import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, BookOpen, Layers, X, ChevronRight, Pause, Play, ArrowUp } from 'lucide-react'

const BAR_COUNT = 9
const BAR_WIDTH = 2.5
const BAR_GAP = 2
const WAVEFORM_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP

  declare global {
  interface Window {
    capsuleBridge: {
      onMode: (cb: (mode: string) => void) => void
      onLanguage: (cb: (language: string) => void) => void
      onBars: (cb: (bars: number[]) => void) => void
      onAccent: (cb: (color: string) => void) => void
      onStatus: (cb: (message: string | null) => void) => void
      onHandsFree: (cb: (on: boolean) => void) => void
      onPaused: (cb: (on: boolean) => void) => void
      onSession: (cb: (sessionId: string | null) => void) => void
      onShowSnippet: (cb: (data: { trigger: string }) => void) => void
      onShowDict: (cb: (data: { word: string; correction: string }) => void) => void
      onHideExpanded: (cb: () => void) => void
      sendReady: () => void
      sendSnippetResp: (accepted: boolean) => void
      sendDictResp: (accepted: boolean) => void
      sendOpenLastEntry: () => void
      sendPause: (sessionId: string | null) => void
      sendResume: (sessionId: string | null) => void
      sendSend: (sessionId: string | null) => void
      setInteractive: (on: boolean) => void
      cleanup: () => void
    }
  }
}

type VisualMode = 'hidden' | 'pressed' | 'recording' | 'processing' | 'done' | 'error' | 'prompt-snippet' | 'prompt-dictionary'

interface PromptData {
  trigger?: string
  word?: string
  correction?: string
}

// Maps a 0-1 mic level to bar height. The power curve keeps quiet speech visible.
function WaveformBars({ bars, accentColor, paused }: { bars: number[]; accentColor: string; paused: boolean }) {
  return (
    <div
      className="flex items-center justify-center transition-opacity duration-100"
      style={{ height: 24, width: WAVEFORM_WIDTH, gap: BAR_GAP, opacity: paused ? 0.35 : 1 }}
    >
      {bars.map((v, i) => {
        const level = paused ? 0 : Math.pow(Math.min(1, Math.max(0, v)), 0.6)
        return (
          <div
            key={i}
            style={{
              width: BAR_WIDTH,
              borderRadius: 999,
              height: 3 + level * 19,
              background: accentColor,
              opacity: 0.35 + level * 0.65,
              transition: 'height 60ms ease-out, opacity 60ms ease-out',
            }}
          />
        )
      })}
    </div>
  )
}

// Round icon button for the hands-free controls.
function ControlButton({ label, onClick, accentColor, children }: {
  label: string
  onClick: () => void
  accentColor?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`flex items-center justify-center rounded-full transition-colors ${accentColor ? 'hover:brightness-110' : 'bg-white/[0.08] hover:bg-white/[0.14]'}`}
      style={{ width: 24, height: 24, background: accentColor, color: 'rgba(255,255,255,0.85)' }}
    >
      {children}
    </button>
  )
}

// Pause/resume and send buttons. Clicks pass through to the app until the pointer is over them.
function HandsFreeControls({ paused, accentColor, sessionId }: { paused: boolean; accentColor: string; sessionId: string | null }) {
  useEffect(() => () => window.capsuleBridge.setInteractive(false), [])

  return (
    <div
      className="flex items-center gap-1.5"
      onPointerEnter={() => window.capsuleBridge.setInteractive(true)}
      onPointerLeave={() => window.capsuleBridge.setInteractive(false)}
    >
      <ControlButton
        label={paused ? 'Resume' : 'Pause'}
        onClick={() => (paused ? window.capsuleBridge.sendResume(sessionId) : window.capsuleBridge.sendPause(sessionId))}
      >
        {paused ? <Play size={13} /> : <Pause size={13} />}
      </ControlButton>
      <ControlButton label="Send" accentColor={accentColor} onClick={() => window.capsuleBridge.sendSend(sessionId)}>
        <ArrowUp size={13} />
      </ControlButton>
    </div>
  )
}


// ── Dark glass shell — graphite gradient, hairline border, top sheen, layered shadow ──
const PILL_STYLE: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(36,36,41,0.97) 0%, rgba(17,17,20,0.97) 100%)',
  border: '0.5px solid rgba(255,255,255,0.14)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08), rgba(0,0,0,0.40) 0px 1px 2px -0.5px, rgba(0,0,0,0.30) 0px 4px 10px -3px, rgba(0,0,0,0.22) 0px 12px 28px -6px',
}

const PROMPT_STYLE: React.CSSProperties = {
  background: 'linear-gradient(180deg, rgba(34,34,39,0.98) 0%, rgba(17,17,20,0.98) 100%)',
  border: '0.5px solid rgba(255,255,255,0.14)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.07), rgba(0,0,0,0.50) 0px 2px 4px -1px, rgba(0,0,0,0.35) 0px 8px 18px -5px, rgba(0,0,0,0.22) 0px 18px 40px -8px',
}

// Small filled status disc used for done / error.
function StatusDisc({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ scale: 0 }} animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.04 }}
      className="flex shrink-0 items-center justify-center rounded-full"
      style={{ width: 18, height: 18, background: color, boxShadow: `0 0 12px -2px ${color}` }}
    >
      {children}
    </motion.div>
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function CapsuleOverlay() {
  const [mode, setMode] = useState<VisualMode>('hidden')
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.08))
  const [accentColor, setAccentColor] = useState('#7C3AED')
  const [promptData, setPromptData] = useState<PromptData>({})
  const [autoTimer, setAutoTimer] = useState(8)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [handsFree, setHandsFree] = useState(false)
  const [paused, setPaused] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const modeRef = useRef<VisualMode>('hidden')

  useEffect(() => { modeRef.current = mode }, [mode])

  useEffect(() => {
    const bridge = window.capsuleBridge
    if (!bridge) return

    bridge.onMode((m) => {
      switch (m) {
        case 'pressed':
          setHandsFree(false)
          setPaused(false)
          setMode('pressed')
          break
        case 'recording':
          setBars(Array(BAR_COUNT).fill(0.08))
          setMode('recording')
          break
        case 'transcribing': setMode('processing'); break
        case 'done':         setMode('done'); break
        case 'error':        setMode('error'); break
        case 'idle':
          setMode('hidden')
          setBars(Array(BAR_COUNT).fill(0.08))
          setHandsFree(false)
          setPaused(false)
          break
      }
    })

    bridge.onBars((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setBars(data.slice(0, BAR_COUNT))
      }
    })
    bridge.onAccent((color) => setAccentColor(color))
    bridge.onStatus((message) => setStatusMessage(message))
    bridge.onHandsFree((on) => setHandsFree(on))
    bridge.onPaused((on) => setPaused(on))
    bridge.onSession((id) => setSessionId(id))

    bridge.onShowSnippet((data) => {
      setPromptData({ trigger: data.trigger })
      setMode('prompt-snippet')
    })

    bridge.onShowDict((data) => {
      setPromptData({ word: data.word, correction: data.correction })
      setMode('prompt-dictionary')
    })

    bridge.onHideExpanded(() => setMode('hidden'))

    // Send ready signal multiple times to handle HMR timing issues.
    // After sending, the main process may immediately send pending mode
    // updates that race with our listener registration. The triple send
    // with staggered retries ensures the main process receives at least
    // one ready signal after all listeners are wired.
    bridge.sendReady()
    const retry1 = window.setTimeout(() => bridge.sendReady(), 50)
    const retry2 = window.setTimeout(() => bridge.sendReady(), 150)

    return () => {
      window.clearTimeout(retry1)
      window.clearTimeout(retry2)
      bridge.cleanup()
    }
  }, [])

  // 8-second auto-dismiss for prompts
  useEffect(() => {
    const isPrompt = mode === 'prompt-snippet' || mode === 'prompt-dictionary'
    if (!isPrompt) { setAutoTimer(8); return }
    setAutoTimer(8)
    const id = setInterval(() => {
      setAutoTimer((t) => {
        if (t <= 1) { clearInterval(id); handleSkip(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [mode])

  function handleAccept() {
    const m = modeRef.current
    if (m === 'prompt-snippet') window.capsuleBridge.sendSnippetResp(true)
    else window.capsuleBridge.sendDictResp(true)
    setMode('hidden')
  }

  function handleSkip() {
    const m = modeRef.current
    if (m === 'prompt-snippet') window.capsuleBridge.sendSnippetResp(false)
    else window.capsuleBridge.sendDictResp(false)
    setMode('hidden')
  }

  const isPill = mode === 'pressed' || mode === 'recording' || mode === 'processing' || mode === 'done' || mode === 'error'
  const isPrompt = mode === 'prompt-snippet' || mode === 'prompt-dictionary'

  return (
    <AnimatePresence mode="wait">

      {/* ── Pill states ── */}
      {isPill && (
        <motion.div
          key="pill"
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          style={{ ...PILL_STYLE, borderRadius: 999 }}
          className="inline-flex items-center"
        >
          <AnimatePresence mode="wait">

            {/* Pressed — pulsing dot before mic opens */}
            {mode === 'pressed' && (
              <motion.div
                key="pressed"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.1 }}
                className="flex items-center justify-center px-4 py-2"
              >
                <motion.div
                  animate={{ scale: [1, 1.4, 1] }}
                  transition={{ duration: 0.6, repeat: Infinity }}
                  style={{ width: 7, height: 7, borderRadius: '50%', background: accentColor, boxShadow: `0 0 10px ${accentColor}` }}
                />
              </motion.div>
            )}

            {/* Recording — live waveform */}
            {mode === 'recording' && (
              <motion.div
                key="rec"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center px-3 py-1"
              >
                <WaveformBars bars={bars} accentColor={accentColor} paused={paused} />
                {handsFree && (
                  <div className="ml-2">
                    <HandsFreeControls paused={paused} accentColor={accentColor} sessionId={sessionId} />
                  </div>
                )}
              </motion.div>
            )}

            {/* Processing — spinner */}
            {mode === 'processing' && (
              <motion.div
                key="proc"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center gap-[5px] whitespace-nowrap px-4 py-[11px]"
                aria-label="Transcribing"
              >
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={i}
                    animate={{ opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                    transition={{ duration: 0.9, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
                    style={{ width: 5, height: 5, borderRadius: '50%', background: accentColor }}
                  />
                ))}
              </motion.div>
            )}

            {/* Done — mint check */}
            {mode === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center gap-1.5 px-2.5 py-[7px]"
              >
                <StatusDisc color="#22a55a">
                  <Check size={11} style={{ color: '#ffffff' }} strokeWidth={3.5} />
                </StatusDisc>
              </motion.div>
            )}

            {/* Error — soft red X */}
            {mode === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center px-2.5 py-[7px]"
              >
                <StatusDisc color="#e5484d">
                  <X size={11} style={{ color: '#ffffff' }} strokeWidth={3.5} />
                </StatusDisc>
                {statusMessage && <span className="ml-2 mr-1 max-w-[380px] truncate text-[11.5px] font-medium leading-tight" style={{ color: 'rgba(255,255,255,0.88)' }}>{statusMessage}</span>}
              </motion.div>
            )}

          </AnimatePresence>
        </motion.div>
      )}

      {/* ── Prompt card ── */}
      {isPrompt && (
        <motion.div
          key="prompt"
          initial={{ opacity: 0, scale: 0.92, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          style={{ ...PROMPT_STYLE, borderRadius: 18, width: 340 }}
        >
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08, duration: 0.2 }}
            className="p-4"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div
                  style={{
                    borderRadius: 9,
                    background: `${accentColor}33`,
                    boxShadow: `inset 0 0 0 0.5px ${accentColor}66`,
                  }}
                  className="w-7 h-7 flex items-center justify-center shrink-0"
                >
                  {mode === 'prompt-dictionary'
                    ? <BookOpen size={13} style={{ color: '#ffffff' }} />
                    : <Layers size={13} style={{ color: '#ffffff' }} />
                  }
                </div>
                <div>
                  <p className="text-[12px] font-bold leading-tight" style={{ color: '#f3f3f5' }}>
                    {mode === 'prompt-dictionary' ? 'New word detected' : 'Save as snippet?'}
                  </p>
                  <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {mode === 'prompt-dictionary' ? 'Add replacement rule?' : 'Trigger this phrase anytime'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <svg width="18" height="18" className="shrink-0 -rotate-90">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
                  <motion.circle
                    cx="9" cy="9" r="7" fill="none"
                    stroke={accentColor}
                    strokeWidth="1.5"
                    strokeDasharray={2 * Math.PI * 7}
                    animate={{ strokeDashoffset: 2 * Math.PI * 7 * (1 - autoTimer / 8) }}
                    transition={{ duration: 1, ease: 'linear' }}
                  />
                </svg>
                <button onClick={handleSkip} aria-label="Dismiss" className="transition-colors hover:opacity-80" style={{ color: 'rgba(255,255,255,0.40)' }}>
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Preview */}
            {mode === 'prompt-dictionary' && (
              <div
                className="flex items-center gap-2 mb-3.5 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                <code className="text-[12px] font-bold" style={{ color: 'rgba(255,255,255,0.55)' }}>&ldquo;{promptData.word ?? ''}&rdquo;</code>
                <ChevronRight size={11} style={{ color: 'rgba(255,255,255,0.25)' }} />
                <code className="text-[12px] font-bold" style={{ color: accentColor }}>
                  &ldquo;{promptData.correction ?? ''}&rdquo;
                </code>
              </div>
            )}

            {mode === 'prompt-snippet' && (
              <div
                className="mb-3.5 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.07)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.35)' }}>trigger:</span>
                  <code className="text-[11px] font-bold" style={{ color: accentColor }}>/{promptData.trigger ?? ''}</code>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                onClick={handleAccept}
                style={{ borderRadius: 10, background: accentColor, backgroundImage: 'linear-gradient(180deg, rgba(255,255,255,0.18), rgba(255,255,255,0) 60%)', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22)' }}
                className="flex-1 py-2 text-[12px] font-semibold text-white"
              >
                {mode === 'prompt-dictionary' ? 'Add rule' : 'Save snippet'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                onClick={handleSkip}
                style={{ borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '0.5px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}
                className="flex-1 py-2 text-[12px] font-semibold"
              >
                Skip
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}

    </AnimatePresence>
  )
}
