import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe, Mic, Keyboard, Type, Palette, Monitor, Volume2, Download, Trash2,
  Eye, EyeOff, Check, AlertTriangle, X, Database, HardDrive, Plug, RefreshCw, Sun, Moon,
  ShieldCheck,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { HotkeyCapture } from './HotkeyCapture'
import { KNOWN_PROVIDERS, SUPPORTED_LANGUAGES, getLanguageLabel, isLanguageSupportedByProvider, resolveProfileLanguage } from '@shared/defaults'
import { Select } from '@renderer/components/ui/Select'
import { ModelPicker } from './ModelPicker'
import { Toggle } from '@renderer/components/ui/toggle'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { createExportPayload } from '@renderer/exportData'
import type { AudioInputDevice, ProviderKeyValidation, Settings } from '@shared/types'
import type { RecoveryStorageUsage } from '@shared/recovery'
import { decideProviderKeyDraft } from '@renderer/lib/providerKeyDraft'

const sidebarItems = [
  { id: 'api', label: 'API & Providers', icon: Plug, group: 'Dictation' },
  { id: 'language', label: 'Language', icon: Globe, group: 'Dictation' },
  { id: 'dictation', label: 'Dictation', icon: Mic, group: 'Dictation' },
  { id: 'hotkey', label: 'Hotkey', icon: Keyboard, group: 'Dictation' },
  { id: 'injection', label: 'Injection', icon: Type, group: 'Dictation' },
  { id: 'audio', label: 'Audio', icon: Volume2, group: 'Dictation' },
  { id: 'appearance', label: 'Appearance', icon: Palette, group: 'App' },
  { id: 'system', label: 'System', icon: Monitor, group: 'App' },
  { id: 'updates', label: 'Updates', icon: Download, group: 'App' },
  { id: 'data', label: 'Data', icon: Database, group: 'Privacy & Data' },
  { id: 'recovery', label: 'Recovery', icon: ShieldCheck, group: 'Privacy & Data' },
]

const sidebarGroups = ['Dictation', 'App', 'Privacy & Data']

const sectionDescriptions: Record<string, string> = {
  api: 'Transcription and formatting providers',
  language: 'Spoken language for transcription',
  dictation: 'Recording behavior and voice settings',
  hotkey: 'Global shortcuts for dictation',
  injection: 'How text is entered into apps',
  appearance: 'Theme and accent color',
  system: 'Dock, startup, and behavior',
  audio: 'Silence detection and noise gate',
  updates: 'Check for app updates',
  data: 'Export, clear history, and reset settings',
  recovery: 'Keep failed dictation work available and private',
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
  { id: '#7C3AED', label: 'Violet' },
  { id: '#7575c8', label: 'Lavender' },
  { id: '#2563eb', label: 'Blue' },
  { id: '#0891b2', label: 'Teal' },
  { id: '#059669', label: 'Green' },
  { id: '#d97706', label: 'Amber' },
  { id: '#e11d48', label: 'Rose' },
  { id: '#db2777', label: 'Pink' },
  { id: '#52525b', label: 'Graphite' },
]

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-[12.5px] font-medium text-muted">{children}</label>
}

// Inset grouped list, like macOS System Settings. Rows inside are separated by hairlines.
function Group({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={`divide-y divide-line rounded-xl border border-line bg-card px-4 shadow-soft ${className ?? ''}`}>{children}</div>
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-medium text-ink">{title}</div>
        <div className="mt-0.5 text-xs leading-relaxed text-faint">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function OptionButton({ active, onClick, label, description }: { active: boolean; onClick: () => void; label: string; description: string }) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={`flex w-full items-center gap-3.5 rounded-xl border p-3.5 text-left transition-all ${
        active ? 'border-accent/50 bg-accent/[0.06] ring-4 ring-accent/[0.07]' : 'border-line bg-card hover:border-line-strong'
      }`}
    >
      <span className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border transition-colors ${active ? 'border-accent bg-accent' : 'border-line-strong bg-card'}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
      <div className="min-w-0">
        <div className="text-[13.5px] font-medium text-ink">{label}</div>
        <div className="mt-0.5 text-xs text-faint">{description}</div>
      </div>
    </button>
  )
}

function RangeField({ label, display, min, max, step, value, onChange }: { label: string; display: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  const fill = ((value - min) / (max - min)) * 100
  return (
    <div className="py-4">
      <div className="mb-3 flex items-center justify-between">
        <label className="text-[13.5px] font-medium text-ink">{label}</label>
        <span className="rounded-md bg-surface px-2 py-0.5 font-mono text-[11px] text-muted">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="range" style={{ '--range-fill': `${fill}%` } as React.CSSProperties} />
    </div>
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

  if (hasKey && !replacing && !value) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex h-10 flex-1 items-center gap-2 rounded-[10px] border border-line bg-surface/70 px-3.5">
          <span className="flex-1 font-mono text-sm tracking-[0.25em] text-muted">••••••••••••</span>
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-inset ring-accent/15">
            <Check size={10} /> Saved
          </span>
          {lastValidation?.valid && (
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 ring-1 ring-inset ring-emerald-500/20 dark:text-emerald-400">
              <Check size={10} /> Validated
            </span>
          )}
          {lastValidation && !lastValidation.valid && (
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-500 ring-1 ring-inset ring-red-500/20">Test failed</span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setReplace(true)}
          className="h-10 shrink-0 rounded-[10px] border border-line bg-card px-3 text-xs font-medium text-muted shadow-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={() => { onClear?.(); setReplace(false); }}
          className="h-10 shrink-0 rounded-[10px] border border-line bg-card px-3 text-xs font-medium text-muted shadow-soft transition-colors hover:border-red-300 hover:text-red-500"
        >
          Clear
        </button>
        {lastValidation && !lastValidation.valid && (
          <p className="absolute left-0 top-full mt-1 text-xs text-red-500/80">{lastValidation.message}</p>
        )}
      </div>
    )
  }

  return (
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
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted transition-colors hover:bg-surface"
        >
          {visible ? <EyeOff size={15} /> : <Eye size={15} />}
        </button>
      </div>
      {replacing && (
        <button
          type="button"
          onMouseDown={(event) => { event.preventDefault(); cancelRequested.current = true; }}
          onClick={() => {
            cancelRequested.current = true;
            onCancel?.();
            setReplace(false);
            window.setTimeout(() => { cancelRequested.current = false; }, 0);
          }}
          className="h-10 shrink-0 rounded-[10px] border border-line bg-card px-3 text-xs font-medium text-muted shadow-soft transition-colors hover:border-line-strong hover:text-ink"
        >
          Cancel
        </button>
      )}
      {onTest && (
        <button
          type="button"
          disabled={testing || !value.trim()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onTest}
          className="h-10 shrink-0 rounded-[10px] border border-line bg-card px-3 text-xs font-medium text-muted shadow-soft transition-colors hover:border-line-strong hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      )}
      {lastValidation && !lastValidation.valid && (
        <p className="absolute mt-12 text-xs text-red-500/80">{lastValidation.message}</p>
      )}
    </div>
  )
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries, updateStatus, checkForUpdates, restartAndInstall, cleanupRecoveryAudio, clearRecoveryAudio: clearAllRecoveryAudio } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const [activeSection, setActiveSection] = useState('api')
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
    if (!isOpen) return
    void window.vaani.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
    void window.vaani.listAudioInputDevices().then(setAudioDevices).catch(() => setAudioDevices([]))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || activeSection !== 'recovery') return
    void window.vaani.getRecoveryStorageUsage().then(setRecoveryUsage).catch(() => setRecoveryUsage({ bytes: 0, sessions: 0 }))
  }, [activeSection, isOpen])

  useEffect(() => { setCustomHex(settings.accentColor) }, [settings.accentColor])

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  useEffect(() => {
    const pk = settings.providerApiKeys ?? []
    setSttKey(pk.find((p) => p.providerId === settings.transcriptionProvider)?.key ?? '')
    setLlmKey(pk.find((p) => p.providerId === settings.formattingProvider)?.key ?? '')
  }, [settings.transcriptionProvider, settings.formattingProvider, settings.providerApiKeys])

  if (!isOpen) return null

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
  const physicalAudioDevices = audioDevices.filter((device) => device.isPhysical)
  const microphoneOptions = [
    { value: '', label: 'Automatic built-in microphone' },
    ...physicalAudioDevices.map((device) => ({
      value: device.uid,
      label: `${device.name || 'Microphone'}${device.isDefault ? ' (Default)' : ''}`,
    })),
  ]

  const sectionContent = (
    <div className="space-y-6">
      {activeSection === 'api' && (
        <div className="space-y-5">
          <div>
            <FieldLabel>Transcription Model</FieldLabel>
            <ModelPicker
              role="transcription"
              provider={settings.transcriptionProvider}
              modelId={settings.transcriptionModel}
              onChange={(provider, modelId) => updateSettings({ transcriptionProvider: provider, transcriptionModel: modelId })}
            />
            <p className="mt-1.5 text-xs text-faint">{providerSummary(activeStt, 'transcription')}</p>
          </div>

          {activeStt?.requiresApiKey && (
            <div>
              <FieldLabel>{activeStt.name} API Key</FieldLabel>
              <ApiKeyInput
                value={sttKey}
                onChange={setSttKey}
                onBlur={() => { if (decideProviderKeyDraft(sttKey, "blur") === "save") void saveProviderKey(settings.transcriptionProvider, sttKey) }}
                onCancel={() => setSttKey('')}
                placeholder={activeStt.id === 'openrouter' ? 'sk-or-...' : activeStt.id === 'openai' || activeStt.id === 'openai-compatible' ? 'sk-...' : activeStt.id === 'deepgram' ? 'Token...' : 'gsk_...'}
                hasKey={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.transcriptionProvider)?.hasKey}
                lastValidation={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.transcriptionProvider)?.lastValidation}
                onClear={() => { void clearProviderKey(settings.transcriptionProvider) }}
                onTest={() => { void testProviderKey(settings.transcriptionProvider, sttKey) }}
                testing={testingProvider === settings.transcriptionProvider}
              />
            </div>
          )}

          <div className="h-px bg-line" />

          <div>
            <FieldLabel>Formatting Model</FieldLabel>
            <ModelPicker
              role="cleanup"
              provider={settings.formattingProvider}
              modelId={settings.formattingModel}
              onChange={(provider, modelId) => updateSettings({ formattingProvider: provider, formattingModel: modelId })}
            />
            <p className="mt-1.5 text-xs text-faint">{providerSummary(activeLlm, 'cleanup')}</p>
          </div>

          {activeLlm?.requiresApiKey && (
            <div>
              <FieldLabel>{activeLlm.name} API Key</FieldLabel>
              <ApiKeyInput
                value={llmKey}
                onChange={setLlmKey}
                onBlur={() => { if (decideProviderKeyDraft(llmKey, "blur") === "save") void saveProviderKey(settings.formattingProvider, llmKey) }}
                onCancel={() => setLlmKey('')}
                placeholder={activeLlm.id === 'openai-llm' ? 'sk-...' : activeLlm.id === 'anthropic' ? 'sk-ant-...' : activeLlm.id === 'openrouter' ? 'sk-or-...' : 'gsk_...'}
                hasKey={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.formattingProvider)?.hasKey}
                lastValidation={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.formattingProvider)?.lastValidation}
                onClear={() => { void clearProviderKey(settings.formattingProvider) }}
                onTest={() => { void testProviderKey(settings.formattingProvider, llmKey) }}
                testing={testingProvider === settings.formattingProvider}
              />
            </div>
          )}

          <Group>
            <Row title="Provider Failover" desc="Try next provider on failure">
              <Toggle checked={settings.failoverEnabled} onChange={(v) => updateSettings({ failoverEnabled: v })} />
            </Row>
          </Group>
        </div>
      )}

      {activeSection === 'language' && (
        <div className="space-y-4">
          <Select value={settings.language} onChange={(v) => updateSettings({ language: v })} options={languages} />
          {!isLanguageSupportedByProvider(settings.language, settings.transcriptionProvider, settings.localWhisperModel) && (
            <p className="flex items-start gap-2 text-xs text-amber-500">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              The selected transcription provider does not support this language. Vaani will fall back to auto-detect.
            </p>
          )}

          {/* Per-app language overrides */}
          <div className="mt-2">
            <FieldLabel>Per-App Language</FieldLabel>
            <p className="mb-2 text-xs text-faint">Override the default language for a specific app using its bundle ID.</p>
            <div className="space-y-2">
              {(settings.appProfiles ?? []).map((profile) => {
                const effectiveLanguage = resolveProfileLanguage(profile.language, settings.language);
                const profileLanguage = profile.language && profile.language !== 'auto' ? profile.language : '';
                return (
                <div key={profile.id} className="flex items-center gap-2 rounded-xl border border-line bg-card p-3 shadow-soft">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{profile.name}</div>
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
                    className="shrink-0 rounded-md p-1.5 text-faint transition-colors hover:bg-red-500/10 hover:text-red-500"
                  >
                    <X size={13} />
                  </button>
                </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2 rounded-xl border border-dashed border-line-strong p-2">
              <Input placeholder="App name" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
              <Input placeholder="Bundle ID (e.g. com.tinyspeck.slackmacgap)" value={newProfileBundleId} onChange={(e) => setNewProfileBundleId(e.target.value)} />
              <Select value={newProfileLanguage} onChange={setNewProfileLanguage} options={appLanguageOptions} />
              <Button variant="outline" onClick={addAppProfile}>Add</Button>
            </div>
          </div>

          <Group className="mt-2">
            <Row title="Smart Punctuation" desc="Auto-add periods, commas, and capitalization">
              <Toggle checked={settings.smartPunctuation} onChange={(v) => updateSettings({ smartPunctuation: v })} />
            </Row>
            <Row title="Cleanup" desc="Remove filler words and apply corrections">
              <Toggle checked={settings.cleanupEnabled} onChange={(v) => updateSettings({ cleanupEnabled: v })} />
            </Row>
            <Row title="Context Awareness" desc="When enabled, bounded app/style context may be used for formatting">
              <Toggle checked={settings.contextAwarenessEnabled} onChange={(v) => updateSettings({ contextAwarenessEnabled: v })} />
            </Row>
          </Group>
          <div>
            <FieldLabel>Style Preset</FieldLabel>
            <Select value={settings.stylePreset} onChange={(v) => updateSettings({ stylePreset: v as typeof settings.stylePreset })} options={stylePresets} />
          </div>
        </div>
      )}

      {activeSection === 'dictation' && (
        <div className="space-y-5">
          <div>
            <FieldLabel>Capture Backend</FieldLabel>
            <Select
              value={settings.captureBackend ?? 'renderer'}
              onChange={(v) => updateSettings({ captureBackend: v as typeof settings.captureBackend })}
              options={[
                { value: 'renderer', label: 'Browser capture (recommended)' },
                { value: 'native', label: 'Native voice processing (experimental)' },
              ]}
            />
            <p className="mt-1.5 text-xs text-faint">Native capture is experimental and falls back to browser capture if it cannot start.</p>
          </div>
          <div>
            <FieldLabel>Dictation Mode</FieldLabel>
            <div role="radiogroup" aria-label="Dictation mode" className="space-y-2">
              {dictationModes.map((mode) => (
                <OptionButton key={mode.id} active={settings.dictationMode === mode.id} onClick={() => updateSettings({ dictationMode: mode.id as typeof settings.dictationMode })} label={mode.label} description={mode.description} />
              ))}
            </div>
          </div>
          <Group>
            <Row title="Save Recordings" desc="Save WAV files to disk for replay">
              <Toggle checked={settings.saveRecordings} onChange={(v) => updateSettings({ saveRecordings: v })} />
            </Row>
            <Row title="Suggest Dictionary Words" desc="After you fix a pasted word, offer to add it to the dictionary">
              <Toggle checked={settings.suggestDictionaryWords} onChange={(v) => updateSettings({ suggestDictionaryWords: v })} />
            </Row>
            <Row title="Low Latency Mode" desc="Keeps the microphone open between dictations">
              <Toggle checked={settings.preWarmMic} onChange={(v) => updateSettings({ preWarmMic: v })} />
            </Row>
          </Group>
          <div>
            <FieldLabel>Microphone</FieldLabel>
            <Select
              value={settings.micDeviceId ?? ''}
              onChange={(v) => updateSettings({ micDeviceId: v || undefined })}
              options={microphoneOptions}
              dropUp
            />
            <p className="mt-1.5 text-xs text-faint">Virtual and aggregate devices are skipped for native capture.</p>
          </div>
          <div className="flex items-center justify-between rounded-xl bg-surface/70 p-4">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-muted" />
              <div><div className="text-[13px] font-medium text-ink">{settings.captureBackend === 'native' ? 'Native Voice Processing' : 'Browser Capture'}</div><div className="text-xs text-faint">{settings.captureBackend === 'native' ? 'Falls back to browser capture automatically if native fails' : 'Renderer capture is the default reliability path'}</div></div>
            </div>
            <HardDrive size={14} className="text-faint" />
          </div>
        </div>
      )}

      {activeSection === 'hotkey' && (
        <div className="space-y-5">
          <div>
            <FieldLabel>Primary Dictation Hotkey</FieldLabel>
            <HotkeyCapture value={settings.primaryHotkey} onChange={(v) => updateSettings({ primaryHotkey: v })} />
            <p className="mt-1.5 flex items-center gap-1.5 text-xs text-faint"><AlertTriangle size={10} /> Fn key detection is hardware-dependent. Test after changing.</p>
          </div>
          <div>
            <FieldLabel>Paste Latest Hotkey</FieldLabel>
            <HotkeyCapture value={settings.pasteLatestHotkey} onChange={(v) => updateSettings({ pasteLatestHotkey: v })} />
          </div>
        </div>
      )}

      {activeSection === 'injection' && (
        <div className="space-y-4">
          <div role="radiogroup" aria-label="Injection mode" className="space-y-2">
            {injectionModes.map((mode) => (
              <OptionButton key={mode.id} active={settings.injectionMode === mode.id} onClick={() => updateSettings({ injectionMode: mode.id as typeof settings.injectionMode })} label={mode.label} description={mode.description} />
            ))}
          </div>
          <div>
            <FieldLabel>Paste Mode</FieldLabel>
            <Select value={settings.pasteMode} onChange={(v) => updateSettings({ pasteMode: v as 'instant' | 'animated' })} options={[{ value: 'animated', label: 'Animated' }, { value: 'instant', label: 'Instant' }]} dropUp />
          </div>
        </div>
      )}

      {activeSection === 'appearance' && (
        <div className="space-y-5">
          <div>
            <FieldLabel>Theme</FieldLabel>
            <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3">
              {([['light', Sun, 'Light'], ['dark', Moon, 'Dark']] as const).map(([value, Icon, label]) => (
                <button key={value} role="radio" aria-checked={mode === value} onClick={() => setMode(value)}
                  className={`overflow-hidden rounded-xl border text-left transition-all ${mode === value ? 'border-accent/50 ring-4 ring-accent/[0.08]' : 'border-line hover:border-line-strong'}`}>
                  {/* Miniature window preview */}
                  <div className={`flex h-20 gap-1.5 p-2 ${value === 'dark' ? 'bg-[#0a0a0c]' : 'bg-[#f0efea]'}`}>
                    <div className="w-1/4 space-y-1 pt-1">
                      <div className={`h-1.5 w-3/4 rounded-full ${value === 'dark' ? 'bg-white/15' : 'bg-black/10'}`} />
                      <div className="h-1.5 w-full rounded-full bg-accent/60" />
                      <div className={`h-1.5 w-2/3 rounded-full ${value === 'dark' ? 'bg-white/10' : 'bg-black/[0.07]'}`} />
                    </div>
                    <div className={`flex-1 rounded-md border p-2 ${value === 'dark' ? 'border-white/10 bg-[#0e0e11]' : 'border-black/5 bg-[#fbfaf8]'}`}>
                      <div className={`h-2 w-1/2 rounded-full ${value === 'dark' ? 'bg-white/25' : 'bg-black/20'}`} />
                      <div className={`mt-2 h-5 rounded ${value === 'dark' ? 'bg-[#16161a]' : 'bg-white shadow-sm'}`} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 border-t border-line bg-card px-3 py-2 text-[13px] font-medium text-ink">
                    <Icon size={14} className={mode === value ? 'text-accent' : 'text-muted'} /> {label}
                    {mode === value && <Check size={14} className="ml-auto text-accent" />}
                  </div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>Accent Color</FieldLabel>
            <div className="flex flex-wrap items-center gap-2.5">
              {accentColors.map((color) => {
                const selected = settings.accentColor.toLowerCase() === color.id.toLowerCase()
                return (
                  <button key={color.id} onClick={() => updateSettings({ accentColor: color.id })}
                    aria-label={color.label} aria-pressed={selected}
                    className={`flex h-8 w-8 items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition-all ${selected ? 'ring-2 ring-ink/80 ring-offset-2 ring-offset-bg' : 'hover:scale-110'}`}
                    style={{ backgroundColor: color.id }} title={color.label}>
                    {selected && <Check size={14} strokeWidth={3} className="text-white" />}
                  </button>
                )
              })}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 h-5 w-5 -translate-y-1/2 rounded-md shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" style={{ backgroundColor: settings.accentColor }} />
                <Input value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                  onBlur={(e) => { const val = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(val)) updateSettings({ accentColor: val }); else setCustomHex(settings.accentColor) }}
                  placeholder="#7C3AED" aria-label="Custom accent hex" className="w-36 pl-10 font-mono uppercase" />
              </div>
            </div>
            <p className="mt-3 text-xs text-faint">Accent color tints highlights and the recording capsule.</p>
          </div>
        </div>
      )}

      {activeSection === 'system' && (
        <Group>
          <Row title="Show in Dock" desc="Display app icon in macOS dock">
            <Toggle checked={settings.showInDock} onChange={(v) => updateSettings({ showInDock: v })} />
          </Row>
          <Row title="Launch at Login" desc="Start Vaani when you log in">
            <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
          </Row>
        </Group>
      )}

      {activeSection === 'audio' && (
        <Group>
          <RangeField label="Minimum Clip Duration" display={`${settings.minClipDuration}s`} min={0.1} max={3} step={0.1}
            value={settings.minClipDuration} onChange={(v) => updateSettings({ minClipDuration: v })} />
          <RangeField label="Silence Threshold" display={`${Math.round(settings.silenceThreshold * 100)}%`} min={0} max={1} step={0.01}
            value={settings.silenceThreshold} onChange={(v) => updateSettings({ silenceThreshold: v })} />
        </Group>
      )}

      {activeSection === 'updates' && (
        <div className="space-y-3 rounded-xl border border-line bg-card p-5 shadow-soft">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-[13.5px] font-medium text-ink">App Updates</div>
              <div className="mt-0.5 text-xs text-faint">Current version: <span className="font-mono">{appVersion ?? '—'}</span></div>
            </div>
          </div>
          <Button variant="soft" size="sm" onClick={checkForUpdates} disabled={updateStatus.status === 'checking' || updateStatus.status === 'downloading'}>
            <RefreshCw size={14} className={updateStatus.status === 'checking' || updateStatus.status === 'downloading' ? 'animate-spin-ui' : ''} />
            {updateStatus.status === 'checking' ? 'Checking…' : updateStatus.status === 'downloading' ? 'Downloading…' : 'Check for Updates'}
          </Button>
          {updateStatus.status === 'ready' && <Button variant="accent" size="sm" onClick={() => restartAndInstall()}>Restart to Update</Button>}
          {updateStatus.status === 'idle' && updateStatus.available === false && <p className="text-xs text-accent">Vaani is up to date</p>}
          {updateStatus.status === 'available' && <p className="text-xs text-accent">{updateStatus.message}</p>}
          {updateStatus.status === 'error' && <p className="text-xs text-red-500">{updateStatus.message}</p>}
        </div>
      )}

      {activeSection === 'data' && (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button variant="soft" size="sm" onClick={handleExportData}><Download size={14} /> Export Data</Button>
            <Button variant="destructive" size="sm" onClick={() => { void clearHistory() }}><Trash2 size={14} /> Clear All History</Button>
          </div>
          <div className="rounded-xl border border-red-500/20 bg-red-500/[0.05] p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="mt-0.5 text-red-500" />
              <div>
                <div className="mb-1 text-sm font-semibold text-red-500">Reset to Defaults</div>
                <p className="mb-3 text-sm text-red-500/80">This will reset all settings. History will not be affected.</p>
                <Button variant="destructive" size="sm" onClick={() => { void resetSettings() }}>Reset Settings</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeSection === 'recovery' && (
        <div className="space-y-6">
          <div>
            <FieldLabel>Unresolved audio retention</FieldLabel>
            <Select
              value={String(settings.recoveryRetentionDays)}
              onChange={(value) => updateSettings({ recoveryRetentionDays: parseRecoveryRetentionDays(value) })}
              options={[1, 3, 7, 14].map((days) => ({ value: String(days), label: `${days} day${days === 1 ? '' : 's'}` }))}
            />
            <p className="mt-1.5 text-xs text-faint">This period applies to new failures. Previously retained audio keeps its original expiry. Bounded text stays until you discard its recovery item.</p>
          </div>
          <Group>
            <Row title="Retain failed audio" desc="Opt in to encrypted audio for retries when recovery is available">
              <Toggle checked={settings.retainFailedAudio} onChange={(value) => updateSettings({ retainFailedAudio: value })} />
            </Row>
          </Group>
          {!settings.retainFailedAudio && (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-4 text-[13px] text-amber-700 dark:text-amber-400">
              Failed audio retention is off. When recovery is available, new failures will keep text only.
            </div>
          )}
          <p className="text-xs leading-relaxed text-faint">Turning this off stops new retention. Previously retained audio remains until it expires or you clear it below. Save Recordings is a separate preference for WAV files.</p>
          <div className="rounded-xl border border-line bg-card p-4 shadow-soft">
            <div className="flex items-center gap-3">
              <HardDrive size={16} className="text-muted" />
              <div>
                <div className="text-sm font-medium text-ink">Recovery storage</div>
                <div className="text-xs text-faint">{formatBytes(recoveryUsage.bytes)} across {recoveryUsage.sessions} unresolved item{recoveryUsage.sessions === 1 ? '' : 's'}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="soft" size="sm" onClick={() => { void cleanupRecovery() }} disabled={recoveryBusy}><RefreshCw size={13} /> Clear expired audio</Button>
              <Button variant="destructive" size="sm" onClick={() => { void clearRecoveryAudio() }} disabled={recoveryBusy}><Trash2 size={13} /> Clear all audio</Button>
            </div>
          </div>
          <p className="text-xs leading-relaxed text-faint">Recovery audio is ciphertext on disk. When it expires or you delete it, the audio reference is removed but the bounded transcript and error details remain. Playback decrypts only for the explicit action and removes its temporary file afterward.</p>
        </div>
      )}
    </div>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="app-no-drag fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[6px]"
          onClick={onClose}
        >
          <motion.div
            role="dialog" aria-modal="true" aria-label="Settings"
            initial={{ opacity: 0, scale: 0.98, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: 'spring', damping: 30, stiffness: 380 }}
            className="flex h-[min(82vh,720px)] w-full max-w-[920px] overflow-hidden rounded-2xl border border-line bg-bg shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex w-56 shrink-0 flex-col border-r border-line bg-sidebar">
              <div className="px-5 pb-4 pt-6">
                <h2 className="type-display text-[28px] text-ink">Settings</h2>
                <p className="label-meta mt-1 text-[9px] text-faint">Configure Vaani</p>
              </div>
              <nav className="flex-1 space-y-4 overflow-y-auto px-3 pb-4">
                {sidebarGroups.map((group) => (
                  <div key={group}>
                    <p className="label-meta px-3 pb-1.5 text-[9px] text-faint">{group}</p>
                    <div className="space-y-0.5">
                      {sidebarItems.filter((it) => it.group === group).map((it) => {
                        const Icon = it.icon
                        const active = activeSection === it.id
                        return (
                          <button key={it.id} onClick={() => setActiveSection(it.id)} aria-current={active ? 'page' : undefined}
                            className={`flex w-full items-center gap-2.5 rounded-[9px] px-3 py-[7px] text-left text-[13px] font-medium transition-all ${
                              active ? 'bg-card text-ink shadow-soft ring-1 ring-line' : 'text-muted hover:bg-ink/[0.04] hover:text-ink'
                            }`}>
                            <Icon size={15} className={active ? 'text-accent' : 'text-faint'} /> {it.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </nav>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-line px-7 py-4">
                <div>
                  <h3 className="type-title text-[17px] text-ink">{sidebarItems.find((s) => s.id === activeSection)?.label}</h3>
                  <p className="mt-0.5 text-xs text-faint">{sectionDescriptions[activeSection]}</p>
                </div>
                <button onClick={onClose} aria-label="Close settings" className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"><X size={17} /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-7 py-6">
                <motion.div key={activeSection} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}>
                  {sectionContent}
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
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
