import { vi } from "vitest";

// Mock electron BEFORE any imports
vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getName: () => "Vaani Test",
    getPath: (name: string) => `/tmp/vaani-test/${name}`,
    setActivationPolicy: () => {},
    dock: {
      show: () => Promise.resolve(),
      hide: () => {}
    }
  },
  BrowserWindow: class {
    webContents = { send: () => {}, on: () => {}, once: () => {} };
    constructor() {}
    isDestroyed() { return false; }
    destroy() {}
    hide() {}
    show() {}
    showInactive() {}
    focus() {}
    loadURL() { return Promise.resolve(); }
    loadFile() { return Promise.resolve(); }
    setBounds() {}
    setVisibleOnAllWorkspaces() {}
    setAlwaysOnTop() {}
    setIgnoreMouseEvents() {}
    excludedFromShownWindowsMenu = false;
  },
  globalShortcut: { register: () => true, unregister: () => {}, isRegistered: () => false },
  clipboard: { readText: () => "", writeText: () => {} },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
  ipcRenderer: { invoke: () => Promise.resolve(), send: () => {}, on: () => {}, removeListener: () => {} },
  contextBridge: { exposeInMainWorld: () => {} },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) }
}), { virtual: true });
