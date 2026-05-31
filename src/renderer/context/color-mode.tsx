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
    // Suppress all transitions while the theme class flips to avoid
    // hundreds of elements animating simultaneously (causes lag).
    const style = document.createElement('style')
    style.textContent = '*,*::before,*::after{transition:none!important}'
    document.head.appendChild(style)
    document.documentElement.classList.toggle('dark', mode === 'dark')
    // One rAF is enough for the browser to apply the class before we re-enable transitions.
    requestAnimationFrame(() => { document.head.removeChild(style) })
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
