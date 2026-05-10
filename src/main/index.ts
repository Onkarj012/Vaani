import { app, BrowserWindow, session } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { DictationService } from "./dictation";
import { HotkeyManager } from "./hotkeys";
import { registerIpcHandlers } from "./ipc";
import { OverlayController } from "./overlay";
import { RecorderWindowController } from "./recorderWindow";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { createTray, type TrayController } from "./tray";

const currentDir = dirname(fileURLToPath(import.meta.url));
const mutableApp = app as typeof app & { isQuitting?: boolean };
const logPath = join(tmpdir(), "claude-vaani-startup.log");

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let overlayController: OverlayController | null = null;
let recorderController: RecorderWindowController | null = null;
let hotkeyManager: HotkeyManager | null = null;
let settingsStore: SettingsStore | null = null;
let menuBarMode = true;   // start as "menu bar only" until window is explicitly shown
let windowHasLoaded = false;
let lastDockVisible: boolean | null = null;
let trayController: TrayController = {
  updateStatus: () => undefined,
  destroy: () => undefined
};

function log(label: string, data?: unknown): void {
  try {
    const line = `[${new Date().toISOString()}] ${label}${data !== undefined ? ` ${JSON.stringify(data)}` : ""}\n`;
    appendFileSync(logPath, line, "utf8");
  } catch {
    // best-effort logging
  }
}

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  menuBarMode = false;
  mainWindow.show();
  mainWindow.focus();
  syncAppPresentation();
}

function syncAppPresentation(): void {
  // Dock icon shows only when:
  // - showInDock setting is enabled, AND
  // - the window has actually been shown, AND
  // - user has not sent the window to the menu bar (X-button close)
  //
  // Pressing the global hotkey does NOT affect menuBarMode — only explicit
  // window close/open actions do. This prevents the dock icon from blinking
  // on and off during recording.
  const showInDock = settingsStore?.get().showInDock ?? true;
  const shouldShowDock = showInDock && windowHasLoaded && !menuBarMode;

  if (lastDockVisible === shouldShowDock) {
    return;
  }

  if (shouldShowDock) {
    void app.dock?.show();
  } else {
    app.dock?.hide();
  }
  lastDockVisible = shouldShowDock;
}

function cleanupRuntimeResources(): void {
  hotkeyManager?.unregister();
  hotkeyManager = null;
  recorderController?.destroy();
  recorderController = null;
  overlayController?.destroy();
  overlayController = null;
  trayController.destroy();
  trayController = { updateStatus: () => undefined, destroy: () => undefined };
}

function createMainWindow(trayEnabled: () => boolean): BrowserWindow {
  const win = new BrowserWindow({
    width: 920,
    height: 680,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#0C0B09",
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    show: false,
    webPreferences: {
      preload: join(currentDir, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.webContents.on("did-finish-load", () => {
    log("renderer:ready");
    // Show the window with the new UI
    if (!menuBarMode) {
      win.show();
      win.focus();
    }
  });

  win.webContents.on("did-fail-load", (_event, code, desc) => {
    log("renderer:fail", { code, desc });
  });

  win.on("close", (event) => {
    if (mutableApp.isQuitting) {
      return;
    }

    if (!trayEnabled()) {
      mutableApp.isQuitting = true;
      return;
    }

    event.preventDefault();
    menuBarMode = true;
    win.hide();
    syncAppPresentation();
  });

  win.on("show", () => {
    menuBarMode = false;
    windowHasLoaded = true;
    syncAppPresentation();
  });
  // Do NOT call syncAppPresentation on hide — the overlay window or other
  // transient windows should not affect the dock icon state.

  return win;
}

function configureMediaPermissions(): void {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === "media") {
      const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
      const audioOnly = mediaTypes.length === 0 || mediaTypes.every((type) => type === "audio");
      callback(audioOnly);
      log("permission:media", { audioOnly, mediaTypes });
      return;
    }

    callback(false);
  });
}

async function loadWindowUrl(win: BrowserWindow): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  await win.loadFile(join(currentDir, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`));
}

async function bootstrap(): Promise<void> {
  log("bootstrap:start");

  const settings = new SettingsStore();
  settingsStore = settings;
  const history = new HistoryStore();
  await settings.init();
  
  // Start hidden from dock — main window isn't visible yet. The dock icon
  // will appear when the window is shown (via syncAppPresentation()).
  app.dock?.hide();
  lastDockVisible = false;

  let trayReady = false;

  configureMediaPermissions();

  mainWindow = createMainWindow(() => trayReady);

  overlayController = new OverlayController();
  recorderController = new RecorderWindowController();
  const initSettings = settings.get();
  overlayController.setTheme("aurora");
  overlayController.setColorMode(initSettings.colorMode ?? "light");
  if (initSettings.accentColor) overlayController.setAccentColor(initSettings.accentColor);
  overlayController.setCapsuleStyle({
    borderWidth:  initSettings.capsuleBorderWidth,
    barRadius:    initSettings.capsuleBarRadius,
    cornerRadius: initSettings.capsuleCornerRadius,
  });
  if (initSettings.capsuleDesign) overlayController.setCapsuleDesign(initSettings.capsuleDesign);

  // Create dictation service first so it can be passed to tray
  const dictation = new DictationService(
    mainWindow,
    settings,
    history,
    (label) => trayController.updateStatus(label),
    overlayController,
    { recorder: recorderController }
  );

  // Now create tray with the dictation callback
  try {
    trayController = createTray(
      () => showMainWindow(),
      () => {
        mutableApp.isQuitting = true;
        app.quit();
      },
      () => dictation.beginHotkeySession(),
      () => { void dictation.pasteLatestEntry(); }
    );
    trayReady = true;
  } catch (error) {
    log("tray:error", { message: error instanceof Error ? error.message : String(error) });
  }

  hotkeyManager = new HotkeyManager(
    () => settings.get(),
    () => dictation.beginHotkeySession(),
    () => dictation.endHotkeySession(),
    () => dictation.cancelSession(),
    () => {
      dictation.pasteLatestEntry().catch((err) => {
        console.error("[vaani] paste latest failed:", err);
      });
    },
    (message) => dictation.reportHotkeyUnavailable(message)
  );

  registerIpcHandlers({
    mainWindow,
    dictation,
    history,
    settings,
    hotkeys: hotkeyManager,
    recorder: recorderController,
    onSettingsUpdated: (_updated, patch) => {
      if ("theme" in patch) {
        overlayController?.setTheme("aurora");
      }
      if ("colorMode" in patch && patch.colorMode) {
        overlayController?.setColorMode(patch.colorMode);
      }
      if ("accentColor" in patch && patch.accentColor) {
        overlayController?.setAccentColor(patch.accentColor);
      }
      if ("capsuleBorderWidth" in patch || "capsuleBarRadius" in patch || "capsuleCornerRadius" in patch) {
        overlayController?.setCapsuleStyle({
          borderWidth:  patch.capsuleBorderWidth,
          barRadius:    patch.capsuleBarRadius,
          cornerRadius: patch.capsuleCornerRadius,
        });
      }
      if ("capsuleDesign" in patch && patch.capsuleDesign) {
        overlayController?.setCapsuleDesign(patch.capsuleDesign);
      }
      if ("showInDock" in patch) {
        syncAppPresentation();
      }
    }
  });

  await loadWindowUrl(mainWindow);
  await recorderController.init();
  setTimeout(() => hotkeyManager?.register(), 300);
  setTimeout(() => overlayController?.prewarm(), 1500);

  // Auto-updater (only in packaged builds)
  if (app.isPackaged) {
    autoUpdater.logger = {
      info: (msg) => log("updater:info", msg),
      warn: (msg) => log("updater:warn", msg),
      error: (msg) => log("updater:error", msg),
      debug: (msg) => log("updater:debug", msg)
    };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log("updater:check-error", { message: err instanceof Error ? err.message : String(err) });
    });
  }

  log("bootstrap:complete");
}

process.on("uncaughtException", (error) => {
  log("uncaughtException", { message: error.message });
});

process.on("unhandledRejection", (reason) => {
  log("unhandledRejection", { reason: String(reason) });
});

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  log("second-instance:exit");
  app.quit();
}

app.on("second-instance", () => {
  log("second-instance:focus");
  showMainWindow();
});

app.on("before-quit", () => {
  mutableApp.isQuitting = true;
  cleanupRuntimeResources();
});

app.whenReady()
  .then(() => bootstrap())
  .catch((error) => {
    log("bootstrap:error", { message: error instanceof Error ? error.message : String(error) });
  });

app.on("activate", () => {
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (mutableApp.isQuitting) {
    app.quit();
  }
});
