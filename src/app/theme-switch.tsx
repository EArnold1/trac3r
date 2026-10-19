import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Theme } from './use-theme'

interface ThemeSwitchProps {
  theme: Theme
  onToggle: () => void
}

/** A pill switch with a sun on the left and a moon on the right. */
export function ThemeSwitch({ theme, onToggle }: ThemeSwitchProps) {
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      onClick={onToggle}
      className="relative h-11 w-19 flex-none rounded-full border border-input bg-secondary transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-1.25 left-1.25 size-8 rounded-full border border-border bg-card transition-transform duration-150 motion-reduce:transition-none',
          dark && 'translate-x-8',
        )}
      />
      <Sun
        aria-hidden="true"
        className={cn(
          'absolute top-3 left-3 size-4.5',
          dark ? 'text-muted-foreground' : 'text-primary',
        )}
      />
      <Moon
        aria-hidden="true"
        className={cn(
          'absolute top-3 left-11 size-4.5',
          dark ? 'text-primary' : 'text-muted-foreground',
        )}
      />
    </button>
  )
}
