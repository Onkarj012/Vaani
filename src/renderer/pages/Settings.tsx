import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Globe, Mic, Keyboard, Type, Palette, Monitor, Volume2, Download, Trash2,
  Eye, EyeOff, AlertTriangle, X, Database, HardDrive, Plug, RefreshCw, Sun, Moon,
  ShieldCheck, ArrowRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { HotkeyCapture } from '@renderer/components/HotkeyCapture'
import { KNOWN_PROVIDERS, SUPPORTED_LANGUAGES, getLanguageLabel, isLanguageSupportedByProvider, resolveProfileLanguage } from '@shared/defaults'
import { Select } from '@renderer/components/ui/Select'
import { ModelPicker } from '@renderer/components/ModelPicker'
import { Toggle } from '@renderer/components/ui/toggle'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { cn } from '@renderer/lib/utils'
import { createExportPayload } from '@renderer/exportData'
import type { AudioInputDevice, ProviderKeyValidation, Settings } from '@shared/types'
import type { RecoveryStorageUsage } from '@shared/recovery'
import { decideProviderKeyDraft } from '@renderer/lib/providerKeyDraft'

export const SETTINGS_SECTIONS = [
  { id: 'api', label: 'API & Providers', icon: Plug },
  { id: 'language', label: 'Language', icon: Globe },
  { id: 'dictation', label: 'Dictation', icon: Mic },
  { id: 'hotkey', label: 'Hotkey', icon: Keyboard },
  { id: 'injection', label: 'Injection', icon: Type },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'updates', label: 'Updates', icon: Download },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'recovery', label: 'Recovery', icon: ShieldCheck },
]

const sectionDescriptions: Record<string, string> = {
  api: 'Who hears you, who cleans up, and what happens when one of them is down.',
  language: 'What you speak, per app, and how it gets cleaned up.',
  dictation: 'How recording starts, stops and captures audio.',
  hotkey: 'Global shortcuts that work in every app.',
  injection: 'How text lands where your cursor is.',
  appearance: 'Theme and accent colour.',
  system: 'Dock and login behaviour.',
  audio: 'Silence detection and short-clip filtering.',
  updates: 'Version and update checks.',
  data: 'Export, clear or reset what Vaani stores.',
  recovery: 'Keep failed dictations so you can retry them.',
}

const languages = SUPPORTED_LANGUAGES.map((l) => ({ value: l.value, label: l.label }))

const dictationModes = [
  { id: 'toggle', label: 'Toggle', description: 'Press once to start recording, press again to stop' },
  { id: 'push-to-talk', label: 'Push to Talk', description: 'Hold to record, release stops immediately' },
  { id: 'toggle-double', label: 'Smart Toggle', description: 'Hold for push-to-talk; double-press to lock recording on' },
]

const injectionModes = [
  { id: 'auto', label: 'Auto (recommended)', description: 'Chooses the best method for the active app' },
  { id: 'ax', label: 'Accessibility API', description: 'Types text using macOS Accessibility APIs' },
  { id: 'clipboard', label: 'Copy Only', description: 'Copies text so you can paste it yourself' },
]

const stylePresets = [
  { value: 'plain', label: 'Plain' },
  { value: 'developer', label: 'Developer' },
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'email', label: 'Email' },
]

const accentColors = [
  { id: '#7575c8', label: 'Purple' },
  { id: '#5bb5d8', label: 'Blue' },
  { id: '#8cc152', label: 'Green' },
  { id: '#d97fc1', label: 'Pink' },
  { id: '#f0a07a', label: 'Peach' },
  { id: '#e6c34d', label: 'Yellow' },
  { id: '#0099ff', label: 'Link' },
  { id: '#1d1d1d', label: 'Ink' },
]

// Pastel tile per provider. Providers without a tint fall back to sky.
const providerTints: Record<string, string> = { groq: 'bg-chip-peach', openai: 'bg-chip-mint', openrouter: 'bg-chip-lav' }

// Shared look for the Hear, Clean and Fix nodes of the pipeline.
const pipeNode = 'flex min-w-0 flex-col gap-2 rounded-[20px] border border-line bg-card p-3.5 text-left shadow-soft'

// Destructive buttons with a soft red tint.
const dangerButton = 'border-transparent bg-[#ffe9e3] text-[#c2412d] hover:bg-[#ffd9cc] dark:bg-[#3a1f1a] dark:text-[#ff9b85] dark:hover:bg-[#4a2620]'

type KeyTone = 'ok' | 'fail' | 'idle'

const statusStyle: Record<KeyTone, { dot: string; text: string }> = {
  ok: { dot: 'bg-[#3fbf7f]', text: 'text-ink' },
  fail: { dot: 'bg-red-500', text: 'text-red-500' },
  idle: { dot: 'bg-faint', text: 'text-muted' },
}

// Group heading inside a section.
function GroupLabel({ children }: { children: React.ReactNode }) {
  return <div className="label-meta mb-1.5 mt-6 text-[10px] text-faint first:mt-0">{children}</div>
}

// Setting row: title and hint on the left, control on the right.
function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[22px] border-b border-line py-[15px]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {desc && <div className="mt-0.5 text-[12.5px] text-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Radio-style option card. The selected card gets the accent border and a filled dot.
function OptionButton({ active, onClick, label, description }: { active: boolean; onClick: () => void; label: string; description: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative rounded-[18px] border-[1.5px] p-4 pr-10 text-left transition-all',
        active ? 'border-accent bg-accent/[.08]' : 'border-line hover:border-ink/20'
      )}
    >
      <span className={cn('absolute right-3.5 top-3.5 h-4 w-4 rounded-full border-[1.5px]', active ? 'border-[5px] border-accent' : 'border-faint')} />
      <div className="text-sm font-semibold text-ink">{label}</div>
      <div className="mt-1 text-[12px] leading-snug text-muted">{description}</div>
    </button>
  )
}

// Hotkey row: name and hint on the left, keycaps and the editor on the right.
function HotkeyRow({ title, desc, children }: { title: string; desc?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-[18px] rounded-[20px] bg-surface p-[18px]">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        {desc && <div className="mt-1 flex items-center gap-1.5 text-[12.5px] text-muted">{desc}</div>}
      </div>
      <div className="shrink-0 [&_[data-slot=kbd]]:h-10 [&_[data-slot=kbd]]:min-w-10 [&_[data-slot=kbd]]:bg-card [&_[data-slot=kbd]]:text-[15px] [&_[data-slot=kbd]]:shadow-[0_3px_0_var(--color-line)]">
        {children}
      </div>
    </div>
  )
}

// Row with an icon, a title and hint, and one action on the right.
function ActionRow({ icon: Icon, title, desc, danger, children }: { icon: LucideIcon; title: string; desc: string; danger?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[18px] bg-surface px-4 py-3.5">
      <Icon size={16} className={cn('shrink-0', danger ? 'text-red-500' : 'text-muted')} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-ink">{title}</div>
        <div className="mt-0.5 text-[12.5px] text-muted">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

// Read-only fact shown in the info grid.
function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface p-3.5">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-1 text-sm font-semibold text-ink">{value}</div>
    </div>
  )
}

// Theme switch segment. The selected one looks raised.
function segmentClass(on: boolean): string {
  return cn(
    'flex h-7 items-center gap-1.5 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors',
    on ? 'bg-card text-ink shadow-sm dark:bg-[#34343b]' : 'text-muted hover:text-ink'
  )
}

function providerSummary(provider: typeof KNOWN_PROVIDERS[number] | undefined, role: 'transcription' | 'cleanup'): string {
  if (!provider) return ''
  const locality = provider.locality === 'local' ? 'Local' : 'Cloud'
  // Transcription always uploads audio, so only a cleanup provider's text-only metadata changes the wording.
  const sendsText = role === 'cleanup' && provider.privacyLevel === 'cloud-text'
  const privacy = provider.privacyLevel === 'local-only' ? 'audio stays on device' : sendsText ? 'sends text to provider' : 'sends audio to provider'
  const cost = provider.estimatedCost === 'free-local' ? 'free after model download' : `${provider.estimatedCost ?? 'varies'} cost`
  const confidence = provider.supportsConfidence ? 'confidence signals' : 'no confidence signals'
  return `${locality} · ${privacy} · ${cost} · ${confidence}`
}

// Short location note under a pipeline node.
function localityNote(provider: typeof KNOWN_PROVIDERS[number] | undefined): string {
  return provider?.locality === 'local' ? 'on this Mac' : 'cloud'
}

// Pastel tile for a provider initial. A missing key gets a dashed outline.
function providerTileClass(providerId: string, hasKey: boolean): string {
  if (!hasKey) return 'border border-dashed border-faint bg-card text-faint'
  return cn(providerTints[providerId] ?? 'bg-chip-sky', 'pastel-scope')
}

// Status pill label and tone for a provider key.
function keyStatus(hasKey: boolean | undefined, lastValidation: ProviderKeyValidation | null | undefined): { label: string; tone: KeyTone } {
  if (lastValidation?.valid) return { label: 'Connected', tone: 'ok' }
  if (lastValidation) return { label: 'Test failed', tone: 'fail' }
  return { label: hasKey ? 'Saved' : 'Not set', tone: 'idle' }
}

// Age of a key test in short words, such as "2 h ago".
function testedAgo(testedAt: string): string {
  const minutes = Math.round((Date.now() - Date.parse(testedAt)) / 60_000)
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`
  return new Date(testedAt).toLocaleDateString()
}

// One provider key: pastel initial, name, status pill, and the key field.
function ProviderKeyRow({ name, role, providerId, hasKey, lastValidation, children }: {
  name: string
  role: string
  providerId: string
  hasKey?: boolean
  lastValidation?: ProviderKeyValidation | null
  children: React.ReactNode
}) {
  const status = keyStatus(hasKey, lastValidation)
  const tested = lastValidation ? testedAgo(lastValidation.testedAt) : ''
  return (
    <div className="flex items-start gap-3 rounded-[18px] bg-surface p-3 px-3.5">
      <span className={cn('text-display mt-0.5 grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[11px] text-[17px]', providerTileClass(providerId, Boolean(hasKey)))}>
        {name.charAt(0)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">{name}</span>
          <span className="truncate text-[12px] text-faint">{role}</span>
          <span className={cn('ml-auto inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-card px-2.5 py-1 text-[11.5px] font-semibold', statusStyle[status.tone].text)}>
            <i className={cn('h-1.5 w-1.5 rounded-full', statusStyle[status.tone].dot)} />
            {status.label}
          </span>
        </div>
        <div className="mt-2">{children}</div>
        {tested && <p className="mt-1.5 text-[11.5px] text-muted">Tested {tested}</p>}
      </div>
    </div>
  )
}

function ApiKeyInput({
  value, onChange, onBlur, onCancel, placeholder, hasKey, lastValidation, onClear, onTest, testing,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  onCancel?: () => void;
  placeholder: string;
  hasKey?: boolean;
  lastValidation?: ProviderKeyValidation | null;
  onClear?: () => void;
  onTest?: () => void;
  testing?: boolean;
}) {
  const [visible, setVisible] = useState(false)
  const [replacing, setReplace] = useState(false)
  const cancelRequested = useRef(false)

  useEffect(() => {
    if (hasKey && !value) setReplace(false)
  }, [hasKey, value])

  useEffect(() => {
    if (lastValidation?.valid) setReplace(false)
  }, [lastValidation?.valid])

  const message = lastValidation && !lastValidation.valid
    ? <p className="text-xs text-red-500/80">{lastValidation.message}</p>
    : null

  if (hasKey && !replacing && !value) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center rounded-full border border-line bg-card px-4">
            <span className="font-mono text-[13px] tracking-[0.2em] text-muted">••••••••••••</span>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setReplace(true)}>Replace</Button>
          <Button
            variant="secondary"
            size="sm"
            aria-label="Clear API key"
            title="Clear API key"
            className="w-9 px-0 hover:text-red-500"
            onClick={() => { onClear?.(); setReplace(false); }}
          >
            <Trash2 size={14} />
          </Button>
        </div>
        {message}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={visible ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => { if (!cancelRequested.current) onBlur?.() }}
            placeholder={placeholder}
            className="pr-11 font-mono"
            autoFocus={replacing}
          />
          <button
            type="button"
            aria-label={visible ? 'Hide API key' : 'Show API key'}
            onClick={() => setVisible(!visible)}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted transition-colors hover:bg-surface"
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        {replacing && (
          <Button
            variant="secondary"
            size="sm"
            onMouseDown={(event) => { event.preventDefault(); cancelRequested.current = true; }}
            onClick={() => {
              cancelRequested.current = true;
              onCancel?.();
              setReplace(false);
              window.setTimeout(() => { cancelRequested.current = false; }, 0);
            }}
          >
            Cancel
          </Button>
        )}
        {onTest && (
          <Button
            variant="secondary"
            size="sm"
            disabled={testing || !value.trim()}
            onMouseDown={(event) => event.preventDefault()}
            onClick={onTest}
          >
            {testing ? 'Testing…' : 'Test'}
          </Button>
        )}
      </div>
      {message}
    </div>
  )
}

// Settings page. The section comes from the route (/app/settings/:section) so every section is linkable.
export default function SettingsPage() {
  const { section } = useParams()
  const navigate = useNavigate()
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries, updateStatus, checkForUpdates, restartAndInstall, cleanupRecoveryAudio, clearRecoveryAudio: clearAllRecoveryAudio } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const activeSection = SETTINGS_SECTIONS.some((s) => s.id === section) ? section as string : 'api'
  const sectionIndex = SETTINGS_SECTIONS.findIndex((s) => s.id === activeSection)
  const [customHex, setCustomHex] = useState(settings.accentColor)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [sttKey, setSttKey] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [testingProvider, setTestingProvider] = useState<string | null>(null)
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileBundleId, setNewProfileBundleId] = useState('')
  const [newProfileLanguage, setNewProfileLanguage] = useState('')
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([])
  const [recoveryUsage, setRecoveryUsage] = useState<RecoveryStorageUsage>({ bytes: 0, sessions: 0 })
  const [recoveryBusy, setRecoveryBusy] = useState(false)

  useEffect(() => {
    void window.vaani.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
    void window.vaani.listAudioInputDevices().then(setAudioDevices).catch(() => setAudioDevices([]))
  }, [])

  useEffect(() => {
    if (activeSection !== 'recovery') return
    void window.vaani.getRecoveryStorageUsage().then(setRecoveryUsage).catch(() => setRecoveryUsage({ bytes: 0, sessions: 0 }))
  }, [activeSection])

  useEffect(() => { setCustomHex(settings.accentColor) }, [settings.accentColor])

  useEffect(() => {
    const pk = settings.providerApiKeys ?? []
    setSttKey(pk.find((p) => p.providerId === settings.transcriptionProvider)?.key ?? '')
    setLlmKey(pk.find((p) => p.providerId === settings.formattingProvider)?.key ?? '')
  }, [settings.transcriptionProvider, settings.formattingProvider, settings.providerApiKeys])


  const addAppProfile = () => {
    const bundleId = newProfileBundleId.trim();
    if (!bundleId) return;
    const existingProfiles = settings.appProfiles ?? [];
    const bundleIdLower = bundleId.toLowerCase();
    if (existingProfiles.some((p) => p.appBundleIds.some((id) => id.toLowerCase() === bundleIdLower))) return;
    const profile = {
      id: crypto.randomUUID(),
      name: newProfileName.trim() || bundleId,
      appBundleIds: [bundleId],
      ...(newProfileLanguage ? { language: newProfileLanguage } : {}),
    };
    void updateSettings({ appProfiles: [...existingProfiles, profile] });
    setNewProfileName('');
    setNewProfileBundleId('');
    setNewProfileLanguage('');
  };

  const clearProviderKey = async (providerId: string) => {
    await window.vaani.clearProviderApiKey(providerId)
    await updateSettings({})
  }

  const saveProviderKey = async (providerId: string, key: string) => {
    if (decideProviderKeyDraft(key, "blur") !== "save") return
    await window.vaani.setProviderApiKey(providerId, key)
    await updateSettings({})
  }

  const testProviderKey = async (providerId: string, key: string) => {
    if (!key.trim()) return
    setTestingProvider(providerId)
    try {
      await saveProviderKey(providerId, key)
      await window.vaani.testApiKey(providerId, key)
      await updateSettings({})
    } finally {
      setTestingProvider(null)
    }
  }

  const cleanupRecovery = async () => {
    setRecoveryBusy(true)
    try { setRecoveryUsage(await cleanupRecoveryAudio()) } finally { setRecoveryBusy(false) }
  }

  const clearRecoveryAudio = async () => {
    if (!window.confirm('Delete all retained recovery audio? Text recovery will stay in History.')) return
    setRecoveryBusy(true)
    try { setRecoveryUsage(await clearAllRecoveryAudio()) } finally { setRecoveryBusy(false) }
  }

  const handleExportData = () => {
    const data = createExportPayload(settings, historyEntries)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const sttProviders = KNOWN_PROVIDERS.filter((p) => !p.hidden && (p.type === 'stt' || p.type === 'local-stt'))
  const llmProviders = KNOWN_PROVIDERS.filter((p) => p.type === 'llm')
  const appLanguageOptions = [
    { value: '', label: `Use global (${getLanguageLabel(settings.language) ?? settings.language})` },
    ...languages.filter((language) => language.value !== 'auto'),
  ]
  const activeStt = KNOWN_PROVIDERS.find((p) => p.id === settings.transcriptionProvider)
  const activeLlm = llmProviders.find((p) => p.id === settings.formattingProvider)
  const showKeys = Boolean(activeStt?.requiresApiKey || activeLlm?.requiresApiKey)
  const sttKeyEntry = (settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.transcriptionProvider)
  const llmKeyEntry = (settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.formattingProvider)
  const physicalAudioDevices = audioDevices.filter((device) => device.isPhysical)
  const microphoneOptions = [
    { value: '', label: 'Automatic built-in microphone' },
    ...physicalAudioDevices.map((device) => ({
      value: device.uid,
      label: `${device.name || 'Microphone'}${device.isDefault ? ' (Default)' : ''}`,
    })),
  ]

  const sectionContent = (
    <div>
      {activeSection === 'api' && (
        <div>
          <div className="mb-1 mt-5 grid grid-cols-[1fr_26px_1fr_26px_.82fr]">
            <div className={pipeNode}>
              <span className="label-meta text-[10px] text-faint">01 · Hear</span>
              <span className="text-display text-[17px] text-ink">Transcription</span>
              <div className="min-w-0">
                <ModelPicker
                  role="transcription"
                  provider={settings.transcriptionProvider}
                  modelId={settings.transcriptionModel}
                  onChange={(provider, modelId) => updateSettings({ transcriptionProvider: provider, transcriptionModel: modelId })}
                />
              </div>
              <p className="text-[12px] leading-snug text-muted">{providerSummary(activeStt, 'transcription')}</p>
              <span className="mt-auto pt-1 font-mono text-[10.5px] text-faint">{localityNote(activeStt)}</span>
            </div>
            <span className="grid place-items-center text-faint"><ArrowRight size={14} /></span>
            <div className={pipeNode}>
              <span className="label-meta text-[10px] text-faint">02 · Clean</span>
              <span className="text-display text-[17px] text-ink">Formatting</span>
              <div className="min-w-0">
                <ModelPicker
                  role="cleanup"
                  provider={settings.formattingProvider}
                  modelId={settings.formattingModel}
                  onChange={(provider, modelId) => updateSettings({ formattingProvider: provider, formattingModel: modelId })}
                />
              </div>
              <p className="text-[12px] leading-snug text-muted">{providerSummary(activeLlm, 'cleanup')}</p>
              <span className="mt-auto pt-1 font-mono text-[10.5px] text-faint">{settings.cleanupEnabled ? localityNote(activeLlm) : 'off'}</span>
            </div>
            <span className="grid place-items-center text-faint"><ArrowRight size={14} /></span>
            <button type="button" onClick={() => navigate('/app/dictionary')} className={cn(pipeNode, 'border-transparent bg-graphite text-[#f3f3f5] dark:border-accent/35 dark:bg-accent/20')}>
              <span className="label-meta text-[10px] text-white/45">03 · Fix</span>
              <span className="text-display text-[17px]">Dictionary &amp; snippets</span>
              <span className="text-[12.5px] text-white/80">{settings.customCorrections.length} rules · {settings.snippets.length} snippets</span>
              <span className="mt-auto pt-1 font-mono text-[10.5px] text-white/45">on this Mac</span>
            </button>
          </div>

          {showKeys && (
            <>
              <GroupLabel>Provider keys</GroupLabel>
              <div className="space-y-2">
                {activeStt?.requiresApiKey && (
                  <ProviderKeyRow
                    name={activeStt.name}
                    role="Transcription"
                    providerId={settings.transcriptionProvider}
                    hasKey={sttKeyEntry?.hasKey}
                    lastValidation={sttKeyEntry?.lastValidation}
                  >
                    <ApiKeyInput
                      value={sttKey}
                      onChange={setSttKey}
                      onBlur={() => { if (decideProviderKeyDraft(sttKey, "blur") === "save") void saveProviderKey(settings.transcriptionProvider, sttKey) }}
                      onCancel={() => setSttKey('')}
                      placeholder={activeStt.id === 'openrouter' ? 'sk-or-...' : activeStt.id === 'openai' || activeStt.id === 'openai-compatible' ? 'sk-...' : activeStt.id === 'deepgram' ? 'Token...' : 'gsk_...'}
                      hasKey={sttKeyEntry?.hasKey}
                      lastValidation={sttKeyEntry?.lastValidation}
                      onClear={() => { void clearProviderKey(settings.transcriptionProvider) }}
                      onTest={() => { void testProviderKey(settings.transcriptionProvider, sttKey) }}
                      testing={testingProvider === settings.transcriptionProvider}
                    />
                  </ProviderKeyRow>
                )}

                {activeLlm?.requiresApiKey && (
                  <ProviderKeyRow
                    name={activeLlm.name}
                    role="Formatting"
                    providerId={settings.formattingProvider}
                    hasKey={llmKeyEntry?.hasKey}
                    lastValidation={llmKeyEntry?.lastValidation}
                  >
                    <ApiKeyInput
                      value={llmKey}
                      onChange={setLlmKey}
                      onBlur={() => { if (decideProviderKeyDraft(llmKey, "blur") === "save") void saveProviderKey(settings.formattingProvider, llmKey) }}
                      onCancel={() => setLlmKey('')}
                      placeholder={activeLlm.id === 'openai-llm' ? 'sk-...' : activeLlm.id === 'anthropic' ? 'sk-ant-...' : activeLlm.id === 'openrouter' ? 'sk-or-...' : 'gsk_...'}
                      hasKey={llmKeyEntry?.hasKey}
                      lastValidation={llmKeyEntry?.lastValidation}
                      onClear={() => { void clearProviderKey(settings.formattingProvider) }}
                      onTest={() => { void testProviderKey(settings.formattingProvider, llmKey) }}
                      testing={testingProvider === settings.formattingProvider}
                    />
                  </ProviderKeyRow>
                )}
              </div>
            </>
          )}

          <GroupLabel>When a provider fails</GroupLabel>
          <Row title="Provider Failover" desc="Try next provider on failure">
            <Toggle checked={settings.failoverEnabled} onChange={(v) => updateSettings({ failoverEnabled: v })} />
          </Row>
        </div>
      )}

      {activeSection === 'language' && (
        <div>
          <Row title="Default language" desc="Used when an app has no profile.">
            <Select value={settings.language} onChange={(v) => updateSettings({ language: v })} options={languages} className="w-[260px]" />
          </Row>
          {!isLanguageSupportedByProvider(settings.language, settings.transcriptionProvider, settings.localWhisperModel) && (
            <p className="mt-3 flex items-start gap-2 text-xs text-amber-500">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              The selected transcription provider does not support this language. Vaani will fall back to auto-detect.
            </p>
          )}

          {/* Per-app language overrides */}
          <GroupLabel>Per-App Language</GroupLabel>
          <p className="mb-2 text-xs text-faint">Override the default language for a specific app using its bundle ID.</p>
          <div className="space-y-2">
            {(settings.appProfiles ?? []).map((profile) => {
              const effectiveLanguage = resolveProfileLanguage(profile.language, settings.language);
              const profileLanguage = profile.language && profile.language !== 'auto' ? profile.language : '';
              return (
              <div key={profile.id} className="flex items-center gap-2 rounded-[18px] bg-surface p-3 px-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-ink">{profile.name}</div>
                  <div className="truncate text-xs text-faint">{profile.appBundleIds.join(', ')}</div>
                </div>
                <Select
                  value={profileLanguage}
                  onChange={(v) => {
                    const next = (settings.appProfiles ?? []).map((p) => {
                      if (p.id !== profile.id) return p;
                      const provider = p.transcriptionProvider;
                      return {
                        ...p,
                        language: v || undefined,
                        transcriptionProvider: provider && isLanguageSupportedByProvider(v || settings.language, provider, settings.localWhisperModel)
                          ? provider
                          : undefined,
                      };
                    });
                    void updateSettings({ appProfiles: next });
                  }}
                  options={appLanguageOptions}
                />
                <Select
                  value={profile.transcriptionProvider && isLanguageSupportedByProvider(effectiveLanguage, profile.transcriptionProvider, settings.localWhisperModel) ? profile.transcriptionProvider : ''}
                  onChange={(v) => {
                    if (v && !isLanguageSupportedByProvider(effectiveLanguage, v, settings.localWhisperModel)) return;
                    const next = (settings.appProfiles ?? []).map((p) => p.id === profile.id ? { ...p, transcriptionProvider: v || undefined } : p);
                    void updateSettings({ appProfiles: next });
                  }}
                  options={[
                    { value: '', label: 'Default STT' },
                    ...sttProviders
                      .filter((p) => isLanguageSupportedByProvider(effectiveLanguage, p.id, settings.localWhisperModel))
                      .map((p) => ({ value: p.id, label: p.name })),
                  ]}
                />
                <button
                  aria-label="Delete profile"
                  onClick={() => {
                    const next = (settings.appProfiles ?? []).filter((p) => p.id !== profile.id);
                    void updateSettings({ appProfiles: next });
                  }}
                  className="shrink-0 rounded-full p-1.5 text-faint transition-colors hover:bg-card hover:text-ink"
                >
                  <X size={13} />
                </button>
              </div>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <Input placeholder="App name" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
            <Input placeholder="Bundle ID (e.g. com.tinyspeck.slackmacgap)" value={newProfileBundleId} onChange={(e) => setNewProfileBundleId(e.target.value)} />
            <Select value={newProfileLanguage} onChange={setNewProfileLanguage} options={appLanguageOptions} />
            <Button variant="secondary" size="sm" onClick={addAppProfile}>Add</Button>
          </div>

          <GroupLabel>Cleanup</GroupLabel>
          <Row title="Smart Punctuation" desc="Auto-add periods, commas, and capitalization">
            <Toggle checked={settings.smartPunctuation} onChange={(v) => updateSettings({ smartPunctuation: v })} />
          </Row>
          <Row title="Cleanup" desc="Remove filler words and apply corrections">
            <Toggle checked={settings.cleanupEnabled} onChange={(v) => updateSettings({ cleanupEnabled: v })} />
          </Row>
          <Row title="Context Awareness" desc="When enabled, bounded app/style context may be used for formatting">
            <Toggle checked={settings.contextAwarenessEnabled} onChange={(v) => updateSettings({ contextAwarenessEnabled: v })} />
          </Row>
          <Row title="Style Preset">
            <Select value={settings.stylePreset} onChange={(v) => updateSettings({ stylePreset: v as typeof settings.stylePreset })} options={stylePresets} className="w-[260px]" />
          </Row>
        </div>
      )}

      {activeSection === 'dictation' && (
        <div>
          <GroupLabel>Capture</GroupLabel>
          <Row title="Capture Backend" desc="Native capture is experimental and falls back to browser capture if it cannot start.">
            <Select
              value={settings.captureBackend ?? 'renderer'}
              onChange={(v) => updateSettings({ captureBackend: v as typeof settings.captureBackend })}
              options={[
                { value: 'renderer', label: 'Browser capture (recommended)' },
                { value: 'native', label: 'Native voice processing (experimental)' },
              ]}
              className="w-[300px]"
            />
          </Row>
          <GroupLabel>Dictation Mode</GroupLabel>
          <div className="grid grid-cols-3 gap-2.5">
            {dictationModes.map((mode) => (
              <OptionButton key={mode.id} active={settings.dictationMode === mode.id} onClick={() => updateSettings({ dictationMode: mode.id as typeof settings.dictationMode })} label={mode.label} description={mode.description} />
            ))}
          </div>
          <div className="mt-2">
            <Row title="Save Recordings" desc="Save WAV files to disk for replay">
              <Toggle checked={settings.saveRecordings} onChange={(v) => updateSettings({ saveRecordings: v })} />
            </Row>
            <Row title="Suggest Dictionary Words" desc="After you fix a pasted word, offer to add it to the dictionary">
              <Toggle checked={settings.suggestDictionaryWords} onChange={(v) => updateSettings({ suggestDictionaryWords: v })} />
            </Row>
            <Row title="Low Latency Mode" desc="Keeps the microphone open between dictations">
              <Toggle checked={settings.preWarmMic} onChange={(v) => updateSettings({ preWarmMic: v })} />
            </Row>
            <Row title="Microphone" desc="Virtual and aggregate devices are skipped for native capture.">
              <Select
                value={settings.micDeviceId ?? ''}
                onChange={(v) => updateSettings({ micDeviceId: v || undefined })}
                options={microphoneOptions}
                dropUp
                className="w-[260px]"
              />
            </Row>
          </div>
          <div className="mt-4 flex items-center justify-between rounded-[18px] bg-surface p-4">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-muted" />
              <div><div className="text-sm font-semibold text-ink">{settings.captureBackend === 'native' ? 'Native Voice Processing' : 'Browser Capture'}</div><div className="text-xs text-faint">{settings.captureBackend === 'native' ? 'Falls back to browser capture automatically if native fails' : 'Renderer capture is the default reliability path'}</div></div>
            </div>
            <HardDrive size={14} className="text-faint" />
          </div>
        </div>
      )}

      {activeSection === 'hotkey' && (
        <div className="space-y-2">
          <HotkeyRow
            title="Primary Dictation Hotkey"
            desc={<><AlertTriangle size={11} /> Fn key detection is hardware-dependent. Test after changing.</>}
          >
            <HotkeyCapture value={settings.primaryHotkey} onChange={(v) => updateSettings({ primaryHotkey: v })} />
          </HotkeyRow>
          <HotkeyRow title="Paste Latest Hotkey" desc="Inserts your last dictation again.">
            <HotkeyCapture value={settings.pasteLatestHotkey} onChange={(v) => updateSettings({ pasteLatestHotkey: v })} />
          </HotkeyRow>
        </div>
      )}

      {activeSection === 'injection' && (
        <div>
          <GroupLabel>Insert Method</GroupLabel>
          <div className="grid grid-cols-3 gap-2.5">
            {injectionModes.map((mode) => (
              <OptionButton key={mode.id} active={settings.injectionMode === mode.id} onClick={() => updateSettings({ injectionMode: mode.id as typeof settings.injectionMode })} label={mode.label} description={mode.description} />
            ))}
          </div>
          <div className="mt-2">
            <Row title="Paste Mode">
              <Select value={settings.pasteMode} onChange={(v) => updateSettings({ pasteMode: v as 'instant' | 'animated' })} options={[{ value: 'animated', label: 'Animated' }, { value: 'instant', label: 'Instant' }]} dropUp className="w-[200px]" />
            </Row>
          </div>
        </div>
      )}

      {activeSection === 'appearance' && (
        <div>
          <Row title="Theme">
            <div className="flex gap-[2px] rounded-full bg-surface p-[3px]">
              <button onClick={() => setMode('light')} className={segmentClass(mode === 'light')}><Sun size={14} /> Light</button>
              <button onClick={() => setMode('dark')} className={segmentClass(mode === 'dark')}><Moon size={14} /> Dark</button>
            </div>
          </Row>
          <Row title="Accent Color" desc="Accent color tints highlights and the recording capsule.">
            <div className="flex items-center gap-2.5">
              {accentColors.map((color) => (
                <button key={color.id} onClick={() => updateSettings({ accentColor: color.id })}
                  className="h-[26px] w-[26px] rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,.12)] transition-shadow"
                  style={{
                    backgroundColor: color.id,
                    boxShadow: settings.accentColor === color.id ? `0 0 0 2px var(--color-card), 0 0 0 4px ${color.id}` : undefined,
                  }}
                  title={color.label} />
              ))}
            </div>
          </Row>
          <Row title="Custom Color" desc="Use a six-digit hex value, like #7575C8. Applies when you leave the field.">
            <div className="flex items-center gap-2.5">
              <Input value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                onBlur={(e) => { const val = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(val)) updateSettings({ accentColor: val }); else setCustomHex(settings.accentColor) }}
                placeholder="#7575C8" className="w-32 font-mono uppercase" />
              <div className="h-9 w-9 rounded-full border border-line" style={{ backgroundColor: settings.accentColor }} />
            </div>
          </Row>
        </div>
      )}

      {activeSection === 'system' && (
        <div>
          <Row title="Show in Dock" desc="Display app icon in macOS dock">
            <Toggle checked={settings.showInDock} onChange={(v) => updateSettings({ showInDock: v })} />
          </Row>
          <Row title="Launch at Login" desc="Start Vaani when you log in">
            <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
          </Row>
        </div>
      )}

      {activeSection === 'audio' && (
        <div>
          <Row title="Minimum Clip Duration">
            <div className="flex items-center gap-3">
              <input type="range" min="0.1" max="3" step="0.1" value={settings.minClipDuration}
                onChange={(e) => updateSettings({ minClipDuration: Number(e.target.value) })}
                className="h-1.5 w-[200px] cursor-pointer appearance-none rounded-full bg-surface accent-accent" />
              <span className="w-12 text-right font-mono text-xs text-muted">{settings.minClipDuration}s</span>
            </div>
          </Row>
          <Row title="Silence Threshold">
            <div className="flex items-center gap-3">
              <input type="range" min="0" max="1" step="0.01" value={settings.silenceThreshold}
                onChange={(e) => updateSettings({ silenceThreshold: Number(e.target.value) })}
                className="h-1.5 w-[200px] cursor-pointer appearance-none rounded-full bg-surface accent-accent" />
              <span className="w-12 text-right font-mono text-xs text-muted">{Math.round(settings.silenceThreshold * 100)}%</span>
            </div>
          </Row>
        </div>
      )}

      {activeSection === 'updates' && (
        <div className="flex items-center gap-5 rounded-[20px] bg-surface p-5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">App Updates</div>
            <div className="text-xs text-faint">Current version: {appVersion ?? '—'}</div>
            {updateStatus.status === 'idle' && updateStatus.available === false && <p className="mt-2 text-xs text-accent">Vaani is up to date</p>}
            {updateStatus.status === 'available' && <p className="mt-2 text-xs text-accent">{updateStatus.message}</p>}
            {updateStatus.status === 'error' && <p className="mt-2 text-xs text-red-500">{updateStatus.message}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <Button variant="secondary" size="sm" onClick={checkForUpdates} disabled={updateStatus.status === 'checking' || updateStatus.status === 'downloading'}>
              <RefreshCw size={14} className={updateStatus.status === 'checking' || updateStatus.status === 'downloading' ? 'animate-spin-ui' : ''} />
              {updateStatus.status === 'checking' ? 'Checking…' : updateStatus.status === 'downloading' ? 'Downloading…' : 'Check for Updates'}
            </Button>
            {updateStatus.status === 'ready' && <Button variant="accent" size="sm" onClick={() => restartAndInstall()}>Restart to Update</Button>}
          </div>
        </div>
      )}

      {activeSection === 'data' && (
        <div className="space-y-2">
          <ActionRow icon={Download} title="Export" desc="Saves your settings and history as a JSON file. API keys are left out.">
            <Button variant="secondary" size="sm" onClick={handleExportData}><Download size={14} /> Export Data</Button>
          </ActionRow>
          <ActionRow icon={Trash2} title="Clear history" desc="Deletes every entry in History." danger>
            <Button variant="destructive" size="sm" className={dangerButton} onClick={() => { void clearHistory() }}><Trash2 size={14} /> Clear All History</Button>
          </ActionRow>
          <ActionRow icon={AlertTriangle} title="Reset to defaults" desc="This will reset all settings. History will not be affected." danger>
            <Button variant="destructive" size="sm" className={dangerButton} onClick={() => { void resetSettings() }}>Reset Settings</Button>
          </ActionRow>
        </div>
      )}

      {activeSection === 'recovery' && (
        <div>
          <Row title="Unresolved audio retention" desc="This period applies to new failures. Previously retained audio keeps its original expiry. Bounded text stays until you discard its recovery item.">
            <Select
              value={String(settings.recoveryRetentionDays)}
              onChange={(value) => updateSettings({ recoveryRetentionDays: parseRecoveryRetentionDays(value) })}
              options={[1, 3, 7, 14].map((days) => ({ value: String(days), label: `${days} day${days === 1 ? '' : 's'}` }))}
              className="w-[200px]"
            />
          </Row>
          <Row title="Retain failed audio" desc="Opt in to encrypted audio for retries when recovery is available">
            <Toggle checked={settings.retainFailedAudio} onChange={(value) => updateSettings({ retainFailedAudio: value })} />
          </Row>
          {!settings.retainFailedAudio && (
            <div className="mt-4 rounded-[18px] border border-amber-400/30 bg-amber-500/10 p-4 text-sm text-amber-700">
              Failed audio retention is off. When recovery is available, new failures will keep text only.
            </div>
          )}
          <p className="mt-4 text-xs leading-relaxed text-faint">Turning this off stops new retention. Previously retained audio remains until it expires or you clear it below. Save Recordings is a separate preference for WAV files.</p>
          <GroupLabel>Recovery storage</GroupLabel>
          <div className="grid grid-cols-3 gap-2">
            <InfoCell label="Stored" value={formatBytes(recoveryUsage.bytes)} />
            <InfoCell label="Unresolved items" value={String(recoveryUsage.sessions)} />
            <InfoCell label="Keep audio for" value={`${settings.recoveryRetentionDays} day${settings.recoveryRetentionDays === 1 ? '' : 's'}`} />
          </div>
          <div className="mt-2 space-y-2">
            <ActionRow icon={RefreshCw} title="Expired audio" desc="Removes audio past its keep time.">
              <Button variant="secondary" size="sm" onClick={() => { void cleanupRecovery() }} disabled={recoveryBusy}><RefreshCw size={13} /> Clear expired audio</Button>
            </ActionRow>
            <ActionRow icon={Trash2} title="All recovery audio" desc="Text recovery stays in History." danger>
              <Button variant="destructive" size="sm" className={dangerButton} onClick={() => { void clearRecoveryAudio() }} disabled={recoveryBusy}><Trash2 size={13} /> Clear all audio</Button>
            </ActionRow>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-faint">Recovery audio is ciphertext on disk. When it expires or you delete it, the audio reference is removed but the bounded transcript and error details remain. Playback decrypts only for the explicit action and removes its temporary file afterward.</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[214px_1fr] gap-[30px]">
      <nav className="min-h-0 overflow-y-auto pr-0.5" aria-label="Settings sections">
        <h1 className="text-display mb-3.5 mt-1 text-[30px] text-ink">Settings</h1>
        {SETTINGS_SECTIONS.map((it, i) => {
          const Icon = it.icon
          const active = activeSection === it.id
          return (
            <button key={it.id} onClick={() => navigate(`/app/settings/${it.id}`, { replace: true })} aria-current={active ? 'page' : undefined}
              className={`flex h-[34px] w-full items-center gap-2.5 rounded-full px-3 text-left text-[13px] font-medium transition-colors ${
                active ? 'bg-ink text-bg' : 'text-muted hover:bg-surface hover:text-ink'
              }`}>
              <span className={`w-4 font-mono text-[10px] ${active ? 'text-bg/55' : 'text-faint'}`}>{String(i + 1).padStart(2, '0')}</span>
              <Icon size={15} /> {it.label}
            </button>
          )
        })}
      </nav>
      <div className="min-h-0 overflow-y-auto pr-2.5">
        <div className="border-b border-line pb-4 pt-1.5">
          <div className="label-meta text-[10px] text-accent">Settings · {String(sectionIndex + 1).padStart(2, '0')} of {SETTINGS_SECTIONS.length}</div>
          <h2 className="text-display mt-2 text-[38px] text-ink">{SETTINGS_SECTIONS[sectionIndex]?.label}</h2>
          <p className="mt-2 text-sm text-muted">{sectionDescriptions[activeSection]}</p>
        </div>
        <div key={activeSection} className="py-2">
          {sectionContent}
        </div>
      </div>
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`
}

function parseRecoveryRetentionDays(value: string): Settings['recoveryRetentionDays'] {
  if (value === '1') return 1
  if (value === '7') return 7
  if (value === '14') return 14
  return 3
}
