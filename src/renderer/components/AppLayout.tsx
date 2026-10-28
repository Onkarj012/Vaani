import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Home, History, BookOpen, SquareSlash, BarChart3, SlidersHorizontal, Search, Sun, Moon } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { useUpdateNotification } from '@renderer/hooks/useUpdateNotification'
import OnboardingModal from '@renderer/components/OnboardingModal'
import OpenRouterKeyPrompt from '@renderer/components/OpenRouterKeyPrompt'
import PermissionGuard from '@renderer/components/PermissionGuard'
import UpdateBanner from '@renderer/components/UpdateBanner'
import { Capsule } from '@renderer/components/ui/Capsule'
import { SETTINGS_SECTIONS } from '@renderer/pages/Settings'
import { cn } from '@renderer/lib/utils'
import devanagariLightUrl from '../../../assets/iconset/devanagari/devanagari_light.svg?url'
import devanagariDarkUrl from '../../../assets/iconset/devanagari/devanagari_dark.svg?url'
import type { DictationState, RecoveryRestoredNotice, Settings } from '@shared/types'

const workspaceNav: { path: string; label: string; icon: LucideIcon }[] = [
  { path: '/app', label: 'Home', icon: Home },
  { path: '/app/history', label: 'History', icon: History },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen },
  { path: '/app/snippets', label: 'Snippets', icon: SquareSlash },
  { path: '/app/insights', label: 'Insights', icon: BarChart3 },
]

const MOD_SYMBOLS: Record<string, string> = { Cmd: '⌘', Command: '⌘', Ctrl: '⌃', Control: '⌃', Option: '⌥', Alt: '⌥', Shift: '⇧', Fn: 'fn' }

// Turns a stored hotkey like "Cmd+Shift+Space" into the keycap text "⌘⇧Space".
function hotkeyLabel(hotkey: string): string {
  return hotkey.split('+').filter(Boolean).map((part) => MOD_SYMBOLS[part] ?? part).join('')
}

// Last path segment of a model id, so "anthropic/claude-haiku-4.5" reads "claude-haiku-4.5".
function shortModel(model: string): string {
  return model.split('/').pop() || model
}

// Page name shown in the toolbar breadcrumb.
function crumbFor(pathname: string): string {
  if (pathname.startsWith('/app/settings')) {
    const id = pathname.split('/')[3]
    return `Settings / ${SETTINGS_SECTIONS.find((s) => s.id === id)?.label ?? 'API & Providers'}`
  }
  return workspaceNav.find((item) => item.path === pathname)?.label ?? 'Home'
}

function NavItem({ path, label, icon: Icon, shortcut, badge, onNavigate }: { path: string; label: string; icon: LucideIcon; shortcut: string; badge?: number; onNavigate?: () => void }) {
  return (
    <NavLink
      to={path}
      end={path === '/app'}
      onClick={onNavigate}
      className={({ isActive }) => cn(
        'group flex items-center gap-3 rounded-full px-3.5 py-2 text-sm transition-colors',
        isActive ? 'bg-accent/15 font-semibold text-accent' : 'font-medium text-muted hover:bg-surface hover:text-ink',
      )}
    >
      {({ isActive }) => (
        <>
          <Icon size={17} />
          {label}
          {badge ? (
            <span className="ml-auto rounded-full bg-chip-peach px-[7px] py-1 font-mono text-[10px] leading-none text-[#8a3b22]" title={`${badge} need attention`}>{badge}</span>
          ) : (
            <span className={cn('ml-auto font-mono text-[10.5px] text-faint transition-opacity', isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}>{shortcut}</span>
          )}
        </>
      )}
    </NavLink>
  )
}

// Graphite card at the foot of the sidebar that mirrors what the overlay is doing right now.
function StatusCard({ dictation, settings }: { dictation: DictationState; settings: Settings }) {
  const status = dictation.status
  const listening = status === 'starting' || status === 'recording'
  const working = status === 'finalizing' || status === 'transcribing'
  const done = status === 'completed'
  const failed = status === 'error' || (done && dictation.outcome === 'failed')
  const title = failed ? 'Needs a retry' : listening ? 'Listening' : working ? 'Cleaning up' : done ? (dictation.outcome === 'saved' ? 'Saved to History' : 'Inserted') : 'Ready to dictate'
  const dot = failed ? 'bg-[#f0736a] shadow-[0_0_0_3px_rgba(240,115,106,.2)]' : listening ? 'bg-[#f0736a] shadow-[0_0_0_3px_rgba(240,115,106,.2)] animate-pulse' : working ? 'bg-accent' : 'bg-ok shadow-[0_0_0_3px_rgba(94,211,155,.18)]'
  const cleanup = settings.cleanupEnabled ? shortModel(settings.formattingModel) : 'no cleanup'
  const sub = failed
    ? (status === 'error' ? dictation.message : 'Open History to retry it.')
    : listening ? 'Release or press Send to finish'
    : working ? 'Turning speech into clean text'
    : `${shortModel(settings.transcriptionModel)} → ${cleanup}`

  return (
    <div className="relative mt-auto overflow-hidden rounded-[20px] bg-graphite p-3.5 text-[#f3f3f5] shadow-[0_12px_26px_-14px_rgba(0,0,0,.6)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]" role="status">
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-16 -right-8 h-36 w-36 rounded-full opacity-60 [background:radial-gradient(color-mix(in_srgb,var(--color-accent)_45%,transparent),transparent_70%)]" />
      <div className="relative flex items-center gap-2 text-[13px] font-semibold">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', dot)} />
        {title}
        <kbd className="ml-auto inline-grid h-[22px] min-w-6 place-items-center rounded-[7px] border border-white/15 bg-white/10 px-1.5 font-sans text-[11px] font-semibold">{hotkeyLabel(settings.primaryHotkey)}</kbd>
      </div>
      {(listening || working || (done && !failed)) && (
        <div className="relative mt-3 origin-left scale-[.92]">
          <Capsule state={listening ? 'rec' : working ? 'proc' : 'done'} doneLabel={dictation.status === 'completed' && dictation.outcome === 'saved' ? 'Saved' : 'Inserted'} />
        </div>
      )}
      <p className="relative mt-2.5 line-clamp-2 font-mono text-[10.5px] leading-[1.55] text-white/55">{sub}</p>
      {status === 'idle' && (
        <p className="relative mt-1 text-[11.5px] leading-snug text-white/70">Hold <b className="font-semibold text-white">{hotkeyLabel(settings.primaryHotkey)}</b> to talk in any app.</p>
      )}
    </div>
  )
}

function Sidebar({ recoveryCount, onNavigate }: { recoveryCount: number; onNavigate?: () => void }) {
  const { mode, setMode } = useColorMode()
  const { dictation, settings } = useVaaniUi()

  return (
    <aside className="flex h-screen w-[236px] shrink-0 flex-col border-r border-line bg-side px-3.5 pb-3.5 pt-14">
      <div className="flex items-center gap-[11px] px-2.5 pb-[18px]">
        <span className="grid h-[38px] w-[38px] place-items-center rounded-xl bg-ink">
          {/* The dark asset is a light glyph, which is what reads on the ink tile in light mode. */}
          <img src={mode === 'dark' ? devanagariLightUrl : devanagariDarkUrl} className="h-6 w-6" alt="" />
        </span>
        <div className="leading-none">
          <span className="text-display block text-[25px] text-ink">Vaani</span>
          <span className="label-meta mt-1 block text-[8.5px] text-faint">Voice dictation</span>
        </div>
      </div>

      <div className="label-meta px-3.5 pb-[7px] pt-3.5 text-[9.5px] text-faint">Workspace</div>
      <nav className="grid gap-0.5" aria-label="Workspace">
        {workspaceNav.map((item, i) => (
          <NavItem key={item.path} {...item} shortcut={`⌘${i + 1}`} badge={item.path === '/app/history' ? recoveryCount : undefined} onNavigate={onNavigate} />
        ))}
      </nav>
      <div className="label-meta px-3.5 pb-[7px] pt-3.5 text-[9.5px] text-faint">Preferences</div>
      <nav className="grid gap-0.5" aria-label="Preferences">
        <NavItem path="/app/settings" label="Settings" icon={SlidersHorizontal} shortcut="⌘," onNavigate={onNavigate} />
      </nav>

      <StatusCard dictation={dictation} settings={settings} />

      <div className="mt-2.5 flex gap-1 rounded-full border border-line bg-surface p-[3px]" role="radiogroup" aria-label="Appearance">
        {(['light', 'dark'] as const).map((m) => {
          const Icon = m === 'light' ? Sun : Moon
          return (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              aria-label={m === 'light' ? 'Light mode' : 'Dark mode'}
              onClick={() => setMode(m)}
              className={cn('grid h-[26px] flex-1 place-items-center rounded-full text-muted', mode === m && 'bg-card text-ink shadow-[0_1px_2px_rgba(0,0,0,.1)] dark:bg-[#34343b]')}
            >
              <Icon size={14} />
            </button>
          )
        })}
      </div>
    </aside>
  )
}

// Toolbar above every page: breadcrumb, a search that jumps into History, and a Settings shortcut.
function Toolbar({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const onHistory = location.pathname === '/app/history'
  // The query lives in History's ?q, so it clears when you leave History or clear the search there.
  const query = onHistory ? searchParams.get('q') ?? '' : ''

  const search = (value: string) => {
    if (!onHistory) {
      if (value) navigate(`/app/history?q=${encodeURIComponent(value)}`)
      return
    }
    setSearchParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('q', value)
      else next.delete('q')
      return next
    }, { replace: true })
  }

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 pl-11 pr-6 pt-2">
      <span className="label-meta text-[10px] tracking-[0.14em] text-faint">Vaani / <b className="font-normal text-ink">{crumbFor(location.pathname)}</b></span>
      <label className="ml-auto flex h-[34px] w-[250px] items-center gap-2 rounded-full bg-surface pl-3.5 pr-1.5 text-faint">
        <Search size={14} />
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') { search(''); e.currentTarget.blur() } }}
          placeholder="Search dictations"
          aria-label="Search dictations"
          className="min-w-0 flex-1 border-0 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
        />
        <kbd className="rounded-[7px] border border-line bg-card px-1.5 py-[3px] font-mono text-[10.5px] text-muted">⌘K</kbd>
      </label>
      <button
        onClick={() => navigate('/app/settings')}
        title="Settings (⌘,)"
        aria-label="Settings"
        className="grid h-8 w-8 place-items-center rounded-full border border-line bg-card text-muted hover:bg-surface hover:text-ink"
      >
        <SlidersHorizontal size={15} />
      </button>
    </header>
  )
}

export default function AppLayout() {
  const [permissionsBlocked, setPermissionsBlocked] = useState(true)
  const [restoredNotice, setRestoredNotice] = useState<RecoveryRestoredNotice | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { settings, settingsLoading, updateSettings, settingsSaveError, dismissSettingsSaveError, recoveryEntries } = useVaaniUi()
  const { notification, dismiss } = useUpdateNotification()
  const onboardingOpen = !settingsLoading && !settings.onboardingCompleted
  const showOpenRouterPrompt = !settingsLoading && settings.onboardingCompleted && !settings.openRouterKeyPromptShown &&
    !(settings.providerApiKeys ?? []).some((pk) => pk.providerId === 'openrouter' && pk.hasKey)
  // History and Settings manage their own scrolling panes; every other page scrolls as a whole.
  const fixedPage = location.pathname.startsWith('/app/history') || location.pathname.startsWith('/app/settings')

  useEffect(() => {
    void window.vaani.getRecoveryRestoredNotice().then((notice) => {
      if (notice) setRestoredNotice(notice)
    }).catch(() => undefined)
  }, [])

  // ⌘K focuses search, ⌘1–5 switch pages, ⌘, opens Settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.altKey || e.ctrlKey || permissionsBlocked || onboardingOpen) return
      if (e.key === 'k') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select() }
      else if (e.key === ',') { e.preventDefault(); navigate('/app/settings') }
      else {
        const target = /^[1-5]$/.test(e.key) ? workspaceNav[Number(e.key) - 1] : undefined
        if (target) { e.preventDefault(); navigate(target.path) }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, permissionsBlocked, onboardingOpen])

  return (
    <div className="relative flex h-screen overflow-hidden bg-bg">
      <div
        aria-hidden={permissionsBlocked}
        ref={(element) => {
          if (element) element.inert = permissionsBlocked
        }}
        className="contents"
      >
        <Sidebar recoveryCount={recoveryEntries.length} />

        <div className="relative z-10 flex min-w-0 flex-1 flex-col">
          <Toolbar searchRef={searchRef} />

          {notification && <UpdateBanner notification={notification} onDismiss={dismiss} />}
          {restoredNotice && (
            <div className="mx-11 mt-2 flex items-center justify-between gap-3 rounded-2xl bg-accent/10 px-4 py-3 text-sm text-accent">
              <span>{restoredNotice.count} unfinished dictation{restoredNotice.count === 1 ? '' : 's'} restored. Nothing was inserted automatically.</span>
              <div className="flex shrink-0 items-center gap-2">
                <button onClick={() => { setRestoredNotice(null); navigate('/app/history?filter=recovery') }} className="rounded-full bg-accent px-3 py-1.5 text-xs font-semibold text-white">Open History</button>
                <button aria-label="Dismiss restored items notice" onClick={() => setRestoredNotice(null)} className="rounded-full p-1 text-accent hover:bg-accent/10"><span aria-hidden="true">×</span></button>
              </div>
            </div>
          )}

          <main className={cn(
            'min-h-0 flex-1 px-11 pt-3.5',
            fixedPage ? 'flex flex-col overflow-hidden pb-6' : 'overflow-y-auto pb-10',
            onboardingOpen && 'touch-none overflow-hidden',
          )}>
            <Outlet />
          </main>
        </div>

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
        <div role="alert" className="fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-lg">
          <span>Settings not saved. {settingsSaveError} Fix or move the file, then restart Vaani.</span>
          <button aria-label="Dismiss settings error" onClick={dismissSettingsSaveError} className="shrink-0 rounded-full p-1 hover:bg-red-600/10"><span aria-hidden="true">×</span></button>
        </div>
      )}
    </div>
  )
}
