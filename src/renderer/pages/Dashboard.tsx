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
  Calendar,
  BookOpen,
  Activity,
  Layers,
  CheckCircle2,
  ShieldCheck,
  Plug,
  Download,
  Sparkles,
  X,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useVaaniUi } from '../context/vaani-ui'
import { useMemo, useState, useEffect } from 'react'
import type { PermissionStatus, Settings } from '@shared/types'
import { KNOWN_PROVIDERS } from '@shared/defaults'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

function StatSkeleton() {
  return (
    <div className="bg-white dark:bg-vaani-gray-900/80 rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800 animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="w-10 h-10 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-xl" />
        <div className="w-16 h-6 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-full" />
      </div>
      <div className="w-20 h-7 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded mb-2" />
      <div className="w-28 h-4 bg-vaani-gray-100 dark:bg-vaani-gray-800 rounded" />
    </div>
  )
}

function OnboardingChecklist({
  settings,
  permissions,
  onDismiss,
  onRestartTour,
}: {
  settings: Settings;
  permissions: PermissionStatus;
  onDismiss: () => void;
  onRestartTour: () => void;
}) {
  const navigate = useNavigate()

  const activeProvider = KNOWN_PROVIDERS.find(
    (p) => p.id === settings.transcriptionProvider && (p.type === 'stt' || p.type === 'local-stt')
  )
  const hasApiKey =
    activeProvider?.requiresApiKey === false ||
    (settings.providerApiKeys ?? []).some(
      (pk: { providerId: string; key: string }) =>
        pk.providerId === settings.transcriptionProvider && pk.key?.toString().trim().length > 0
    ) ||
    (settings.transcriptionProvider === 'groq' && !!settings.groqApiKey?.toString().trim())

  const items = [
    {
      label: 'Complete Welcome Tour',
      done: settings.onboardingCompleted,
      icon: <Sparkles size={16} />,
      action: () => onRestartTour(),
      actionLabel: 'Restart Tour',
    },
    {
      label: 'Setup API Key',
      done: hasApiKey,
      icon: <Plug size={16} />,
      action: undefined,
      actionLabel: undefined,
    },
    {
      label: 'Grant Permissions',
      done: permissions.microphone === 'granted' && permissions.accessibility === 'granted',
      icon: <ShieldCheck size={16} />,
      action: () => {
        if (permissions.microphone !== 'granted') {
          void window.vaani.openPermissionSettings('microphone')
        } else if (permissions.accessibility !== 'granted') {
          void window.vaani.openPermissionSettings('accessibility')
        }
      },
      actionLabel: 'Open Settings',
    },
    {
      label: 'Explore Custom Dictionary',
      done: settings.dictionaryOnboarded,
      icon: <BookOpen size={16} />,
      action: () => navigate('/app/dictionary'),
      actionLabel: 'Go to Dictionary',
    },
    {
      label: 'Try Snippets Shortcuts',
      done: settings.snippetsOnboarded,
      icon: <Layers size={16} />,
      action: () => navigate('/app/snippets'),
      actionLabel: 'Go to Snippets',
    },
  ]

  const completed = items.filter((i) => i.done).length
  const total = items.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  if (progress >= 100) return null

  return (
    <motion.div
      variants={itemVariants}
      className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 p-6"
    >
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-vaani-black dark:text-white">Setup Checklist</h2>
          <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
            {completed} of {total} steps completed
          </p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss setup checklist"
          title="Dismiss setup checklist"
          className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800 rounded-lg transition-colors"
        >
          <X size={16} className="text-vaani-gray-500" />
        </button>
      </div>

      <div className="w-full h-2 bg-vaani-gray-100 dark:bg-vaani-gray-800 rounded-full overflow-hidden mb-4">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6 }}
          className="h-full rounded-full bg-vaani-pink"
        />
      </div>

      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.label}
            className={`flex items-center gap-3 p-3 rounded-xl transition-colors ${
              item.done
                ? 'bg-vaani-gray-50 dark:bg-vaani-gray-800/50'
                : 'bg-vaani-gray-50/50 dark:bg-vaani-gray-800/30'
            }`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                item.done
                  ? 'bg-vaani-lime/20 text-vaani-black dark:text-vaani-lime'
                  : 'bg-vaani-gray-100 dark:bg-vaani-gray-700 text-vaani-gray-500 dark:text-vaani-gray-400'
              }`}
            >
              {item.done ? <CheckCircle2 size={16} /> : item.icon}
            </div>
            <span
              className={`text-sm flex-1 ${
                item.done
                  ? 'text-vaani-gray-500 dark:text-vaani-gray-400 line-through'
                  : 'text-vaani-black dark:text-white font-medium'
              }`}
            >
              {item.label}
            </span>
            {!item.done && item.action && item.actionLabel && (
              <button
                onClick={item.action}
                className="text-xs font-semibold text-vaani-pink hover:text-vaani-black dark:hover:text-white transition-colors shrink-0"
              >
                {item.actionLabel}
              </button>
            )}
          </div>
        ))}
      </div>
    </motion.div>
  )
}

export default function Dashboard() {
  const {
    stats, historyEntries, historyItems, historyLoading,
    copyHistoryEntry, deleteHistoryEntry, reinjectHistoryEntry,
    settings, updateSettings, updateStatus, restartAndInstall
  } = useVaaniUi()
  const [permissions, setPermissions] = useState<PermissionStatus>({ microphone: 'unknown', accessibility: 'unknown' })
  const [checklistDismissed, setChecklistDismissed] = useState(false)

  useEffect(() => {
    void window.vaani.getPermissionStatus().then(setPermissions)
    const id = window.setInterval(() => {
      void window.vaani.getPermissionStatus().then(setPermissions)
    }, 3000)
    return () => window.clearInterval(id)
  }, [])

  const appBreakdown = useMemo(() => {
    const counts = new Map<string, { words: number; sessions: number }>()
    for (const entry of historyEntries) {
      const app = entry.appName?.trim() || 'Unknown'
      const existing = counts.get(app) ?? { words: 0, sessions: 0 }
      const wordCount = entry.cleanedText?.split(/\s+/).filter(Boolean).length ?? 0
      counts.set(app, { words: existing.words + wordCount, sessions: existing.sessions + 1 })
    }
    return Array.from(counts.entries())
      .map(([app, data]) => ({ app, ...data }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 5)
  }, [historyEntries])

  const maxAppSessions = Math.max(...appBreakdown.map(a => a.sessions), 1)

  const statCards = [
    {
      label: 'Total Sessions',
      value: stats.totalSessions.toLocaleString(),
      change: `${stats.sessionsToday} today`,
      icon: Activity,
      color: 'bg-vaani-pink',
      textColor: 'text-vaani-pink',
    },
    {
      label: 'Words Dictated',
      value: stats.totalWords.toLocaleString(),
      change: `${stats.wordsToday.toLocaleString()} today`,
      icon: Type,
      color: 'bg-vaani-lime',
      textColor: 'text-vaani-lime',
    },
    {
      label: 'Current Streak',
      value: `${stats.streak} day${stats.streak === 1 ? '' : 's'}`,
      change: stats.streak > 0 ? 'Keep it going' : 'Start today',
      icon: Flame,
      color: 'bg-vaani-orange',
      textColor: 'text-vaani-orange',
    },
    {
      label: 'Injection Rate',
      value: stats.totalSessions > 0 ? `${stats.accuracy}%` : '—',
      change: stats.totalSessions > 0 ? 'Successful injections' : 'No sessions yet',
      icon: Clock,
      color: 'bg-vaani-cyan',
      textColor: 'text-vaani-cyan',
    },
  ]

  const recentItems = historyItems.slice(0, 4)

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="max-w-7xl mx-auto space-y-8"
    >
      <motion.div variants={itemVariants} className="flex items-end justify-between">
        <div>
          <h1 className="text-display text-4xl sm:text-5xl text-vaani-black dark:text-white mb-2">
            DASHBOARD
          </h1>
          <p className="text-vaani-gray-500 dark:text-vaani-gray-400">
            Welcome back. Here is what is happening with your dictation.
          </p>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
          <Calendar size={14} />
          <span>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
        </div>
      </motion.div>

      {/* Update Banner */}
      {(updateStatus.available || updateStatus.status === 'ready') && (
        <motion.div
          variants={itemVariants}
          className="rounded-2xl border border-vaani-pink/30 bg-vaani-pink/10 dark:bg-vaani-pink/20 p-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3 min-w-0">
            <Download size={18} className="text-vaani-pink shrink-0" />
            <span className="text-sm font-medium text-vaani-black dark:text-white truncate">
              {updateStatus.status === 'ready'
                ? `Vaani ${updateStatus.version} is ready to install`
                : `Vaani ${updateStatus.version} is available`}
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {updateStatus.status === 'ready' && (
              <button
                onClick={() => restartAndInstall()}
                className="px-3 py-1.5 bg-vaani-pink text-white rounded-lg text-xs font-semibold hover:bg-vaani-pink/90 transition-colors"
              >
                Restart & Install
              </button>
            )}
          </div>
        </motion.div>
      )}

      {/* Onboarding Progress Checklist */}
      {!checklistDismissed && (
        <OnboardingChecklist
          settings={settings}
          permissions={permissions}
          onDismiss={() => setChecklistDismissed(true)}
          onRestartTour={() => updateSettings({ onboardingCompleted: false })}
        />
      )}

      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {historyLoading
          ? Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)
          : statCards.map((stat, index) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: index * 0.1 }}
              whileHover={{ y: -4, scale: 1.02 }}
              className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800 hover:shadow-lg dark:hover:shadow-vaani-pink/10 transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-4">
                <div className={`w-10 h-10 ${stat.color} rounded-xl flex items-center justify-center`}>
                  <stat.icon size={18} className="text-vaani-black" />
                </div>
                <span className="text-xs font-bold text-vaani-gray-400 dark:text-vaani-gray-500 bg-vaani-gray-100 dark:bg-vaani-gray-800 px-2 py-1 rounded-full">
                  {stat.change}
                </span>
              </div>
              <div className="text-2xl font-bold text-vaani-black dark:text-white mb-1">{stat.value}</div>
              <div className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">{stat.label}</div>
            </motion.div>
          ))}
      </motion.div>

      <div className="grid lg:grid-cols-3 gap-6">
        <motion.div
          variants={itemVariants}
          className="lg:col-span-2 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl p-6 border border-vaani-gray-200 dark:border-vaani-gray-800"
        >
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1">Where you dictate</h2>
              <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
                Apps used most with Vaani
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
              <Activity size={14} className="text-vaani-pink" />
              <span className="font-medium text-vaani-black dark:text-white">
                {appBreakdown.length} apps
              </span>
            </div>
          </div>

          <div className="space-y-3">
            {appBreakdown.length === 0 ? (
              <p className="text-sm text-vaani-gray-400 text-center py-6">
                Start dictating to see your app usage here
              </p>
            ) : (
              appBreakdown.map((item) => (
                <div key={item.app} className="flex items-center gap-3">
                  <span className="w-24 text-xs font-medium text-vaani-gray-600 dark:text-vaani-gray-400 truncate text-right">
                    {item.app}
                  </span>
                  <div className="flex-1 h-5 bg-vaani-gray-100 dark:bg-vaani-gray-800 rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(item.sessions / maxAppSessions) * 100}%` }}
                      transition={{ duration: 0.6, delay: 0.1 }}
                      className="h-full rounded-full"
                      style={{ background: 'var(--accent, #FF006E)' }}
                    />
                  </div>
                  <span className="w-10 text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400 text-right">
                    {item.sessions}
                  </span>
                </div>
              ))
            )}
          </div>
        </motion.div>

        <motion.div variants={itemVariants} className="space-y-4">
          <h2 className="text-lg font-bold text-vaani-black dark:text-white">Quick Links</h2>
          <Link
            to="/app/dictionary"
            className="flex items-center gap-4 p-4 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-700 hover:shadow-md dark:hover:shadow-vaani-pink/5 transition-all group"
          >
            <div className="w-12 h-12 bg-vaani-purple rounded-xl flex items-center justify-center">
              <BookOpen size={20} className="text-white" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-vaani-black dark:text-white">Dictionary</div>
              <div className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Manage word replacements</div>
            </div>
            <ArrowRight size={16} className="text-vaani-gray-400 group-hover:text-vaani-black dark:group-hover:text-white group-hover:translate-x-1 transition-all" />
          </Link>
          <Link
            to="/app/snippets"
            className="flex items-center gap-4 p-4 bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-700 hover:shadow-md dark:hover:shadow-vaani-pink/5 transition-all group"
          >
            <div className="w-12 h-12 bg-vaani-lime rounded-xl flex items-center justify-center">
              <Layers size={20} className="text-vaani-black" />
            </div>
            <div className="flex-1">
              <div className="font-semibold text-vaani-black dark:text-white">Snippets</div>
              <div className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Manage slash commands</div>
            </div>
            <ArrowRight size={16} className="text-vaani-gray-400 group-hover:text-vaani-black dark:group-hover:text-white group-hover:translate-x-1 transition-all" />
          </Link>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4, delay: 0.8 }}
            className="bg-vaani-yellow/10 dark:bg-vaani-yellow/5 border border-vaani-yellow/30 dark:border-vaani-yellow/20 rounded-2xl p-4"
          >
            <div className="flex items-start gap-3">
              <Zap size={18} className="text-vaani-yellow mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-vaani-black dark:text-white mb-1">
                  Tip of the Day
                </div>
                <p className="text-sm text-vaani-gray-600 dark:text-vaani-gray-400 leading-relaxed">
                  Use snippets to expand common phrases. Try typing{' '}
                  <code className="bg-white dark:bg-vaani-gray-800 px-1.5 py-0.5 rounded text-xs font-mono">
                    /email
                  </code>{' '}
                  to insert your signature.
                </p>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>

      <motion.div
        variants={itemVariants}
        className="bg-white dark:bg-vaani-gray-900/80 backdrop-blur-sm rounded-2xl border border-vaani-gray-200 dark:border-vaani-gray-800 overflow-hidden"
      >
        <div className="p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-800 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-vaani-black dark:text-white mb-1">
              Recent Dictations
            </h2>
            <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">
              Your latest transcriptions
            </p>
          </div>
          <Link
            to="/app/history"
            className="text-sm font-semibold text-vaani-pink hover:text-vaani-black dark:hover:text-white transition-colors flex items-center gap-1"
          >
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {recentItems.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">No dictations yet. Press your hotkey to start!</p>
          </div>
        ) : (
          <div className="divide-y divide-vaani-gray-200 dark:divide-vaani-gray-800">
            {recentItems.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 * index }}
                className="p-6 hover:bg-vaani-gray-50 dark:hover:bg-vaani-gray-800/50 transition-colors group"
              >
                <div className="flex items-start justify-between gap-4 mb-2">
                  <p className="text-sm text-vaani-gray-700 dark:text-vaani-gray-300 leading-relaxed line-clamp-2 flex-1">
                    {item.text}
                  </p>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => copyHistoryEntry(item.text)}
                      className="p-2 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-lg transition-colors"
                      title="Copy"
                    >
                      <Copy size={14} className="text-vaani-gray-500 dark:text-vaani-gray-400" />
                    </button>
                    <button
                      onClick={() => reinjectHistoryEntry(item.id)}
                      className="p-2 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-lg transition-colors"
                      title="Re-inject"
                    >
                      <RotateCcw size={14} className="text-vaani-gray-500 dark:text-vaani-gray-400" />
                    </button>
                    <button
                      onClick={() => deleteHistoryEntry(item.id)}
                      className="p-2 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Delete"
                    >
                      <Trash2 size={14} className="text-vaani-gray-500 dark:text-vaani-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-vaani-gray-400 dark:text-vaani-gray-500">
                  <span>{item.group}, {item.time}</span>
                  <span className="w-1 h-1 bg-vaani-gray-300 dark:bg-vaani-gray-600 rounded-full" />
                  <span>{item.duration}</span>
                  <span className="w-1 h-1 bg-vaani-gray-300 dark:bg-vaani-gray-600 rounded-full" />
                  <span>{item.wordCount} words</span>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}
