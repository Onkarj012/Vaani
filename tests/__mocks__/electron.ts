// Mock electron module for unit tests
// This provides minimal stubs for the electron APIs used in the main process

export const app = {
  isPackaged: false,
  getName: () => "Vaani Test",
  getPath: (name: string) => `/tmp/vaani-test/${name}`,
  setActivationPolicy: () => {},
  dock: {
    show: () => Promise.resolve(),
    hide: () => {}
  }
};

export const BrowserWindow = class MockBrowserWindow {
  webContents = {
    send: () => {},
    on: () => {},
    once: () => {}
  };

  constructor(_options?: unknown) {}

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
};

export const globalShortcut = {
  register: () => true,
  unregister: () => {},
  isRegistered: () => false
};

export const clipboard = {
  readText: () => "",
  writeText: () => {}
};

export const ipcMain = {
  handle: () => {},
  on: () => {},
  removeHandler: () => {}
};

export const ipcRenderer = {
  invoke: () => Promise.resolve(),
  send: () => {},
  on: () => {},
  removeListener: () => {}
};

export const contextBridge = {
  exposeInMainWorld: () => {}
};

export const screen = {
  getPrimaryDisplay: () => ({
    workArea: { x: 0, y: 0, width: 1920, height: 1080 }
  })
};

export const session = {
  defaultSession: {
    setPermissionRequestHandler: () => {}
  }
};

export default {
  app,
  BrowserWindow,
  globalShortcut,
  clipboard,
  ipcMain,
  ipcRenderer,
  contextBridge,
  screen,
  session
};
