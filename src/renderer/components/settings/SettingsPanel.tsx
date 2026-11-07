import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronDown, ChevronRight, Cpu, Database, Download, Globe, Keyboard, Mic, Monitor, Palette, Plug, Plus, RefreshCw, Search, ShieldCheck, Trash2, Type, X } from 'lucide-react'
import { useVaaniUi } from '@renderer/context/vaani-ui'
import { useColorMode } from '@renderer/context/color-mode'
import { useSettingsPanel, type SettingsSectionId } from '@renderer/context/settings-panel'
import { useDictateTip } from '@renderer/hooks/useDictateTip'
import { formatHotkeyLabel, HotkeyCapture } from '@renderer/components/HotkeyCapture'
import { ModelPicker } from '@renderer/components/ModelPicker'
import AppIcon from '@renderer/components/ui/AppIcon'
import { Button } from '@renderer/components/ui/button'
import { Input, Textarea } from '@renderer/components/ui/input'
import { Kbd } from '@renderer/components/ui/Kbd'
import { Select } from '@renderer/components/ui/Select'
import { Segmented } from '@renderer/components/ui/Segmented'
import { Tag } from '@renderer/components/ui/tag'
import { Toggle } from '@renderer/components/ui/toggle'
import { createExportPayload } from '@renderer/exportData'
import { decideProviderKeyDraft } from '@renderer/lib/providerKeyDraft'
import { pickerEntries } from '@shared/modelList'
import { useNavigate } from 'react-router-dom'
import { KNOWN_PROVIDERS, SUPPORTED_LANGUAGES, getLanguageLabel, isLanguageSupportedByProvider, resolveProfileLanguage } from '@shared/defaults'
import type { AudioInputDevice, PermissionStatus, Settings } from '@shared/types'

const sections: { id: SettingsSectionId; label: string; description: string; icon: typeof Monitor }[] = [
  { id: 'general', label: 'General', description: 'Startup, the Dock and updates.', icon: Monitor },
  { id: 'permissions', label: 'Permissions', description: 'What Vaani needs from macOS, and why.', icon: ShieldCheck },
  { id: 'api', label: 'API and providers', description: 'Keys, local models and which model does what.', icon: Plug },
  { id: 'language', label: 'Language', description: 'What you speak, per app, and how it gets cleaned up.', icon: Globe },
  { id: 'dictation', label: 'Dictation', description: 'How recording starts and stops, and how audio is captured.', icon: Mic },
  { id: 'hotkey', label: 'Shortcuts', description: 'Keys that work in every app.', icon: Keyboard },
  { id: 'injection', label: 'Insertion', description: 'How text lands where your cursor is.', icon: Type },
  { id: 'appearance', label: 'Appearance', description: 'Theme, accent colour, the overlay waveform and Home cards.', icon: Palette },
  { id: 'data', label: 'Data', description: 'Export, clear or reset what Vaani stores.', icon: Database },
]
const languages = SUPPORTED_LANGUAGES.map((language) => ({ value: language.value, label: language.label }))
const styles = [{ value: 'plain', label: 'Plain' }, { value: 'developer', label: 'Developer' }, { value: 'casual', label: 'Casual' }, { value: 'formal', label: 'Formal' }, { value: 'email', label: 'Email' }]
const accents = [{ color: '#7575c8', label: 'Indigo' }, { color: '#ff006e', label: 'Pink' }, { color: '#2bb5a0', label: 'Teal' }, { color: '#e0a030', label: 'Amber' }]

// Renders a setting row with its label, description, and control.
function Row({ title, description, children, wide = false, className = '' }: { title: string; description?: string; children: ReactNode; wide?: boolean; className?: string }) {
  return <div data-setting-row className={`flex ${wide ? 'flex-col items-stretch gap-3' : 'items-center gap-5'} border-b border-line py-[15px] last:border-b-0 ${className}`}><div className="min-w-0 flex-1"><div className="text-[14px] font-semibold text-ink">{title}</div>{description && <p className="mt-[3px] text-[12.5px] leading-[1.45] text-muted">{description}</p>}</div><div className={wide ? '' : 'shrink-0'}>{children}</div></div>
}

// Groups related settings under a compact label.
function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="mt-6 first:mt-5"><h3 className="label-meta mb-1 text-[10px] text-faint">{title}</h3>{children}</section>
}

// Shows a selectable option card.
function OptionCards<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; description: string }[]; onChange: (value: T) => void }) {
  return <div className="grid grid-cols-3 gap-2 @max-[700px]/pane:grid-cols-1">{options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)} className={`flex min-h-[82px] items-start justify-between gap-2 rounded-[16px] border p-3 text-left transition-colors ${value === option.value ? 'border-accent bg-accent/10' : 'border-line bg-card hover:border-ink/25'}`}><span><b className="block text-[13px] text-ink">{option.label}</b><span className="mt-1 block text-[11.5px] leading-snug text-muted">{option.description}</span></span>{value === option.value && <Check size={15} className="shrink-0 text-accent" />}</button>)}</div>
}

// Renders one data action with its label and button.
function DataAction({ icon, title, description, actionLabel, onClick }: { icon: ReactNode; title: string; description: string; actionLabel: string; onClick: () => void }) {
  return <div className="flex items-center gap-3 rounded-[16px] bg-surface p-3"><span className="grid size-8 place-items-center rounded-full bg-card">{icon}</span><span className="min-w-0 flex-1"><b className="block text-[13px]">{title}</b><small className="text-[11px] text-muted">{description}</small></span><Button size="sm" variant={title === 'Export history' ? 'default' : 'ghost'} onClick={onClick}>{actionLabel}</Button></div>
}

// Renders the settings window and binds it to existing settings APIs.
export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { isOpen, section, setSection } = useSettingsPanel()
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries, updateStatus, checkForUpdates, restartAndInstall, dictionaryItems, snippets } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const navigate = useNavigate()
  const tip = useDictateTip(historyEntries.length)
  const [query, setQuery] = useState('')
  const [version, setVersion] = useState('')
  const [devices, setDevices] = useState<AudioInputDevice[]>([])
  const [permissions, setPermissions] = useState<PermissionStatus>({ microphone: 'unknown', accessibility: 'unknown' })
  const [whisperModels, setWhisperModels] = useState<string[]>([])
  const [expandedProfile, setExpandedProfile] = useState<string | null>(null)
  const [addingProfile, setAddingProfile] = useState(false)
  const [profileName, setProfileName] = useState('')
  const [profileBundle, setProfileBundle] = useState('')
  const [fillerDraft, setFillerDraft] = useState('')
  const [promptDraft, setPromptDraft] = useState(settings.customPrompt ?? '')
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [permissionsBusy, setPermissionsBusy] = useState<keyof PermissionStatus | null>(null)
  const [hotkeyEditing, setHotkeyEditing] = useState<'primary' | 'paste' | null>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const lastSection = sections.find((item) => item.id === section) ?? { label: 'General', description: 'Startup, the Dock and updates.' }
  const profiles = settings.appProfiles ?? []
  const sttProviders = KNOWN_PROVIDERS.filter((provider) => !provider.hidden && (provider.type === 'stt' || provider.type === 'local-stt'))
  const llmProviders = KNOWN_PROVIDERS.filter((provider) => provider.type === 'llm')
  const keyProviders = KNOWN_PROVIDERS.filter((provider) => provider.requiresApiKey && !provider.hidden)
  const profileLanguageOptions = [{ value: '', label: `Use global (${getLanguageLabel(settings.language) ?? settings.language})` }, ...languages.filter((language) => language.value !== 'auto')]
  const micOptions = [{ value: '', label: 'Automatic built-in microphone' }, ...devices.filter((device) => device.isPhysical).map((device) => ({ value: device.uid, label: `${device.name || 'Microphone'}${device.isDefault ? ' (Default)' : ''}` }))]
  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    const providers = KNOWN_PROVIDERS.map((provider) => `${provider.name} ${provider.id}`).join(' ')
    const models = [...pickerEntries('transcription'), ...pickerEntries('cleanup')].map((entry) => `${entry.displayName} ${entry.modelId}`).join(' ')
    const profilesText = profiles.map((profile) => `${profile.name} ${profile.appBundleIds.join(' ')} ${profile.language ?? ''}`).join(' ')
    const currentSettings = `${settings.language} ${settings.transcriptionProvider} ${settings.transcriptionModel} ${settings.formattingProvider} ${settings.formattingModel} ${settings.localWhisperModel} ${settings.fillerWords.join(' ')} ${settings.extraFillerWords.join(' ')} ${providers} ${profilesText}`
    return sections.filter((item) => {
      const extra = item.id === 'api' ? `${currentSettings} ${models} ${whisperModels.join(' ')} transcription cleanup failover processing mode dictionary snippets`
        : item.id === 'language' ? `${currentSettings} default language app profiles smart punctuation style custom instructions filler words ${languages.map((language) => language.label).join(' ')}`
        : item.id === 'general' ? 'account sync launch at login dock updates version check now'
        : item.id === 'permissions' ? 'microphone accessibility granted not granted macOS'
        : item.id === 'dictation' ? 'recording mode audio capture microphone save recordings folder low latency clip length silence threshold'
        : item.id === 'hotkey' ? 'shortcuts dictate paste latest cancel dictation escape fn'
        : item.id === 'injection' ? 'insertion auto accessibility api copy only paste mode animated instant'
        : item.id === 'appearance' ? 'theme light dark accent indigo pink teal amber home dictate card setup checklist'
        : 'data dictations stored oldest entry export history clear history reset settings'
      return `${item.label} ${item.description} ${extra}`.toLowerCase().includes(q)
    })
  }, [query, settings, profiles, whisperModels])

  useEffect(() => {
    if (!isOpen) return
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    void window.vaani.getAppVersion().then(setVersion).catch(() => setVersion(''))
    void window.vaani.listAudioInputDevices().then(setDevices).catch(() => setDevices([]))
    void window.vaani.whisperListModels().then(setWhisperModels).catch(() => setWhisperModels([]))
    void window.vaani.getPermissionStatus().then(setPermissions).catch(() => undefined)
    const unsubscribe = window.vaani.onPermissionStatusChanged?.(setPermissions)
    requestAnimationFrame(() => dialogRef.current?.focus())
    return () => { unsubscribe?.(); openerRef.current?.focus() }
  }, [isOpen])

  useEffect(() => { setPromptDraft(settings.customPrompt ?? '') }, [settings.customPrompt])
  useEffect(() => {
    if (!hotkeyEditing) return
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setHotkeyEditing(null) }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [hotkeyEditing])
  useEffect(() => {
    if (!query.trim()) return
    const hit = [...(paneRef.current?.querySelectorAll<HTMLElement>('[data-setting-row]') ?? [])].find((row) => row.textContent?.toLowerCase().includes(query.trim().toLowerCase()))
    if (hit) {
      hit.scrollIntoView({ block: 'nearest' })
      hit.classList.add('settings-hit')
      const timer = window.setTimeout(() => hit.classList.remove('settings-hit'), 1100)
      return () => window.clearTimeout(timer)
    }
  }, [query, section, settings])

  // Handles panel keys, Escape, close and focus trapping.
  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      if (hotkeyEditing) { setHotkeyEditing(null); event.preventDefault(); return }
      if (expandedProfile) { setExpandedProfile(null); event.preventDefault(); return }
      onClose(); event.preventDefault(); return
    }
    if (event.metaKey && event.key.toLowerCase() === 'w') { event.preventDefault(); onClose(); return }
    if (event.key !== 'Tab') return
    const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])].filter((element) => element.offsetParent !== null)
    const first = elements[0]
    const last = elements[elements.length - 1]
    if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  // Adds a profile after checking its bundle id against existing profiles.
  function addProfile() {
    const bundleId = profileBundle.trim()
    if (!bundleId || profiles.some((profile) => profile.appBundleIds.some((id) => id.toLowerCase() === bundleId.toLowerCase()))) return
    void updateSettings({ appProfiles: [...profiles, { id: crypto.randomUUID(), name: profileName.trim() || bundleId, appBundleIds: [bundleId] }] })
    setProfileName(''); setProfileBundle(''); setAddingProfile(false)
  }

  // Updates one existing app profile.
  function patchProfile(id: string, patch: Partial<NonNullable<Settings['appProfiles']>[number]>) {
    void updateSettings({ appProfiles: profiles.map((profile) => profile.id === id ? { ...profile, ...patch } : profile) })
  }

  // Saves an API key through the existing secure provider-key bridge.
  async function saveKey(providerId: string, key: string) {
    if (decideProviderKeyDraft(key, 'blur') !== 'save') return
    await window.vaani.setProviderApiKey(providerId, key)
    await updateSettings({})
  }

  // Tests a provider key and refreshes its saved validation state.
  async function testKey(providerId: string) {
    const key = keyDrafts[providerId] ?? ''
    if (!key.trim()) return
    setTestingProvider(providerId)
    try { await saveKey(providerId, key); await window.vaani.testApiKey(providerId, key); await updateSettings({}) }
    finally { setTestingProvider(null) }
  }

  // Requests or opens the macOS permission pane for one permission.
  async function permissionAction(permission: keyof PermissionStatus) {
    setPermissionsBusy(permission)
    try {
      if (permissions[permission] === 'granted') await window.vaani.openPermissionSettings(permission)
      else if (permission === 'microphone') await window.vaani.requestMicrophonePermission()
      else await window.vaani.requestAccessibilityPermission()
      setPermissions(await window.vaani.getPermissionStatus())
    } finally { setPermissionsBusy(null) }
  }

  // Exports stored settings and dictations to a local JSON file.
  function exportHistory() {
    const payload = createExportPayload(settings, historyEntries)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url)
  }

  // Sends the user to Dictionary after selecting Fix in the provider pipeline.
  function openDictionary() {
    onClose()
    navigate('/app/dictionary')
  }

  if (!isOpen) return null
  return <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <style>{'@keyframes settings-enter{from{opacity:0;transform:translateY(8px) scale(.985)}to{opacity:1;transform:translateY(0) scale(1)}}.settings-hit{background:color-mix(in srgb,var(--color-accent) 9%,transparent);border-radius:12px;transition:background-color .7s}'}</style>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onKeyDown={handleKeyDown} className="grid h-[min(680px,calc(100vh-66px))] w-[min(940px,calc(100vw-40px))] grid-cols-[232px_minmax(0,1fr)] overflow-hidden rounded-xl border border-line bg-bg text-ink shadow-[0_44px_110px_-24px_rgba(0,0,0,.55)] outline-none max-[900px]:grid-cols-[180px_minmax(0,1fr)] animate-[settings-enter_.22s_cubic-bezier(.2,1,.4,1)]">
      <aside className="flex min-h-0 flex-col overflow-y-auto border-r border-line bg-side px-3 py-7">
        <h1 id="settings-title" className="text-display mb-4 px-2 text-[28px] text-ink">Settings</h1>
        <label className="mb-3 flex h-9 items-center gap-2 rounded-full border border-line bg-card px-3 text-muted"><Search size={14}/><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a setting" aria-label="Find a setting" className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none placeholder:text-faint" /></label>
        <nav aria-label="Settings sections" className="grid gap-1">{filteredSections.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" aria-current={section === item.id ? 'page' : undefined} onClick={() => setSection(item.id)} className={`flex min-h-9 items-center gap-2 rounded-full px-2.5 text-left text-[12.5px] transition-colors ${section === item.id ? 'bg-accent/10 font-semibold text-accent' : 'text-muted hover:bg-bg hover:text-ink'}`}><Icon size={15} strokeWidth={1.8}/>{item.label}</button> })}{filteredSections.length === 0 && <p className="px-2 py-2 text-[12px] text-muted">No settings match.</p>}</nav>
      </aside>
      <div className="relative flex min-h-0 min-w-0 flex-col">
        <button type="button" aria-label="Close settings" title="Close settings" onClick={onClose} className="absolute right-4 top-4 z-10 grid size-7 place-items-center rounded-full bg-surface text-muted hover:bg-line hover:text-ink"><X size={15}/></button>
        <header className="shrink-0 border-b border-line px-8 pb-4 pt-7 pr-14"><h2 className="text-display text-[36px] leading-none text-ink">{lastSection.label}</h2><p className="mt-2 text-[12.5px] text-muted">{lastSection.description}</p></header>
        <div ref={paneRef} className="min-h-0 flex-1 overflow-auto px-8 pb-8 pt-2 @container/pane">
          {section === 'general' && <>
            <Group title="Account"><div className="flex items-center gap-4 border-b border-line py-4"><div className="min-w-0 flex-1"><b className="text-[14px]">Sync across your Macs</b> <Tag tone="lav">Coming soon</Tag><p className="mt-1 text-[12.5px] leading-snug text-muted">Sync will include your dictionary, snippets and settings. History and recordings will not sync.</p></div><button disabled aria-label="Sign in, coming soon" className="h-9 rounded-full border border-line px-4 text-[13px] font-semibold text-muted">Sign in</button></div>
              <Row title="Launch at login" description="Start Vaani when you log in to your Mac."><Toggle checked={settings.launchAtLogin} onChange={(value) => void updateSettings({ launchAtLogin: value })}/></Row><Row title="Show in Dock" description="Off keeps Vaani in the menu bar only."><Toggle checked={settings.showInDock} onChange={(value) => void updateSettings({ showInDock: value })}/></Row></Group>
            <Group title="Updates"><div className={`my-2 flex flex-wrap items-center gap-4 rounded-[18px] p-4 ${updateStatus.status === 'ready' ? 'bg-accent/10' : 'bg-surface'}`}><div className="min-w-0 flex-1"><span className="label-meta text-[10px] text-faint">VAANI FOR MAC</span><b className="text-display mt-1 block text-[23px]">{version || '—'}</b><p className="text-[12px] text-muted">{updateStatus.status === 'checking' ? 'Checking for updates…' : updateStatus.status === 'available' ? updateStatus.message : updateStatus.status === 'downloading' ? updateStatus.message || 'Downloading update…' : updateStatus.status === 'ready' ? 'An update is ready to install.' : updateStatus.status === 'error' ? updateStatus.message : updateStatus.available === false ? 'Vaani is up to date.' : 'Check for the latest version.'}</p></div><Button size="sm" onClick={() => void checkForUpdates()} disabled={updateStatus.status === 'checking' || updateStatus.status === 'downloading'}><RefreshCw size={14} className={updateStatus.status === 'checking' ? 'animate-spin' : ''}/> Check now</Button>{updateStatus.status === 'ready' && <Button size="sm" variant="accent" onClick={() => void restartAndInstall()}>Restart to update</Button>}</div></Group>
          </>}
          {section === 'permissions' && <><Group title="macOS permissions">{(['microphone', 'accessibility'] as const).map((permission) => { const granted = permissions[permission] === 'granted'; const title = permission === 'microphone' ? 'Microphone' : 'Accessibility'; const detail = permission === 'microphone' ? 'Vaani needs microphone access to hear your dictation. Audio is processed by your chosen provider.' : 'Vaani needs Accessibility access to insert text into the active app.'; const Icon = permission === 'microphone' ? Mic : ShieldCheck; return <div key={permission} className={`my-2 flex flex-wrap items-center gap-3 rounded-[18px] bg-surface p-3 ${!granted ? 'border border-peach' : ''}`}><span className={`grid size-[34px] place-items-center rounded-[11px] ${granted ? 'bg-mint text-[#2c6b1b]' : 'bg-peach text-[#a2462c]'}`}><Icon size={17}/></span><div className="min-w-0 flex-1"><b className="text-[13px]">{title}</b><p className="text-[11.5px] text-muted">{detail}</p></div><Tag tone={granted ? 'mint' : 'peach'}>{granted ? 'Granted' : 'Not granted'}</Tag><Button size="sm" variant="ghost" disabled={permissionsBusy === permission} onClick={() => void permissionAction(permission)}>{granted ? 'Open' : 'Grant access'}</Button></div> })}</Group><p className="mt-4 text-[12px] leading-relaxed text-muted">Vaani checks these again each time you come back to it. Turning one off in System Settings takes effect right away.</p></>}
          {section === 'api' && <>
            <div data-setting-row className="grid grid-cols-[1fr_22px_1fr_22px_.82fr] items-center gap-1 py-5 @max-[600px]/pane:grid-cols-1">
              <div className="rounded-[18px] bg-surface p-3"><span className="label-meta text-[9px] text-faint">01 · Hear</span><b className="mt-1 block text-[13px]">Transcription</b><ModelPicker role="transcription" provider={settings.transcriptionProvider} modelId={settings.transcriptionModel} onChange={(provider, modelId) => void updateSettings({ transcriptionProvider: provider, transcriptionModel: modelId })}/><small className="mt-2 block text-[11px] text-muted">{KNOWN_PROVIDERS.find((provider) => provider.id === settings.transcriptionProvider)?.locality === 'local' ? 'on this Mac' : 'cloud'}</small></div><ArrowRight size={14} className="justify-self-center text-faint max-[760px]:rotate-90"/>
              <div className="rounded-[18px] bg-surface p-3"><span className="label-meta text-[9px] text-faint">02 · Clean</span><b className="mt-1 block text-[13px]">Cleanup</b><ModelPicker role="cleanup" provider={settings.formattingProvider} modelId={settings.formattingModel} onChange={(provider, modelId) => void updateSettings({ formattingProvider: provider, formattingModel: modelId })}/><small className="mt-2 block text-[11px] text-muted">{KNOWN_PROVIDERS.find((provider) => provider.id === settings.formattingProvider)?.locality === 'local' ? 'on this Mac' : 'cloud'}</small></div><ArrowRight size={14} className="justify-self-center text-faint max-[760px]:rotate-90"/>
              <button type="button" onClick={openDictionary} className="rounded-[18px] bg-[#18181b] p-3 text-left text-white"><span className="label-meta text-[9px] text-white/55">03 · Fix</span><b className="mt-1 block text-[13px]">Dictionary &amp; snippets</b><span className="mt-1 block text-[11px] text-white/70">{dictionaryItems.length} rules · {snippets.length} snippets</span><small className="text-[10px] text-white/50">on this Mac</small></button>
            </div>
            <Group title="Provider keys">{keyProviders.map((provider) => { const saved = (settings.providerApiKeys ?? []).find((key) => key.providerId === provider.id); const validation = saved?.lastValidation; const isEditing = editingKey === provider.id; return <div key={provider.id} className="my-2 flex flex-wrap items-center gap-3 rounded-[18px] bg-surface p-3"><div className="min-w-[130px] flex-1"><b className="text-[13px]">{provider.name}</b><span className="ml-2 text-[11px] text-faint">{provider.type === 'llm' ? 'Cleanup' : 'Transcription'}</span></div>{!isEditing && <>{saved?.hasKey && <span aria-label="API key saved" className="font-mono text-[10px] tracking-[.18em] text-muted">••••••••••••</span>}<Tag tone={saved?.hasKey && validation?.valid ? 'mint' : 'surface'}>{saved?.hasKey && validation?.valid ? 'Connected' : 'Not set'}</Tag><span className="min-w-[130px] flex-1 text-[11px] text-muted">{validation?.message ?? (saved?.hasKey ? 'Key saved. Test it to verify.' : 'Add a key to use this provider.')}</span><Button size="sm" variant="ghost" onClick={() => setEditingKey(provider.id)}>{saved?.hasKey ? 'Replace' : 'Set key'}</Button>{saved?.hasKey && <Button size="sm" variant="ghost" onClick={() => { void window.vaani.clearProviderApiKey(provider.id).then(() => updateSettings({})) }}>Clear</Button>}</>}{isEditing && <div className="flex min-w-full flex-wrap gap-2"><Input type="password" autoComplete="new-password" aria-label={`${provider.name} API key`} value={keyDrafts[provider.id] ?? ''} onChange={(event) => setKeyDrafts({ ...keyDrafts, [provider.id]: event.target.value })} onBlur={() => { const key = keyDrafts[provider.id] ?? ''; if (decideProviderKeyDraft(key, 'blur') === 'save') void saveKey(provider.id, key) }} placeholder="API key" className="min-w-[180px] flex-1 font-mono"/><Button size="sm" onClick={() => void testKey(provider.id)} disabled={testingProvider === provider.id || !(keyDrafts[provider.id] ?? '').trim()}>{testingProvider === provider.id ? 'Testing…' : 'Test'}</Button><Button size="sm" variant="ghost" onClick={() => { setEditingKey(null); setKeyDrafts({ ...keyDrafts, [provider.id]: '' }) }}>Done</Button></div>}</div> })}</Group>
            <Group title="Fallbacks"><Row title="Provider failover" description="If a provider fails, Vaani tries the next available provider."><Toggle checked={settings.failoverEnabled} onChange={(value) => void updateSettings({ failoverEnabled: value })}/></Row><Row title="Processing mode" description="Choose when Vaani uses cloud providers or local whisper.cpp."><Select value={settings.offlineMode} onChange={(value) => void updateSettings({ offlineMode: value as Settings['offlineMode'] })} options={[{ value: 'auto', label: 'Cloud with local fallback' }, { value: 'always-offline', label: 'Local only' }, { value: 'always-online', label: 'Cloud only' }]}/></Row></Group>
            <Group title="Local whisper.cpp models">{whisperModels.length ? whisperModels.map((model) => <div key={model} className="my-2 flex items-center gap-3 rounded-[18px] bg-surface p-3"><Cpu size={17} className="text-muted"/><span className="min-w-0 flex-1 font-mono text-[12px]">{model}</span>{settings.localWhisperModel === model ? <Tag tone="mint">In use</Tag> : <Button size="sm" variant="ghost" onClick={() => void updateSettings({ localWhisperModel: model })}>Use</Button>}</div>) : <p className="py-3 text-[12px] text-muted">No local models are installed.</p>}</Group>
          </>}
          {section === 'language' && <>
            <Row title="Default language" description="Used when an app has no profile."><Select value={settings.language} onChange={(value) => void updateSettings({ language: value })} options={languages}/></Row>{!isLanguageSupportedByProvider(settings.language, settings.transcriptionProvider, settings.localWhisperModel) && <p className="flex gap-2 py-2 text-[12px] text-amber-600"><AlertTriangle size={14}/>The selected transcription provider does not support this language. Vaani will fall back to auto-detect.</p>}
            <Group title="App profiles">{profiles.map((profile) => { const opened = expandedProfile === profile.id; const effectiveLanguage = resolveProfileLanguage(profile.language, settings.language); const profileLang = profile.language && profile.language !== 'auto' ? profile.language : ''; return <div key={profile.id} className="my-2 overflow-hidden rounded-[16px] bg-surface"><div className="flex flex-wrap items-center gap-2 p-3"><AppIcon name={profile.name} bundleId={profile.appBundleIds[0] ?? ''} size={30}/><div className="min-w-[115px] flex-1"><b className="block text-[13px]">{profile.name}</b><span className="block truncate font-mono text-[10px] text-muted">{profile.appBundleIds.join(', ')}</span></div><Select aria-label={`${profile.name} language`} value={profileLang} onChange={(value) => patchProfile(profile.id, { language: value || undefined, transcriptionProvider: profile.transcriptionProvider && isLanguageSupportedByProvider(value || settings.language, profile.transcriptionProvider, settings.localWhisperModel) ? profile.transcriptionProvider : undefined })} options={profileLanguageOptions}/><Select aria-label={`${profile.name} style`} value={profile.stylePreset ?? ''} onChange={(value) => patchProfile(profile.id, { stylePreset: value ? value as Settings['stylePreset'] : undefined })} options={[{ value: '', label: 'Default style' }, ...styles]}/><button type="button" aria-label={`${opened ? 'Collapse' : 'Expand'} ${profile.name}`} aria-expanded={opened} onClick={() => setExpandedProfile(opened ? null : profile.id)} className="grid size-8 place-items-center rounded-full hover:bg-card">{opened ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</button></div>{opened && <div className="grid grid-cols-2 gap-x-4 px-4 pb-4 pl-[54px] max-[700px]:grid-cols-1"><label className="grid gap-1 text-[11px] text-muted">Transcription provider<Select value={profile.transcriptionProvider && isLanguageSupportedByProvider(effectiveLanguage, profile.transcriptionProvider, settings.localWhisperModel) ? profile.transcriptionProvider : ''} onChange={(value) => patchProfile(profile.id, { transcriptionProvider: value || undefined })} options={[{ value: '', label: 'Default provider' }, ...sttProviders.filter((provider) => isLanguageSupportedByProvider(effectiveLanguage, provider.id, settings.localWhisperModel)).map((provider) => ({ value: provider.id, label: provider.name }))]}/></label><label className="grid gap-1 text-[11px] text-muted">Cleanup provider<Select value={profile.formattingProvider ?? ''} onChange={(value) => patchProfile(profile.id, { formattingProvider: value || undefined })} options={[{ value: '', label: 'Default provider' }, ...llmProviders.map((provider) => ({ value: provider.id, label: provider.name }))]}/></label><Row title="Context awareness"><Toggle checked={profile.contextAwarenessEnabled ?? settings.contextAwarenessEnabled} onChange={(value) => patchProfile(profile.id, { contextAwarenessEnabled: value })}/></Row><Row title="Press Return after inserting"><Toggle checked={profile.autoSubmit ?? false} onChange={(value) => patchProfile(profile.id, { autoSubmit: value })}/></Row><Button variant="ghost" size="sm" className="col-span-full justify-self-start text-red-500" onClick={() => { void updateSettings({ appProfiles: profiles.filter((item) => item.id !== profile.id) }); setExpandedProfile(null) }}>Remove profile</Button></div>}</div> })}
              {addingProfile ? <div className="my-2 grid gap-2 rounded-[16px] border border-line p-3"><Input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="App name" aria-label="App name"/><Input value={profileBundle} onChange={(event) => setProfileBundle(event.target.value)} placeholder="Bundle ID" aria-label="Bundle ID"/><div className="flex gap-2"><Button size="sm" onClick={addProfile} disabled={!profileBundle.trim()}>Add profile</Button><Button size="sm" variant="ghost" onClick={() => setAddingProfile(false)}>Cancel</Button></div></div> : <Button size="sm" variant="ghost" className="mt-2" onClick={() => setAddingProfile(true)}><Plus size={14}/> Add app profile</Button>}</Group>
            <Group title="Cleanup"><Row title="Smart punctuation" description="Adds periods, commas and capitals."><Toggle checked={settings.smartPunctuation} onChange={(value) => void updateSettings({ smartPunctuation: value })}/></Row><Row title="Cleanup" description="Removes filler words and applies corrections."><Toggle checked={settings.cleanupEnabled} onChange={(value) => void updateSettings({ cleanupEnabled: value })}/></Row><Row title="Context awareness" description="Sends the app name and style hint to the formatter."><Toggle checked={settings.contextAwarenessEnabled} onChange={(value) => void updateSettings({ contextAwarenessEnabled: value })}/></Row><Row title="Style preset" description="Default tone when an app has no profile."><Segmented value={settings.stylePreset} options={styles} onChange={(value) => void updateSettings({ stylePreset: value as Settings['stylePreset'] })}/></Row>
              <Row wide title="Filler words" description="Cleanup drops these when they are not part of a sentence."><div className="flex flex-wrap items-center gap-1.5">{settings.fillerWords.map((word) => <span key={`d-${word}`} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface pl-3 pr-1 font-mono text-[11px]">{word}<button aria-label={`Remove ${word}`} onClick={() => void updateSettings({ fillerWords: settings.fillerWords.filter((item) => item !== word), fillerWordsCustomized: true })} className="grid size-5 place-items-center rounded-full text-muted hover:bg-card"><X size={12}/></button></span>)}{settings.extraFillerWords.map((word) => <span key={`e-${word}`} className="inline-flex h-7 items-center gap-1 rounded-full bg-surface pl-3 pr-1 font-mono text-[11px]">{word}<button aria-label={`Remove ${word}`} onClick={() => void updateSettings({ extraFillerWords: settings.extraFillerWords.filter((item) => item !== word) })} className="grid size-5 place-items-center rounded-full text-muted hover:bg-card"><X size={12}/></button></span>)}<input value={fillerDraft} onChange={(event) => setFillerDraft(event.target.value)} onKeyDown={(event) => { if (event.key !== 'Enter') return; event.preventDefault(); const word = fillerDraft.trim().toLowerCase(); if (word && !settings.extraFillerWords.includes(word) && !settings.fillerWords.includes(word)) void updateSettings({ extraFillerWords: [...settings.extraFillerWords, word] }); setFillerDraft('') }} placeholder="Add a word" aria-label="Add a filler word" className="h-7 w-28 rounded-full border border-dashed border-faint bg-transparent px-3 text-[11px] outline-none focus:border-accent"/></div></Row>
              <Row wide title="Custom instructions" description="Extra rules for the cleanup model, in plain words."><Textarea value={promptDraft} onChange={(event) => setPromptDraft(event.target.value)} onBlur={() => { if (promptDraft !== (settings.customPrompt ?? '')) void updateSettings({ customPrompt: promptDraft }) }} placeholder="e.g. Use British spelling. Never add emoji." className="min-h-20 resize-y"/></Row></Group>
          </>}
          {section === 'dictation' && <>
            <Group title="Recording"><Row wide title="Mode"><OptionCards value={settings.dictationMode} options={[{ value: 'toggle' as const, label: 'Toggle', description: 'Press once to start, again to stop.' }, { value: 'push-to-talk' as const, label: 'Push to talk', description: 'Hold to record, release to send.' }, { value: 'toggle-double' as const, label: 'Smart toggle', description: 'Hold to talk. Double-press to go hands-free.' }]} onChange={(value) => void updateSettings({ dictationMode: value })}/></Row><Row title="Audio capture" description="Native capture is experimental. If it fails, Vaani switches to browser capture."><Select value={settings.captureBackend} onChange={(value) => void updateSettings({ captureBackend: value as Settings['captureBackend'] })} options={[{ value: 'renderer', label: 'Browser capture (recommended)' }, { value: 'native', label: 'Native voice processing (experimental)' }]}/></Row><Row title="Microphone" description="Virtual and aggregate devices are skipped for native capture."><Select value={settings.micDeviceId ?? ''} onChange={(value) => void updateSettings({ micDeviceId: value || undefined })} options={micOptions}/></Row><Row title="Save recordings" description="Keeps WAV files on disk so you can replay them."><Toggle checked={settings.saveRecordings} onChange={(value) => void updateSettings({ saveRecordings: value })}/></Row>{settings.saveRecordings && <Row title="Recordings folder"><span className="max-w-[240px] truncate font-mono text-[11px] text-muted">{settings.recordingsPath || 'Not set'}</span></Row>}<Row title="Suggest dictionary words" description="After you fix a pasted word, offer to add a rule."><Toggle checked={settings.suggestDictionaryWords} onChange={(value) => void updateSettings({ suggestDictionaryWords: value })}/></Row><Row title="Low latency mode" description="Keeps the microphone open between dictations. Uses more battery."><Toggle checked={settings.preWarmMic} onChange={(value) => void updateSettings({ preWarmMic: value })}/></Row></Group>
            <Group title="Audio"><Row title="Minimum clip length" description="Clips shorter than this are ignored as accidental taps."><div className="flex w-[190px] items-center gap-3"><input aria-label="Minimum clip length" type="range" min="0.1" max="3" step="0.1" value={settings.minClipDuration} onChange={(event) => void updateSettings({ minClipDuration: Number(event.target.value) })} className="w-full accent-[#7575c8]"/><output className="w-12 text-right font-mono text-[11px]">{settings.minClipDuration.toFixed(1)} s</output></div></Row><Row title="Silence threshold" description="Audio below this level counts as silence and gets trimmed."><div className="flex w-[190px] items-center gap-3"><input aria-label="Silence threshold" type="range" min="0" max="1" step="0.01" value={settings.silenceThreshold} onChange={(event) => void updateSettings({ silenceThreshold: Number(event.target.value) })} className="w-full accent-[#7575c8]"/><output className="w-12 text-right font-mono text-[11px]">{Math.round(settings.silenceThreshold * 100)}%</output></div></Row></Group>
          </>}
          {section === 'hotkey' && <Group title="Shortcuts"><Row title="Dictate" description={settings.dictationMode === 'push-to-talk' ? 'Hold to record, release to send.' : settings.dictationMode === 'toggle-double' ? 'Hold to talk. Double-press to go hands-free.' : 'Press once to start, again to stop.'}><div className="flex items-center gap-2">{hotkeyEditing === 'primary' ? <><HotkeyCapture value={settings.primaryHotkey} onChange={(value) => { void updateSettings({ primaryHotkey: value }); setHotkeyEditing(null) }}/><span className="text-[11px] text-muted">Press the new shortcut… Esc cancels</span></> : <><Kbd>{formatHotkeyLabel(settings.primaryHotkey)}</Kbd><Button size="sm" variant="ghost" onClick={() => setHotkeyEditing('primary')}>Change</Button></>}</div></Row><p className="-mt-2 pb-3 text-[11px] text-muted">Fn key detection is hardware-dependent. Test after changing.</p><Row title="Paste latest" description="Insert the most recent dictation."><div className="flex items-center gap-2">{hotkeyEditing === 'paste' ? <><HotkeyCapture value={settings.pasteLatestHotkey} onChange={(value) => { void updateSettings({ pasteLatestHotkey: value }); setHotkeyEditing(null) }}/><span className="text-[11px] text-muted">Press the new shortcut… Esc cancels</span></> : <><Kbd>{formatHotkeyLabel(settings.pasteLatestHotkey)}</Kbd><Button size="sm" variant="ghost" onClick={() => setHotkeyEditing('paste')}>Change</Button></>}</div></Row><Row title="Cancel dictation" description="Escape cancels while a dictation is recording."><Kbd>esc</Kbd></Row></Group>}
          {section === 'injection' && <><Group title="Insertion"><Row wide title="Insert method"><OptionCards value={settings.injectionMode} options={[{ value: 'auto' as const, label: 'Auto', description: 'Picks the best method for the active app.' }, { value: 'ax' as const, label: 'Accessibility API', description: 'Types text through macOS accessibility.' }, { value: 'clipboard' as const, label: 'Copy only', description: 'Copies text so you paste it yourself.' }]} onChange={(value) => void updateSettings({ injectionMode: value })}/></Row><Row title="Paste mode" description="Animated types word by word. Instant pastes in one go."><Segmented value={settings.pasteMode} options={[{ value: 'animated', label: 'Animated' }, { value: 'instant', label: 'Instant' }]} onChange={(value) => void updateSettings({ pasteMode: value as Settings['pasteMode'] })}/></Row></Group></>}
          {section === 'appearance' && <><Group title="Appearance"><Row title="Theme"><Segmented value={mode} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} onChange={(value) => setMode(value as 'light' | 'dark')}/></Row><Row title="Accent colour" description="Tints the capsule's Send button and its waveform."><div role="radiogroup" aria-label="Accent colour" className="flex flex-wrap gap-2" onKeyDown={(event) => { if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return; event.preventDefault(); const radios = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=radio]')]; const index = radios.findIndex((radio) => radio.getAttribute('aria-checked') === 'true'); const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1; const next = radios[(index + offset + radios.length) % radios.length]; next?.focus(); next?.click() }}>{[...accents, ...(!accents.some((accent) => accent.color === settings.accentColor) ? [{ color: settings.accentColor, label: 'Custom' }] : [])].map((accent) => <button key={accent.color} type="button" role="radio" aria-label={accent.label} aria-checked={settings.accentColor === accent.color} tabIndex={settings.accentColor === accent.color ? 0 : -1} onClick={() => void updateSettings({ accentColor: accent.color })} className={`grid size-8 place-items-center rounded-full border border-black/10 ${settings.accentColor === accent.color ? 'ring-2 ring-ink ring-offset-2 ring-offset-bg' : ''}`} style={{ backgroundColor: accent.color }}>{settings.accentColor === accent.color && <Check size={14} className="text-white"/>}</button>)}</div></Row></Group><Group title="Home"><Row title="How to dictate card" description="Shows on Home for your first 5 dictations, then hides. Turn on to bring it back."><Toggle checked={tip.visible} onChange={(value) => tip.setVisible(value)}/></Row><Row title="Setup checklist" description="Shows on Home until every step is done."><Toggle checked={!settings.setupChecklistDismissed} onChange={(value) => void updateSettings({ setupChecklistDismissed: !value })}/></Row></Group></>}
          {section === 'data' && <><div className="grid grid-cols-2 gap-2 py-3 max-[700px]:grid-cols-1"><div className="rounded-[16px] bg-surface p-3"><span className="text-[11px] text-muted">Dictations stored</span><b className="mt-1 block text-[14px]">{historyEntries.length}</b></div><div className="rounded-[16px] bg-surface p-3"><span className="text-[11px] text-muted">Oldest entry</span><b className="mt-1 block text-[14px]">{historyEntries.length ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(Math.min(...historyEntries.map((entry) => new Date(entry.timestamp).getTime())))) : '—'}</b></div></div><Group title="Your data"><div className="grid gap-2"><DataAction icon={<Download size={15}/>} title="Export history" description="JSON with settings and dictations." actionLabel="Export…" onClick={exportHistory}/><DataAction icon={<Trash2 size={15}/>} title="Clear history" description="Deletes every dictation." actionLabel="Clear" onClick={() => void clearHistory()}/><DataAction icon={<RefreshCw size={15}/>} title="Reset all settings" description="Restores default settings, clears saved API key values and resets dictionary settings. History stays." actionLabel="Reset" onClick={() => void resetSettings()}/></div></Group></>}
        </div>
      </div>
    </section>
  </div>
}

