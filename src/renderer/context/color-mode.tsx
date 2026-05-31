import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Mode = 'light' | 'dark'

const ColorModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void; toggle: () => void }>({
  mode: 'light',
  setMode: () => {},
  toggle: () => {},
})

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => {
    try {
      const cur = localStorage.getItem('vaani-color-mode')
      if (cur === 'dark' || cur === 'light') return cur
      // Migrate from old ThemeContext key
      const legacy = localStorage.getItem('vaani-theme')
      if (legacy === 'dark' || legacy === 'light') return legacy
    } catch { /* storage unavailable */ }
    return 'light'
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    try { localStorage.setItem('vaani-color-mode', mode) } catch { /* no-op */ }
  }, [mode])

  return (
    <ColorModeContext.Provider value={{ mode, setMode, toggle: () => setMode((m) => (m === 'light' ? 'dark' : 'light')) }}>
      {children}
    </ColorModeContext.Provider>
  )
}

export function useColorMode() {
  return useContext(ColorModeContext)
}
