import { useEffect, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  History,
  FileText,
  BookOpen,
  Settings,
  Menu,
  BarChart3,
  Sun,
  Moon,
  X,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { useUpdateNotification } from '@renderer/hooks/useUpdateNotification'
import SettingsModal from '@renderer/components/SettingsModal'
import OnboardingModal from '@renderer/components/OnboardingModal'
import OpenRouterKeyPrompt from '@renderer/components/OpenRouterKeyPrompt'
import PermissionGuard from '@renderer/components/PermissionGuard'
import UpdateBanner from '@renderer/components/UpdateBanner'
import { Kbd } from '@renderer/components/ui/Kbd'
import { cn } from '@renderer/lib/utils'
import { hotkeyDisplayParts } from '@renderer/lib/hotkeyDisplay'
import devanagariLightUrl from '../../../assets/iconset/devanagari/devanagari_light.svg?url'
import devanagariDarkUrl from '../../../assets/iconset/devanagari/devanagari_dark.svg?url'
import type { DictationState, RecoveryRestoredNotice } from '@shared/types'

const navItems = [
  { path: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/app/history', label: 'History', icon: History },
  { path: '/app/snippets', label: 'Snippets', icon: FileText },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen },
  { path: '/app/insights', label: 'Insights', icon: BarChart3 },
] as const

type StatusTone = 'ready' | 'live' | 'busy' | 'done' | 'warn'

function describeDictation(dictation: DictationState): { label: string; tone: StatusTone } {
  switch (dictation.status) {
    case 'starting': return { label: 'Starting…', tone: 'busy' }
    case 'recording': return { label: 'Listening', tone: 'live' }
    case 'finalizing':
    case 'transcribing': return { label: 'Transcribing…', tone: 'busy' }
    case 'completed':
      if (dictation.outcome === 'injected') return { label: 'Inserted', tone: 'done' }
      if (dictation.outcome === 'saved') return { label: 'Saved to History', tone: 'done' }
      return { label: 'Needs attention', tone: 'warn' }
    case 'error': return { label: 'Something went wrong', tone: 'warn' }
    default: return { label: 'Ready to dictate', tone: 'ready' }
  }
}

const statusDot: Record<StatusTone, string> = {
  ready: 'bg-emerald-500',
  live: 'bg-accent animate-breathe',
  busy: 'bg-amber-500 animate-breathe',
  done: 'bg-emerald-500',
  warn: 'bg-red-500',
}

// Live dictation state plus the hotkey that starts it.
function StatusCard() {
  const { dictation, bars, settings } = useVaaniUi()
  const { label, tone } = describeDictation(dictation)
  const keys = hotkeyDisplayParts(settings.primaryHotkey)

  return (
    <div className="mx-3 mb-5 rounded-xl border border-line bg-card/70 p-3 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot[tone])} />
          <span className="truncate text-[12.5px] font-medium text-ink">{label}</span>
        </div>
        {tone === 'live' && (
          <div aria-hidden className="flex h-4 items-center gap-[2px]">
            {bars.slice(0, 7).map((v, i) => (
              <span
                key={i}
                className="w-[2px] rounded-full bg-accent"
                style={{ height: 3 + Math.pow(Math.min(1, Math.max(0, v)), 0.6) * 13, transition: 'height 60ms ease-out' }}
              />
            ))}
          </div>
        )}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-faint">Hotkey</span>
        <div className="flex items-center gap-1">
          {keys.map((k, i) => <Kbd key={i} className="h-6 min-w-[24px] px-1.5 text-[11px]">{k}</Kbd>)}
        </div>
      </div>
    </div>
  )
}

function Sidebar({ isOpen, onClose, onSettings }: { isOpen: boolean; onClose: () => void; onSettings: () => void }) {
  const { mode, setMode } = useColorMode()
  const { historyItems, snippets, userDictionary, recoveryEntries } = useVaaniUi()

  const counts: Partial<Record<(typeof navItems)[number]['path'], number>> = {
    '/app/history': historyItems.length,
    '/app/snippets': snippets.length,
    '/app/dictionary': userDictionary.length,
  }

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="app-no-drag fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] md:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[240px] flex-col bg-sidebar transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:translate-x-0 ${
          isOpen ? 'translate-x-0 shadow-pop' : '-translate-x-full'
        }`}
      >
        {/* Traffic-light clearance doubles as a window drag handle */}
        <div className="app-drag flex h-[52px] shrink-0 items-center justify-end px-3">
          <button
            onClick={onClose}
            aria-label="Close navigation menu"
            className="app-no-drag rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink md:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/* Brand */}
        <div className="flex items-center gap-2.5 px-5 pb-5">
          <img src={mode === 'dark' ? devanagariDarkUrl : devanagariLightUrl} className="h-8 w-8" alt="" />
          <div className="leading-none">
            <span className="type-display block text-[24px] text-ink">Vaani</span>
            <span className="label-meta mt-1 block text-[9px] text-faint">Voice Dictation</span>
          </div>
        </div>

        <StatusCard />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3">
          <p className="label-meta px-3 pb-2 text-[9.5px] text-faint">Workspace</p>
          <div className="space-y-0.5">
            {navItems.map((item) => {
              const Icon = item.icon
              const count = counts[item.path]
              const pendingRecovery = item.path === '/app/history' ? recoveryEntries.length : 0
              return (
                <NavLink
                  key={item.path}
                  to={item.path}
                  end={item.path === '/app'}
                  onClick={onClose}
                  className={({ isActive }) => cn(
                    'group relative flex items-center gap-2.5 rounded-[9px] px-3 py-[7px] text-[13px] transition-all duration-200',
                    isActive
                      ? 'bg-card font-medium text-ink shadow-soft ring-1 ring-line'
                      : 'font-medium text-muted hover:bg-ink/[0.04] hover:text-ink'
                  )}
                >
                  {({ isActive }) => (
                    <>
                      <Icon size={16} strokeWidth={isActive ? 2.1 : 1.8} className={isActive ? 'text-accent' : 'text-faint group-hover:text-muted'} />
                      <span className="flex-1">{item.label}</span>
                      {pendingRecovery > 0 && (
                        <span className="rounded-full bg-amber-500/15 px-1.5 text-[10.5px] font-semibold text-amber-700 dark:text-amber-400" title={`${pendingRecovery} awaiting recovery`}>
                          {pendingRecovery}
                        </span>
                      )}
                      {count !== undefined && count > 0 && pendingRecovery === 0 && (
                        <span className="text-[11px] tabular-nums text-faint">{count}</span>
                      )}
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="space-y-2 border-t border-line/70 px-3 pb-4 pt-3">
          <button
            onClick={() => { onSettings(); onClose() }}
            className="flex w-full items-center gap-2.5 rounded-[9px] px-3 py-[7px] text-left text-[13px] font-medium text-muted transition-all hover:bg-ink/[0.04] hover:text-ink"
          >
            <Settings size={16} strokeWidth={1.8} className="text-faint" />
            Settings
          </button>
          <div role="radiogroup" aria-label="Color mode" className="grid grid-cols-2 gap-1 rounded-[10px] bg-ink/[0.04] p-1">
            {([['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                role="radio"
                aria-checked={mode === value}
                onClick={() => setMode(value)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-[7px] py-1.5 text-[12px] font-medium transition-all',
                  mode === value ? 'bg-card text-ink shadow-soft' : 'text-muted hover:text-ink'
                )}
              >
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>
        </div>
      </aside>
    </>
  )
}

function NoticeBar({ children, onDismiss, dismissLabel, action }: { children: React.ReactNode; onDismiss: () => void; dismissLabel: string; action?: React.ReactNode }) {
  return (
    <div className="mx-6 mt-3 flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/[0.07] px-4 py-2.5 text-[13px] text-ink md:mx-10">
      <span className="flex items-center gap-2.5"><span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{children}</span>
      <div className="flex shrink-0 items-center gap-1.5">
        {action}
        <button aria-label={dismissLabel} onClick={onDismiss} className="rounded-md p-1 text-muted transition-colors hover:bg-ink/5 hover:text-ink"><X size={14} /></button>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [permissionsBlocked, setPermissionsBlocked] = useState(true)
  const [restoredNotice, setRestoredNotice] = useState<RecoveryRestoredNotice | null>(null)
  const navigate = useNavigate()
  const { settings, settingsLoading, updateSettings, settingsSaveError, dismissSettingsSaveError } = useVaaniUi()
  const { notification, dismiss } = useUpdateNotification()
  const onboardingOpen = !settingsLoading && !settings.onboardingCompleted
  const showOpenRouterPrompt = !settingsLoading && settings.onboardingCompleted && !settings.openRouterKeyPromptShown &&
    !(settings.providerApiKeys ?? []).some((pk) => pk.providerId === 'openrouter' && pk.hasKey)

  useEffect(() => {
    void window.vaani.getRecoveryRestoredNotice().then((notice) => {
      if (notice) setRestoredNotice(notice)
    }).catch(() => undefined)
  }, [])

  return (
    <div className="relative flex h-screen bg-sidebar">
      <div
        aria-hidden={permissionsBlocked}
        ref={(element) => {
          if (element) element.inert = permissionsBlocked
        }}
        className="contents"
      >
        <Sidebar
          isOpen={isMobileMenuOpen}
          onClose={() => setIsMobileMenuOpen(false)}
          onSettings={() => setIsSettingsOpen(true)}
        />

        <div className="relative z-10 flex h-screen min-w-0 flex-1 flex-col md:ml-[240px] md:py-2 md:pr-2">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg md:rounded-[14px] md:border md:border-line md:shadow-soft">
            {/* Window drag strip. On narrow windows it also holds the menu button, clear of the traffic lights. */}
            <header className="app-drag flex h-12 shrink-0 items-center pl-20 pr-4 md:h-6 md:pl-0">
              <button
                onClick={() => setIsMobileMenuOpen(true)}
                aria-label="Open navigation menu"
                aria-expanded={isMobileMenuOpen}
                className="app-no-drag rounded-lg p-1.5 text-ink transition-colors hover:bg-surface md:hidden"
              >
                <Menu size={18} />
              </button>
            </header>

            {notification && <UpdateBanner notification={notification} onDismiss={dismiss} />}
            {restoredNotice && (
              <NoticeBar
                dismissLabel="Dismiss restored items notice"
                onDismiss={() => setRestoredNotice(null)}
                action={<button onClick={() => { setRestoredNotice(null); navigate('/app/history') }} className="accent-sheen rounded-md px-2.5 py-1 text-xs font-semibold text-white">Open History</button>}
              >
                {restoredNotice.count} unfinished dictation{restoredNotice.count === 1 ? '' : 's'} restored. Nothing was inserted automatically.
              </NoticeBar>
            )}

            <main className={`flex-1 px-6 pb-12 pt-6 md:px-10 md:pt-8 ${onboardingOpen ? 'touch-none overflow-hidden' : 'overflow-y-auto'}`}>
              <Outlet />
            </main>
          </div>
        </div>

        <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
        {!settingsLoading && !settings.onboardingCompleted && (
          <OnboardingModal
            settings={settings}
            updateSettings={updateSettings}
            onComplete={() => updateSettings({ onboardingCompleted: true })}
          />
        )}
        {showOpenRouterPrompt && <OpenRouterKeyPrompt updateSettings={updateSettings} />}
      </div>
      <PermissionGuard onBlockingChange={setPermissionsBlocked} />
      {/* Outside the content wrapper's stacking context, so it shows above onboarding. */}
      {settingsSaveError && (
        <div role="alert" className="app-no-drag fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-xl border border-red-500/20 bg-card px-4 py-3 text-[13px] text-red-600 shadow-pop dark:text-red-400">
          <span>Settings not saved. {settingsSaveError} Fix or move the file, then restart Vaani.</span>
          <button aria-label="Dismiss settings error" onClick={dismissSettingsSaveError} className="shrink-0 rounded-md p-1 hover:bg-red-600/10"><X size={14} /></button>
        </div>
      )}
    </div>
  )
}
