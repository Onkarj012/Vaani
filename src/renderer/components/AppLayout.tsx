import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  LayoutDashboard,
  History,
  FileText,
  BookOpen,
  Settings,
  Menu,
  ChevronRight,
  Moon,
  Sun,
  Sparkles,
  BarChart3,
} from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import { useVaaniUi } from '../context/vaani-ui'
import { useUpdateNotification } from '../hooks/useUpdateNotification'
import SettingsModal from './SettingsModal'
import OnboardingModal from './OnboardingModal'
import UpdateBanner from './UpdateBanner'
import devanagariDarkUrl from '../../../assets/iconset/devanagari/devanagari_dark.svg?url'
import devanagariLightUrl from '../../../assets/iconset/devanagari/devanagari_light.svg?url'

const navItems = [
  { path: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/app/history', label: 'History', icon: History },
  { path: '/app/snippets', label: 'Snippets', icon: FileText },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen },
  { path: '/app/insights', label: 'Insights', icon: BarChart3 },
]

function VaaniIcon({ className = '' }: { className?: string }) {
  const { theme } = useTheme()
  return (
    <img
      src={theme === 'dark' ? devanagariDarkUrl : devanagariLightUrl}
      className={className}
      alt="Vaani"
    />
  )
}

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <motion.button
      whileTap={{ scale: 0.95 }}
      onClick={toggleTheme}
      className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800/50 transition-all text-left text-sm text-vaani-gray-600 dark:text-vaani-gray-300"
    >
      <AnimatePresence mode="wait">
        <motion.div key={theme} initial={{ rotate: -90, scale: 0 }} animate={{ rotate: 0, scale: 1 }} exit={{ rotate: 90, scale: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </motion.div>
      </AnimatePresence>
      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
    </motion.button>
  )
}

function Sidebar({ isOpen, onClose, onSettings }: { isOpen: boolean; onClose: () => void; onSettings: () => void }) {
  const location = useLocation()

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside className={`fixed lg:fixed top-0 left-0 h-screen w-[280px] bg-white dark:bg-vaani-black border-r border-vaani-gray-200 dark:border-vaani-gray-800 z-50 flex flex-col transition-transform duration-300 ease-out lg:translate-x-0 pt-4 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6 border-b border-vaani-gray-200 dark:border-vaani-gray-800 shrink-0">
          <div className="flex items-center gap-3 group">
            <motion.div whileHover={{ rotate: 10, scale: 1.1 }} transition={{ type: 'spring', stiffness: 300 }}>
              <VaaniIcon className="w-10 h-10 transition-colors" />
            </motion.div>
            <div>
              <span className="font-display text-2xl tracking-wide text-vaani-black dark:text-white transition-colors">VAANI</span>
              <span className="block text-xs text-vaani-gray-500 -mt-1">Voice Dictation</span>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-hidden">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/app'}
                onClick={onClose}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-vaani-pink text-white shadow-lg shadow-vaani-pink/20'
                    : 'text-vaani-gray-500 dark:text-vaani-gray-400 hover:text-vaani-black dark:hover:text-white hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800'
                }`}
              >
                <motion.div whileHover={{ rotate: isActive ? 0 : 8, scale: isActive ? 1 : 1.1 }} transition={{ type: 'spring', stiffness: 300 }}>
                  <Icon size={18} />
                </motion.div>
                {item.label}
                {isActive && (
                  <motion.div layoutId="sidebar-indicator" className="ml-auto">
                    <ChevronRight size={14} />
                  </motion.div>
                )}
              </NavLink>
            )
          })}
        </nav>

        <div className="p-4 border-t border-vaani-gray-200 dark:border-vaani-gray-800 space-y-3 shrink-0">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-3 px-4 py-3 bg-vaani-gray-100 dark:bg-vaani-gray-800/50 rounded-xl"
          >
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 2, repeat: Infinity }} className="w-2 h-2 bg-vaani-lime rounded-full" />
            <span className="text-sm text-vaani-gray-500 dark:text-vaani-gray-400">Ready to dictate</span>
            <motion.div animate={{ rotate: [0, 15, -15, 0] }} transition={{ duration: 3, repeat: Infinity }} className="ml-auto">
              <Sparkles size={14} className="text-vaani-lime" />
            </motion.div>
          </motion.div>

          <div className="space-y-1">
            <ThemeToggle />
            <button
              onClick={() => { onSettings(); onClose(); }}
              className="flex items-center gap-2 w-full px-3 py-2.5 rounded-xl hover:bg-vaani-gray-100 dark:hover:bg-vaani-gray-800/50 transition-all text-left text-sm text-vaani-gray-600 dark:text-vaani-gray-300"
            >
              <Settings size={16} />
              Settings
            </button>
          </div>
        </div>
      </aside>
    </>
  )
}

export default function AppLayout() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const { settings, settingsLoading, updateSettings } = useVaaniUi()
  const { notification, dismiss } = useUpdateNotification()
  const onboardingOpen = !settingsLoading && !settings.onboardingCompleted

  return (
    <div className="min-h-screen bg-vaani-gray-100 dark:bg-vaani-black flex relative">
      <Sidebar
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onSettings={() => setIsSettingsOpen(true)}
      />

      <div className="flex-1 pt-4 flex flex-col min-h-screen overflow-hidden lg:ml-[280px] relative z-10">
        <header className="h-14 flex items-center px-4 lg:hidden shrink-0 pt-2">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="p-2 hover:bg-vaani-gray-200 dark:hover:bg-vaani-gray-800 rounded-xl transition-colors"
          >
            <Menu size={20} className="text-vaani-black dark:text-white" />
          </button>
        </header>

        {notification && <UpdateBanner notification={notification} onDismiss={dismiss} />}

        <main
          className={`flex-1 p-6 lg:p-8 ${onboardingOpen ? "overflow-hidden touch-none" : "overflow-y-auto"}`}
        >
          <Outlet />
        </main>
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      {!settingsLoading && !settings.onboardingCompleted && (
        <OnboardingModal
          settings={settings}
          updateSettings={updateSettings}
          onComplete={() => updateSettings({ onboardingCompleted: true })}
        />
      )}
    </div>
  )
}
