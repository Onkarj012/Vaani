import { contextBridge, ipcRenderer } from 'electron'

const OVERLAY_CHANNELS = [
  'capsule:set-mode',
  'capsule:update-bars',
  'capsule:set-accent',
  'capsule:show-snippet',
  'capsule:show-dictionary',
  'capsule:show-toast',
  'capsule:hide-expanded',
  'capsule:set-lang',
] as const

contextBridge.exposeInMainWorld('capsuleBridge', {
  onMode: (cb: (mode: string) => void) => {
    ipcRenderer.on('capsule:set-mode', (_e, m: string) => cb(m))
  },
  onBars: (cb: (bars: number[]) => void) => {
    ipcRenderer.on('capsule:update-bars', (_e, b: number[]) => cb(b))
  },
  onAccent: (cb: (color: string) => void) => {
    ipcRenderer.on('capsule:set-accent', (_e, c: string) => cb(c))
  },
  onShowSnippet: (cb: (data: { trigger: string }) => void) => {
    ipcRenderer.on('capsule:show-snippet', (_e, d: { trigger: string }) => cb(d))
  },
  onShowDict: (cb: (data: { word: string; correction: string }) => void) => {
    ipcRenderer.on('capsule:show-dictionary', (_e, d: { word: string; correction: string }) => cb(d))
  },
  onShowToast: (cb: (data: { word: string; correction: string }) => void) => {
    ipcRenderer.on('capsule:show-toast', (_e, d: { word: string; correction: string }) => cb(d))
  },
  onHideExpanded: (cb: () => void) => {
    ipcRenderer.on('capsule:hide-expanded', () => cb())
  },
  onLanguage: (cb: (lang: string) => void) => {
    ipcRenderer.on('capsule:set-lang', (_e, lang: string) => cb(lang))
  },
  sendReady: () => ipcRenderer.send('capsule:ready'),
  sendSnippetResp: (accepted: boolean) => ipcRenderer.send('capsule:snippet-response', { accepted }),
  sendDictResp: (accepted: boolean) => ipcRenderer.send('capsule:dictionary-response', { accepted }),
  sendToastUndo: () => ipcRenderer.send('capsule:toast-undo'),
  sendOpenLastEntry: () => ipcRenderer.send('capsule:open-last-entry'),
  cleanup: () => {
    for (const ch of OVERLAY_CHANNELS) ipcRenderer.removeAllListeners(ch)
  },
})
