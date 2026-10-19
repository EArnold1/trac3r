// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeSwitch } from '../../src/app/theme-switch'
import { THEME_KEY, useTheme } from '../../src/app/use-theme'

type Listener = () => void
let systemDark = false
let listeners: Listener[] = []

beforeEach(() => {
  systemDark = false
  listeners = []
  window.localStorage.clear()
  delete document.documentElement.dataset.theme
  vi.stubGlobal('matchMedia', (query: string): Partial<MediaQueryList> => ({
    matches: query.includes('dark') && systemDark,
    addEventListener: (_type: string, listener: unknown) => {
      listeners.push(listener as Listener)
    },
    removeEventListener: (_type: string, listener: unknown) => {
      listeners = listeners.filter((l) => l !== listener)
    },
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useTheme', () => {
  it('starts from the system setting', () => {
    systemDark = true
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('is light when the system is light', () => {
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('prefers a saved choice to the system setting', () => {
    systemDark = true
    window.localStorage.setItem(THEME_KEY, 'light')
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light')
  })

  it('ignores a saved value it does not know', () => {
    window.localStorage.setItem(THEME_KEY, 'sepia')
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light')
  })

  it('toggles, applies the change to the page and remembers it', () => {
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.toggle()
    })
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark')
    act(() => {
      result.current.toggle()
    })
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light')
  })

  it('follows the system while there is no saved choice, and stops once there is one', () => {
    const { result } = renderHook(() => useTheme())
    systemDark = true
    act(() => {
      listeners.forEach((listener) => {
        listener()
      })
    })
    expect(result.current.theme).toBe('dark')

    act(() => {
      result.current.toggle()
    })
    systemDark = false
    act(() => {
      listeners.forEach((listener) => {
        listener()
      })
    })
    expect(result.current.theme).toBe('light')
  })

  it('still switches when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    const { result } = renderHook(() => useTheme())
    act(() => {
      result.current.toggle()
    })
    expect(result.current.theme).toBe('dark')
    vi.restoreAllMocks()
  })
})

describe('ThemeSwitch', () => {
  it('is a switch named Dark mode that reflects the theme', () => {
    const { rerender } = render(<ThemeSwitch theme="light" onToggle={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    rerender(<ThemeSwitch theme="dark" onToggle={vi.fn()} />)
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toHaveAttribute(
      'aria-checked',
      'true',
    )
  })

  it('asks to toggle when pressed', () => {
    const onToggle = vi.fn()
    render(<ThemeSwitch theme="light" onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(onToggle).toHaveBeenCalledOnce()
  })
})
