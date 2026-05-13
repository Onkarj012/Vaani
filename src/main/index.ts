import { app, BrowserWindow, ipcMain, session } from "electron";
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
import { IpcChannel } from "@shared/ipc";

const currentDir = dirname(fileURLToPath(import.meta.url));
const mutableApp = app as typeof app & { isQuitting?: boolean };
const logPath = join(tmpdir(), "claude-vaani-startup.log");
const MAIN_RENDERER_READY_TIMEOUT_MS = 5_000;

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let overlayController: OverlayController | null = null;
let recorderController: RecorderWindowController | null = null;
let hotkeyManager: HotkeyManager | null = null;
let settingsStore: SettingsStore | null = null;
let dictationService: DictationService | null = null;
let menuBarMode = true;   // start as "menu bar only" until window is explicitly shown
let rendererReady = false;
let mainWindowOpenRequested = false;
let mainWindowReadyTimer: ReturnType<typeof setTimeout> | null = null;
let lastDockVisible: boolean | null = null;
let dockRestoreTimers: ReturnType<typeof setTimeout>[] = [];
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
    log("window:show-missing");
    return;
  }

  mainWindowOpenRequested = true;
  menuBarMode = false;
  if (mainWindow.webContents.isCrashed()) {
    rendererReady = false;
    mainWindow.reload();
    armMainWindowReadyTimeout(mainWindow);
  } else if (!rendererReady) {
    armMainWindowReadyTimeout(mainWindow);
  }
  log("window:show-requested", {
    rendererReady,
    crashed: mainWindow.webContents.isCrashed(),
    visible: mainWindow.isVisible()
  });
  mainWindow.show();
  mainWindow.focus();
  syncAppPresentation();
}

function clearMainWindowReadyTimeout(): void {
  if (mainWindowReadyTimer) {
    clearTimeout(mainWindowReadyTimer);
    mainWindowReadyTimer = null;
  }
}

function armMainWindowReadyTimeout(win: BrowserWindow): void {
  clearMainWindowReadyTimeout();
  mainWindowReadyTimer = setTimeout(() => {
    if (mainWindow !== win || win.isDestroyed() || rendererReady) {
      return;
    }

    log("renderer:ready-timeout", { loading: win.webContents.isLoading(), visible: win.isVisible() });
    if (!mainWindowOpenRequested && menuBarMode && !win.isVisible()) {
      return;
    }
    if (win.webContents.isCrashed()) {
      win.reload();
    } else if (!win.webContents.isLoading()) {
      win.reload();
    }
    armMainWindowReadyTimeout(win);
  }, MAIN_RENDERER_READY_TIMEOUT_MS);
}

function syncAppPresentation(): void {
  const showInDock = settingsStore?.get().showInDock ?? true;
  const windowIsVisible = !!mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible();
  const shouldShowDock = showInDock && windowIsVisible;

  // Always call dock.show() when the window is visible — macOS or the overlay
  // can knock out the dock icon unexpectedly, so we can't trust cached state.
  if (shouldShowDock) {
    void app.dock?.show();
  } else if (lastDockVisible !== false) {
    app.dock?.hide();
  }
  lastDockVisible = shouldShowDock;
}

function restoreDockForVisibleMainWindow(): void {
  syncAppPresentation();

  clearDockRestoreTimers();
  dockRestoreTimers = [50, 250, 750].map((delay) => {
    const timer = setTimeout(() => {
      syncAppPresentation();
      dockRestoreTimers = dockRestoreTimers.filter((activeTimer) => activeTimer !== timer);
    }, delay);
    return timer;
  });
}

function clearDockRestoreTimers(): void {
  dockRestoreTimers.forEach((timer) => clearTimeout(timer));
  dockRestoreTimers = [];
}

function cleanupRuntimeResources(): void {
  clearMainWindowReadyTimeout();
  clearDockRestoreTimers();
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

  win.webContents.on("did-start-loading", () => {
    rendererReady = false;
    if (mainWindowOpenRequested || !menuBarMode || win.isVisible()) {
      armMainWindowReadyTimeout(win);
    }
  });

  win.webContents.on("did-finish-load", () => {
    log("renderer:loaded", {
      url: win.webContents.getURL(),
      partition: win.webContents.session.storagePath
    });
    if (mainWindowOpenRequested || !menuBarMode || win.isVisible()) {
      armMainWindowReadyTimeout(win);
    } else {
      clearMainWindowReadyTimeout();
    }
    // Fallback: if renderer:ready never fires (HMR timing), activate after a short delay
    setTimeout(() => {
      if (!rendererReady && mainWindow === win && !win.isDestroyed()) {
        log("renderer:ready-fallback");
        rendererReady = true;
        clearMainWindowReadyTimeout();
      }
    }, 400);
  });

  win.webContents.on("did-fail-load", (_event, code, desc) => {
    log("renderer:fail", { code, desc });
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      setTimeout(() => {
        if (!win.isDestroyed() && !rendererReady) {
          win.reload();
        }
      }, 500);
    }
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer:gone", details);
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.reload();
        }
      }, 250);
    }
  });

  win.on("unresponsive", () => {
    log("window:unresponsive");
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      win.webContents.forcefullyCrashRenderer();
      setTimeout(() => {
        if (!win.isDestroyed()) {
          win.reload();
        }
      }, 250);
    }
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
    mainWindowOpenRequested = false;
    menuBarMode = true;
    clearMainWindowReadyTimeout();
    win.hide();
    syncAppPresentation();
  });

  win.on("show", () => {
    log("window:shown");
    mainWindowOpenRequested = true;
    menuBarMode = false;
    syncAppPresentation();
  });

  win.on("hide", () => {
    log("window:hidden", { menuBarMode, mainWindowOpenRequested });
    syncAppPresentation();
  });

  win.on("blur", () => {
    log("window:blur");
  });
  // Do NOT call syncAppPresentation on hide — the overlay window or other
  // transient windows should not affect the dock icon state.

  return win;
}

function configureRendererLifecycle(win: BrowserWindow): void {
  ipcMain.on(IpcChannel.RendererReady, (event) => {
    if (event.sender !== win.webContents) {
      return;
    }

    log("renderer:ready");
    rendererReady = true;
    clearMainWindowReadyTimeout();
    if (!menuBarMode) {
      win.show();
      win.focus();
    }
  });

  ipcMain.on(IpcChannel.RendererError, (event, payload: { message?: string; stack?: string }) => {
    if (event.sender !== win.webContents) {
      return;
    }

    log("renderer:error", {
      message: payload?.message ?? "Renderer error",
      stack: payload?.stack
    });
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    // Log all console messages during debugging (level 0=debug, 1=info, 2=warn, 3=error)
    log("renderer:console", { level, message: message.slice(0, 500), line, sourceId });
  });
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
    log("main:loading-url", { url: MAIN_WINDOW_VITE_DEV_SERVER_URL });
    await win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    return;
  }

  const filePath = join(currentDir, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
  log("main:loading-file", { path: filePath });
  await win.loadFile(filePath);
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
  configureRendererLifecycle(mainWindow);

  overlayController = new OverlayController();
  overlayController.setOnPresent(() => {
    // macOS hides the dock icon when the overlay is shown (activation-policy side effect).
    // Restore it immediately if the main window is still on screen.
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
      void app.dock?.show();
    }
  });
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
  dictationService = dictation;

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
    autoUpdater.setFeedURL({
      provider: "github",
      owner: "Onkarj012",
      repo: "Vaani"
    });
    autoUpdater.on("checking-for-update", () => log("updater:checking"));
    autoUpdater.on("update-available", (info) => log("updater:available", { version: info.version }));
    autoUpdater.on("update-not-available", (info) => log("updater:not-available", { version: info.version }));
    autoUpdater.on("update-downloaded", (info) => log("updater:downloaded", { version: info.version }));
    autoUpdater.on("error", (error) => log("updater:event-error", { message: error.message }));
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
  // Don't steal focus from the user's target app during an active dictation session.
  // The overlay triggers macOS app activation but the main window should stay put.
  const dictationStatus = dictationService?.getState().status;
  if (dictationStatus && dictationStatus !== "idle" && dictationStatus !== "completed" && dictationStatus !== "error") {
    log("activate:suppressed", { dictationStatus });
    restoreDockForVisibleMainWindow();
    return;
  }
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (mutableApp.isQuitting) {
    app.quit();
  }
});
