import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChartLine,
  Check,
  Clock,
  House,
  Moon,
  SlidersHorizontal,
  SquareSlash,
  Sun,
  UserRound,
} from 'lucide-react'
import { useVaaniUi } from '@renderer/context/vaani-ui'
import { useColorMode } from '@renderer/context/color-mode'
import { SettingsPanelProvider, useSettingsPanel } from '@renderer/context/settings-panel'
import { useUpdateNotification } from '@renderer/hooks/useUpdateNotification'
import SettingsPanel from '@renderer/components/settings/SettingsPanel'
import OnboardingModal from '@renderer/components/OnboardingModal'
import OpenRouterKeyPrompt from '@renderer/components/OpenRouterKeyPrompt'
import PermissionGuard from '@renderer/components/PermissionGuard'
import UpdateBanner from '@renderer/components/UpdateBanner'
import VaaniMark from '@renderer/components/ui/VaaniMark'
import MiniCapsule from '@renderer/components/ui/MiniCapsule'
import SearchField from '@renderer/components/ui/SearchField'
import { Kbd } from '@renderer/components/ui/Kbd'
import { formatHotkeyLabel } from '@renderer/components/HotkeyCapture'
import { providerModels } from '@shared/modelList'

const statusCardClassName = [
  "relative mt-3 overflow-hidden rounded-[20px] bg-[#18181b] p-[13px] text-[#f3f3f5]",
  "shadow-[0_12px_26px_-14px_rgba(0,0,0,.6)]",
  "before:absolute before:-bottom-[60px] before:-right-[30px] before:size-[140px] before:rounded-full",
  "before:bg-[radial-gradient(color-mix(in_srgb,var(--color-accent)_45%,transparent),transparent_70%)]",
  "before:opacity-60 before:content-[''] dark:bg-[#0d0d0f]",
  "@max-[860px]/win:grid @max-[860px]/win:w-[54px] @max-[860px]/win:justify-items-center",
  "@max-[860px]/win:rounded-[18px] @max-[860px]/win:px-0 @max-[860px]/win:py-2.5",
].join(" ")

const pages = [
  { path: '/app', label: 'Home', icon: House },
  { path: '/app/history', label: 'History', icon: Clock },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen },
  { path: '/app/snippets', label: 'Snippets', icon: SquareSlash },
  { path: '/app/insights', label: 'Insights', icon: ChartLine },
]

// Shows the current dictation state in the sidebar.
function stateLabel(status: string, message?: string): string {
  if (status === 'idle' || status === 'starting') return 'Ready to dictate'
  if (status === 'recording') return 'Listening'
  if (['finalizing', 'transcribing'].includes(status)) return 'Cleaning up'
  if (status === 'completed') return 'Inserted'
  return message || 'Dictation failed'
}

// Renders the sidebar navigation links.
function Navigation({ onSettings }: { onSettings: () => void }) {
  const location = useLocation()

  return (
    <>
      <div className="label-meta mx-2.5 mb-2 text-[10px] text-faint @max-[860px]/win:hidden">Workspace</div>
      <nav className="grid gap-0.5" aria-label="Workspace">
        {pages.map(({ path, label, icon: Icon }, index) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/app'}
            title={`${label} (⌘${index + 1})`}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-full px-3.5 py-[9px] text-sm no-underline transition-colors @max-[860px]/win:size-12 @max-[860px]/win:justify-center @max-[860px]/win:px-0 ${isActive ? 'bg-accent/15 font-semibold text-accent dark:text-[#a6a6ef]' : 'font-medium text-muted hover:bg-surface hover:text-ink'}`
            }
            aria-current={location.pathname === path ? 'page' : undefined}
          >
            <Icon size={17} strokeWidth={1.8} />
            <span className="min-w-0 @max-[860px]/win:hidden">{label}</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100 group-aria-[current=page]:opacity-100 @max-[860px]/win:hidden">⌘{index + 1}</span>
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <nav className="grid gap-0.5" aria-label="Settings">
          <button
            className="group flex items-center gap-3 rounded-full px-3.5 py-[9px] text-left text-sm text-muted transition-colors hover:bg-surface hover:text-ink @max-[860px]/win:size-12 @max-[860px]/win:justify-center @max-[860px]/win:px-0"
            onClick={onSettings}
            title="Settings (⌘,)"
          >
            <SlidersHorizontal size={17} strokeWidth={1.8} />
            <span className="@max-[860px]/win:hidden">Settings</span>
            <span className="ml-auto font-mono text-[10.5px] text-faint opacity-0 transition-opacity group-hover:opacity-100 @max-[860px]/win:hidden">⌘,</span>
          </button>
        </nav>
      </div>
    </>
  )
}

// Renders the app sidebar and live dictation card.
function Sidebar({ onSettings }: { onSettings: () => void }) {
  const { dictation, bars, settings } = useVaaniUi()
  const [version, setVersion] = useState('')
  const [providerNames, setProviderNames] = useState<Record<string, string>>({})
  const [micName, setMicName] = useState('')
  const status = dictation.status
  const live = status === 'recording' || status === 'finalizing' || status === 'transcribing'
  const cleanupName = providerModels('cleanup', settings.formattingProvider)
    .find((model) => model.id === settings.formattingModel)?.name
    ?? providerNames[settings.formattingProvider] ?? settings.formattingProvider
  const details = status === 'recording'
    ? 'Tap Send or press fn again'
    : `${providerNames[settings.transcriptionProvider] ?? settings.transcriptionProvider} → ${cleanupName}`

  useEffect(() => {
    let alive = true
    void window.vaani.getAppVersion()
      .then((value) => { if (alive) setVersion(value) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    void window.vaani.listAudioInputDevices()
      .then((devices) => {
        const picked = devices.find((device) => device.uid === settings.micDeviceId) ?? devices.find((device) => device.isDefault)
        if (alive) setMicName(picked?.name ?? '')
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [settings.micDeviceId])

  useEffect(() => {
    let alive = true
    void window.vaani.getProviderStatus()
      .then((providers) => {
        if (alive) setProviderNames(Object.fromEntries(providers.map((provider) => [provider.id, provider.name])))
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  return (
    <aside className="flex min-w-0 flex-col border-r border-line bg-side px-3.5 pb-3.5 pt-[58px] @max-[860px]/win:items-center @max-[860px]/win:px-3 @max-[860px]/win:pb-3">
      <div className="mb-[26px] flex items-center gap-[11px] px-2.5 @max-[860px]/win:mb-3 @max-[860px]/win:px-0">
        <span className="grid size-[38px] shrink-0 place-items-center rounded-xl bg-ink text-bg">
          <VaaniMark size={27} live={live} />
        </span>
        <div className="leading-none @max-[860px]/win:hidden">
          <b className="text-display block text-[25px] text-ink">Vaani</b>
          {version && <span className="label-meta mt-1 block text-[11px] tracking-[0.04em] text-faint">Dictation · {version}</span>}
        </div>
      </div>
      <Navigation onSettings={onSettings} />
      <div
        className={statusCardClassName}
      >
        <div className="relative z-[1] flex items-center gap-[9px] text-xs font-semibold @max-[860px]/win:justify-center">
          <i className={`size-2 shrink-0 rounded-full bg-[#3fbf7f] shadow-[0_0_0_3px_rgba(94,211,155,.18)] ${status === 'recording' ? 'animate-[vaani-pulse_1s_infinite] bg-[#f0736a]' : live ? 'bg-accent' : ''}`} />
          <span className="@max-[860px]/win:hidden">{stateLabel(status, status === 'error' ? dictation.message : undefined)}</span>
          <Kbd className="ml-auto h-[22px] border-white/15 bg-white/10 text-[11px] text-[#f3f3f5] shadow-none @max-[860px]/win:hidden">{formatHotkeyLabel(settings.primaryHotkey)}</Kbd>
        </div>
        {live && (
          <div className="relative z-[1] mt-3 @max-[860px]/win:hidden">
            <MiniCapsule state={status === 'recording' ? 'rec' : 'proc'} bars={status === 'recording' ? bars : undefined} />
          </div>
        )}
        <div className="relative z-[1] mt-[9px] truncate font-mono text-[11px] leading-[1.55] text-white/50 @max-[860px]/win:hidden">
          {details}
          {micName && status !== 'recording' && <span className="block truncate">{micName}</span>}
        </div>
      </div>
    </aside>
  )
}

// Provides the main shell, global shortcuts, and existing app overlays.
function AppLayoutContent() {
  const [permissionsBlocked, setPermissionsBlocked] = useState(true)
  const [popover, setPopover] = useState<'theme' | 'account' | null>(null)
  const [search, setSearch] = useState('')
  const { isOpen, open, close } = useSettingsPanel()
  const { settings, settingsLoading, updateSettings, settingsSaveError, dismissSettingsSaveError } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const { notification, dismiss } = useUpdateNotification()
  const location = useLocation()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const shouldFocusHistorySearch = useRef(false)
  const themeRef = useRef<HTMLButtonElement>(null)
  const checkedThemeRef = useRef<HTMLButtonElement>(null)
  const accountRef = useRef<HTMLButtonElement>(null)
  const historyRoute = location.pathname === '/app/history'
  const current = pages.find((page) => page.path === location.pathname)?.label ?? 'Home'
  const onboardingOpen = !settingsLoading && !settings.onboardingCompleted
  const showOpenRouterPrompt = !settingsLoading
    && settings.onboardingCompleted
    && !settings.openRouterKeyPromptShown
    && !(settings.providerApiKeys ?? []).some((key) => key.providerId === 'openrouter' && key.hasKey)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover) {
        setPopover(null)
        ;(popover === 'theme' ? themeRef : accountRef).current?.focus()
        return
      }
      if (!event.metaKey) return

      const target = event.target
      const isField = target instanceof HTMLElement
        && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (historyRoute) {
          document.querySelector<HTMLInputElement>('[data-history-search]')?.focus()
        } else {
          searchRef.current?.focus()
        }
        return
      }
      if (isField) return
      if (event.key === ',') {
        event.preventDefault()
        open()
        return
      }
      const match = /^([1-5])$/.exec(event.key)
      if (match?.[1]) {
        event.preventDefault()
        navigate(pages[Number(match[1]) - 1]?.path ?? '/app')
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyRoute, navigate, open, popover])

  useEffect(() => {
    if (!historyRoute || !shouldFocusHistorySearch.current) return
    document.querySelector<HTMLInputElement>('[data-history-search]')?.focus()
    shouldFocusHistorySearch.current = false
  }, [historyRoute, location.search])

  useEffect(() => {
    if (!popover) return
    const onPointerDown = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.popover-anchor')) setPopover(null)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [popover])

  useEffect(() => {
    if (popover === 'theme') checkedThemeRef.current?.focus()
  }, [popover])

  // Updates the query and focuses the History search after navigation.
  const setSearchQuery = (query: string) => {
    setSearch(query)
    shouldFocusHistorySearch.current = true
    navigate(`/app/history?q=${encodeURIComponent(query)}`, { replace: true })
  }

  // Moves focus through the theme choices with the keyboard.
  const handleThemeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    const activeIndex = items.findIndex((item) => item === document.activeElement)
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? items.length - 1
        : (activeIndex + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length
    items[nextIndex]?.focus()
  }

  return (
    <div className="relative h-full min-w-0 @container/win">
      <div
        className="grid h-full min-w-0 grid-cols-[236px_minmax(0,1fr)] overflow-hidden @max-[1080px]/win:grid-cols-[212px_minmax(0,1fr)] @max-[860px]/win:grid-cols-[78px_minmax(0,1fr)]"
        inert={isOpen || permissionsBlocked ? true : undefined}
      >
        <Sidebar onSettings={() => open()} />
        <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
          <header className="flex h-14 shrink-0 items-center gap-2.5 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] px-[max(26px,calc((100cqw-1760px)/2-18px))] pl-[max(44px,calc((100cqw-1760px)/2))] pt-2 @max-[720px]/win:px-4 @max-[720px]/win:pl-6">
            <div className="label-meta mr-auto whitespace-nowrap text-[10px] text-faint">
              VAANI / <b className="font-medium text-ink">{current}</b>
            </div>
            {!historyRoute && (
              <SearchField
                ref={searchRef}
                value={search}
                className="ml-auto h-[34px] w-[min(250px,35vw)] @max-[720px]/win:w-[210px]"
                placeholder="Search dictations"
                hint="⌘K"
                onChange={setSearchQuery}
              />
            )}
            <div className="flex items-center gap-[5px]">
              <div className="popover-anchor relative">
                <button
                  ref={themeRef}
                  className="grid size-8 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:bg-surface hover:text-ink"
                  aria-label="Choose theme"
                  aria-haspopup="menu"
                  aria-expanded={popover === 'theme'}
                  onClick={() => setPopover(popover === 'theme' ? null : 'theme')}
                >
                  {mode === 'dark' ? <Moon size={17} /> : <Sun size={17} />}
                </button>
                {popover === 'theme' && (
                  <div
                    className="absolute right-0 top-[39px] z-[60] min-w-44 rounded-[14px] border border-line bg-card p-1.5 text-ink shadow-[0_12px_36px_rgba(0,0,0,.18)]"
                    role="menu"
                    aria-label="Theme"
                    onKeyDown={handleThemeKeyDown}
                  >
                    <button
                      ref={mode === 'light' ? checkedThemeRef : undefined}
                      role="menuitemradio"
                      aria-checked={mode === 'light'}
                      className="flex h-[34px] w-full items-center gap-[9px] rounded-[9px] px-[9px] text-left text-[13px] hover:bg-surface focus:bg-surface focus:outline-none"
                      onClick={() => { setMode('light'); setPopover(null); themeRef.current?.focus() }}
                    >
                      Light {mode === 'light' && <Check className="ml-auto text-accent" size={14} />}
                    </button>
                    <button
                      ref={mode === 'dark' ? checkedThemeRef : undefined}
                      role="menuitemradio"
                      aria-checked={mode === 'dark'}
                      className="flex h-[34px] w-full items-center gap-[9px] rounded-[9px] px-[9px] text-left text-[13px] hover:bg-surface focus:bg-surface focus:outline-none"
                      onClick={() => { setMode('dark'); setPopover(null); themeRef.current?.focus() }}
                    >
                      Dark {mode === 'dark' && <Check className="ml-auto text-accent" size={14} />}
                    </button>
                  </div>
                )}
              </div>
              <div className="popover-anchor relative">
                <button
                  ref={accountRef}
                  className="grid size-8 place-items-center rounded-full border border-line bg-card text-muted transition-colors hover:bg-surface hover:text-ink"
                  aria-label="Account"
                  aria-haspopup="dialog"
                  aria-expanded={popover === 'account'}
                  onClick={() => setPopover(popover === 'account' ? null : 'account')}
                >
                  <UserRound size={17} />
                </button>
                {popover === 'account' && (
                  <div
                    className="absolute right-0 top-[39px] z-[60] w-[306px] rounded-[14px] border border-line bg-card p-[17px] text-ink shadow-[0_12px_36px_rgba(0,0,0,.18)]"
                    role="dialog"
                    aria-label="Account"
                  >
                    <b className="text-display text-lg">
                      Sync across your Macs
                      <span className="rounded-full bg-lav px-2 py-1 text-[11px] font-semibold">
                        Coming soon
                      </span>
                    </b>
                    <p className="mb-[14px] mt-[7px] text-[12.5px] leading-[1.5] text-muted">
                      Sync will include your dictionary, snippets and settings. History and recordings will not sync.
                    </p>
                    <div className="flex gap-[7px]">
                      <button
                        className="inline-flex h-9 items-center rounded-full border border-line bg-card px-[15px] text-[13px] font-semibold"
                        disabled
                        aria-label="Sign in, coming soon"
                      >
                        Sign in
                      </button>
                      <button
                        className="inline-flex h-9 items-center rounded-full px-[15px] text-[13px] font-semibold text-muted hover:bg-surface"
                        onClick={() => { setPopover(null); accountRef.current?.focus() }}
                      >
                        Close
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </header>
          {notification && <UpdateBanner notification={notification} onDismiss={dismiss} />}
          <main className={`@container/main min-w-0 flex-1 overflow-auto pb-11 pt-[50px] @max-[720px]/main:pb-7 @max-[720px]/main:pt-2 ${onboardingOpen ? 'touch-none overflow-hidden' : ''}`}>
            <div className="mx-auto w-full max-w-[1848px] px-11 [&_h1]:text-[56px] @max-[720px]/main:px-6 @max-[720px]/main:[&_h1]:text-[46px]">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
      {isOpen && <SettingsPanel onClose={close} />}
      {onboardingOpen && <OnboardingModal settings={settings} updateSettings={updateSettings} onComplete={() => updateSettings({ onboardingCompleted: true })} />}
      {showOpenRouterPrompt && <OpenRouterKeyPrompt updateSettings={updateSettings} />}
      <PermissionGuard onBlockingChange={setPermissionsBlocked} />
      {settingsSaveError && (
        <div role="alert" className="fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-lg">
          <span>Settings not saved. {settingsSaveError} Fix or move the file, then restart Vaani.</span>
          <button
            aria-label="Dismiss settings error"
            onClick={dismissSettingsSaveError}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

// Adds settings panel state around the main shell.
export default function AppLayout() {
  return (
    <SettingsPanelProvider>
      <AppLayoutContent />
    </SettingsPanelProvider>
  )
}
