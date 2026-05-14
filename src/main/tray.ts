import { Menu, Tray, app, nativeImage } from "electron";
import { join } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = dirname(fileURLToPath(import.meta.url));

export interface TrayController {
  updateStatus: (label: string) => void;
  setOfflineMode: (offline: boolean) => void;
  destroy: () => void;
}

export function createTray(
  onOpen: () => void,
  onQuit: () => void,
  onStartDictation?: () => void,
  onPasteLatest?: () => void
): TrayController {
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

  const buildMenu = (status: string) => {
    const offlineIndicator = isOffline ? " [Offline]" : "";
    const statusIcon =
      status === "Recording…" ? "🔴" :
      status === "Transcribing…" || status === "Processing…" ? "🔵" :
      status === "Done" || status === "Saved" ? "✅" :
      status === "Error" ? "⚠️" : isOffline ? "🔸" : "⚪";

    return Menu.buildFromTemplate([
      {
        label: `${statusIcon}  ${status}${offlineIndicator}`,
        enabled: false,
      },
      { type: "separator" },
      { label: "Open Vaani", accelerator: "Cmd+Shift+V", click: onOpen },
      ...(onStartDictation
        ? [{ label: "Start Dictation", click: onStartDictation }]
        : []),
      ...(onPasteLatest
        ? [{ label: "Paste Latest", click: onPasteLatest }]
        : []),
      { type: "separator" },
      {
        label: "Preferences…",
        click: () => { onOpen(); },
      },
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
      { label: "Quit Vaani", accelerator: "Cmd+Q", click: onQuit },
    ]);
  };

  tray.on("right-click", (_event, bounds) => {
    tray.popUpContextMenu(buildMenu(currentStatus), bounds);
  });

  tray.on("click", () => { onOpen(); });
  tray.on("mouse-up", () => { onOpen(); });

  return {
    updateStatus: (label) => { currentStatus = label; },
    setOfflineMode: (offline: boolean) => {
      isOffline = offline;
      tray.setToolTip(offline ? "Vaani — Voice Dictation [Offline]" : "Vaani — Voice Dictation");
    },
    destroy: () => tray.destroy(),
  };
}
