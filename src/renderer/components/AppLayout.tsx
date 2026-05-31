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
  BarChart3,
  Sun,
  Moon,
} from 'lucide-react'
import { useVaaniUi } from '../context/vaani-ui'
import { useColorMode } from '../context/color-mode'
import { useUpdateNotification } from '@renderer/hooks/useUpdateNotification'
import SettingsModal from '@renderer/components/SettingsModal'
import OnboardingModal from '@renderer/components/OnboardingModal'
import UpdateBanner from '@renderer/components/UpdateBanner'
import devanagariLightUrl from '../../../assets/iconset/devanagari/devanagari_light.svg?url'
import devanagariDarkUrl from '../../../assets/iconset/devanagari/devanagari_dark.svg?url'

const navItems = [
  { path: '/app', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/app/history', label: 'History', icon: History },
  { path: '/app/snippets', label: 'Snippets', icon: FileText },
  { path: '/app/dictionary', label: 'Dictionary', icon: BookOpen },
  { path: '/app/insights', label: 'Insights', icon: BarChart3 },
]

function Sidebar({ isOpen, onClose, onSettings }: { isOpen: boolean; onClose: () => void; onSettings: () => void }) {
  const location = useLocation()
  const { mode, toggle } = useColorMode()

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 lg:hidden"
            onClick={onClose}
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-[264px] flex-col border-r border-line bg-bg transition-transform duration-300 ease-out lg:translate-x-0 ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-7 pb-6 pt-12">
          <img src={mode === 'dark' ? devanagariDarkUrl : devanagariLightUrl} className="h-9 w-9" alt="Vaani" />
          <div className="leading-none">
            <span className="text-display text-2xl text-ink">Vaani</span>
            <span className="label-meta mt-1 block text-[9px] text-faint">Voice Dictation</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 px-4">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === '/app'}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all duration-200 ${
                  isActive
                    ? 'bg-accent/10 font-semibold text-accent'
                    : 'font-medium text-muted hover:bg-surface hover:text-ink'
                }`}
              >
                <Icon size={17} />
                {item.label}
              </NavLink>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="space-y-2 px-4 pb-6">
          <button
            onClick={toggle}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm font-medium text-muted transition-all hover:bg-surface hover:text-ink"
          >
            {mode === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            {mode === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </button>
          <button
            onClick={() => { onSettings(); onClose() }}
            className="flex w-full items-center gap-3 rounded-full px-4 py-2.5 text-left text-sm font-medium text-muted transition-all hover:bg-surface hover:text-ink"
          >
            <Settings size={17} />
            Settings
          </button>
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
    <div className="relative flex min-h-screen bg-bg">
      <Sidebar
        isOpen={isMobileMenuOpen}
        onClose={() => setIsMobileMenuOpen(false)}
        onSettings={() => setIsSettingsOpen(true)}
      />

      <div className="relative z-10 flex min-h-screen flex-1 flex-col overflow-hidden lg:ml-[264px]">
        <header className="flex h-14 shrink-0 items-center px-4 lg:hidden">
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            aria-label="Open navigation menu"
            aria-expanded={isMobileMenuOpen}
            className="rounded-full p-2 text-ink transition-colors hover:bg-surface"
          >
            <Menu size={20} />
          </button>
        </header>

        {notification && <UpdateBanner notification={notification} onDismiss={dismiss} />}

        <main className={`flex-1 px-6 py-8 lg:px-12 ${onboardingOpen ? 'touch-none overflow-hidden' : 'overflow-y-auto'}`}>
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
