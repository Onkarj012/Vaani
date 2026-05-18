import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Globe,
  Mic,
  Keyboard,
  Type,
  Palette,
  Monitor,
  Volume2,
  Download,
  Trash2,
  Eye,
  EyeOff,
  ChevronRight,
  Check,
  Moon,
  Sun,
  AlertTriangle,
  X,
  Database,
  HardDrive,
  Plug,
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { useVaaniUi } from '../context/vaani-ui'
import { HotkeyCapture } from './HotkeyCapture'
import { KNOWN_PROVIDERS } from '@shared/defaults'

const sidebarItems = [
  { id: 'api', label: 'API & Providers', icon: Plug },
  { id: 'language', label: 'Language', icon: Globe },
  { id: 'dictation', label: 'Dictation', icon: Mic },
  { id: 'hotkey', label: 'Hotkey', icon: Keyboard },
  { id: 'injection', label: 'Injection', icon: Type },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'data', label: 'Data', icon: Database },
]

const sectionDescriptions: Record<string, string> = {
  api: 'Transcription and formatting providers',
  language: 'Spoken language for transcription',
  dictation: 'Recording behavior and voice settings',
  hotkey: 'Global shortcuts for dictation',
  injection: 'How text is entered into apps',
  appearance: 'Theme and accent colors',
  system: 'Dock, startup, and behavior',
  audio: 'Silence detection and noise gate',
  data: 'Export, clear history, and reset settings',
}

const languages = [
  { value: 'auto', label: 'Auto-detect' },
  { value: 'en', label: 'English' },
  { value: 'hi', label: 'Hindi' },
  { value: 'hinglish', label: 'Hinglish' },
  { value: 'ta', label: 'Tamil' },
  { value: 'pa', label: 'Punjabi' },
  { value: 'mr', label: 'Marathi' },
  { value: 'bn', label: 'Bengali' },
  { value: 'gu', label: 'Gujarati' },
  { value: 'te', label: 'Telugu' },
  { value: 'kn', label: 'Kannada' },
  { value: 'ml', label: 'Malayalam' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'ja', label: 'Japanese' },
  { value: 'zh', label: 'Chinese' },
  { value: 'ko', label: 'Korean' },
  { value: 'ar', label: 'Arabic' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'ru', label: 'Russian' },
]

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

const accentColors = [
  { id: '#FF006E', label: 'Pink', color: 'bg-[#FF006E]' },
  { id: '#ADFF02', label: 'Lime', color: 'bg-[#ADFF02]' },
  { id: '#00F5FF', label: 'Cyan', color: 'bg-[#00F5FF]' },
  { id: '#9D4EDD', label: 'Purple', color: 'bg-[#9D4EDD]' },
  { id: '#FFE600', label: 'Yellow', color: 'bg-[#FFE600]' },
  { id: '#FF6B35', label: 'Orange', color: 'bg-[#FF6B35]' },
  { id: '#FFFFFF', label: 'White', color: 'bg-white border-2 border-vaani-gray-200 dark:border-vaani-gray-600' },
  { id: '#000000', label: 'Black', color: 'bg-black border-2 border-vaani-gray-700 dark:border-vaani-gray-500' },
  { id: '#9CA3AF', label: 'Monochrome', color: 'bg-[#9CA3AF]' },
]

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${
        checked ? 'bg-vaani-pink' : 'bg-vaani-gray-300 dark:bg-vaani-gray-600'
      }`}
    >
      <motion.div
        animate={{ x: checked ? 22 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm"
      />
    </button>
  )
}

function Select({
  value,
  onChange,
  options,
  dropUp = false,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  dropUp?: boolean
}) {
  const [isOpen, setIsOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm text-vaani-black dark:text-white hover:border-vaani-gray-300 dark:hover:border-vaani-gray-500 transition-colors"
      >
        {options.find((o) => o.value === value)?.label ?? value}
        <ChevronRight size={14} className={`text-vaani-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className={`absolute left-0 right-0 bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto ${
            dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}>
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { onChange(opt.value); setIsOpen(false) }}
                className={`w-full text-left px-4 py-2.5 text-sm hover:bg-vaani-gray-50 dark:hover:bg-vaani-gray-700 transition-colors flex items-center justify-between ${
                  value === opt.value ? 'text-vaani-pink font-medium' : 'text-vaani-black dark:text-white'
                }`}
              >
                {opt.label}
                {value === opt.value && <Check size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const { theme, toggleTheme } = useTheme()
  const { settings, updateSettings, resetSettings, clearHistory, historyEntries } = useVaaniUi()
  const [activeSection, setActiveSection] = useState('api')
  const [customHex, setCustomHex] = useState(settings.accentColor)

  // Track API keys for currently selected providers only
  const [sttKey, setSttKey] = useState('')
  const [sttKeyVisible, setSttKeyVisible] = useState(false)
  const [llmKey, setLlmKey] = useState('')
  const [llmKeyVisible, setLlmKeyVisible] = useState(false)

  useEffect(() => { setCustomHex(settings.accentColor) }, [settings.accentColor])

  // Load keys for selected providers
  useEffect(() => {
    const pk = settings.providerApiKeys ?? []
    const sttKeyEntry = pk.find(p => p.providerId === settings.transcriptionProvider)
    setSttKey(sttKeyEntry?.key ?? (settings.transcriptionProvider === 'groq' ? settings.groqApiKey : ''))
    const llmKeyEntry = pk.find(p => p.providerId === settings.formattingProvider)
    setLlmKey(llmKeyEntry?.key ?? '')
  }, [settings.transcriptionProvider, settings.formattingProvider, settings.providerApiKeys, settings.groqApiKey])

  if (!isOpen) return null

  const saveProviderKey = (providerId: string, key: string) => {
    const current = settings.providerApiKeys ?? []
    const existing = current.findIndex(p => p.providerId === providerId)
    const next = existing >= 0
      ? current.map((p, i) => i === existing ? { providerId, key } : p)
      : [...current, { providerId, key }]
    void updateSettings({ providerApiKeys: next })
  }

  const handleExportData = () => {
    const data = { exportedAt: new Date().toISOString(), settings, history: historyEntries }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  const sttProviders = KNOWN_PROVIDERS.filter(p => p.type === 'stt' || p.type === 'local-stt')
  const llmProviders = KNOWN_PROVIDERS.filter(p => p.type === 'llm')
  const activeStt = sttProviders.find(p => p.id === settings.transcriptionProvider)
  const activeLlm = llmProviders.find(p => p.id === settings.formattingProvider)
  const activeLlmModels = activeLlm?.models ?? []

  const sectionContent = (
    <div className="space-y-6">
      {activeSection === 'api' && (
        <div className="space-y-5">
          {/* Transcription Provider */}
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
              Transcription Provider
            </label>
            <Select value={settings.transcriptionProvider} onChange={(v) => updateSettings({ transcriptionProvider: v })}
              options={sttProviders.map(p => ({ value: p.id, label: p.name }))} />
            <p className="text-xs text-vaani-gray-400 mt-1.5">
              {activeStt?.requiresApiKey === false
                ? 'Runs entirely on-device — no API key needed.'
                : 'Requires an API key.'}
            </p>
          </div>

          {/* STT API key — only for the selected provider */}
          {activeStt?.requiresApiKey && (
            <div>
              <label className="text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400">
                {activeStt.name} API Key
              </label>
              <div className="relative mt-1">
                <input
                  type={sttKeyVisible ? 'text' : 'password'}
                  value={sttKey}
                  onChange={(e) => { setSttKey(e.target.value); saveProviderKey(settings.transcriptionProvider, e.target.value) }}
                  onBlur={() => { if (settings.transcriptionProvider === 'groq') { void updateSettings({ groqApiKey: sttKey }) } }}
                  placeholder={activeStt.id === 'openai' || activeStt.id === 'openai-compatible' ? 'sk-...' : activeStt.id === 'deepgram' ? 'Token...' : 'gsk_...'}
                  className="w-full pl-4 pr-12 py-2.5 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all font-mono text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                />
                <button
                  onClick={() => setSttKeyVisible(!sttKeyVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-600 rounded-lg transition-colors"
                >
                  {sttKeyVisible ? <EyeOff size={14} className="text-vaani-gray-500" /> : <Eye size={14} className="text-vaani-gray-500" />}
                </button>
              </div>
            </div>
          )}

          <div className="h-px bg-vaani-gray-200 dark:bg-vaani-gray-700" />

          {/* Formatting Provider */}
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
              Formatting Provider
            </label>
            <Select value={settings.formattingProvider} onChange={(v) => updateSettings({ formattingProvider: v })}
              options={llmProviders.map(p => ({ value: p.id, label: p.name }))} />
          </div>

          {/* LLM API key — only for selected provider */}
          {activeLlm?.requiresApiKey && (
            <div>
              <label className="text-xs font-medium text-vaani-gray-500 dark:text-vaani-gray-400">
                {activeLlm.name} API Key
              </label>
              <div className="relative mt-1">
                <input
                  type={llmKeyVisible ? 'text' : 'password'}
                  value={llmKey}
                  onChange={(e) => { setLlmKey(e.target.value); saveProviderKey(settings.formattingProvider, e.target.value) }}
                  placeholder={activeLlm.id === 'openai-llm' ? 'sk-...' : activeLlm.id === 'anthropic' ? 'sk-ant-...' : activeLlm.id === 'openrouter' ? 'sk-or-...' : 'gsk_...'}
                  className="w-full pl-4 pr-12 py-2.5 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all font-mono text-vaani-black dark:text-white placeholder:text-vaani-gray-400"
                />
                <button
                  onClick={() => setLlmKeyVisible(!llmKeyVisible)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-600 rounded-lg transition-colors"
                >
                  {llmKeyVisible ? <EyeOff size={14} className="text-vaani-gray-500" /> : <Eye size={14} className="text-vaani-gray-500" />}
                </button>
              </div>
            </div>
          )}

          {/* Formatting model selector */}
          {activeLlmModels.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
                Formatting Model
              </label>
              <Select value={settings.formattingModel} onChange={(v) => updateSettings({ formattingModel: v })}
                options={activeLlmModels.map(m => ({ value: m.id, label: m.name }))} />
            </div>
          )}

          <div className="h-px bg-vaani-gray-200 dark:bg-vaani-gray-700" />

          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-vaani-black dark:text-white">Provider Failover</div>
              <div className="text-xs text-vaani-gray-400">Try next provider on failure</div>
            </div>
            <Toggle checked={settings.failoverEnabled} onChange={(v) => updateSettings({ failoverEnabled: v })} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-sm font-medium text-vaani-black dark:text-white">Offline Mode</div>
              <div className="text-xs text-vaani-gray-400">Prefer offline processing when available</div>
            </div>
            <Select value={settings.offlineMode} onChange={(v) => updateSettings({ offlineMode: v as "auto" | "always-offline" | "always-online" })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'always-offline', label: 'Prefer Offline' },
                { value: 'always-online', label: 'Always Online' },
              ]} dropUp />
          </div>

          {settings.transcriptionProvider === 'local-whisper' && (
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
                Local Whisper Model
              </label>
              <Select value={settings.localWhisperModel} onChange={(v) => updateSettings({ localWhisperModel: v })}
                options={[
                  { value: 'tiny.en', label: 'Tiny English (78 MB, fastest)' },
                  { value: 'base.en', label: 'Base English (147 MB)' },
                  { value: 'small.en', label: 'Small English (488 MB)' },
                  { value: 'medium.en', label: 'Medium English (1.5 GB, most accurate)' },
                ]} />
              <p className="text-xs text-vaani-gray-400 mt-1.5">
                Models are downloaded on first use. Larger models are more accurate but slower.
              </p>
            </div>
          )}
        </div>
      )}

      {activeSection === 'language' && (
        <div className="space-y-4">
          <Select value={settings.language} onChange={(v) => updateSettings({ language: v })} options={languages} />
          <div className="flex items-center justify-between py-3">
            <div><div className="text-sm font-medium text-vaani-black dark:text-white">Smart Punctuation</div><div className="text-xs text-vaani-gray-400">Auto-add periods, commas, and capitalization</div></div>
            <Toggle checked={settings.smartPunctuation} onChange={(v) => updateSettings({ smartPunctuation: v })} />
          </div>
          <div className="flex items-center justify-between py-3">
            <div><div className="text-sm font-medium text-vaani-black dark:text-white">Cleanup</div><div className="text-xs text-vaani-gray-400">Remove filler words and apply corrections</div></div>
            <Toggle checked={settings.cleanupEnabled} onChange={(v) => updateSettings({ cleanupEnabled: v })} />
          </div>
        </div>
      )}

      {activeSection === 'dictation' && (
        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Dictation Mode</label>
            <div className="space-y-2">
              {dictationModes.map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => updateSettings({ dictationMode: mode.id as typeof settings.dictationMode })}
                  className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                    settings.dictationMode === mode.id ? 'border-vaani-pink bg-vaani-pink/5' : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300'
                  }`}
                >
                  <div><div className="text-sm font-medium">{mode.label}</div><div className="text-xs text-vaani-gray-400">{mode.description}</div></div>
                  {settings.dictationMode === mode.id && <div className="w-5 h-5 bg-vaani-pink rounded-full flex items-center justify-center"><Check size={12} className="text-white" /></div>}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between py-3">
            <div><div className="text-sm font-medium">Save Recordings</div><div className="text-xs text-vaani-gray-400">Save WAV files to disk for replay</div></div>
            <Toggle checked={settings.saveRecordings} onChange={(v) => updateSettings({ saveRecordings: v })} />
          </div>

          <div className="flex items-center justify-between p-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 rounded-xl">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-vaani-gray-500" />
              <div><div className="text-sm">System Default Microphone</div><div className="text-xs text-vaani-gray-400">Vaani uses your system mic</div></div>
            </div>
            <HardDrive size={14} className="text-vaani-gray-400" />
          </div>
        </div>
      )}

      {activeSection === 'hotkey' && (
        <div className="space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Primary Dictation Hotkey</label>
              <HotkeyCapture value={settings.primaryHotkey} onChange={(v) => updateSettings({ primaryHotkey: v })} />
              <p className="text-xs text-vaani-gray-400 mt-1.5 flex items-center gap-1.5">
                <AlertTriangle size={10} /> Fn key detection is hardware-dependent. Test after changing.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Paste Latest Hotkey</label>
              <HotkeyCapture value={settings.pasteLatestHotkey} onChange={(v) => updateSettings({ pasteLatestHotkey: v })} />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'injection' && (
        <div className="space-y-4">
          <div className="space-y-2">
            {injectionModes.map((mode) => (
              <button
                key={mode.id}
                onClick={() => updateSettings({ injectionMode: mode.id as typeof settings.injectionMode })}
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${settings.injectionMode === mode.id ? 'border-vaani-pink bg-vaani-pink/5' : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300'}`}
              >
                <div><div className="text-sm font-medium">{mode.label}</div><div className="text-xs text-vaani-gray-400">{mode.description}</div></div>
                {settings.injectionMode === mode.id && <div className="w-5 h-5 bg-vaani-pink rounded-full flex items-center justify-center"><Check size={12} className="text-white" /></div>}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between py-3">
            <div><div className="text-sm font-medium">Paste Mode</div><div className="text-xs text-vaani-gray-400">Animated typing or instant paste</div></div>
            <Select value={settings.pasteMode} onChange={(v) => updateSettings({ pasteMode: v as 'instant' | 'animated' })}
              options={[{ value: 'animated', label: 'Animated' }, { value: 'instant', label: 'Instant' }]} />
          </div>
        </div>
      )}

      {activeSection === 'appearance' && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Theme</label>
            <div className="flex items-center gap-2">
              <button onClick={() => { if (theme === 'dark') toggleTheme(); updateSettings({ colorMode: 'light' }) }}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${theme === 'light' ? 'border-vaani-pink bg-vaani-pink/5' : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300'}`}>
                <Sun size={16} /> <span className="text-sm font-medium">Light</span>
              </button>
              <button onClick={() => { if (theme === 'light') toggleTheme(); updateSettings({ colorMode: 'dark' }) }}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${theme === 'dark' ? 'border-vaani-pink bg-vaani-pink/5' : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300'}`}>
                <Moon size={16} /> <span className="text-sm font-medium">Dark</span>
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">Accent Color</label>
            <div className="flex flex-wrap items-center gap-3">
              {accentColors.map((color) => (
                <button key={color.id} onClick={() => updateSettings({ accentColor: color.id })}
                  className={`w-10 h-10 ${color.color} rounded-xl transition-all ${settings.accentColor === color.id ? 'ring-2 ring-vaani-black dark:ring-white ring-offset-2 scale-110' : 'hover:scale-105'}`}
                  title={color.label} />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input type="text" value={customHex} onChange={(e) => setCustomHex(e.target.value)}
                onBlur={(e) => { const val = e.target.value; if (/^#[0-9A-Fa-f]{6}$/.test(val)) updateSettings({ accentColor: val }); else setCustomHex(settings.accentColor) }}
                placeholder="#7C3AED" className="w-32 pl-3 pr-3 py-2 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink font-mono uppercase" />
              <div className="w-8 h-8 rounded-lg border border-vaani-gray-200 dark:border-vaani-gray-600" style={{ backgroundColor: settings.accentColor }} />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'system' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-medium">Show in Dock</div><div className="text-xs text-vaani-gray-400">Display app icon in macOS dock</div></div>
            <Toggle checked={settings.showInDock} onChange={(v) => updateSettings({ showInDock: v })} />
          </div>
          <div className="h-px bg-vaani-gray-200 dark:bg-vaani-gray-700" />
          <div className="flex items-center justify-between">
            <div><div className="text-sm font-medium">Launch at Login</div><div className="text-xs text-vaani-gray-400">Start Vaani when you log in</div></div>
            <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
          </div>
        </div>
      )}

      {activeSection === 'audio' && (
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Minimum Clip Duration</label>
              <span className="text-xs text-vaani-gray-400">{settings.minClipDuration}s</span>
            </div>
            <input type="range" min="0.1" max="3" step="0.1" value={settings.minClipDuration}
              onChange={(e) => updateSettings({ minClipDuration: Number(e.target.value) })}
              className="w-full h-1.5 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-full appearance-none cursor-pointer accent-vaani-pink" />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Silence Threshold</label>
              <span className="text-xs text-vaani-gray-400">{Math.round(settings.silenceThreshold * 100)}%</span>
            </div>
            <input type="range" min="0" max="1" step="0.01" value={settings.silenceThreshold}
              onChange={(e) => updateSettings({ silenceThreshold: Number(e.target.value) })}
              className="w-full h-1.5 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-full appearance-none cursor-pointer accent-vaani-pink" />
          </div>
        </div>
      )}

      {activeSection === 'data' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button onClick={handleExportData} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-vaani-gray-100 dark:bg-vaani-gray-800 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-xl text-sm font-medium transition-colors">
                <Download size={14} /> Export Data
              </button>
              <button onClick={() => { void clearHistory() }} className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl text-sm font-medium text-red-600 transition-colors">
                <Trash2 size={14} /> Clear All History
              </button>
            </div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-500 mt-0.5" />
              <div>
                <div className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">Reset to Defaults</div>
                <p className="text-sm text-red-600 dark:text-red-300 mb-3">This will reset all settings. History will not be affected.</p>
                <button onClick={() => { void resetSettings() }} className="px-4 py-2 bg-white dark:bg-vaani-gray-800 border border-red-200 dark:border-red-700 rounded-xl text-sm font-medium text-red-600 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
                  Reset Settings
                </button>
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
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-4xl h-[80vh] bg-white dark:bg-vaani-gray-900 rounded-3xl shadow-2xl overflow-hidden flex"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-64 bg-vaani-gray-50 dark:bg-vaani-gray-800/50 border-r border-vaani-gray-200 dark:border-vaani-gray-700 flex flex-col shrink-0">
              <div className="p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-700">
                <h2 className="text-xl font-bold text-vaani-black dark:text-white">Settings</h2>
                <p className="text-xs text-vaani-gray-400 mt-1">Configure Vaani</p>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {sidebarItems.map((item) => {
                  const Icon = item.icon
                  return (
                    <button key={item.id} onClick={() => setActiveSection(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                        activeSection === item.id ? 'bg-vaani-pink text-white' : 'text-vaani-gray-600 dark:text-vaani-gray-300 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-700/50'
                      }`}
                    >
                      <Icon size={16} /> {item.label}
                    </button>
                  )
                })}
              </nav>
            </div>
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-700">
                <div>
                  <h3 className="text-xl font-bold">{sidebarItems.find((s) => s.id === activeSection)?.label}</h3>
                  <p className="text-xs text-vaani-gray-400 mt-1">{sectionDescriptions[activeSection]}</p>
                </div>
                <button onClick={onClose} className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-700 rounded-xl transition-colors">
                  <X size={18} className="text-vaani-gray-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <motion.div key={activeSection} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }}>
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
