import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Loader2, BookOpen, Layers, X, ChevronRight } from 'lucide-react'

const BAR_COUNT = 9

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
      className="flex items-center gap-[2px]"
      style={{ height: 24, width: BAR_COUNT * 5 }}
    >
      {bars.map((v, i) => (
        <div
          key={i}
          className="rounded-[2px]"
          style={{
            width: 3,
            height: Math.max(3, v * 22),
            background: accentColor,
            opacity: 0.5 + v * 0.5,
            transition: 'height 50ms ease-out, opacity 50ms ease-out',
          }}
        />
      ))}
    </div>
  )
}

// ── Pill shell style — no backdropFilter to avoid transparent-window artifacts ─

const PILL_STYLE: React.CSSProperties = {
  background: 'rgba(10,10,10,0.96)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
}

const PROMPT_STYLE: React.CSSProperties = {
  background: 'rgba(10,10,10,0.96)',
  border: '1px solid rgba(255,255,255,0.08)',
  boxShadow: '0 6px 24px rgba(0,0,0,0.4)',
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function CapsuleOverlay() {
  const [mode, setMode] = useState<VisualMode>('hidden')
  const [bars, setBars] = useState<number[]>(Array(BAR_COUNT).fill(0.08))
  const [accentColor, setAccentColor] = useState('#FF006E')
  const [promptData, setPromptData] = useState<PromptData>({})
  const [autoTimer, setAutoTimer] = useState(8)
  const modeRef = useRef<VisualMode>('hidden')

  useEffect(() => { modeRef.current = mode }, [mode])

  useEffect(() => {
    const bridge = window.capsuleBridge
    if (!bridge) return

    bridge.onMode((m) => {
      switch (m) {
        case 'pressed':      setMode('pressed'); break
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

    bridge.sendReady()
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
          style={{ ...PILL_STYLE, borderRadius: 12 }}
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
                  <Loader2 size={12} className="text-white/50" />
                </motion.div>
              </motion.div>
            )}

            {/* Done — lime check */}
            {mode === 'done' && (
              <motion.div
                key="done"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center px-3 py-2"
                style={{ background: 'rgba(173,255,2,0.95)', borderRadius: 10 }}
              >
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.05 }}
                >
                  <Check size={13} style={{ color: '#0A0A0A' }} strokeWidth={3} />
                </motion.div>
              </motion.div>
            )}

            {/* Error — pink X */}
            {mode === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="flex items-center justify-center px-3 py-2"
                style={{ background: 'rgba(255,0,110,0.95)', borderRadius: 10 }}
              >
                <motion.div
                  initial={{ scale: 0 }} animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 18, delay: 0.05 }}
                >
                  <X size={13} className="text-white" strokeWidth={3} />
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
          exit={{ opacity: 0, scale: 0.94, y: 6 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          style={{ ...PROMPT_STYLE, borderRadius: 16, width: 340 }}
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
                  style={{ borderRadius: 8 }}
                  className={`w-7 h-7 flex items-center justify-center shrink-0 ${
                    mode === 'prompt-dictionary' ? 'bg-[#9D4EDD]' : 'bg-[#ADFF02]'
                  }`}
                >
                  {mode === 'prompt-dictionary'
                    ? <BookOpen size={13} className="text-white" />
                    : <Layers size={13} style={{ color: '#0A0A0A' }} />
                  }
                </div>
                <div>
                  <p className="text-[12px] font-bold text-white leading-tight">
                    {mode === 'prompt-dictionary' ? 'New word detected' : 'Save as snippet?'}
                  </p>
                  <p className="text-[10px] text-white/40 leading-tight">
                    {mode === 'prompt-dictionary' ? 'Add replacement rule?' : 'Trigger this phrase anytime'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <svg width="18" height="18" className="shrink-0 -rotate-90">
                  <circle cx="9" cy="9" r="7" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1.5" />
                  <motion.circle
                    cx="9" cy="9" r="7" fill="none"
                    stroke="rgba(255,255,255,0.32)"
                    strokeWidth="1.5"
                    strokeDasharray={2 * Math.PI * 7}
                    animate={{ strokeDashoffset: 2 * Math.PI * 7 * (1 - autoTimer / 8) }}
                    transition={{ duration: 1, ease: 'linear' }}
                  />
                </svg>
                <button onClick={handleSkip} className="text-white/30 hover:text-white/65 transition-colors">
                  <X size={13} />
                </button>
              </div>
            </div>

            {/* Preview */}
            {mode === 'prompt-dictionary' && (
              <div
                className="flex items-center gap-2 mb-3.5 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                <code className="text-[12px] font-bold text-white/70">&ldquo;{promptData.word ?? ''}&rdquo;</code>
                <ChevronRight size={11} className="text-white/25" />
                <code className="text-[12px] font-bold" style={{ color: accentColor }}>
                  &ldquo;{promptData.correction ?? ''}&rdquo;
                </code>
              </div>
            )}

            {mode === 'prompt-snippet' && (
              <div
                className="mb-3.5 px-3 py-2 rounded-xl"
                style={{ background: 'rgba(255,255,255,0.05)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-white/30">trigger:</span>
                  <code className="text-[11px] font-bold text-[#ADFF02]">/{promptData.trigger ?? ''}</code>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                onClick={handleAccept}
                style={{ borderRadius: 10, background: accentColor }}
                className="flex-1 py-2 text-[12px] font-bold text-white"
              >
                {mode === 'prompt-dictionary' ? 'Add rule' : 'Save snippet'}
              </motion.button>
              <motion.button
                whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.94 }}
                onClick={handleSkip}
                style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}
                className="flex-1 py-2 text-[12px] font-semibold text-white/45"
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
