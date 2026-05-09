import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

interface ThemeContextType {
  theme: 'light' | 'dark'
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'light',
  toggleTheme: () => {},
})

export function ThemeProvider({ children, colorMode }: { children: ReactNode; colorMode?: 'light' | 'dark' }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (colorMode === 'dark' || colorMode === 'light') return colorMode
    const stored = localStorage.getItem('vaani-theme')
    if (stored === 'dark' || stored === 'light') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })

  useEffect(() => {
    if (colorMode === 'dark' || colorMode === 'light') {
      setTheme(colorMode)
    }
  }, [colorMode])

  useEffect(() => {
    localStorage.setItem('vaani-theme', theme)
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  const toggleTheme = () => setTheme((prev) => (prev === 'light' ? 'dark' : 'light'))

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  return useContext(ThemeContext)
}
