import { motion } from 'framer-motion'
import {
  Type,
  Flame,
  Clock,
  ArrowRight,
  Copy,
  RotateCcw,
  Trash2,
  Zap,
  BookOpen,
  Activity,
  Layers,
  CheckCircle2,
  ShieldCheck,
  Plug,
  Sparkles,
  X,
  AlertTriangle,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useVaaniUi } from '../context/vaani-ui'
import { useMemo, useState, useEffect, useRef } from 'react'
import type { PermissionStatus, Settings } from '@shared/types'
import { KNOWN_PROVIDERS } from '@shared/defaults'
import { Card } from '@renderer/components/ui/card'
import { Tag } from '@renderer/components/ui/tag'
import { Button } from '@renderer/components/ui/button'
import { Kbd } from '@renderer/components/ui/Kbd'
import { IconTile } from '@renderer/components/ui/icon-tile'
import { PageHeader, pageContainer as container, pageItem as item } from '@renderer/components/ui/page-header'
import PermissionStatusIndicator from '@renderer/components/PermissionStatusIndicator'
import { hotkeyDisplayParts } from '@renderer/lib/hotkeyDisplay'

function greeting(date: Date): string {
  const hour = date.getHours()
  if (hour < 5) return 'Working late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

const modeHint: Record<Settings['dictationMode'], string> = {
  'toggle': 'Press once to start, again to stop.',
  'push-to-talk': 'Hold while you speak, release to insert.',
  'toggle-double': 'Hold to talk, or double-press to lock recording on.',
}

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
    { label: 'Complete Welcome Tour', done: settings.onboardingCompleted, icon: <Sparkles size={12} />, action: onRestartTour, actionLabel: 'Restart Tour' },
    { label: 'Setup API Key', done: hasApiKey, icon: <Plug size={12} />, action: undefined, actionLabel: undefined },
    {
      label: 'Grant Permissions',
      done: permissions.microphone === 'granted' && permissions.accessibility === 'granted',
      icon: <ShieldCheck size={12} />,
      action: () => {
        if (permissions.microphone !== 'granted') void window.vaani.openPermissionSettings('microphone')
        else if (permissions.accessibility !== 'granted') void window.vaani.openPermissionSettings('accessibility')
      },
      actionLabel: 'Open Settings',
    },
    { label: 'Explore Custom Dictionary', done: settings.dictionaryOnboarded, icon: <BookOpen size={12} />, action: () => navigate('/app/dictionary'), actionLabel: 'Go to Dictionary' },
    { label: 'Try Snippets Shortcuts', done: settings.snippetsOnboarded, icon: <Layers size={12} />, action: () => navigate('/app/snippets'), actionLabel: 'Go to Snippets' },
  ]

  const completed = items.filter((i) => i.done).length
  const progress = Math.round((completed / items.length) * 100)
  if (progress >= 100) return null

  return (
    <motion.div variants={item}>
      <Card>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="type-title text-ink">Finish setting up</h2>
            <p className="mt-0.5 text-[13px] text-muted">{completed} of {items.length} steps complete</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="type-figure text-[20px] text-ink">{progress}%</span>
            <button onClick={onDismiss} aria-label="Dismiss" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink">
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="mb-4 h-1 overflow-hidden rounded-full bg-surface">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.7, ease: [0.32, 0.72, 0, 1] }} className="h-full rounded-full bg-accent" />
        </div>

        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-3 bg-bg/40 px-4 py-2.5">
              <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${it.done ? 'bg-accent text-white' : 'border border-line-strong text-faint'}`}>
                {it.done ? <CheckCircle2 size={13} /> : it.icon}
              </div>
              <span className={`flex-1 text-[13px] ${it.done ? 'text-faint line-through decoration-line-strong' : 'font-medium text-ink'}`}>{it.label}</span>
              {!it.done && it.action && it.actionLabel && (
                <button onClick={it.action} className="flex shrink-0 items-center gap-1 text-xs font-semibold text-accent transition-colors hover:text-accent-strong">
                  {it.actionLabel} <ArrowRight size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </motion.div>
  )
}

export default function Dashboard() {
  const {
    stats, historyEntries, historyItems, historyLoading,
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

  const maxAppSessions = Math.max(...appBreakdown.map((a) => a.sessions), 1)

  const statCards = [
    { label: 'Total Sessions', value: stats.totalSessions.toLocaleString(), change: `${stats.sessionsToday} today`, icon: Activity },
    { label: 'Words Dictated', value: stats.totalWords.toLocaleString(), change: `${stats.wordsToday.toLocaleString()} today`, icon: Type },
    { label: 'Current Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, change: stats.streak > 0 ? 'Keep it going' : 'Start today', icon: Flame },
    { label: 'Injection Rate', value: stats.totalSessions > 0 ? `${stats.accuracy}%` : '—', change: stats.totalSessions > 0 ? 'Successful' : 'No sessions yet', icon: Clock },
  ] as const

  const recentItems = historyItems.slice(0, 4)
  const now = new Date()
  const hotkeyKeys = hotkeyDisplayParts(settings.primaryHotkey)

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        eyebrow={now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        title={<>{greeting(now)}<span className="text-faint">.</span></>}
        description="Here is what is happening with your dictation."
      />

      {/* Hero: how to start, and today at a glance */}
      <motion.div variants={item}>
        <div className="ambient-glow relative overflow-hidden rounded-2xl border border-line bg-card shadow-card">
          <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-[1.4fr_1fr] lg:items-center">
            <div>
              <p className="label-meta text-[10px] text-accent">Dictate anywhere</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {hotkeyKeys.map((k, i) => <Kbd key={i} className="h-10 min-w-[40px] rounded-[10px] px-3 text-[15px]">{k}</Kbd>)}
                </div>
                <span className="type-display text-[26px] text-ink">and start speaking</span>
              </div>
              <p className="mt-3 max-w-md text-[13px] leading-relaxed text-muted">{modeHint[settings.dictationMode]} Text lands wherever your cursor is.</p>
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line">
              <div className="bg-card/80 p-4 backdrop-blur">
                <div className="type-figure text-[30px] text-ink">{historyLoading ? '—' : stats.wordsToday.toLocaleString()}</div>
                <div className="mt-1.5 text-xs text-muted">Words today</div>
              </div>
              <div className="bg-card/80 p-4 backdrop-blur">
                <div className="type-figure text-[30px] text-ink">{historyLoading ? '—' : stats.sessionsToday.toLocaleString()}</div>
                <div className="mt-1.5 text-xs text-muted">Sessions today</div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {(updateStatus.available || updateStatus.status === 'ready') && (
        <motion.div variants={item}>
          <Card tone="lav" className="flex items-center justify-between gap-4 px-5 py-3.5">
            <span className="text-[13px] font-medium text-ink">
              {updateStatus.status === 'ready' ? `Vaani ${updateStatus.version} is ready to install` : `Vaani ${updateStatus.version} is available`}
            </span>
            {updateStatus.status === 'ready' && (
              <Button size="sm" variant="accent" onClick={() => restartAndInstall()}>Restart &amp; Install</Button>
            )}
          </Card>
        </motion.div>
      )}

      <motion.div variants={item}>
        <PermissionStatusIndicator
          status={permissions}
          busyPermission={busyPermission}
          onPermissionAction={(permission) => { void handlePermissionAction(permission) }}
        />
      </motion.div>

      {permissionLostWarning && (
        <motion.div variants={item}>
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-4 py-3">
            <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1 text-[13px] text-amber-800 dark:text-amber-300">{permissionLostWarning}</span>
            <button onClick={() => setPermissionLostWarning(null)} aria-label="Dismiss warning" className="shrink-0 rounded-md p-1 text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}

      {!checklistDismissed && (
        <OnboardingChecklist
          settings={settings}
          permissions={permissions}
          onDismiss={() => { setOptimisticChecklistDismissed(true); updateSettings({ setupChecklistDismissed: true }); }}
          onRestartTour={() => updateSettings({ onboardingCompleted: false })}
        />
      )}

      <motion.div variants={item} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} hover className="p-5">
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-muted">{stat.label}</span>
              <stat.icon size={15} className="text-faint" />
            </div>
            <div className="type-figure mt-4 text-[32px] text-ink">{historyLoading ? '—' : stat.value}</div>
            <div className="mt-2 text-xs text-faint">{historyLoading ? '…' : stat.change}</div>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-4 lg:grid-cols-3">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="h-full">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="type-title text-ink">Where you dictate</h2>
                <p className="mt-0.5 text-[13px] text-muted">Apps used most with Vaani</p>
              </div>
              <Tag tone="surface">{appBreakdown.length} apps</Tag>
            </div>
            <div className="space-y-3.5">
              {appBreakdown.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-muted">Start dictating to see your app usage here</p>
              ) : (
                appBreakdown.map((it) => (
                  <div key={it.app}>
                    <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="truncate font-medium text-ink">{it.app}</span>
                      <span className="shrink-0 text-xs tabular-nums text-faint">{it.sessions} sessions · {it.words.toLocaleString()} words</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(it.sessions / maxAppSessions) * 100}%` }}
                        transition={{ duration: 0.8, ease: [0.32, 0.72, 0, 1] }}
                        className="h-full rounded-full bg-accent"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="flex flex-col gap-3">
          {([
            { to: '/app/dictionary', icon: BookOpen, title: 'Dictionary', desc: 'Manage word replacements' },
            { to: '/app/snippets', icon: Layers, title: 'Snippets', desc: 'Manage slash commands' },
          ] as const).map((link) => (
            <Link key={link.to} to={link.to} className="group block">
              <Card hover className="flex items-center gap-3.5 p-4">
                <IconTile><link.icon size={17} /></IconTile>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-ink">{link.title}</div>
                  <div className="text-xs text-muted">{link.desc}</div>
                </div>
                <ArrowRight size={15} className="text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-ink" />
              </Card>
            </Link>
          ))}
          <Card tone="lav" className="flex-1 p-4">
            <div className="flex items-start gap-3">
              <Zap size={16} className="mt-0.5 shrink-0 text-accent" />
              <div>
                <div className="mb-1 text-[13px] font-semibold text-ink">Tip of the day</div>
                <p className="text-[13px] leading-relaxed text-muted">
                  Use snippets to expand common phrases. Try typing{' '}
                  <code className="rounded-md border border-line bg-card px-1.5 py-0.5 font-mono text-[11px] text-ink">/email</code> to insert your signature.
                </p>
              </div>
            </div>
          </Card>
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <div>
              <h2 className="type-title text-ink">Recent dictations</h2>
              <p className="mt-0.5 text-[13px] text-muted">Your latest transcriptions</p>
            </div>
            <Link to="/app/history" className="flex items-center gap-1 text-[13px] font-semibold text-accent transition-colors hover:text-accent-strong">
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {recentItems.length === 0 ? (
            <div className="p-12 text-center text-[13px] text-muted">No dictations yet. Press your hotkey to start!</div>
          ) : (
            <div className="divide-y divide-line">
              {recentItems.map((it) => (
                <div key={it.id} className="group px-6 py-4 transition-colors hover:bg-surface/60">
                  <div className="flex items-start justify-between gap-4">
                    <p className="line-clamp-2 flex-1 text-[13.5px] leading-relaxed text-ink/85">{it.text}</p>
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                      <button onClick={() => copyHistoryEntry(it.text)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-card hover:text-ink" title="Copy" aria-label="Copy"><Copy size={14} /></button>
                      <button onClick={() => reinjectHistoryEntry(it.id)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-card hover:text-ink" title="Re-inject" aria-label="Re-inject"><RotateCcw size={14} /></button>
                      <button onClick={() => deleteHistoryEntry(it.id)} className="rounded-md p-1.5 text-muted transition-colors hover:bg-card hover:text-red-500" title="Delete" aria-label="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-[11.5px] text-faint">
                    <span>{it.group}, {it.time}</span>
                    <span aria-hidden>·</span><span className="tabular-nums">{it.duration}</span>
                    <span aria-hidden>·</span><span>{it.wordCount} words</span>
                    {it.app !== 'Unknown' && <><span aria-hidden>·</span><span>{it.app}</span></>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </motion.div>
    </motion.div>
  )
}
