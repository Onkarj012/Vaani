import { contextBridge, ipcRenderer } from 'electron'

const OVERLAY_CHANNELS = [
  'capsule:set-mode',
  'capsule:set-lang',
  'capsule:update-bars',
  'capsule:set-accent',
  'capsule:set-status',
  'capsule:show-snippet',
  'capsule:show-dictionary',
  'capsule:hide-expanded',
  'capsule:set-hands-free',
  'capsule:set-paused',
  'capsule:set-session',
] as const

contextBridge.exposeInMainWorld('capsuleBridge', {
  onMode: (cb: (mode: string) => void) => {
    ipcRenderer.on('capsule:set-mode', (_e, m: string) => cb(m))
  },
  onLanguage: (cb: (language: string) => void) => {
    ipcRenderer.on('capsule:set-lang', (_e, language: string) => cb(language))
  },
  onBars: (cb: (bars: number[]) => void) => {
    ipcRenderer.on('capsule:update-bars', (_e, b: number[]) => cb(b))
  },
  onAccent: (cb: (color: string) => void) => {
    ipcRenderer.on('capsule:set-accent', (_e, c: string) => cb(c))
  },
  onStatus: (cb: (message: string | null) => void) => {
    ipcRenderer.on('capsule:set-status', (_e, message: string | null) => cb(message))
  },
  onHandsFree: (cb: (on: boolean) => void) => {
    ipcRenderer.on('capsule:set-hands-free', (_e, on: boolean) => cb(on))
  },
  onPaused: (cb: (on: boolean) => void) => {
    ipcRenderer.on('capsule:set-paused', (_e, on: boolean) => cb(on))
  },
  onSession: (cb: (sessionId: string | null) => void) => {
    ipcRenderer.on('capsule:set-session', (_e, sessionId: string | null) => cb(sessionId))
  },
  onShowSnippet: (cb: (data: { trigger: string }) => void) => {
    ipcRenderer.on('capsule:show-snippet', (_e, d: { trigger: string }) => cb(d))
  },
  onShowDict: (cb: (data: { word: string; correction: string }) => void) => {
    ipcRenderer.on('capsule:show-dictionary', (_e, d: { word: string; correction: string }) => cb(d))
  },
  onHideExpanded: (cb: () => void) => {
    ipcRenderer.on('capsule:hide-expanded', () => cb())
  },
  sendReady: () => ipcRenderer.send('capsule:ready'),
  sendSnippetResp: (accepted: boolean) => ipcRenderer.send('capsule:snippet-response', { accepted }),
  sendDictResp: (accepted: boolean) => ipcRenderer.send('capsule:dictionary-response', { accepted }),
  sendOpenLastEntry: () => ipcRenderer.send('capsule:open-last-entry'),
  sendPause: (sessionId: string) => ipcRenderer.send('capsule:pause', sessionId),
  sendResume: (sessionId: string) => ipcRenderer.send('capsule:resume', sessionId),
  sendSend: (sessionId: string) => ipcRenderer.send('capsule:send', sessionId),
  setInteractive: (on: boolean) => ipcRenderer.send('capsule:set-interactive', on),
  cleanup: () => {
    for (const ch of OVERLAY_CHANNELS) ipcRenderer.removeAllListeners(ch)
  },
})
