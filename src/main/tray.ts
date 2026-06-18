import { Menu, Tray, app, nativeImage } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

const TRAY_LANGUAGES: Array<{ value: string; label: string }> = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
  { value: "ta", label: "Tamil" },
  { value: "pa", label: "Punjabi" },
  { value: "mr", label: "Marathi" },
  { value: "bn", label: "Bengali" },
  { value: "gu", label: "Gujarati" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
  { value: "ml", label: "Malayalam" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "ja", label: "Japanese" },
  { value: "zh", label: "Chinese" },
  { value: "ko", label: "Korean" },
  { value: "ar", label: "Arabic" },
  { value: "pt", label: "Portuguese" },
  { value: "ru", label: "Russian" },
];

const RECENT_HISTORY_LIMIT = 10;
const RECENT_LABEL_MAX = 60;
const MENU_DEBOUNCE_MS = 300;

export interface TrayController {
  updateStatus: (label: string) => void;
  setOfflineMode: (offline: boolean) => void;
  destroy: () => void;
}

export interface TrayOptions {
  openMainWindow: () => void;
  quit: () => void;
  startDictation?: () => void;
  pasteLatest?: () => void;
  getRecentHistory: () => Promise<Array<{ id: string; cleanedText: string }>>;
  reinjectEntry: (id: string) => Promise<void>;
  getLanguage: () => string;
  setLanguage: (language: string) => void;
}

function trimRecentLabel(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= RECENT_LABEL_MAX) return flat || "(empty)";
  return `${flat.slice(0, RECENT_LABEL_MAX - 1)}…`;
}

export function createTray(options: TrayOptions): TrayController {
  let icon: Electron.NativeImage;
  let isOffline = false;
  const candidatePaths = [
    join(process.resourcesPath ?? "", "trayTemplate@2x.png"),
    join(currentDir, "../../assets/iconset/trayTemplate@2x.png"),
    join(currentDir, "../../../assets/iconset/trayTemplate@2x.png"),
  ];

  let loaded = false;
  for (const p of candidatePaths) {
    try {
      const candidate = nativeImage.createFromPath(p);
      if (!candidate.isEmpty()) {
        icon = candidate.resize({ width: 18, height: 18, quality: "best" });
        icon.setTemplateImage(true);
        loaded = true;
        break;
      }
    } catch {
      // try next path
    }
  }

  if (!loaded) {
    icon = nativeImage.createFromDataURL(
      `data:image/svg+xml;utf8,${encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">' +
        '<rect x="2.5" y="5" width="2.8" height="10" rx="1.4" fill="white"/>' +
        '<rect x="8.6" y="2" width="2.8" height="16" rx="1.4" fill="white"/>' +
        '<rect x="14.7" y="6" width="2.8" height="8" rx="1.4" fill="white"/>' +
        '</svg>'
      )}`
    );
    icon.setTemplateImage(true);
  }

  const tray = new Tray(icon!);
  tray.setToolTip("Vaani — Voice Dictation");
  tray.setIgnoreDoubleClickEvents(true);

  let currentStatus = "Ready";
  let lastMenuAt = 0;

  const buildMenu = (
    status: string,
    recent: Array<{ id: string; cleanedText: string }>,
  ): Electron.Menu => {
    const offlineIndicator = isOffline ? " [Offline]" : "";
    const statusIcon =
      status === "Recording…" ? "🔴" :
      status === "Transcribing…" || status === "Processing…" ? "🔵" :
      status === "Done" || status === "Saved" ? "✅" :
      status === "Error" ? "⚠️" : isOffline ? "🔸" : "⚪";

    const activeLanguage = options.getLanguage();
    const languageSubmenu: Electron.MenuItemConstructorOptions[] = TRAY_LANGUAGES.map((lang) => ({
      label: lang.label,
      type: "checkbox",
      checked: lang.value === activeLanguage,
      click: () => options.setLanguage(lang.value),
    }));

    const recentItems: Electron.MenuItemConstructorOptions[] = recent.length === 0
      ? [{ label: "No recent dictations", enabled: false }]
      : recent.slice(0, RECENT_HISTORY_LIMIT).map((entry) => ({
          label: trimRecentLabel(entry.cleanedText),
          click: () => { void options.reinjectEntry(entry.id); },
        }));

    return Menu.buildFromTemplate([
      { label: `${statusIcon}  ${status}${offlineIndicator}`, enabled: false },
      { type: "separator" },
      { label: "Open Vaani", accelerator: "Cmd+Shift+V", click: options.openMainWindow },
      ...(options.startDictation
        ? [{ label: "Start Dictation", click: options.startDictation }]
        : []),
      ...(options.pasteLatest
        ? [{ label: "Paste Latest", click: options.pasteLatest }]
        : []),
      { type: "separator" },
      { label: "Language", submenu: languageSubmenu },
      { label: "Recent History", submenu: recentItems },
      { type: "separator" },
      { label: "Preferences…", click: () => { options.openMainWindow(); } },
      { type: "separator" },
      {
        label: "About Vaani",
        click: () => {
          app.setAboutPanelOptions({
            applicationName: "Vaani",
            applicationVersion: app.getVersion(),
            copyright: "© 2024 Vaani. All rights reserved.",
            credits: "Voice dictation powered by Whisper & Claude.",
          });
          app.showAboutPanel();
        },
      },
      { type: "separator" },
      { label: "Quit Vaani", accelerator: "Cmd+Q", click: options.quit },
    ]);
  };

  const showMenu = async (bounds?: Electron.Rectangle): Promise<void> => {
    const now = Date.now();
    // macOS fires both "click" and "mouse-up" for one physical click; debounce.
    if (now - lastMenuAt < MENU_DEBOUNCE_MS) return;
    lastMenuAt = now;
    let recent: Array<{ id: string; cleanedText: string }> = [];
    try {
      recent = await options.getRecentHistory();
    } catch {
      recent = [];
    }
    tray.popUpContextMenu(buildMenu(currentStatus, recent), bounds);
  };

  tray.on("right-click", (_event, bounds) => { void showMenu(bounds); });
  tray.on("click", () => { void showMenu(); });
  tray.on("mouse-up", () => { void showMenu(); });

  return {
    updateStatus: (label) => { currentStatus = label; },
    setOfflineMode: (offline: boolean) => {
      isOffline = offline;
      tray.setToolTip(offline ? "Vaani — Voice Dictation [Offline]" : "Vaani — Voice Dictation");
    },
    destroy: () => tray.destroy(),
  };
}
