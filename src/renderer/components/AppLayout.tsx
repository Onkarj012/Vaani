import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BookOpen, ChartLine, Check, Clock, House, Moon, SlidersHorizontal, Sun, UserRound } from 'lucide-react'
import { useVaaniUi } from '@renderer/context/vaani-ui'
import { useColorMode } from '@renderer/context/color-mode'
import { SettingsPanelProvider, useSettingsPanel } from '@renderer/context/settings-panel'
import { useUpdateNotification } from '@renderer/hooks/useUpdateNotification'
import SettingsModal from '@renderer/components/SettingsModal'
import OnboardingModal from '@renderer/components/OnboardingModal'
import OpenRouterKeyPrompt from '@renderer/components/OpenRouterKeyPrompt'
import PermissionGuard from '@renderer/components/PermissionGuard'
import UpdateBanner from '@renderer/components/UpdateBanner'
import VaaniMark from '@renderer/components/ui/VaaniMark'
import MiniCapsule from '@renderer/components/ui/MiniCapsule'
import SearchField from '@renderer/components/ui/SearchField'
import { Kbd } from '@renderer/components/ui/Kbd'

const pages = [
  { path: '/app', label: 'Home', icon: House }, { path: '/app/history', label: 'History', icon: Clock },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen }, { path: '/app/snippets', label: 'Snippets', icon: SlidersHorizontal },
  { path: '/app/insights', label: 'Insights', icon: ChartLine },
]

// Formats the configured shortcut as compact Mac key labels.
function displayHotkey(value: string): string {
  return value.split('+').map((part) => ({ Cmd: '⌘', Command: '⌘', Option: '⌥', Ctrl: '⌃', Shift: '⇧', Fn: 'fn', Return: '↩', Space: 'Space' }[part] ?? part)).join('')
}

// Shows the current dictation state in the sidebar.
function stateLabel(status: string, message?: string): string {
  if (status === 'idle' || status === 'starting') return 'Ready to dictate'
  if (status === 'recording') return 'Listening'
  if (['finalizing', 'transcribing'].includes(status)) return 'Cleaning up'
  if (status === 'completed') return 'Inserted'
  return message || 'Dictation failed'
}

// Renders one sidebar navigation link.
function Navigation({ onSettings }: { onSettings: () => void }) {
  const location = useLocation()
  return <>
    <div className="navlabel meta">Workspace</div>
    <nav className="nav" aria-label="Workspace">{pages.map(({ path, label, icon: Icon }, index) => <NavLink key={path} to={path} end={path === '/app'} title={`${label} (⌘${index + 1})`} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} aria-current={location.pathname === path ? 'page' : undefined}><Icon size={17} strokeWidth={1.8}/><span className="nl">{label}</span><Kbd className="k">⌘{index + 1}</Kbd></NavLink>)}</nav>
    <div className="side-bottom"><nav className="nav" aria-label="Settings"><button className="nav-link" onClick={onSettings} title="Settings (⌘,)"><SlidersHorizontal size={17}/><span className="nl">Settings</span><Kbd className="k">⌘,</Kbd></button></nav></div>
  </>
}

// Renders the app sidebar and live dictation card.
function Sidebar({ onSettings }: { onSettings: () => void }) {
  const { dictation, bars, settings } = useVaaniUi()
  const [version, setVersion] = useState('')
  const [providerNames, setProviderNames] = useState<Record<string, string>>({})
  useEffect(() => { let alive = true; void window.vaani.getAppVersion().then((value) => { if (alive) setVersion(value) }).catch(() => undefined); return () => { alive = false } }, [])
  useEffect(() => { let alive = true; void window.vaani.getProviderStatus().then((providers) => { if (alive) setProviderNames(Object.fromEntries(providers.map((provider) => [provider.id, provider.name]))) }).catch(() => undefined); return () => { alive = false } }, [])
  const status = dictation.status
  const live = status === 'recording' || status === 'finalizing' || status === 'transcribing'
  const details = status === 'recording' ? 'Tap Send or press fn again' : `${providerNames[settings.transcriptionProvider] ?? settings.transcriptionProvider} → ${providerNames[settings.formattingProvider] ?? settings.formattingProvider}`
  return <aside className="side"><div className="brand"><span className="brand-mark"><VaaniMark size={27} live={live}/></span><div><b>Vaani</b>{version && <span className="meta">Dictation · {version}</span>}</div></div><Navigation onSettings={onSettings}/><div className="status"><div className="st-top"><i className={`ldot ${status === 'recording' ? 'rec' : live ? 'proc' : ''}`}/><span className="st-label">{stateLabel(status, status === 'error' ? dictation.message : undefined)}</span><Kbd>{displayHotkey(settings.primaryHotkey)}</Kbd></div>{live && <div className="st-live"><MiniCapsule state={status === 'recording' ? 'rec' : 'proc'} bars={status === 'recording' ? bars : undefined}/></div>}<div className="st-sub">{details}</div></div></aside>
}

// Provides the main shell, global shortcuts, and existing app overlays.
function AppLayoutContent() {
  const [permissionsBlocked, setPermissionsBlocked] = useState(true)
  const [popover, setPopover] = useState<'theme' | 'account' | null>(null)
  const { isOpen, open, close } = useSettingsPanel()
  const { settings, settingsLoading, updateSettings, settingsSaveError, dismissSettingsSaveError } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const { notification, dismiss } = useUpdateNotification()
  const location = useLocation()
  const navigate = useNavigate()
  const searchRef = useRef<HTMLInputElement>(null)
  const themeRef = useRef<HTMLButtonElement>(null)
  const accountRef = useRef<HTMLButtonElement>(null)
  const historyRoute = location.pathname === '/app/history'
  const current = pages.find((page) => page.path === location.pathname)?.label ?? 'Home'
  const onboardingOpen = !settingsLoading && !settings.onboardingCompleted
  const showOpenRouterPrompt = !settingsLoading && settings.onboardingCompleted && !settings.openRouterKeyPromptShown && !(settings.providerApiKeys ?? []).some((key) => key.providerId === 'openrouter' && key.hasKey)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && popover) { setPopover(null); (popover === 'theme' ? themeRef : accountRef).current?.focus(); return }
      if (!event.metaKey) return
      const target = event.target
      const isField = target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); (historyRoute ? document.querySelector<HTMLInputElement>('.main input') : searchRef.current)?.focus(); return }
      if (isField) return
      if (event.key === ',') { event.preventDefault(); open(); return }
      const match = /^([1-5])$/.exec(event.key)
      if (match?.[1]) { event.preventDefault(); navigate(pages[Number(match[1]) - 1]?.path ?? '/app') }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyRoute, navigate, open, popover])

  useEffect(() => { if (!historyRoute && location.pathname === '/app/history') document.querySelector<HTMLInputElement>('[data-history-search]')?.focus() }, [historyRoute, location.pathname])
  useEffect(() => {
    if (!popover) return
    const onPointerDown = (event: MouseEvent) => { if (!(event.target instanceof Element) || !event.target.closest('.popover-anchor')) setPopover(null) }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [popover])

  const setSearch = (query: string) => { navigate(`/app/history?q=${encodeURIComponent(query)}`); requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.main input')?.focus()) }
  return <div className="v1 app-shell" inert={isOpen || permissionsBlocked ? true : undefined}>
    <Sidebar onSettings={() => open()}/>
    <div className="app-frame" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <header className="toolbar"><div className="crumb">VAANI / <b>{current}</b></div>{!historyRoute && <SearchField ref={searchRef} className="tsearch" placeholder="Search dictations" hint="⌘K" onChange={setSearch}/>}<div className="top-actions"><div className="popover-anchor"><button ref={themeRef} className="icb" aria-label="Choose theme" aria-haspopup="menu" aria-expanded={popover === 'theme'} onClick={() => setPopover(popover === 'theme' ? null : 'theme')}>{mode === 'dark' ? <Moon size={17}/> : <Sun size={17}/>}</button>{popover === 'theme' && <div className="pop theme-pop" role="menu" aria-label="Theme" onKeyDown={(event) => { if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return; event.preventDefault(); const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]; const active = document.activeElement; const index = active instanceof HTMLButtonElement ? items.indexOf(active) : -1; items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus() }}><button role="menuitemradio" aria-checked={mode === 'light'} onClick={() => { setMode('light');setPopover(null);themeRef.current?.focus() }}>Light {mode === 'light' && <Check size={14}/>}</button><button role="menuitemradio" aria-checked={mode === 'dark'} onClick={() => { setMode('dark');setPopover(null);themeRef.current?.focus() }}>Dark {mode === 'dark' && <Check size={14}/>}</button></div>}</div><div className="popover-anchor"><button ref={accountRef} className="icb" aria-label="Account" aria-haspopup="dialog" aria-expanded={popover === 'account'} onClick={() => setPopover(popover === 'account' ? null : 'account')}><UserRound size={17}/></button>{popover === 'account' && <div className="pop account-pop" role="dialog" aria-label="Account"><b>Sync across your Macs <span className="chip c-lav">Coming soon</span></b><p>Sync will include your dictionary, snippets and settings. History and recordings will not sync.</p><div><button className="btn" disabled aria-label="Sign in, coming soon">Sign in</button><button className="btn ghost" onClick={() => { setPopover(null);accountRef.current?.focus() }}>Close</button></div></div>}</div></div></header>
      {notification && <UpdateBanner notification={notification} onDismiss={dismiss}/>}
      <main className={`main ${historyRoute ? 'fixed' : ''} ${onboardingOpen ? 'touch-none overflow-hidden' : ''}`}><div className="page-wrap"><Outlet/></div></main>
    </div>
    {isOpen && <SettingsModal isOpen={isOpen} onClose={close}/>}
    {onboardingOpen && <OnboardingModal settings={settings} updateSettings={updateSettings} onComplete={() => updateSettings({ onboardingCompleted: true })}/>}
    {showOpenRouterPrompt && <OpenRouterKeyPrompt updateSettings={updateSettings}/>}
    <PermissionGuard onBlockingChange={setPermissionsBlocked}/>
    {settingsSaveError && <div role="alert" className="fixed inset-x-4 top-4 z-[80] mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-600 shadow-lg"><span>Settings not saved. {settingsSaveError} Fix or move the file, then restart Vaani.</span><button aria-label="Dismiss settings error" onClick={dismissSettingsSaveError}>×</button></div>}
  </div>
}

// Adds settings panel state around the main shell.
export default function AppLayout() {
  return <SettingsPanelProvider><AppLayoutContent/></SettingsPanelProvider>
}
