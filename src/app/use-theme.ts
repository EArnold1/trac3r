import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dark'

export const THEME_KEY = 'tracer-theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

function readSaved(): Theme | null {
  try {
    const saved = window.localStorage.getItem(THEME_KEY)
    return saved === 'light' || saved === 'dark' ? saved : null
  } catch {
    // Storage can be blocked, for example in a private window.
    return null
  }
}

function systemTheme(): Theme {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

/**
 * The color theme: the saved choice if there is one, otherwise the system setting, which it then
 * follows. It is written to `data-theme` on <html>, so menus and tooltips that render outside the
 * app root get the same tokens.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(() => readSaved() ?? systemTheme())

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY)
    function onChange() {
      if (readSaved() === null) setTheme(systemTheme())
    }
    query.addEventListener('change', onChange)
    return () => {
      query.removeEventListener('change', onChange)
    }
  }, [])

  const toggle = useCallback(() => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try {
      window.localStorage.setItem(THEME_KEY, next)
    } catch {
      // The choice still applies for this visit.
    }
  }, [theme])

  return { theme, toggle }
}
