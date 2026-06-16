import { app, BrowserWindow, ipcMain, session } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync, existsSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { UpdateNotificationPayload } from "@shared/types";
import { DictationService } from "./dictation";
import { HotkeyManager } from "./hotkeys";
import { registerIpcHandlers } from "./ipc";
import { OverlayController } from "./overlay";
import { RecorderWindowController } from "./recorderWindow";
import { HistoryStore } from "./store/history";
import { SettingsStore } from "./store/settings";
import { CredentialsStore } from "./store/credentials";
import { createTray, type TrayController } from "./tray";
import { IpcChannel } from "@shared/ipc";
import { assertValidWhisperModelName } from "@shared/whisperModels";
import { getProviderRegistry } from "./providers";
import { loadWhisperModel } from "./providers/local/whisperCpp";
import { error } from "@main/log";

const currentDir = dirname(fileURLToPath(import.meta.url));
const mutableApp = app as typeof app & { isQuitting?: boolean };
const logPath = join(tmpdir(), "vaani-startup.log");
const MAIN_RENDERER_READY_TIMEOUT_MS = 5_000;

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

let mainWindow: BrowserWindow | null = null;
let overlayController: OverlayController | null = null;
let recorderController: RecorderWindowController | null = null;
let hotkeyManager: HotkeyManager | null = null;
let settingsStore: SettingsStore | null = null;
let credentialsStore: CredentialsStore | null = null;
let dictationService: DictationService | null = null;
let menuBarMode = true;
let rendererReady = false;
let mainWindowOpenRequested = false;
let mainWindowReadyTimer: ReturnType<typeof setTimeout> | null = null;
let lastDockVisible: boolean | null = null;
let suppressDashboardActivationUntil = 0;
export let cachedUpdateStatus: UpdateNotificationPayload | null = null;
let trayController: TrayController = {
  updateStatus: () => undefined,
  setOfflineMode: () => undefined,
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

export function setCachedUpdateStatus(payload: UpdateNotificationPayload | null): void {
  cachedUpdateStatus = payload;
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
  app.focus({ steal: true });
  // Ensure the window stays on top — sometimes focus is stolen back by the OS
  setTimeout(() => mainWindow?.focus(), 200);
  syncAppPresentation();
}

function isDictationActive(): boolean {
  const status = dictationService?.getState().status;
  return !!status && status !== "idle" && status !== "completed" && status !== "error";
}

function suppressDashboardActivation(reason: string, durationMs = 2_500): void {
  suppressDashboardActivationUntil = Math.max(suppressDashboardActivationUntil, Date.now() + durationMs);
  log("activate:suppress-window", { reason, until: suppressDashboardActivationUntil });
}

function shouldSuppressDashboardActivation(): boolean {
  return isDictationActive() || Date.now() < suppressDashboardActivationUntil;
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
    if (mainWindow !== win || win.isDestroyed() || rendererReady) return;
    log("renderer:ready-timeout", { loading: win.webContents.isLoading(), visible: win.isVisible() });
    if (!mainWindowOpenRequested && menuBarMode && !win.isVisible()) return;
    if (shouldSuppressDashboardActivation()) {
      log("renderer:ready-timeout-suppressed");
      armMainWindowReadyTimeout(win);
      return;
    }
    if (win.webContents.isCrashed()) { win.reload(); }
    else if (!win.webContents.isLoading()) { win.reload(); }
  }, MAIN_RENDERER_READY_TIMEOUT_MS);
}

function syncAppPresentation(): void {
  const showInDock = settingsStore?.get().showInDock ?? true;
  const mainWindowExists = !!mainWindow && !mainWindow.isDestroyed();
  const shouldShowDock = showInDock && mainWindowExists && mainWindowOpenRequested && !menuBarMode;

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

function preserveDockIfDashboardOpen(): void {
  const showInDock = settingsStore?.get().showInDock ?? true;
  const mainWindowExists = !!mainWindow && !mainWindow.isDestroyed();
  const shouldShowDock = showInDock && mainWindowExists && mainWindowOpenRequested && !menuBarMode;
  if (!shouldShowDock) return;

  for (const delayMs of [0, 100, 300, 700]) {
    setTimeout(() => {
      const stillShouldShowDock =
        (settingsStore?.get().showInDock ?? true) &&
        !!mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindowOpenRequested &&
        !menuBarMode;
      if (stillShouldShowDock) {
        void app.dock?.show();
        lastDockVisible = true;
      }
    }, delayMs);
  }
}

function cleanupRuntimeResources(): void {
  clearMainWindowReadyTimeout();
  dictationService?.destroy();
  hotkeyManager?.unregister();
  hotkeyManager = null;
  recorderController?.destroy();
  recorderController = null;
  overlayController?.destroy();
  overlayController = null;
  trayController.destroy();
  trayController = { updateStatus: () => undefined, setOfflineMode: () => undefined, destroy: () => undefined };
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
    log("renderer:start-loading", { rendererReady });
    if (rendererReady) return;
    if (mainWindowOpenRequested || !menuBarMode || win.isVisible()) {
      armMainWindowReadyTimeout(win);
    }
  });

  win.webContents.on("did-finish-load", () => {
    log("renderer:loaded", { url: win.webContents.getURL() });
    rendererReady = true;
    clearMainWindowReadyTimeout();
  });

  win.webContents.on("did-fail-load", (_event, code, desc) => {
    log("renderer:fail", { code, desc });
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      setTimeout(() => { if (!win.isDestroyed() && !rendererReady) win.reload(); }, 500);
    }
  });

  win.webContents.on("render-process-gone", (_event, details) => {
    log("renderer:gone", details);
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 250);
    }
  });

  win.on("unresponsive", () => {
    log("window:unresponsive");
    rendererReady = false;
    clearMainWindowReadyTimeout();
    if (mainWindowOpenRequested || !menuBarMode) {
      win.webContents.forcefullyCrashRenderer();
      setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 250);
    }
  });

  win.on("close", (event) => {
    if (mutableApp.isQuitting) return;
    if (!trayEnabled()) { mutableApp.isQuitting = true; return; }
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
  });

  win.on("blur", () => { log("window:blur"); });

  return win;
}

function configureRendererLifecycle(win: BrowserWindow): void {
  ipcMain.on(IpcChannel.RendererReady, (event) => {
    if (event.sender !== win.webContents) return;
    log("renderer:ready");
    rendererReady = true;
    clearMainWindowReadyTimeout();
    if (!menuBarMode && !shouldSuppressDashboardActivation()) {
      win.show();
      win.focus();
    } else if (!menuBarMode) {
      log("renderer:ready-focus-suppressed");
      syncAppPresentation();
    }
  });

  ipcMain.on(IpcChannel.RendererError, (event, payload: { message?: string; stack?: string }) => {
    if (event.sender !== win.webContents) return;
    log("renderer:error", { message: payload?.message ?? "Renderer error", stack: payload?.stack });
  });

  win.webContents.on("console-message", (_event, level, message, line, sourceId) => {
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

  // Migrate legacy data directory (.claude_vaani → .vaani)
  const home = app.getPath("home");
  const oldDir = join(home, ".claude_vaani");
  const newDir = join(home, ".vaani");
  if (existsSync(oldDir) && !existsSync(newDir)) {
    try { renameSync(oldDir, newDir); log("migration:data-dir"); } catch { /* best-effort */ }
  }

  const settings = new SettingsStore();
  settingsStore = settings;
  const history = new HistoryStore();
  await settings.init();

  // Initialize credentials store and migrate legacy API keys
  credentialsStore = new CredentialsStore();
  const initSettings = settings.get();
  const migrationPatch = await credentialsStore.migrateFromSettings(initSettings);
  if (Object.keys(migrationPatch).length > 0) {
    settings.update(migrationPatch);
    log("credentials:migrated");
  }

  // Initialize provider registry with active providers from settings
  const registry = getProviderRegistry();
  registry.setActiveTranscription(initSettings.transcriptionProvider || "groq");
  registry.setActiveFormatting(initSettings.formattingProvider || "groq-llm");

  // Don't hide dock immediately — let syncAppPresentation() manage it once
  // the window decides whether to show. Prevents window from appearing then
  // being sent to background.
  lastDockVisible = null;

  let trayReady = false;
  configureMediaPermissions();

  mainWindow = createMainWindow(() => trayReady);
  configureRendererLifecycle(mainWindow);

  overlayController = new OverlayController();
  recorderController = new RecorderWindowController();
  overlayController.setTheme("aurora");
  overlayController.setColorMode(initSettings.colorMode ?? "light");
  if (initSettings.accentColor) overlayController.setAccentColor(initSettings.accentColor);
  overlayController.setCapsuleStyle({
    borderWidth: initSettings.capsuleBorderWidth,
    barRadius: initSettings.capsuleBarRadius,
    cornerRadius: initSettings.capsuleCornerRadius,
  });
  if (initSettings.capsuleDesign) overlayController.setCapsuleDesign(initSettings.capsuleDesign);

  const dictation = new DictationService(
    mainWindow,
    settings,
    history,
    (label) => trayController.updateStatus(label),
    overlayController,
    { recorder: recorderController, credentials: credentialsStore }
  );
  dictationService = dictation;

  try {
    trayController = createTray(
      () => showMainWindow(),
      () => { mutableApp.isQuitting = true; app.quit(); },
      () => dictation.beginHotkeySession(),
      () => { void dictation.pasteLatestEntry(); }
    );
    trayReady = true;
  } catch (error) {
    log("tray:error", { message: error instanceof Error ? error.message : String(error) });
  }

  hotkeyManager = new HotkeyManager(
    () => settings.get(),
    () => {
      suppressDashboardActivation("hotkey");
      dictation.beginHotkeySession();
      preserveDockIfDashboardOpen();
    },
    () => dictation.endHotkeySession(),
    () => dictation.cancelSession(),
    () => { dictation.pasteLatestEntry().catch((err) => { error("main", `paste latest failed: ${err instanceof Error ? err.message : String(err)}`); }); },
    (message) => dictation.reportHotkeyUnavailable(message)
  );

  registerIpcHandlers({
    mainWindow,
    dictation,
    history,
    settings,
    hotkeys: hotkeyManager,
    recorder: recorderController,
    credentials: credentialsStore,
    onSettingsUpdated: (_updated, patch) => {
      if ("theme" in patch) overlayController?.setTheme("aurora");
      if ("colorMode" in patch && patch.colorMode) overlayController?.setColorMode(patch.colorMode);
      if ("accentColor" in patch && patch.accentColor) overlayController?.setAccentColor(patch.accentColor);
      if ("capsuleBorderWidth" in patch || "capsuleBarRadius" in patch || "capsuleCornerRadius" in patch) {
        overlayController?.setCapsuleStyle({
          borderWidth: patch.capsuleBorderWidth,
          barRadius: patch.capsuleBarRadius,
          cornerRadius: patch.capsuleCornerRadius,
        });
      }
      if ("capsuleDesign" in patch && patch.capsuleDesign) overlayController?.setCapsuleDesign(patch.capsuleDesign);
      if ("showInDock" in patch) syncAppPresentation();
      if ("offlineMode" in patch) trayController.setOfflineMode(patch.offlineMode === "always-offline");
      if ("localWhisperModel" in patch && patch.localWhisperModel) {
        const modelsDir = join(homedir(), ".vaani", "models");
        try {
          assertValidWhisperModelName(patch.localWhisperModel);
          const ok = loadWhisperModel(join(modelsDir, `ggml-${patch.localWhisperModel}.bin`));
          if (!ok) error("whisper", `Failed to load local model ${patch.localWhisperModel}`);
        } catch (err) {
          error("whisper", `Invalid local model ${patch.localWhisperModel}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  });

  await loadWindowUrl(mainWindow);
  setTimeout(() => showMainWindow(), 100);
  setTimeout(() => hotkeyManager?.register(), 300);

  // Auto-updater (only in packaged builds)
  if (app.isPackaged) {
    autoUpdater.logger = {
      info: (msg) => log("updater:info", msg),
      warn: (msg) => log("updater:warn", msg),
      error: (msg) => log("updater:error", msg),
      debug: (msg) => log("updater:debug", msg)
    };
    autoUpdater.setFeedURL({ provider: "github", owner: "Onkarj012", repo: "Vaani" });

    function sendUpdateNotification(payload: UpdateNotificationPayload): void {
      cachedUpdateStatus = payload;
      mainWindow?.webContents.send(IpcChannel.UpdateNotification, payload);
    }

    autoUpdater.on("checking-for-update", () => log("updater:checking"));
    autoUpdater.on("update-available", (info) => {
      log("updater:available", { version: info.version });
      sendUpdateNotification({
        version: info.version,
        status: "downloading",
        message: `Update ${info.version} downloading…`,
      });
    });
    autoUpdater.on("update-not-available", (info) => {
      log("updater:not-available", { version: info.version });
      // Don't clear cache if a download is in progress or already ready
      if (cachedUpdateStatus?.status !== "ready" && cachedUpdateStatus?.status !== "downloading") {
        cachedUpdateStatus = null;
      }
    });
    autoUpdater.on("update-downloaded", (info) => {
      log("updater:downloaded", { version: info.version });
      sendUpdateNotification({
        version: info.version,
        status: "ready",
        message: `Vaani ${info.version} ready — restart to update`,
      });
    });
    autoUpdater.on("error", (err) => {
      log("updater:event-error", { message: err.message });
      // Clear a stuck "downloading" cache so renderers don't show a perpetual banner
      if (cachedUpdateStatus?.status === "downloading") {
        sendUpdateNotification({
          status: "error",
          message: `Update failed: ${err.message}`,
        });
      }
    });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.checkForUpdates().catch((err) => {
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
if (!hasLock) { log("second-instance:exit"); app.quit(); }

app.on("second-instance", () => { log("second-instance:focus"); showMainWindow(); });

app.on("before-quit", () => { mutableApp.isQuitting = true; cleanupRuntimeResources(); });

app.whenReady()
  .then(() => bootstrap())
  .catch((error) => {
    log("bootstrap:error", { message: error instanceof Error ? error.message : String(error) });
  });

app.on("activate", () => {
  if (shouldSuppressDashboardActivation()) {
    log("activate:suppressed", { dictationStatus: dictationService?.getState().status });
    return;
  }
  showMainWindow();
});

app.on("window-all-closed", () => {
  if (mutableApp.isQuitting) app.quit();
});
