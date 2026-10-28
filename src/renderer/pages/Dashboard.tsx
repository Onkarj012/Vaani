import { motion } from 'framer-motion'
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  Copy,
  Keyboard,
  Layers,
  Loader2,
  Mic,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useMemo, useState, useEffect, useRef, type ReactNode } from 'react'
import { useVaaniUi } from '../context/vaani-ui'
import type { CustomCorrection, DictationEntry, PermissionStatus, Settings } from '@shared/types'
import { KNOWN_PROVIDERS } from '@shared/defaults'
import { getPermissionStatusIndicator, getPermissionStatusLabel } from '@shared/permissionGuard'
import { countWords } from '@renderer/lib/historyDerivations'
import { buildProof, proofSummaryLine, summarizeProof } from '@renderer/lib/proofMarks'
import { Card } from '@renderer/components/ui/card'
import { Tag } from '@renderer/components/ui/tag'
import { Button } from '@renderer/components/ui/button'
import { Capsule } from '@renderer/components/ui/Capsule'
import { Kbd } from '@renderer/components/ui/Kbd'

const TYPING_WPM = 45
const APP_TONES = ['bg-chip-lav', 'bg-chip-sky', 'bg-chip-mint', 'bg-chip-blush', 'bg-chip-peach', 'bg-chip-butter'] as const
const MOD_SYMBOLS: Record<string, string> = { Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Option: '⌥', Alt: '⌥', Shift: '⇧', Fn: 'fn' }
const PERMISSION_ROWS = [
  { key: 'microphone', title: 'Microphone', icon: Mic },
  { key: 'accessibility', title: 'Accessibility', icon: Keyboard },
] as const

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
}
const item = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

// Greeting for the local hour of the day.
function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning.'
  if (hour < 17) return 'Good afternoon.'
  return 'Good evening.'
}

// Keycap labels for a stored hotkey, so "Ctrl+Cmd+V" gives ["⌃", "⌘", "V"] and "Fn" gives ["fn"].
function hotkeyKeys(hotkey: string): string[] {
  return hotkey.split('+').filter(Boolean).map((part) => MOD_SYMBOLS[part] ?? part)
}

// Pastel for an app badge, picked from its name so the same app always gets the same colour.
function appTone(app: string): string {
  const hash = [...app].reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
  return APP_TONES[hash % APP_TONES.length] ?? APP_TONES[0]
}

// Words per minute across today's dictations, or null when they have no speaking time yet.
function speakingPace(entries: DictationEntry[], now: Date): number | null {
  const today = entries.filter((entry) => new Date(entry.timestamp).toDateString() === now.toDateString())
  const words = today.reduce((sum, entry) => sum + countWords(entry.cleanedText), 0)
  const seconds = today.reduce((sum, entry) => sum + entry.durationSeconds, 0)
  return seconds > 0 ? Math.round((words / seconds) * 60) : null
}

// One-line proof summary such as "2 fillers, 3 fixes", or "" when Vaani changed nothing.
function proofLine(entry: DictationEntry, options: { fillers: string[]; corrections: CustomCorrection[] }): string {
  return proofSummaryLine(summarizeProof(buildProof(entry.rawText, entry.cleanedText, options)))
}

// SVG path through the values, scaled to the largest one and kept 2px inside the top and bottom.
function sparkPath(values: number[], width: number, height: number): string {
  const max = Math.max(1, ...values)
  const step = width / Math.max(values.length - 1, 1)
  return values
    .map((value, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)} ${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`)
    .join(' ')
}

// Row of keycaps, one per key label.
function Keys({ keys }: { keys: string[] }) {
  return (
    <>
      {keys.map((key) => (
        <Kbd
          key={key}
          className="mx-0.5 h-[22px] min-w-[22px] border-ink/10 bg-white/75 px-1.5 text-[11px] pastel-scope shadow-[0_1.5px_0_rgba(29,29,29,0.12)]"
        >
          {key}
        </Kbd>
      ))}
    </>
  )
}

// Pastel stat tile with a big number, an optional sparkline, and one line of context.
function StatTile({ tone, label, value, unit, sub, sparkline }: {
  tone: 'butter' | 'mint' | 'sky' | 'blush'
  label: string
  value: string
  unit?: string
  sub: string
  sparkline?: ReactNode
}) {
  return (
    <Card tone={tone} bordered={false} className="relative col-span-3 flex min-h-[143px] flex-col p-5">
      <span className="label-meta text-[10px] pastel-scope/55">{label}</span>
      {sparkline}
      <div className="text-display mt-auto text-[46px] leading-none">
        {value}
        {unit && <span className="ml-0.5 text-[20px] tracking-[-0.02em]">{unit}</span>}
      </div>
      <div className="mt-1.5 text-[12px] pastel-scope/60">{sub}</div>
    </Card>
  )
}

// Tiny area line of daily word counts, drawn in the tile's text colour.
function Sparkline({ values }: { values: number[] }) {
  const width = 70
  const height = 34
  const line = sparkPath(values, width, height)
  return (
    <svg className="absolute right-[18px] top-[14px] h-[34px] w-[70px]" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={`${line} L${width} ${height} L0 ${height} Z`} fill="currentColor" opacity="0.08" />
      <path d={line} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

// Square badge with the app's first letter on a pastel chosen from its name.
function AppBadge({ app }: { app: string }) {
  return (
    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] text-[13px] font-bold pastel-scope ${appTone(app)}`}>
      {app.charAt(0).toUpperCase()}
    </span>
  )
}

// Peach call-out for failed dictations whose audio is kept for a retry.
function RecoveryAlert({ count }: { count: number }) {
  return (
    <div className="rounded-[20px] bg-chip-peach p-5 pastel-scope">
      <div className="flex items-start gap-3.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-white/70">
          <AlertTriangle size={17} />
        </span>
        <div>
          <div className="text-display text-[18px]">
            {count} {count === 1 ? 'dictation needs' : 'dictations need'} you
          </div>
          <p className="mt-1 text-[12.5px] leading-[1.45] pastel-scope/65">Audio is kept so you can retry.</p>
        </div>
      </div>
      <Link to="/app/history?filter=recovery" className="mt-3.5 inline-flex h-8 items-center rounded-full bg-white px-3.5 text-[12.5px] font-semibold pastel-scope">
        Review in History →
      </Link>
    </div>
  )
}

// Link card to another workspace page, with a pastel icon square.
function QuickLink({ to, icon, iconBg, title, text }: { to: string; icon: ReactNode; iconBg: string; title: string; text: string }) {
  return (
    <Link to={to} className="group col-span-4 block">
      <Card hover className="flex h-full items-center gap-3.5 p-5">
        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] pastel-scope ${iconBg}`}>{icon}</span>
        <div className="flex-1">
          <div className="font-semibold text-ink">{title}</div>
          <div className="text-sm text-muted">{text}</div>
        </div>
        <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-ink" />
      </Card>
    </Link>
  )
}

// Permission rows with a mint On chip or a Grant button for anything not yet granted.
function PermissionsCard({ permissions, busyPermission, onGrant }: {
  permissions: PermissionStatus
  busyPermission: keyof PermissionStatus | null
  onGrant: (permission: keyof PermissionStatus) => void
}) {
  const summary = getPermissionStatusIndicator(permissions)
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <h2 className="text-display text-[20px] text-ink">Permissions</h2>
        <Tag tone={summary.allGranted ? 'mint' : 'peach'}>{summary.label}</Tag>
      </div>
      <p className="mb-2 text-[12px] leading-snug text-muted">{summary.description}</p>
      {PERMISSION_ROWS.map(({ key, title, icon: Icon }) => {
        const state = permissions[key]
        const granted = state === 'granted'
        return (
          <div key={key} className="flex items-center gap-2.5 py-1.5">
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] pastel-scope ${granted ? 'bg-chip-mint' : 'bg-chip-peach'}`}>
              <Icon size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink">{title}</div>
              <div className="text-[11.5px] text-muted">{getPermissionStatusLabel(state)}</div>
            </div>
            {granted ? (
              <Tag tone="mint"><Check size={11} />On</Tag>
            ) : (
              <Button variant="soft" size="xs" disabled={busyPermission !== null} onClick={() => onGrant(key)}>
                {busyPermission === key && <Loader2 className="animate-spin-ui" />}
                Grant
              </Button>
            )}
          </div>
        )
      })}
    </Card>
  )
}

// Setup card with a 5-segment progress bar; hides itself once every step is done.
function OnboardingChecklist({
  settings,
  permissions,
  onDismiss,
  onRestartTour,
}: {
  settings: Settings
  permissions: PermissionStatus
  onDismiss: () => void
  onRestartTour: () => void
}) {
  const navigate = useNavigate()

  const activeProvider = KNOWN_PROVIDERS.find(
    (p) => p.id === settings.transcriptionProvider && (p.type === 'stt' || p.type === 'local-stt')
  )
  const hasApiKey =
    activeProvider?.requiresApiKey === false ||
    (settings.providerApiKeys ?? []).some(
      (pk) => pk.providerId === settings.transcriptionProvider && pk.hasKey === true
    )

  const items = [
    { label: 'Complete Welcome Tour', done: settings.onboardingCompleted, action: onRestartTour, actionLabel: 'Restart Tour' },
    { label: 'Setup API Key', done: hasApiKey, action: undefined, actionLabel: undefined },
    {
      label: 'Grant Permissions',
      done: permissions.microphone === 'granted' && permissions.accessibility === 'granted',
      action: () => {
        if (permissions.microphone !== 'granted') void window.vaani.openPermissionSettings('microphone')
        else if (permissions.accessibility !== 'granted') void window.vaani.openPermissionSettings('accessibility')
      },
      actionLabel: 'Open Settings',
    },
    { label: 'Explore Custom Dictionary', done: settings.dictionaryOnboarded, action: () => navigate('/app/dictionary'), actionLabel: 'Go to Dictionary' },
    { label: 'Try Snippets Shortcuts', done: settings.snippetsOnboarded, action: () => navigate('/app/snippets'), actionLabel: 'Go to Snippets' },
  ]

  const completed = items.filter((i) => i.done).length
  if (completed === items.length) return null
  const nextIndex = items.findIndex((i) => !i.done && i.action)

  return (
    <motion.div variants={item}>
      <Card className="p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-display text-[20px] text-ink">Setup</h2>
          <div className="flex items-center gap-1">
            <span className="label-meta mr-1 text-[10px] text-faint">{completed} of {items.length}</span>
            <button onClick={onDismiss} aria-label="Dismiss" className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface hover:text-ink">
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="my-3 flex gap-1">
          {items.map((it) => (
            <span key={it.label} className={`h-1.5 flex-1 rounded-full ${it.done ? 'bg-accent' : 'bg-surface'}`} />
          ))}
        </div>

        {items.map((it, index) => (
          <div key={it.label} className="flex items-start gap-2.5 py-1.5 text-[13px]">
            <span className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${it.done ? 'bg-chip-mint pastel-scope' : 'border-[1.5px] border-dashed border-faint'}`}>
              {it.done && <Check size={11} strokeWidth={3} />}
            </span>
            <div className="min-w-0 flex-1">
              <div className={it.done ? 'text-muted' : 'font-medium text-ink'}>{it.label}</div>
              {!it.done && it.action && it.actionLabel && (
                <Button className="mt-1.5" size="xs" variant={index === nextIndex ? 'primary' : 'soft'} onClick={it.action}>
                  {it.actionLabel}
                </Button>
              )}
            </div>
          </div>
        ))}
      </Card>
    </motion.div>
  )
}

export default function Dashboard() {
  const {
    stats, weeklyActivity, historyEntries, historyItems, historyLoading, recoveryEntries,
    copyHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry,
    settings, updateSettings, updateStatus, restartAndInstall,
  } = useVaaniUi()
  const [permissions, setPermissions] = useState<PermissionStatus>({ microphone: 'unknown', accessibility: 'unknown' })
  const [optimisticChecklistDismissed, setOptimisticChecklistDismissed] = useState(false)
  const checklistDismissed = settings.setupChecklistDismissed || optimisticChecklistDismissed
  const prevPermissionsRef = useRef<PermissionStatus | null>(null)
  const [permissionLostWarning, setPermissionLostWarning] = useState<string | null>(null)
  const [busyPermission, setBusyPermission] = useState<keyof PermissionStatus | null>(null)

  useEffect(() => {
    const poll = () => {
      window.vaani.getPermissionStatus().then((status) => {
        const prev = prevPermissionsRef.current
        if (prev) {
          if (prev.accessibility === 'granted' && status.accessibility !== 'granted') {
            setPermissionLostWarning('Accessibility permission was revoked. Dictation hotkeys won\'t work until re-granted.')
          }
          if (prev.microphone === 'granted' && status.microphone !== 'granted') {
            setPermissionLostWarning('Microphone permission was revoked. Dictation won\'t work until re-granted.')
          }
        }
        prevPermissionsRef.current = status
        setPermissions(status)
      }).catch(() => {})
    }
    poll()
    const id = window.setInterval(poll, 3000)
    const unsub = window.vaani.onPermissionStatusChanged?.((status) => {
      const prev = prevPermissionsRef.current
      if (prev) {
        if (prev.accessibility === 'granted' && status.accessibility !== 'granted') {
          setPermissionLostWarning('Accessibility permission was revoked. Dictation hotkeys won\'t work until re-granted.')
        }
        if (prev.microphone === 'granted' && status.microphone !== 'granted') {
          setPermissionLostWarning('Microphone permission was revoked. Dictation won\'t work until re-granted.')
        }
      }
      prevPermissionsRef.current = status
      setPermissions(status)
    })
    return () => {
      window.clearInterval(id)
      unsub?.()
    }
  }, [])

  async function handlePermissionAction(permission: keyof PermissionStatus): Promise<void> {
    if (busyPermission !== null) return
    setBusyPermission(permission)
    try {
      const state = permissions[permission]
      if (state === 'not-determined' || (permission === 'accessibility' && state === 'denied')) {
        const nextState = permission === 'microphone'
          ? await window.vaani.requestMicrophonePermission()
          : await window.vaani.requestAccessibilityPermission()
        if (nextState === 'granted') {
          setPermissions((current) => ({ ...current, [permission]: nextState }))
          return
        }
      }
      await window.vaani.openPermissionSettings(permission)
    } finally {
      setBusyPermission(null)
    }
  }

  const appBreakdown = useMemo(() => {
    const counts = new Map<string, { words: number; sessions: number }>()
    for (const entry of historyEntries) {
      const app = entry.appName?.trim() || 'Unknown'
      const existing = counts.get(app) ?? { words: 0, sessions: 0 }
      const wordCount = entry.cleanedText?.split(/\s+/).filter(Boolean).length ?? 0
      counts.set(app, { words: existing.words + wordCount, sessions: existing.sessions + 1 })
    }
    return Array.from(counts.entries()).map(([app, d]) => ({ app, ...d })).sort((a, b) => b.sessions - a.sessions).slice(0, 5)
  }, [historyEntries])

  const appTotalSessions = appBreakdown.reduce((sum, app) => sum + app.sessions, 0)

  const now = new Date()
  const pace = speakingPace(historyEntries, now)
  const hotkey = hotkeyKeys(settings.primaryHotkey)
  const hotkeyText = hotkey.join('')
  const pasteKeys = hotkeyKeys(settings.pasteLatestHotkey)
  const handsFree = settings.dictationMode === 'toggle-double'
  const minutesSaved = Math.round(stats.wordsToday / TYPING_WPM)

  // The four newest history rows, each with the proof line for its raw-to-cleaned changes.
  const recentRows = useMemo(() => {
    const entryById = new Map(historyEntries.map((entry): [string, DictationEntry] => [entry.id, entry]))
    const options = {
      fillers: [...settings.fillerWords, ...settings.extraFillerWords],
      corrections: settings.customCorrections,
    }
    return historyItems.slice(0, 6).flatMap((row) => {
      const entry = entryById.get(row.id)
      return entry ? [{ row, proof: proofLine(entry, options) }] : []
    })
  }, [historyEntries, historyItems, settings.fillerWords, settings.extraFillerWords, settings.customCorrections])

  return (
    <motion.div variants={container} initial="hidden" animate="visible">
      <motion.header variants={item} className="mb-6">
        <p className="label-meta mb-2 text-[10px] text-faint">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
        <h1 className="text-display text-[56px] text-ink">{greetingFor(now.getHours())}</h1>
      </motion.header>

      {(updateStatus.available || updateStatus.status === 'ready') && (
        <motion.div variants={item} className="mb-3.5">
          <Card tone="lav" className="flex items-center justify-between gap-4 py-4">
            <span className="text-sm font-medium text-ink">
              {updateStatus.status === 'ready' ? `Vaani ${updateStatus.version} is ready to install` : `Vaani ${updateStatus.version} is available`}
            </span>
            {updateStatus.status === 'ready' && (
              <Button size="sm" variant="accent" onClick={() => restartAndInstall()}>Restart &amp; Install</Button>
            )}
          </Card>
        </motion.div>
      )}

      {permissionLostWarning && (
        <motion.div variants={item} className="mb-3.5">
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
            <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1 text-sm text-amber-800 dark:text-amber-300">{permissionLostWarning}</span>
            <button onClick={() => setPermissionLostWarning(null)} className="shrink-0 text-amber-600 transition-colors hover:text-amber-800 dark:text-amber-400">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-12 gap-3.5">
        <Card tone="lav" bordered={false} className="col-span-6 row-span-2 flex flex-col p-6">
          <span className="label-meta text-[10px] pastel-scope/55">How to dictate</span>
          <h2 className="text-display mt-3.5 text-[50px] leading-[0.98]">
            Hold{' '}
            <span className="mx-1 inline-flex h-12 min-w-[66px] items-center justify-center rounded-[10px] bg-white px-2 align-middle text-[18px] font-semibold leading-none pastel-scope shadow-[0_3px_0_#b4b4e4,0_8px_18px_rgba(60,60,140,0.22)]">
              {hotkeyText}
            </span>
            ,
            <br />
            speak, let go.
          </h2>
          <p className="mt-4 max-w-[350px] text-[13.5px] leading-[1.55] pastel-scope/75">
            Vaani types the cleaned-up text wherever your cursor is.
            {handsFree && (
              <>
                {' '}Double-press <Keys keys={hotkey} /> for hands-free.
              </>
            )}
            {' '}<Keys keys={pasteKeys} /> pastes the last one again, and saying &quot;scratch that&quot; drops your last sentence.
          </p>
          <div className="mt-auto flex items-center gap-3 pt-5">
            <Capsule state="rec" />
            <span className="label-meta max-w-[150px] text-[10px] leading-[1.5] pastel-scope/55">This capsule sits at the bottom of your screen</span>
          </div>
        </Card>

        <StatTile
          tone="butter"
          label="Words today"
          value={historyLoading ? '—' : stats.wordsToday.toLocaleString('en-IN')}
          sub={`${stats.totalWords.toLocaleString('en-IN')} all time`}
          sparkline={<Sparkline values={weeklyActivity.map((day) => day.words)} />}
        />
        <StatTile
          tone="mint"
          label="Dictations"
          value={historyLoading ? '—' : stats.sessionsToday.toLocaleString('en-IN')}
          sub={stats.totalSessions > 0 ? `${stats.accuracy}% inserted, ${stats.totalSessions.toLocaleString('en-IN')} all time` : 'None yet'}
        />
        <StatTile
          tone="sky"
          label="Time saved"
          value={historyLoading ? '—' : minutesSaved.toLocaleString('en-IN')}
          unit="min"
          sub={`Today, vs typing at ${TYPING_WPM} wpm`}
        />
        <StatTile
          tone="blush"
          label="Speaking pace"
          value={historyLoading || pace === null ? '—' : pace.toLocaleString('en-IN')}
          unit="wpm"
          sub={stats.streak > 0 ? `${stats.streak}-day streak` : 'Start today'}
        />

        <Card className="col-span-8 self-start p-5 pb-2">
          <div className="mb-1 flex items-center justify-between px-1">
            <h2 className="text-display text-[22px] text-ink">Recent dictations</h2>
            <Link to="/app/history" className="text-sm font-semibold text-accent transition-colors hover:text-accent-strong">
              Open History →
            </Link>
          </div>

          {recentRows.length === 0 ? (
            <p className="px-1 py-10 text-center text-sm text-muted">No dictations yet. Hold {hotkeyText} and speak in any app to start.</p>
          ) : (
            recentRows.map(({ row, proof }) => (
              <div key={row.id} className="group mx-1 grid grid-cols-[32px_1fr_auto] items-center gap-3.5 rounded-2xl px-3 py-3 transition-colors hover:bg-surface">
                <AppBadge app={row.app} />
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm leading-[1.45] text-ink">{row.text}</p>
                  <div className="label-meta mt-1.5 truncate text-[10px] text-faint">
                    {row.app} · {row.time} · {row.wordCount}W
                    {proof && <span className="text-accent"> · ✎ {proof}</span>}
                  </div>
                </div>
                <div className="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                  <button onClick={() => copyHistoryEntry(row.text)} title="Copy" aria-label="Copy" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-card hover:text-ink">
                    <Copy size={14} />
                  </button>
                  <button onClick={() => reinjectHistoryEntry(row.id)} title="Re-inject" aria-label="Re-inject" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-card hover:text-ink">
                    <RotateCcw size={14} />
                  </button>
                  <button onClick={() => deleteHistoryEntry(row.id)} title="Delete" aria-label="Delete" className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-card hover:text-red-500">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </Card>

        <div className="col-span-4 flex flex-col gap-3.5">
          {recoveryEntries.length > 0 && <RecoveryAlert count={recoveryEntries.length} />}
          {!checklistDismissed && (
            <OnboardingChecklist
              settings={settings}
              permissions={permissions}
              onDismiss={() => { setOptimisticChecklistDismissed(true); updateSettings({ setupChecklistDismissed: true }); }}
              onRestartTour={() => updateSettings({ onboardingCompleted: false })}
            />
          )}
          <PermissionsCard
            permissions={permissions}
            busyPermission={busyPermission}
            onGrant={(permission) => { void handlePermissionAction(permission) }}
          />
        </div>

        <Card className="col-span-12 px-6 py-5">
          <div className="flex items-baseline justify-between">
            <h2 className="text-display text-[22px] text-ink">Where you dictate</h2>
            <span className="label-meta text-[10px] text-faint">{appBreakdown.length} apps</span>
          </div>
          {appBreakdown.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Start dictating to see your app usage here</p>
          ) : (
            <>
              <div className="mb-4 mt-4 flex h-3.5 gap-[3px] overflow-hidden rounded-full">
                {appBreakdown.map((app) => (
                  <span key={app.app} className={appTone(app.app)} style={{ flex: app.sessions }} />
                ))}
              </div>
              <div className="grid grid-cols-5 gap-2.5">
                {appBreakdown.map((app) => (
                  <div key={app.app} className="flex min-w-0 items-center gap-2.5">
                    <AppBadge app={app.app} />
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-ink">{app.app}</div>
                      <div className="font-mono text-[10px] text-muted">
                        {Math.round((app.sessions / appTotalSessions) * 100)}% · {app.words.toLocaleString('en-IN')} words
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <QuickLink to="/app/dictionary" icon={<BookOpen size={17} />} iconBg="bg-chip-sky" title="Dictionary" text="Manage word replacements" />
        <QuickLink to="/app/snippets" icon={<Layers size={17} />} iconBg="bg-chip-mint" title="Snippets" text="Manage slash commands" />
        <Card tone="surface" bordered={false} className="col-span-4 p-5">
          <div className="flex items-start gap-3">
            <Zap size={18} className="mt-0.5 shrink-0 text-accent" />
            <div>
              <div className="mb-1 text-sm font-semibold text-ink">Tip of the day</div>
              <p className="text-sm leading-relaxed text-muted">
                Use snippets to expand common phrases. Try typing{' '}
                <code className="rounded-md bg-bg px-1.5 py-0.5 font-mono text-xs">/email</code> to insert your signature.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </motion.div>
  )
}
