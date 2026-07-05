import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe, Mic, Keyboard, Type, Palette, Monitor, Volume2, Download, Trash2,
  Eye, EyeOff, Check, AlertTriangle, X, Database, HardDrive, Plug, RefreshCw, Sun, Moon,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { HotkeyCapture } from './HotkeyCapture'
import { KNOWN_PROVIDERS, SUPPORTED_LANGUAGES, isLanguageSupportedByProvider } from '@shared/defaults'
import { Select } from '@renderer/components/ui/Select'
import { Toggle } from '@renderer/components/ui/toggle'
import { Input } from '@renderer/components/ui/input'
import { Button } from '@renderer/components/ui/button'
import { createExportPayload } from '@renderer/exportData'
import type { AudioInputDevice } from '@shared/types'

const sidebarItems = [
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
]

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
  { id: 'clipboard', label: 'Clipboard', description: 'Pastes text via the clipboard' },
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

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className="mb-2 block text-sm font-medium text-muted">{children}</label>
}

function Row({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="text-xs text-faint">{desc}</div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function OptionButton({ active, onClick, label, description }: { active: boolean; onClick: () => void; label: string; description: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-2xl border p-4 text-left transition-all ${
        active ? 'border-accent bg-accent/10' : 'border-line hover:border-ink/20'
      }`}
    >
      <div>
        <div className="text-sm font-medium text-ink">{label}</div>
        <div className="text-xs text-faint">{description}</div>
      </div>
      {active && <span className="ml-3 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent"><Check size={12} className="text-white" /></span>}
    </button>
  )
}

function providerSummary(provider: typeof KNOWN_PROVIDERS[number] | undefined): string {
  if (!provider) return ''
  const locality = provider.locality === 'local' ? 'Local' : 'Cloud'
  const privacy = provider.privacyLevel === 'local-only' ? 'audio stays on device' : provider.privacyLevel === 'cloud-text' ? 'sends text to provider' : 'sends audio to provider'
  const cost = provider.estimatedCost === 'free-local' ? 'free after model download' : `${provider.estimatedCost ?? 'varies'} cost`
  const confidence = provider.supportsConfidence ? 'confidence signals' : 'no confidence signals'
  return `${locality} · ${privacy} · ${cost} · ${confidence}`
}

function ApiKeyInput({
  value, onChange, onBlur, placeholder, hasKey, onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  placeholder: string;
  hasKey?: boolean;
  onClear?: () => void;
}) {
  const [visible, setVisible] = useState(false)
  const [replacing, setReplace] = useState(false)

  if (hasKey && !replacing && !value) {
    return (
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5">
          <span className="flex-1 font-mono text-sm tracking-[0.25em] text-muted">••••••••••••</span>
          <span className="flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-semibold text-accent">
            <Check size={10} /> Saved
          </span>
        </div>
        <button
          type="button"
          onClick={() => setReplace(true)}
          className="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-ink/30 hover:text-ink"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={() => { onClear?.(); setReplace(false); }}
          className="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-red-300 hover:text-red-500"
        >
          Clear
        </button>
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
          onBlur={onBlur}
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
          onClick={() => { onChange(''); setReplace(false); }}
          className="shrink-0 rounded-xl border border-line px-3 py-2 text-xs font-medium text-muted transition-colors hover:border-ink/30 hover:text-ink"
        >
          Cancel
        </button>
      )}
    </div>
  )
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries, updateStatus, checkForUpdates, restartAndInstall } = useVaaniUi()
  const { mode, setMode } = useColorMode()
  const [activeSection, setActiveSection] = useState('api')
  const [customHex, setCustomHex] = useState(settings.accentColor)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [sttKey, setSttKey] = useState('')
  const [llmKey, setLlmKey] = useState('')
  const [newProfileName, setNewProfileName] = useState('')
  const [newProfileBundleId, setNewProfileBundleId] = useState('')
  const [newProfileLanguage, setNewProfileLanguage] = useState('auto')
  const [audioDevices, setAudioDevices] = useState<AudioInputDevice[]>([])

  useEffect(() => {
    if (!isOpen) return
    void window.vaani.getAppVersion().then(setAppVersion).catch(() => setAppVersion(null))
    void window.vaani.listAudioInputDevices().then(setAudioDevices).catch(() => setAudioDevices([]))
  }, [isOpen])

  useEffect(() => { setCustomHex(settings.accentColor) }, [settings.accentColor])

  useEffect(() => {
    const pk = settings.providerApiKeys ?? []
    setSttKey(pk.find((p) => p.providerId === settings.transcriptionProvider)?.key ?? (settings.transcriptionProvider === 'groq' ? settings.groqApiKey : ''))
    setLlmKey(pk.find((p) => p.providerId === settings.formattingProvider)?.key ?? '')
  }, [settings.transcriptionProvider, settings.formattingProvider, settings.providerApiKeys, settings.groqApiKey])

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
      language: newProfileLanguage,
    };
    void updateSettings({ appProfiles: [...existingProfiles, profile] });
    setNewProfileName('');
    setNewProfileBundleId('');
    setNewProfileLanguage('auto');
  };

  const saveProviderKey = (providerId: string, key: string) => {
    const current = settings.providerApiKeys ?? []
    const existing = current.findIndex((p) => p.providerId === providerId)
    const next = existing >= 0 ? current.map((p, i) => (i === existing ? { providerId, key } : p)) : [...current, { providerId, key }]
    void updateSettings({ providerApiKeys: next })
  }

  const handleExportData = () => {
    const data = createExportPayload(settings, historyEntries)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const sttProviders = KNOWN_PROVIDERS.filter((p) => p.type === 'stt' || p.type === 'local-stt')
  const llmProviders = KNOWN_PROVIDERS.filter((p) => p.type === 'llm')
  const activeStt = sttProviders.find((p) => p.id === settings.transcriptionProvider)
  const activeLlm = llmProviders.find((p) => p.id === settings.formattingProvider)
  const activeLlmModels = activeLlm?.models ?? []
  const physicalAudioDevices = audioDevices.filter((device) => device.isPhysical)
  const microphoneOptions = [
    { value: '', label: 'Automatic physical microphone' },
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
            <FieldLabel>Transcription Provider</FieldLabel>
            <Select value={settings.transcriptionProvider} onChange={(v) => updateSettings({ transcriptionProvider: v })} options={sttProviders.map((p) => ({ value: p.id, label: p.name }))} />
            <p className="mt-1.5 text-xs text-faint">{providerSummary(activeStt)}</p>
          </div>

          {activeStt?.requiresApiKey && (
            <div>
              <FieldLabel>{activeStt.name} API Key</FieldLabel>
              <ApiKeyInput
                value={sttKey}
                onChange={(v) => { setSttKey(v); saveProviderKey(settings.transcriptionProvider, v) }}
                onBlur={() => { if (settings.transcriptionProvider === 'groq') void updateSettings({ groqApiKey: sttKey }) }}
                placeholder={activeStt.id === 'openai' || activeStt.id === 'openai-compatible' ? 'sk-...' : activeStt.id === 'deepgram' ? 'Token...' : 'gsk_...'}
                hasKey={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.transcriptionProvider)?.hasKey}
                onClear={() => saveProviderKey(settings.transcriptionProvider, '')}
              />
            </div>
          )}

          <div className="h-px bg-line" />

          <div>
            <FieldLabel>Formatting Provider</FieldLabel>
            <Select value={settings.formattingProvider} onChange={(v) => updateSettings({ formattingProvider: v })} options={llmProviders.map((p) => ({ value: p.id, label: p.name }))} />
            <p className="mt-1.5 text-xs text-faint">{providerSummary(activeLlm)}</p>
          </div>

          {activeLlm?.requiresApiKey && (
            <div>
              <FieldLabel>{activeLlm.name} API Key</FieldLabel>
              <ApiKeyInput
                value={llmKey}
                onChange={(v) => { setLlmKey(v); saveProviderKey(settings.formattingProvider, v) }}
                placeholder={activeLlm.id === 'openai-llm' ? 'sk-...' : activeLlm.id === 'anthropic' ? 'sk-ant-...' : activeLlm.id === 'openrouter' ? 'sk-or-...' : 'gsk_...'}
                hasKey={(settings.providerApiKeys ?? []).find((pk) => pk.providerId === settings.formattingProvider)?.hasKey}
                onClear={() => saveProviderKey(settings.formattingProvider, '')}
              />
            </div>
          )}

          {activeLlmModels.length > 0 && (
            <div>
              <FieldLabel>Formatting Model</FieldLabel>
              <Select value={settings.formattingModel} onChange={(v) => updateSettings({ formattingModel: v })} options={activeLlmModels.map((m) => ({ value: m.id, label: m.name }))} />
            </div>
          )}

          <div className="h-px bg-line" />
          <Row title="Provider Failover" desc="Try next provider on failure">
            <Toggle checked={settings.failoverEnabled} onChange={(v) => updateSettings({ failoverEnabled: v })} />
          </Row>
          <div>
            <FieldLabel>Offline Mode</FieldLabel>
            <Select value={settings.offlineMode} onChange={(v) => updateSettings({ offlineMode: v as 'auto' | 'always-offline' | 'always-online' })}
              options={[{ value: 'auto', label: 'Auto' }, { value: 'always-offline', label: 'Prefer Offline' }, { value: 'always-online', label: 'Always Online' }]} dropUp />
          </div>

          {settings.transcriptionProvider === 'local-whisper' && (
            <div>
              <FieldLabel>Local Whisper Model</FieldLabel>
              <Select value={settings.localWhisperModel} onChange={(v) => updateSettings({ localWhisperModel: v })}
                options={[
                  { value: 'tiny.en', label: 'Tiny English (78 MB, fastest)' },
                  { value: 'base.en', label: 'Base English (147 MB)' },
                  { value: 'small.en', label: 'Small English (488 MB)' },
                  { value: 'medium.en', label: 'Medium English (1.5 GB, most accurate)' },
                ]} dropUp />
              <p className="mt-1.5 text-xs text-faint">Models download on first use. Larger models are more accurate but slower.</p>
            </div>
          )}
        </div>
      )}

      {activeSection === 'language' && (
        <div className="space-y-4">
          <Select value={settings.language} onChange={(v) => updateSettings({ language: v })} options={languages} />
          {!isLanguageSupportedByProvider(settings.language, settings.transcriptionProvider, settings.localWhisperModel) && (
            <p className="flex items-start gap-2 text-xs text-amber-500">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {settings.transcriptionProvider === 'local-whisper'
                ? 'The selected local model is English-only. Choose a cloud transcription provider for this language.'
                : 'The selected transcription provider does not support this language. Vaani will fall back to auto-detect.'}
            </p>
          )}

          {/* Per-app language overrides */}
          <div className="mt-2">
            <FieldLabel>Per-App Language</FieldLabel>
            <p className="mb-2 text-xs text-faint">Override the default language for a specific app using its bundle ID.</p>
            <div className="space-y-2">
              {(settings.appProfiles ?? []).map((profile) => (
                <div key={profile.id} className="flex items-center gap-2 rounded-xl border border-line p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{profile.name}</div>
                    <div className="truncate text-xs text-faint">{profile.appBundleIds.join(', ')}</div>
                  </div>
                  <Select
                    value={profile.language ?? 'auto'}
                    onChange={(v) => {
                      const next = (settings.appProfiles ?? []).map((p) => {
                        if (p.id !== profile.id) return p;
                        const provider = p.transcriptionProvider;
                        return {
                          ...p,
                          language: v,
                          transcriptionProvider: provider && isLanguageSupportedByProvider(v, provider, settings.localWhisperModel)
                            ? provider
                            : undefined,
                        };
                      });
                      void updateSettings({ appProfiles: next });
                    }}
                    options={languages}
                  />
                  <Select
                    value={profile.transcriptionProvider && isLanguageSupportedByProvider(profile.language ?? 'auto', profile.transcriptionProvider, settings.localWhisperModel) ? profile.transcriptionProvider : ''}
                    onChange={(v) => {
                      if (v && !isLanguageSupportedByProvider(profile.language ?? 'auto', v, settings.localWhisperModel)) return;
                      const next = (settings.appProfiles ?? []).map((p) => p.id === profile.id ? { ...p, transcriptionProvider: v || undefined } : p);
                      void updateSettings({ appProfiles: next });
                    }}
                    options={[
                      { value: '', label: 'Default STT' },
                      ...sttProviders
                        .filter((p) => isLanguageSupportedByProvider(profile.language ?? 'auto', p.id, settings.localWhisperModel))
                        .map((p) => ({ value: p.id, label: p.name })),
                    ]}
                  />
                  <button
                    aria-label="Delete profile"
                    onClick={() => {
                      const next = (settings.appProfiles ?? []).filter((p) => p.id !== profile.id);
                      void updateSettings({ appProfiles: next });
                    }}
                    className="shrink-0 rounded-lg p-1 text-faint transition-colors hover:text-ink"
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <Input placeholder="App name" value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} />
              <Input placeholder="Bundle ID (e.g. com.tinyspeck.slackmacgap)" value={newProfileBundleId} onChange={(e) => setNewProfileBundleId(e.target.value)} />
              <Select value={newProfileLanguage} onChange={setNewProfileLanguage} options={languages} />
              <Button variant="outline" onClick={addAppProfile}>Add</Button>
            </div>
          </div>

          <Row title="Smart Punctuation" desc="Auto-add periods, commas, and capitalization">
            <Toggle checked={settings.smartPunctuation} onChange={(v) => updateSettings({ smartPunctuation: v })} />
          </Row>
          <Row title="Cleanup" desc="Remove filler words and apply corrections">
            <Toggle checked={settings.cleanupEnabled} onChange={(v) => updateSettings({ cleanupEnabled: v })} />
          </Row>
          <Row title="Context Awareness" desc="When enabled, bounded app/style context may be used for formatting">
            <Toggle checked={settings.contextAwarenessEnabled} onChange={(v) => updateSettings({ contextAwarenessEnabled: v })} />
          </Row>
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
            <div className="space-y-2">
              {dictationModes.map((mode) => (
                <OptionButton key={mode.id} active={settings.dictationMode === mode.id} onClick={() => updateSettings({ dictationMode: mode.id as typeof settings.dictationMode })} label={mode.label} description={mode.description} />
              ))}
            </div>
          </div>
          <Row title="Save Recordings" desc="Save WAV files to disk for replay">
            <Toggle checked={settings.saveRecordings} onChange={(v) => updateSettings({ saveRecordings: v })} />
          </Row>
          <Row title="Low Latency Mode" desc="Keeps the microphone open between dictations">
            <Toggle checked={settings.preWarmMic} onChange={(v) => updateSettings({ preWarmMic: v })} />
          </Row>
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
          <div className="flex items-center justify-between rounded-2xl bg-surface p-4">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-muted" />
              <div><div className="text-sm text-ink">{settings.captureBackend === 'native' ? 'Native Voice Processing' : 'Browser Capture'}</div><div className="text-xs text-faint">{settings.captureBackend === 'native' ? 'Falls back to browser capture automatically if native fails' : 'Renderer capture is the default reliability path'}</div></div>
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
          <div className="space-y-2">
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
            <div className="flex gap-2">
              <button onClick={() => setMode('light')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-medium transition-all ${mode === 'light' ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:border-ink/20'}`}>
                <Sun size={16} /> Light
              </button>
              <button onClick={() => setMode('dark')}
                className={`flex flex-1 items-center justify-center gap-2 rounded-2xl border p-3 text-sm font-medium transition-all ${mode === 'dark' ? 'border-accent bg-accent/10 text-ink' : 'border-line text-muted hover:border-ink/20'}`}>
                <Moon size={16} /> Dark
              </button>
            </div>
          </div>
          <div>
            <FieldLabel>Accent Color</FieldLabel>
            <div className="flex flex-wrap items-center gap-3">
              {accentColors.map((color) => (
                <button key={color.id} onClick={() => updateSettings({ accentColor: color.id })}
                  className={`h-10 w-10 rounded-full transition-all ${settings.accentColor === color.id ? 'ring-2 ring-ink ring-offset-2' : 'hover:scale-105'}`}
                  style={{ backgroundColor: color.id }} title={color.label} />
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Input value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                onBlur={(e) => { const val = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(val)) updateSettings({ accentColor: val }); else setCustomHex(settings.accentColor) }}
                placeholder="#7575C8" className="w-36 font-mono uppercase" />
              <div className="h-9 w-9 rounded-lg border border-line" style={{ backgroundColor: settings.accentColor }} />
            </div>
            <p className="mt-3 text-xs text-faint">Accent color tints highlights and the recording capsule.</p>
          </div>
        </div>
      )}

      {activeSection === 'system' && (
        <div className="space-y-2">
          <Row title="Show in Dock" desc="Display app icon in macOS dock">
            <Toggle checked={settings.showInDock} onChange={(v) => updateSettings({ showInDock: v })} />
          </Row>
          <div className="h-px bg-line" />
          <Row title="Launch at Login" desc="Start Vaani when you log in">
            <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
          </Row>
        </div>
      )}

      {activeSection === 'audio' && (
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-ink">Minimum Clip Duration</label>
              <span className="text-xs text-faint">{settings.minClipDuration}s</span>
            </div>
            <input type="range" min="0.1" max="3" step="0.1" value={settings.minClipDuration}
              onChange={(e) => updateSettings({ minClipDuration: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[#7575c8]" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-ink">Silence Threshold</label>
              <span className="text-xs text-faint">{Math.round(settings.silenceThreshold * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={settings.silenceThreshold}
              onChange={(e) => updateSettings({ silenceThreshold: Number(e.target.value) })}
              className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-line accent-[#7575c8]" />
          </div>
        </div>
      )}

      {activeSection === 'updates' && (
        <div className="space-y-3">
          <div>
            <div className="text-sm font-medium text-ink">App Updates</div>
            <div className="text-xs text-faint">Current version: {appVersion ?? '—'}</div>
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
          <div className="rounded-2xl border border-red-400/30 bg-red-500/10 p-5">
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
    </div>
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
            className="flex h-[80vh] w-full max-w-4xl overflow-hidden rounded-[20px] bg-bg shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex w-60 shrink-0 flex-col border-r border-line bg-surface">
              <div className="px-6 pb-4 pt-6">
                <h2 className="text-display text-2xl text-ink">Settings</h2>
                <p className="label-meta mt-1 text-[9px] text-faint">Configure Vaani</p>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
                {sidebarItems.map((it) => {
                  const Icon = it.icon
                  return (
                    <button key={it.id} onClick={() => setActiveSection(it.id)}
                      className={`flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm transition-all ${
                        activeSection === it.id ? 'bg-accent/10 font-semibold text-accent' : 'font-medium text-muted hover:bg-bg hover:text-ink'
                      }`}>
                      <Icon size={16} /> {it.label}
                    </button>
                  )
                })}
              </nav>
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-line px-7 py-5">
                <div>
                  <h3 className="text-display text-xl text-ink">{sidebarItems.find((s) => s.id === activeSection)?.label}</h3>
                  <p className="mt-0.5 text-xs text-faint">{sectionDescriptions[activeSection]}</p>
                </div>
                <button onClick={onClose} className="rounded-full p-2 text-muted transition-colors hover:bg-surface"><X size={18} /></button>
              </div>
              <div className="flex-1 overflow-y-auto px-7 py-6">
                <motion.div key={activeSection} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
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
