import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Key,
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
  Pencil,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useTheme } from '../contexts/ThemeContext'
import { useVaaniUi } from '../context/vaani-ui'
import { HotkeyCapture } from './HotkeyCapture'

const sidebarItems = [
  { id: 'api', label: 'API Key', icon: Key },
  { id: 'language', label: 'Language', icon: Globe },
  { id: 'microphone', label: 'Microphone', icon: Mic },
  { id: 'hotkey', label: 'Hotkey', icon: Keyboard },
  { id: 'injection', label: 'Injection Mode', icon: Type },
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'data', label: 'Data', icon: Database },
]

const sectionDescriptions: Record<string, string> = {
  api: 'Your Groq API key for transcription',
  language: 'Spoken language for transcription',
  microphone: 'Input device and audio settings',
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
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm text-vaani-black dark:text-white hover:border-vaani-gray-300 dark:hover:border-vaani-gray-500 transition-colors"
      >
        {options.find((o) => o.value === value)?.label ?? value}
        <ChevronRight
          size={14}
          className={`text-vaani-gray-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
        />
      </button>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
          <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto">
            {options.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  onChange(opt.value)
                  setIsOpen(false)
                }}
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
  const [showApiKey, setShowApiKey] = useState(false)
  const [isEditingApiKey, setIsEditingApiKey] = useState(false)
  const [customHex, setCustomHex] = useState(settings.accentColor)

  useEffect(() => {
    setCustomHex(settings.accentColor)
  }, [settings.accentColor])

  if (!isOpen) return null

  const handleExportData = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      settings,
      history: historyEntries,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vaani-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sectionContent = (
    <div className="space-y-6">
      {activeSection === 'api' && (
        <div className="space-y-4">
          <div className="relative">
            <input
              type={showApiKey ? 'text' : 'password'}
              value={settings.groqApiKey}
              onChange={(e) => updateSettings({ groqApiKey: e.target.value })}
              placeholder="gsk_..."
              readOnly={!isEditingApiKey}
              className={cn(
                "w-full pl-4 pr-24 py-3 rounded-xl text-sm outline-none transition-all font-mono placeholder:text-vaani-gray-400",
                isEditingApiKey
                  ? "bg-vaani-gray-50 dark:bg-vaani-gray-800 border-2 border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20"
                  : "bg-vaani-gray-100 dark:bg-vaani-gray-700 border border-vaani-gray-300 dark:border-vaani-gray-600 text-vaani-black dark:text-white cursor-not-allowed opacity-75"
              )}
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
              <button
                onClick={() => setIsEditingApiKey(!isEditingApiKey)}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  isEditingApiKey
                    ? "bg-vaani-pink/10 hover:bg-vaani-pink/20"
                    : "bg-vaani-gray-200 dark:bg-vaani-gray-600 hover:bg-vaani-gray-300 dark:hover:bg-vaani-gray-500"
                )}
                title={isEditingApiKey ? 'Lock editing' : 'Enable editing'}
              >
                <Pencil size={16} className={isEditingApiKey ? 'text-vaani-pink' : 'text-vaani-gray-600 dark:text-vaani-gray-300'} />
              </button>
              <button
                onClick={() => setShowApiKey(!showApiKey)}
                className="p-2 bg-vaani-gray-200 dark:bg-vaani-gray-600 hover:bg-vaani-gray-300 dark:hover:bg-vaani-gray-500 rounded-lg transition-colors"
              >
                {showApiKey ? (
                  <EyeOff size={16} className="text-vaani-gray-600 dark:text-vaani-gray-300" />
                ) : (
                  <Eye size={16} className="text-vaani-gray-600 dark:text-vaani-gray-300" />
                )}
              </button>
            </div>
          </div>
          <p className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
            Click the edit icon to enable editing. Your API key is stored securely in the macOS keychain.
          </p>
        </div>
      )}

      {activeSection === 'language' && (
        <div className="space-y-4">
          <Select
            value={settings.language}
            onChange={(v) => updateSettings({ language: v })}
            options={languages}
          />
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-vaani-black dark:text-white">Smart Punctuation</div>
              <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">Auto-add periods, commas, and capitalization</div>
            </div>
            <Toggle checked={settings.smartPunctuation} onChange={(v) => updateSettings({ smartPunctuation: v })} />
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-vaani-black dark:text-white">Cleanup</div>
              <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">Remove filler words and apply corrections</div>
            </div>
            <Toggle checked={settings.cleanupEnabled} onChange={(v) => updateSettings({ cleanupEnabled: v })} />
          </div>
        </div>
      )}

      {activeSection === 'microphone' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-vaani-gray-50 dark:bg-vaani-gray-800 rounded-xl">
            <div className="flex items-center gap-3">
              <Mic size={16} className="text-vaani-gray-500" />
              <span className="text-sm text-vaani-black dark:text-white">System Default Microphone</span>
            </div>
            <Toggle checked={true} onChange={() => {}} />
          </div>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-vaani-black dark:text-white">Minimum Clip Duration</label>
                <span className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">{settings.minClipDuration}s</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="3"
                step="0.1"
                value={settings.minClipDuration}
                onChange={(e) => updateSettings({ minClipDuration: Number(e.target.value) })}
                className="w-full h-1.5 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-full appearance-none cursor-pointer accent-vaani-pink"
              />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'hotkey' && (
        <div className="space-y-4">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
                Primary Dictation Hotkey
              </label>
              <HotkeyCapture
                value={settings.primaryHotkey}
                onChange={(v) => updateSettings({ primaryHotkey: v })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
                Paste Latest Hotkey
              </label>
              <HotkeyCapture
                value={settings.pasteLatestHotkey}
                onChange={(v) => updateSettings({ pasteLatestHotkey: v })}
              />
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
                className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left ${
                  settings.injectionMode === mode.id
                    ? 'border-vaani-pink bg-vaani-pink/5 dark:bg-vaani-pink/10'
                    : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-500'
                }`}
              >
                <div>
                  <div className="text-sm font-medium text-vaani-black dark:text-white">
                    {mode.label}
                  </div>
                  <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
                    {mode.description}
                  </div>
                </div>
                {settings.injectionMode === mode.id && (
                  <div className="w-5 h-5 bg-vaani-pink rounded-full flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm font-medium text-vaani-black dark:text-white">Paste Mode</div>
              <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">Animated typing or instant paste</div>
            </div>
            <Select
              value={settings.pasteMode}
              onChange={(v) => updateSettings({ pasteMode: v as 'instant' | 'animated' })}
              options={[
                { value: 'animated', label: 'Animated' },
                { value: 'instant', label: 'Instant' },
              ]}
            />
          </div>
        </div>
      )}

      {activeSection === 'appearance' && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
              Theme
            </label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => { if (theme === 'dark') toggleTheme(); updateSettings({ colorMode: 'light' }); }}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                  theme === 'light'
                    ? 'border-vaani-pink bg-vaani-pink/5 dark:bg-vaani-pink/10'
                    : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-500'
                }`}
              >
                <Sun size={16} className="text-vaani-black dark:text-white" />
                <span className="text-sm font-medium text-vaani-black dark:text-white">Light</span>
              </button>
              <button
                onClick={() => { if (theme === 'light') toggleTheme(); updateSettings({ colorMode: 'dark' }); }}
                className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-xl border transition-all ${
                  theme === 'dark'
                    ? 'border-vaani-pink bg-vaani-pink/5 dark:bg-vaani-pink/10'
                    : 'border-vaani-gray-200 dark:border-vaani-gray-700 hover:border-vaani-gray-300 dark:hover:border-vaani-gray-500'
                }`}
              >
                <Moon size={16} className="text-vaani-black dark:text-white" />
                <span className="text-sm font-medium text-vaani-black dark:text-white">Dark</span>
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-vaani-gray-600 dark:text-vaani-gray-300 mb-2">
              Accent Color
            </label>
            <div className="flex flex-wrap items-center gap-3">
              {accentColors.map((color) => (
                <button
                  key={color.id}
                  onClick={() => updateSettings({ accentColor: color.id })}
                  className={`w-10 h-10 ${color.color} rounded-xl transition-all ${
                    settings.accentColor === color.id
                      ? 'ring-2 ring-vaani-black dark:ring-white ring-offset-2 scale-110'
                      : 'hover:scale-105'
                  }`}
                  title={color.label}
                />
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="text"
                value={customHex}
                onChange={(e) => setCustomHex(e.target.value)}
                onBlur={(e) => {
                  const val = e.target.value
                  if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                    updateSettings({ accentColor: val })
                  } else {
                    setCustomHex(settings.accentColor)
                  }
                }}
                placeholder="#7C3AED"
                className="w-32 pl-3 pr-3 py-2 bg-vaani-gray-50 dark:bg-vaani-gray-800 border border-vaani-gray-200 dark:border-vaani-gray-700 rounded-xl text-sm outline-none focus:border-vaani-pink focus:ring-2 focus:ring-vaani-pink/20 transition-all font-mono text-vaani-black dark:text-white placeholder:text-vaani-gray-400 uppercase"
              />
              <div
                className="w-8 h-8 rounded-lg border border-vaani-gray-200 dark:border-vaani-gray-600"
                style={{ backgroundColor: settings.accentColor }}
              />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'system' && (
        <div className="space-y-4">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-vaani-black dark:text-white">
                  Show in Dock
                </div>
                <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
                  Display app icon in macOS dock
                </div>
              </div>
              <Toggle checked={settings.showInDock} onChange={(v) => updateSettings({ showInDock: v })} />
            </div>
            <div className="h-px bg-vaani-gray-200 dark:bg-vaani-gray-700" />
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-vaani-black dark:text-white">
                  Launch at Login
                </div>
                <div className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
                  Start Vaani when you log in
                </div>
              </div>
              <Toggle checked={settings.launchAtLogin} onChange={(v) => updateSettings({ launchAtLogin: v })} />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'audio' && (
        <div className="space-y-4">
          <div className="space-y-5">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-vaani-black dark:text-white">
                  Silence Threshold
                </label>
                <span className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400">
                  {Math.round(settings.silenceThreshold * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                value={settings.silenceThreshold}
                onChange={(e) => updateSettings({ silenceThreshold: Number(e.target.value) })}
                className="w-full h-1.5 bg-vaani-gray-200 dark:bg-vaani-gray-700 rounded-full appearance-none cursor-pointer accent-vaani-pink"
              />
            </div>
          </div>
        </div>
      )}

      {activeSection === 'data' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleExportData}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-vaani-gray-100 dark:bg-vaani-gray-800 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-700 rounded-xl text-sm font-medium text-vaani-black dark:text-white transition-colors"
              >
                <Download size={14} />
                Export Data
              </button>
              <button
                onClick={() => { void clearHistory(); }}
                className="flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-xl text-sm font-medium text-red-600 transition-colors"
              >
                <Trash2 size={14} />
                Clear All History
              </button>
            </div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <AlertTriangle size={18} className="text-red-500 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-semibold text-red-700 dark:text-red-400 mb-1">
                  Reset to Defaults
                </div>
                <p className="text-sm text-red-600 dark:text-red-300 leading-relaxed mb-3">
                  This will reset all settings to their default values. Your history will not be affected.
                </p>
                <button
                  onClick={() => { void resetSettings(); }}
                  className="px-4 py-2 bg-white dark:bg-vaani-gray-800 border border-red-200 dark:border-red-700 rounded-xl text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                >
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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="w-full max-w-4xl h-[80vh] bg-white dark:bg-vaani-gray-900 rounded-3xl shadow-2xl overflow-hidden flex"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-64 bg-vaani-gray-50 dark:bg-vaani-gray-800/50 border-r border-vaani-gray-200 dark:border-vaani-gray-700 flex flex-col shrink-0">
              <div className="p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-700">
                <h2 className="text-xl font-bold text-vaani-black dark:text-white">Settings</h2>
                <p className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400 mt-1">
                  Configure Vaani
                </p>
              </div>
              <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
                {sidebarItems.map((item) => {
                  const Icon = item.icon
                  const isActive = activeSection === item.id
                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveSection(item.id)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                        isActive
                          ? 'bg-vaani-pink text-white'
                          : 'text-vaani-gray-600 dark:text-vaani-gray-300 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-700/50'
                      }`}
                    >
                      <Icon size={16} />
                      {item.label}
                    </button>
                  )
                })}
              </nav>
            </div>

            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-700">
                <div>
                  <h3 className="text-xl font-bold text-vaani-black dark:text-white">
                    {sidebarItems.find((s) => s.id === activeSection)?.label}
                  </h3>
                  <p className="text-xs text-vaani-gray-500 dark:text-vaani-gray-400 mt-1">
                    {sectionDescriptions[activeSection]}
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-700 rounded-xl transition-colors"
                >
                  <X size={18} className="text-vaani-gray-500" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.2 }}
                >
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
