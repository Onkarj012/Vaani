import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Mode = 'light' | 'dark'

const ColorModeContext = createContext<{ mode: Mode; setMode: (m: Mode) => void; toggle: () => void }>({
  mode: 'light',
  setMode: () => {},
  toggle: () => {},
})

export function ColorModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('vaani-color-mode') === 'dark' ? 'dark' : 'light'))

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark')
    localStorage.setItem('vaani-color-mode', mode)
  }, [mode])

  return (
    <ColorModeContext.Provider value={{ mode, setMode, toggle: () => setMode(mode === 'light' ? 'dark' : 'light') }}>
      {children}
    </ColorModeContext.Provider>
  )
}

export function useColorMode() {
  return useContext(ColorModeContext)
}
