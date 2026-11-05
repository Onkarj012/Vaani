import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, RefObject } from 'react'
import { ArrowUp, BookOpen, Check, ChevronRight, Layers, Pause, Play, X } from 'lucide-react'
import type { OverlayPrompt, OverlayPromptReply, OverlayPromptResult, OverlayStatus } from '@shared/types'
import { dictionaryEditError, normalizeSnippetTrigger, overlayErrorTitle, snippetEditError } from '@shared/overlayPrompt'
import { focusMountedPrompt, nextCountdown, nextPromptFocusIndex, overlayPromptKeyAction } from './overlayPrompt'
import { LevelHistory, RIBBON_HEIGHT, RIBBON_WIDTH, accentInk, ribbonBars } from './ribbon'

interface CapsuleBridge {
  onMode: (cb: (mode: string) => void) => void
  onLanguage: (cb: (language: string) => void) => void
  onLevel: (cb: (level: number) => void) => void
  onAccent: (cb: (color: string) => void) => void
  onStatus: (cb: (status: OverlayStatus | null) => void) => void
  onHandsFree: (cb: (on: boolean) => void) => void
  onPaused: (cb: (on: boolean) => void) => void
  onSession: (cb: (sessionId: string | null) => void) => void
  onShowPrompt: (cb: (prompt: OverlayPrompt) => void) => void
  onHideExpanded: (cb: () => void) => void
  sendReady: () => void
  replyPrompt: (reply: OverlayPromptReply) => Promise<OverlayPromptResult>
  setPromptHeld: (held: boolean) => void
  sendOpenLastEntry: () => void
  sendPause: (sessionId: string | null) => void
  sendResume: (sessionId: string | null) => void
  sendSend: (sessionId: string | null) => void
  setInteractive: (on: boolean) => void
  cleanup: () => void
}

declare global {
  interface Window {
    capsuleBridge: CapsuleBridge
  }
}

type Visual = 'pressed' | 'recording' | 'settle' | 'processing' | 'done' | 'error' | 'cancelled' | 'prompt' | 'saved'
type CSSVars = CSSProperties & Record<`--${string}`, string>

// Push-to-talk release: bars settle this long before the processing dots.
const SETTLE_MS = 260
const COUNTDOWN_TICK_MS = 100

interface PromptView {
  prompt: OverlayPrompt
  edit: boolean
  // Spoken/written for dictionary, trigger/text for snippet.
  first: string
  second: string
  error: string | null
  busy: boolean
}

// Original values of a prompt, in first/second order.
function promptValues(prompt: OverlayPrompt): [string, string] {
  return prompt.kind === 'dictionary' ? [prompt.spoken, prompt.written] : [prompt.trigger, prompt.text]
}

// Client-side check before sending an edit; main checks again with what only it knows.
function editError(view: PromptView): string | null {
  return view.prompt.kind === 'dictionary'
    ? dictionaryEditError({ spoken: view.first, written: view.second })
    : snippetEditError({ trigger: view.first, text: view.second })
}

// Live ribbon waveform on a canvas. Reads the level from a ref so IPC frames never re-render React.
function Ribbon({ levelRef, mode, accent }: { levelRef: RefObject<number>; mode: 'live' | 'paused' | 'settle'; accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef(mode)
  const accentRef = useRef(accent)
  modeRef.current = mode
  accentRef.current = accent

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(RIBBON_WIDTH * dpr)
    canvas.height = Math.round(RIBBON_HEIGHT * dpr)
    ctx.scale(dpr, dpr)
    const history = new LevelHistory()
    let gain = 1
    let last = performance.now()
    let raf = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const m = modeRef.current
      history.step(m === 'live' ? levelRef.current ?? 0 : 0, dt)
      gain += ((m === 'live' ? 1 : 0) - gain) * (1 - Math.exp(-dt / (m === 'settle' ? 0.1 : 0.08)))
      ctx.clearRect(0, 0, RIBBON_WIDTH, RIBBON_HEIGHT)
      ctx.fillStyle = accentRef.current
      for (const bar of ribbonBars((lag) => history.at(lag) * gain, now / 1000)) {
        ctx.globalAlpha = Math.min(1, Math.max(0, bar.alpha))
        ctx.beginPath()
        ctx.roundRect(bar.x, (RIBBON_HEIGHT - bar.height) / 2, bar.width, bar.height, bar.width / 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [levelRef])

  return <canvas ref={canvasRef} className="wv" style={{ width: RIBBON_WIDTH, height: RIBBON_HEIGHT }} aria-hidden="true" />
}

// Dictionary or snippet card: suggestion, edit form, and countdown bar.
function PromptCard({ view, remaining, onChange, onAccept, onEdit, onBack, onSkip, onHeldChange }: {
  view: PromptView
  remaining: number
  onChange: (first: string, second: string) => void
  onAccept: () => void
  onEdit: () => void
  onBack: () => void
  onSkip: () => void
  onHeldChange: (held: boolean) => void
}) {
  const dict = view.prompt.kind === 'dictionary'
  const label = dict ? 'Add rule' : 'Save snippet'
  const cardRef = useRef<HTMLDivElement | null>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const hoverRef = useRef(false)
  const focusRef = useRef(false)

  // Held while hovered, while a control inside has keyboard focus, or while editing.
  const syncHeld = useCallback(() => {
    const card = cardRef.current
    const active = document.activeElement
    focusRef.current = !!card && document.hasFocus() && active !== card && card.contains(active)
    onHeldChange(view.edit || hoverRef.current || focusRef.current)
  }, [onHeldChange, view.edit])

  useEffect(() => {
    syncHeld()
    const later = () => window.setTimeout(syncHeld, 0)
    window.addEventListener('blur', later)
    window.addEventListener('focus', later)
    return () => {
      window.removeEventListener('blur', later)
      window.removeEventListener('focus', later)
    }
  }, [syncHeld])

  useEffect(() => {
    if (view.edit) firstFieldRef.current?.focus({ preventScroll: true })
  }, [view.edit, view.error])

  // Focus the card when React commits it, so Escape and Tab reach this window.
  const setCardRef = useCallback((node: HTMLDivElement | null) => {
    cardRef.current = node
    focusMountedPrompt(node)
  }, [])

  const countdownStyle: CSSVars = { '--p': Math.max(0, Math.min(1, remaining / view.prompt.durationMs)).toFixed(3) }

  return (
    <div
      ref={setCardRef}
      id="overlay-prompt"
      className="card"
      role="dialog"
      aria-modal="true"
      aria-labelledby="overlay-prompt-title"
      aria-describedby="overlay-prompt-description"
      tabIndex={-1}
      onPointerEnter={() => { hoverRef.current = true; syncHeld() }}
      onPointerLeave={() => { hoverRef.current = false; syncHeld() }}
      onFocus={() => window.setTimeout(syncHeld, 0)}
      onBlur={() => window.setTimeout(syncHeld, 0)}
    >
      <div className="ch">
        <span className={`ci ${dict ? 'dict' : 'snip'}`}>{dict ? <BookOpen size={14} aria-hidden="true" /> : <Layers size={14} aria-hidden="true" />}</span>
        <div className="ct">
          <b id="overlay-prompt-title">{dict ? 'Add to dictionary?' : 'Save as snippet?'}</b>
          <span id="overlay-prompt-description">{dict ? 'Replace this every time you say it.' : 'Say the trigger to insert this phrase.'}</span>
        </div>
        <button type="button" className="cx" onClick={onSkip} aria-label="Dismiss"><X size={13} aria-hidden="true" /></button>
      </div>

      {!view.edit && dict && (
        <div className="pv">
          <div className="pvc"><small>Heard</small><code>{view.first}</code></div>
          <span className="arr"><ChevronRight size={13} aria-hidden="true" /></span>
          <div className="pvc"><small>Writes</small><code className="acc">{view.second}</code></div>
        </div>
      )}
      {!view.edit && !dict && (
        <div className="pv snp">
          <div className="pvc"><small>Trigger</small><code className="acc">/{normalizeSnippetTrigger(view.first)}</code></div>
          <p>{view.second}</p>
        </div>
      )}
      {view.edit && (
        <div className="ed">
          {dict ? (
            <>
              <label><span>Heard</span><input ref={firstFieldRef} value={view.first} onChange={(e) => onChange(e.target.value, view.second)} autoComplete="off" spellCheck={false} /></label>
              <label><span>Write as</span><input value={view.second} onChange={(e) => onChange(view.first, e.target.value)} autoComplete="off" spellCheck={false} /></label>
            </>
          ) : (
            <>
              <label><span>Trigger</span><span className="pre"><i>/</i><input ref={firstFieldRef} value={view.first} onChange={(e) => onChange(e.target.value, view.second)} autoComplete="off" spellCheck={false} /></span></label>
              <label><span>Phrase</span><textarea rows={2} value={view.second} onChange={(e) => onChange(view.first, e.target.value)} spellCheck={false} /></label>
            </>
          )}
          {view.error && <p className="er" role="alert">{view.error}</p>}
        </div>
      )}

      <div className="acts">
        <button type="button" className="b pri" onClick={onAccept} disabled={view.busy}>{label}</button>
        {view.edit
          ? <button type="button" className="b" onClick={onBack}>Back</button>
          : <>
              <button type="button" className="b" onClick={onEdit}>Edit</button>
              <button type="button" className="b ghost" onClick={onSkip}>Skip</button>
            </>}
      </div>
      {!view.edit && <div className="cd" aria-hidden="true"><i style={countdownStyle} /></div>}
    </div>
  )
}

// ── Main overlay ──────────────────────────────────────────────────────────────

export default function CapsuleOverlay() {
  const [visual, setVisual] = useState<Visual>('pressed')
  const [visible, setVisible] = useState(false)
  const [accentColor, setAccentColor] = useState('#7575c8')
  const [status, setStatus] = useState<OverlayStatus | null>(null)
  const [handsFree, setHandsFree] = useState(false)
  const [paused, setPaused] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [promptView, setPromptView] = useState<PromptView | null>(null)
  const [saved, setSaved] = useState<{ title: string; sub: string } | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [held, setHeld] = useState(false)

  const levelRef = useRef(0)
  const visualRef = useRef<Visual>('pressed')
  const visibleRef = useRef(false)
  // True if this recording was ever hands-free; those skip the push-to-talk settle.
  const sessionHandsFreeRef = useRef(false)
  const settleTimerRef = useRef<number | null>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  const show = useCallback((next: Visual) => {
    visualRef.current = next
    visibleRef.current = true
    setVisual(next)
    setVisible(true)
  }, [])

  const hide = useCallback(() => {
    visibleRef.current = false
    setVisible(false)
  }, [])

  const clearSettle = useCallback(() => {
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current)
    settleTimerRef.current = null
  }, [])

  useEffect(() => {
    const bridge = window.capsuleBridge
    if (!bridge) return

    bridge.onMode((m) => {
      switch (m) {
        case 'pressed':
          clearSettle()
          sessionHandsFreeRef.current = false
          setHandsFree(false)
          setPaused(false)
          setPromptView(null)
          show('pressed')
          break
        case 'recording':
          clearSettle()
          if (visualRef.current !== 'recording') levelRef.current = 0
          show('recording')
          break
        case 'transcribing':
          // Main resends modes; a repeat must not cut the settle short.
          if (visualRef.current === 'settle' || visualRef.current === 'processing') break
          if (visualRef.current === 'recording' && visibleRef.current && !sessionHandsFreeRef.current) {
            show('settle')
            settleTimerRef.current = window.setTimeout(() => {
              settleTimerRef.current = null
              if (visualRef.current === 'settle') show('processing')
            }, SETTLE_MS)
          } else {
            show('processing')
          }
          break
        case 'done': clearSettle(); show('done'); break
        case 'error': clearSettle(); show('error'); break
        case 'cancelled': clearSettle(); show('cancelled'); break
        case 'idle':
          clearSettle()
          hide()
          setHandsFree(false)
          setPaused(false)
          break
      }
    })

    bridge.onLevel((level) => {
      if (Number.isFinite(level)) levelRef.current = Math.min(1, Math.max(0, level))
    })
    bridge.onAccent((color) => setAccentColor(color))
    bridge.onStatus((next) => setStatus(next))
    bridge.onHandsFree((on) => {
      if (on) sessionHandsFreeRef.current = true
      setHandsFree(on)
    })
    bridge.onPaused((on) => setPaused(on))
    bridge.onSession((id) => setSessionId(id))

    bridge.onShowPrompt((prompt) => {
      clearSettle()
      const [first, second] = promptValues(prompt)
      setPromptView({ prompt, edit: false, first, second, error: null, busy: false })
      setRemaining(prompt.durationMs)
      setSaved(null)
      show('prompt')
    })

    bridge.onHideExpanded(() => {
      if (visualRef.current === 'prompt' || visualRef.current === 'saved') hide()
    })

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
      clearSettle()
      bridge.cleanup()
    }
  }, [clearSettle, hide, show])

  // ── Prompt actions ──

  const promptOpen = visible && visual === 'prompt' && promptView !== null

  const skip = useCallback(() => {
    const view = promptView
    if (!view) return
    hide()
    void window.capsuleBridge.replyPrompt({ id: view.prompt.id, accepted: false }).catch(() => undefined)
  }, [hide, promptView])

  const accept = useCallback(async () => {
    const view = promptView
    if (!view || view.busy) return
    const error = view.edit ? editError(view) : null
    if (error) { setPromptView({ ...view, error }); return }
    const id = view.prompt.id
    setPromptView({ ...view, busy: true, error: null })
    let result: OverlayPromptResult
    try {
      result = await window.capsuleBridge.replyPrompt({ id, accepted: true, first: view.first, second: view.second })
    } catch {
      result = { ok: false, error: 'Could not save. Try again from Settings.' }
    }
    if (result.ok) {
      const dict = view.prompt.kind === 'dictionary'
      setSaved(dict
        ? { title: 'Rule added', sub: `${view.first.trim()} → ${view.second.trim()}` }
        : { title: 'Snippet saved', sub: `/${normalizeSnippetTrigger(view.first)}` })
      show('saved')
      return
    }
    // Main refused (for example a trigger taken since the card opened): show why in the edit form.
    setPromptView((current) => current && current.prompt.id === id ? { ...current, busy: false, edit: true, error: result.error } : current)
  }, [promptView, show])

  const back = useCallback(() => {
    setPromptView((view) => {
      if (!view) return view
      const [first, second] = promptValues(view.prompt)
      return { ...view, edit: false, error: null, first: view.first.trim() ? view.first : first, second: view.second.trim() ? view.second : second }
    })
  }, [])

  // Countdown bar. Main owns the real 8 s timer; this mirrors it and pauses on the same signal.
  useEffect(() => {
    if (!promptOpen) return
    const id = window.setInterval(() => setRemaining((r) => nextCountdown(r, COUNTDOWN_TICK_MS, held)), COUNTDOWN_TICK_MS)
    return () => window.clearInterval(id)
  }, [promptOpen, held])

  useEffect(() => {
    if (promptOpen) window.capsuleBridge?.setPromptHeld(held)
  }, [promptOpen, held])

  // Escape skips or backs out of Edit. Enter submits only from an edit field. Tab stays in the card.
  useEffect(() => {
    if (!promptOpen || !promptView) return
    const editing = promptView.edit
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const action = overlayPromptKeyAction(event.key, {
        editing,
        inField: !!target?.matches('input, textarea'),
        inTextarea: target?.tagName === 'TEXTAREA',
        shiftKey: event.shiftKey,
      })
      if (action) {
        event.preventDefault()
        if (action === 'skip') skip()
        else if (action === 'back') back()
        else void accept()
        return
      }
      if (event.key !== 'Tab') return
      const root = document.getElementById('overlay-prompt')
      if (!root) return
      const focusable = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea'))
      event.preventDefault()
      if (focusable.length === 0) return
      const index = document.activeElement instanceof HTMLElement ? focusable.indexOf(document.activeElement) : -1
      focusable[nextPromptFocusIndex(index, focusable.length, event.shiftKey)]?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [promptOpen, promptView, skip, back, accept])

  // ── Shell sizing: the shell animates to the body's measured size, so width and height morph ──

  const wasVisibleRef = useRef(false)
  const fit = useCallback(() => {
    const shell = shellRef.current
    const body = bodyRef.current
    if (!shell || !body || !body.offsetWidth) return
    shell.style.width = `${body.offsetWidth + 2}px`
    shell.style.height = `${body.offsetHeight + 2}px`
  }, [])

  useLayoutEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    if (visible && !wasVisibleRef.current) {
      // Appearing: jump to size without morphing from the last state, then morph again.
      shell.setAttribute('data-nomorph', '')
      fit()
      requestAnimationFrame(() => requestAnimationFrame(() => shell.removeAttribute('data-nomorph')))
    } else if (visible) {
      fit()
    }
    wasVisibleRef.current = visible
  })

  useEffect(() => {
    const body = bodyRef.current
    if (!body || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => { if (visibleRef.current) fit() })
    observer.observe(body)
    return () => observer.disconnect()
  }, [fit])

  // ── Hands-free pointer: clicks pass through to the app until the pointer is over the capsule ──

  const handsFreeControls = visible && visual === 'recording' && handsFree
  useEffect(() => {
    if (!handsFreeControls) return
    return () => window.capsuleBridge?.setInteractive(false)
  }, [handsFreeControls])

  const shellStyle: CSSVars = { '--accent': accentColor, '--accent-ink': accentInk(accentColor) }
  const errorTitle = status ? overlayErrorTitle(status.reason, status.insertion) : null

  return (
    <div ref={shellRef} className="ovx" style={shellStyle} data-hidden={visible ? undefined : ''} inert={!visible}>
      <div ref={bodyRef} className="ovx-body">
        {visual === 'pressed' && (
          <div className="pl pressed" role="img" aria-label="Opening microphone"><span className="dot" /></div>
        )}

        {(visual === 'recording' || visual === 'settle') && (
          <div
            className={`pl rec${handsFreeControls ? ' hf' : ''}${paused ? ' paused' : ''}`}
            role={handsFreeControls ? 'group' : 'img'}
            aria-label={paused ? 'Recording paused' : 'Recording'}
            onPointerEnter={handsFreeControls ? () => window.capsuleBridge.setInteractive(true) : undefined}
            onPointerLeave={handsFreeControls ? () => window.capsuleBridge.setInteractive(false) : undefined}
          >
            {handsFreeControls && (
              <button
                type="button"
                className="cb"
                data-act={paused ? 'resume' : 'pause'}
                aria-label={paused ? 'Resume' : 'Pause'}
                title={paused ? 'Resume' : 'Pause'}
                onClick={() => (paused ? window.capsuleBridge.sendResume(sessionId) : window.capsuleBridge.sendPause(sessionId))}
              >
                {paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
              </button>
            )}
            <Ribbon levelRef={levelRef} mode={visual === 'settle' ? 'settle' : paused ? 'paused' : 'live'} accent={accentColor} />
            {handsFreeControls && (
              <button type="button" className="cb send" aria-label="Send" title="Send" onClick={() => window.capsuleBridge.sendSend(sessionId)}>
                <ArrowUp size={13} strokeWidth={2.4} aria-hidden="true" />
              </button>
            )}
          </div>
        )}

        {visual === 'processing' && (
          <div className="pl proc" role="img" aria-label="Processing"><i /><i /><i /><i /><i /></div>
        )}

        {visual === 'done' && (
          <div className={`pl done${status ? ' withnote' : ''}`} role="status">
            <span className="disc ok"><Check size={13} strokeWidth={3.2} className="check" aria-hidden="true" /></span>
            {status ? <span className="msg">{status.message}</span> : <span className="sr">Done</span>}
          </div>
        )}

        {visual === 'error' && (
          <div className="pl err" role="alert">
            <span className="disc bad"><X size={13} strokeWidth={3.2} aria-hidden="true" /></span>
            {status
              ? <div className="txt">{errorTitle ? <><b>{errorTitle}</b><span>{status.message}</span></> : <b>{status.message}</b>}</div>
              : <span className="sr">Error</span>}
          </div>
        )}

        {visual === 'cancelled' && (
          <div className="pl cancel" role="status">
            <span className="disc neutral"><X size={12} strokeWidth={3} aria-hidden="true" /></span>
            <span className="msg">Cancelled</span>
          </div>
        )}

        {visual === 'saved' && saved && (
          <div className="pl saved" role="status">
            <span className="disc ok"><Check size={13} strokeWidth={3.2} className="check" aria-hidden="true" /></span>
            <div className="txt"><b>{saved.title}</b><span>{saved.sub}</span></div>
          </div>
        )}

        {visual === 'prompt' && promptView && (
          <PromptCard
            key={promptView.prompt.id}
            view={promptView}
            remaining={remaining}
            onChange={(first, second) => setPromptView((view) => view && { ...view, first, second, error: null })}
            onAccept={() => void accept()}
            onEdit={() => setPromptView((view) => view && { ...view, edit: true })}
            onBack={back}
            onSkip={skip}
            onHeldChange={setHeld}
          />
        )}
      </div>
    </div>
  )
}
