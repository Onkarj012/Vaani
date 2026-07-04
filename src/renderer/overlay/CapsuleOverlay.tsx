import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, BookOpen, Layers, X, ChevronRight } from 'lucide-react'

const BAR_COUNT = 9
const BAR_WIDTH = 2.5
const BAR_GAP = 2
const WAVEFORM_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP

  declare global {
  interface Window {
    capsuleBridge: {
      onMode: (cb: (mode: string) => void) => void
      onBars: (cb: (bars: number[]) => void) => void
      onAccent: (cb: (color: string) => void) => void
      onShowSnippet: (cb: (data: { trigger: string }) => void) => void
      onShowDict: (cb: (data: { word: string; correction: string }) => void) => void
      onHideExpanded: (cb: () => void) => void
      sendReady: () => void
      sendSnippetResp: (accepted: boolean) => void
      sendDictResp: (accepted: boolean) => void
      sendOpenLastEntry: () => void
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

function WaveformBars({ bars, accentColor }: { bars: number[]; accentColor: string }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ height: 24, width: WAVEFORM_WIDTH, gap: BAR_GAP }}
    >
      {bars.map((v, i) => (
        <div
          key={i}
          style={{
            width: BAR_WIDTH,
            borderRadius: 999,
            height: Math.max(3, Math.min(22, v * 18)),
            background: accentColor,
            opacity: 0.3 + v * 0.7,
            transition: 'height 60ms ease-out, opacity 60ms ease-out',
          }}
        />
      ))}
    </div>
  )
}


//    over any background. ───────────────────────────────────────────────────────

// ── Dark pill shell — near-black, soft border, layered shadow ────────────────
const PILL_STYLE: React.CSSProperties = {
  background: 'rgba(18,18,20,0.97)',
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: 'rgba(0,0,0,0.40) 0px 1px 2px -0.5px, rgba(0,0,0,0.30) 0px 4px 10px -3px, rgba(0,0,0,0.20) 0px 12px 28px -6px',
}

const PROMPT_STYLE: React.CSSProperties = {
  background: 'rgba(18,18,20,0.97)',
  border: '1px solid rgba(255,255,255,0.09)',
  boxShadow: 'rgba(0,0,0,0.50) 0px 2px 4px -1px, rgba(0,0,0,0.35) 0px 8px 18px -5px, rgba(0,0,0,0.20) 0px 18px 40px -8px',
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function CapsuleOverlay() {
  const [mode, setMode] = useState<VisualMode>('hidden')
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.08))
  const [accentColor, setAccentColor] = useState('#7575c8')
  const [promptData, setPromptData] = useState<PromptData>({})
  const [autoTimer, setAutoTimer] = useState(8)
  const modeRef = useRef<VisualMode>('hidden')

  useEffect(() => { modeRef.current = mode }, [mode])

  useEffect(() => {
    const bridge = window.capsuleBridge
    if (!bridge) return

    bridge.onMode((m) => {
      switch (m) {
        case 'pressed':
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
          break
      }
    })

    bridge.onBars((data) => {
      if (Array.isArray(data) && data.length > 0) {
        setBars(data.slice(0, BAR_COUNT))
      }
    })
    bridge.onAccent((color) => setAccentColor(color))

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
        if (t <= 1) { clearInterval(id); handleDismiss(); return 0 }
        return t - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [mode])

  function handlePrimary() {
    const m = modeRef.current
    if (m === 'prompt-snippet') window.capsuleBridge.sendSnippetResp(true)
    else window.capsuleBridge.sendDictResp(false)
    setMode('hidden')
  }

  function handleDismiss() {
    const m = modeRef.current
    if (m === 'prompt-snippet') window.capsuleBridge.sendSnippetResp(false)
    else window.capsuleBridge.sendDictResp(true)
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
                  style={{ width: 7, height: 7, borderRadius: '50%', background: accentColor }}
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
                <WaveformBars bars={bars} accentColor={accentColor} />
              </motion.div>
            )}

            {/* Processing — spinner */}
            {mode === 'processing' && (
              <motion.div
                key="proc"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center px-3 py-2"
              >
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                >
                  <Loader2 size={12} style={{ color: 'rgba(255,255,255,0.45)' }} />
                </motion.div>
              </motion.div>
            )}

            {/* Done — mint check */}
            {mode === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center gap-1.5 px-3 py-2"
                style={{ background: 'rgba(90,138,42,0.85)', borderRadius: 11 }}
              >
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.05 }}
                >
                  <Check size={13} style={{ color: '#ffffff' }} strokeWidth={3} />
                </motion.div>
              </motion.div>
            )}

            {/* Error — soft red X */}
            {mode === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center px-3 py-2"
                style={{ background: 'rgba(209,67,67,0.85)', borderRadius: 11 }}
              >
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.05 }}
                >
                  <X size={13} style={{ color: '#ffffff' }} strokeWidth={3} />
                </motion.div>
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
                    background: mode === 'prompt-dictionary' ? 'rgba(44,127,184,0.25)' : 'rgba(154,123,26,0.25)',
                  }}
                  className="w-7 h-7 flex items-center justify-center shrink-0"
                >
                  {mode === 'prompt-dictionary'
                    ? <BookOpen size={13} style={{ color: '#7ec8f0' }} />
                    : <Layers size={13} style={{ color: '#e6c34d' }} />
                  }
                </div>
                <div>
                  <p className="text-[12px] font-bold leading-tight" style={{ color: '#f3f3f5' }}>
                    {mode === 'prompt-dictionary' ? 'Added to dictionary' : 'Save as snippet?'}
                  </p>
                  <p className="text-[10px] leading-tight" style={{ color: 'rgba(255,255,255,0.45)' }}>
                    {mode === 'prompt-dictionary' ? 'Undo if this was not wanted' : 'Trigger this phrase anytime'}
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
                <button onClick={handleDismiss} className="transition-colors" style={{ color: 'rgba(255,255,255,0.30)' }}>
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
                onClick={handlePrimary}
                style={{ borderRadius: 999, background: accentColor }}
                className="flex-1 py-2 text-[12px] font-bold text-white"
              >
                {mode === 'prompt-dictionary' ? 'Undo' : 'Save snippet'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                onClick={handleDismiss}
                style={{ borderRadius: 999, border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.45)' }}
                className="flex-1 py-2 text-[12px] font-semibold"
              >
                {mode === 'prompt-dictionary' ? 'Keep' : 'Skip'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}

    </AnimatePresence>
  )
}
