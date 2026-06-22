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

const container = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
}
const item = {
  hidden: { opacity: 0, y: 18 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
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
      (pk) => pk.providerId === settings.transcriptionProvider && pk.key?.toString().trim().length > 0
    ) ||
    (settings.transcriptionProvider === 'groq' && !!settings.groqApiKey?.toString().trim())

  const items = [
    { label: 'Complete Welcome Tour', done: settings.onboardingCompleted, icon: <Sparkles size={15} />, action: onRestartTour, actionLabel: 'Restart Tour' },
    { label: 'Setup API Key', done: hasApiKey, icon: <Plug size={15} />, action: undefined, actionLabel: undefined },
    {
      label: 'Grant Permissions',
      done: permissions.microphone === 'granted' && permissions.accessibility === 'granted',
      icon: <ShieldCheck size={15} />,
      action: () => {
        if (permissions.microphone !== 'granted') void window.vaani.openPermissionSettings('microphone')
        else if (permissions.accessibility !== 'granted') void window.vaani.openPermissionSettings('accessibility')
      },
      actionLabel: 'Open Settings',
    },
    { label: 'Explore Custom Dictionary', done: settings.dictionaryOnboarded, icon: <BookOpen size={15} />, action: () => navigate('/app/dictionary'), actionLabel: 'Go to Dictionary' },
    { label: 'Try Snippets Shortcuts', done: settings.snippetsOnboarded, icon: <Layers size={15} />, action: () => navigate('/app/snippets'), actionLabel: 'Go to Snippets' },
  ]

  const completed = items.filter((i) => i.done).length
  const progress = Math.round((completed / items.length) * 100)
  if (progress >= 100) return null

  return (
    <motion.div variants={item}>
      <Card>
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 className="text-display text-xl text-ink">Setup checklist</h2>
            <p className="mt-1 text-sm text-muted">{completed} of {items.length} steps completed</p>
          </div>
          <button onClick={onDismiss} aria-label="Dismiss" className="rounded-full p-2 text-muted transition-colors hover:bg-surface">
            <X size={16} />
          </button>
        </div>

        <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-surface">
          <motion.div initial={{ width: 0 }} animate={{ width: `${progress}%` }} transition={{ duration: 0.6 }} className="h-full rounded-full bg-accent" />
        </div>

        <div className="space-y-2">
          {items.map((it) => (
            <div key={it.label} className="flex items-center gap-3 rounded-2xl bg-surface px-4 py-3">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${it.done ? 'bg-accent/10 text-accent' : 'bg-bg text-muted'}`}>
                {it.done ? <CheckCircle2 size={15} /> : it.icon}
              </div>
              <span className={`flex-1 text-sm ${it.done ? 'text-faint line-through' : 'font-medium text-ink'}`}>{it.label}</span>
              {!it.done && it.action && it.actionLabel && (
                <button onClick={it.action} className="shrink-0 text-xs font-semibold text-accent transition-colors hover:text-accent-strong">
                  {it.actionLabel}
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
  const [checklistDismissed, setChecklistDismissed] = useState(false)
  const prevPermissionsRef = useRef<PermissionStatus | null>(null)
  const [permissionLostWarning, setPermissionLostWarning] = useState<string | null>(null)

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
      prevPermissionsRef.current = status
      setPermissions(status)
    })
    return () => {
      window.clearInterval(id)
      unsub?.()
    }
  }, [])

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
    { label: 'Total Sessions', value: stats.totalSessions.toLocaleString(), change: `${stats.sessionsToday} today`, icon: Activity, iconBg: 'bg-accent/10 text-accent' },
    { label: 'Words Dictated', value: stats.totalWords.toLocaleString(), change: `${stats.wordsToday.toLocaleString()} today`, icon: Type, iconBg: 'bg-accent/10 text-accent' },
    { label: 'Current Streak', value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`, change: stats.streak > 0 ? 'Keep it going' : 'Start today', icon: Flame, iconBg: 'bg-accent/10 text-accent' },
    { label: 'Injection Rate', value: stats.totalSessions > 0 ? `${stats.accuracy}%` : '—', change: stats.totalSessions > 0 ? 'Successful' : 'No sessions yet', icon: Clock, iconBg: 'bg-accent/10 text-accent' },
  ] as const

  const recentItems = historyItems.slice(0, 4)

  return (
    <motion.div variants={container} initial="hidden" animate="visible" className="mx-auto max-w-6xl space-y-8">
      <motion.div variants={item} className="flex items-end justify-between">
        <div>
          <p className="label-meta mb-2 text-[11px] text-accent">✦ Overview</p>
          <h1 className="text-display text-5xl text-ink">Dashboard</h1>
          <p className="mt-3 max-w-md text-muted">Welcome back. Here is what is happening with your dictation.</p>
        </div>
        <span className="label-meta hidden text-[11px] text-faint sm:block">
          {new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
        </span>
      </motion.div>

      {(updateStatus.available || updateStatus.status === 'ready') && (
        <motion.div variants={item}>
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
        <motion.div variants={item}>
          <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/40 dark:bg-amber-900/10">
            <AlertTriangle size={15} className="shrink-0 text-amber-600 dark:text-amber-400" />
            <span className="flex-1 text-sm text-amber-800 dark:text-amber-300">{permissionLostWarning}</span>
            <button onClick={() => setPermissionLostWarning(null)} className="shrink-0 text-amber-600 transition-colors hover:text-amber-800 dark:text-amber-400">
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}

      {!checklistDismissed && (
        <OnboardingChecklist
          settings={settings}
          permissions={permissions}
          onDismiss={() => setChecklistDismissed(true)}
          onRestartTour={() => updateSettings({ onboardingCompleted: false })}
        />
      )}

      <motion.div variants={item} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <Card key={stat.label} hover className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className={`flex h-11 w-11 items-center justify-center rounded-full ${stat.iconBg}`}>
                <stat.icon size={18} />
              </div>
              <Tag tone="surface">{historyLoading ? '…' : stat.change}</Tag>
            </div>
            <div className="text-display text-3xl text-ink">{historyLoading ? '—' : stat.value}</div>
            <div className="mt-1 text-sm text-muted">{stat.label}</div>
          </Card>
        ))}
      </motion.div>

      <div className="grid gap-6 lg:grid-cols-3">
        <motion.div variants={item} className="lg:col-span-2">
          <Card className="h-full">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-display text-xl text-ink">Where you dictate</h2>
                <p className="mt-1 text-sm text-muted">Apps used most with Vaani</p>
              </div>
              <Tag tone="lav">{appBreakdown.length} apps</Tag>
            </div>
            <div className="space-y-3">
              {appBreakdown.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">Start dictating to see your app usage here</p>
              ) : (
                appBreakdown.map((it) => (
                  <div key={it.app} className="flex items-center gap-3">
                    <span className="w-24 truncate text-right text-xs font-medium text-muted">{it.app}</span>
                    <div className="h-5 flex-1 overflow-hidden rounded-full bg-surface">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${(it.sessions / maxAppSessions) * 100}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full rounded-full"
                        style={{ background: 'var(--color-accent)' }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-medium text-muted">{it.sessions}</span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </motion.div>

        <motion.div variants={item} className="space-y-4">
          <Link to="/app/dictionary" className="group block">
            <Card hover className="flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent"><BookOpen size={18} /></div>
              <div className="flex-1">
                <div className="font-semibold text-ink">Dictionary</div>
                <div className="text-sm text-muted">Manage word replacements</div>
              </div>
              <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-ink" />
            </Card>
          </Link>
          <Link to="/app/snippets" className="group block">
            <Card hover className="flex items-center gap-4 p-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-accent/10 text-accent"><Layers size={18} /></div>
              <div className="flex-1">
                <div className="font-semibold text-ink">Snippets</div>
                <div className="text-sm text-muted">Manage slash commands</div>
              </div>
              <ArrowRight size={16} className="text-faint transition-transform group-hover:translate-x-1 group-hover:text-ink" />
            </Card>
          </Link>
          <Card tone="peach" bordered={false} className="p-4">
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
        </motion.div>
      </div>

      <motion.div variants={item}>
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-5">
            <div>
              <h2 className="text-display text-xl text-ink">Recent dictations</h2>
              <p className="mt-1 text-sm text-muted">Your latest transcriptions</p>
            </div>
            <Link to="/app/history" className="flex items-center gap-1 text-sm font-semibold text-accent transition-colors hover:text-accent-strong">
              View all <ArrowRight size={14} />
            </Link>
          </div>

          {recentItems.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted">No dictations yet. Press your hotkey to start!</div>
          ) : (
            <div className="divide-y divide-line">
              {recentItems.map((it) => (
                <div key={it.id} className="group px-6 py-5 transition-colors hover:bg-surface">
                  <div className="mb-2 flex items-start justify-between gap-4">
                    <p className="line-clamp-2 flex-1 text-sm leading-relaxed text-ink/80">{it.text}</p>
                    <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      <button onClick={() => copyHistoryEntry(it.text)} className="rounded-lg p-2 text-muted transition-colors hover:bg-bg" title="Copy"><Copy size={14} /></button>
                      <button onClick={() => reinjectHistoryEntry(it.id)} className="rounded-lg p-2 text-muted transition-colors hover:bg-bg" title="Re-inject"><RotateCcw size={14} /></button>
                      <button onClick={() => deleteHistoryEntry(it.id)} className="rounded-lg p-2 text-muted transition-colors hover:bg-bg hover:text-red-500" title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </div>
                  <div className="label-meta flex items-center gap-3 text-[10px] text-faint">
                    <span>{it.group}, {it.time}</span>
                    <span>·</span><span>{it.duration}</span>
                    <span>·</span><span>{it.wordCount} words</span>
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
