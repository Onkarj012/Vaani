import { contextBridge, ipcRenderer } from 'electron'
import type { OverlayPrompt, OverlayPromptReply, OverlayPromptResult, OverlayStatus } from '@shared/types'

const OVERLAY_CHANNELS = [
  'capsule:set-mode',
  'capsule:set-lang',
  'capsule:update-level',
  'capsule:set-accent',
  'capsule:set-status',
  'capsule:show-prompt',
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
  onLevel: (cb: (level: number) => void) => {
    ipcRenderer.on('capsule:update-level', (_e, level: number) => cb(level))
  },
  onAccent: (cb: (color: string) => void) => {
    ipcRenderer.on('capsule:set-accent', (_e, c: string) => cb(c))
  },
  onStatus: (cb: (status: OverlayStatus | null) => void) => {
    ipcRenderer.on('capsule:set-status', (_e, status: OverlayStatus | null) => cb(status))
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
  onShowPrompt: (cb: (prompt: OverlayPrompt) => void) => {
    ipcRenderer.on('capsule:show-prompt', (_e, prompt: OverlayPrompt) => cb(prompt))
  },
  onHideExpanded: (cb: () => void) => {
    ipcRenderer.on('capsule:hide-expanded', () => cb())
  },
  sendReady: () => ipcRenderer.send('capsule:ready'),
  replyPrompt: (reply: OverlayPromptReply): Promise<OverlayPromptResult> => ipcRenderer.invoke('capsule:prompt-reply', reply),
  setPromptHeld: (held: boolean) => ipcRenderer.send('capsule:prompt-hold', held),
  sendOpenLastEntry: () => ipcRenderer.send('capsule:open-last-entry'),
  sendPause: (sessionId: string) => ipcRenderer.send('capsule:pause', sessionId),
  sendResume: (sessionId: string) => ipcRenderer.send('capsule:resume', sessionId),
  sendSend: (sessionId: string) => ipcRenderer.send('capsule:send', sessionId),
  setInteractive: (on: boolean) => ipcRenderer.send('capsule:set-interactive', on),
  cleanup: () => {
    for (const ch of OVERLAY_CHANNELS) ipcRenderer.removeAllListeners(ch)
  },
})
