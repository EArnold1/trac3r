import { Pencil, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EXAMPLES } from './examples'
import { ThemeSwitch } from './theme-switch'
import type { Theme } from './use-theme'

interface HeaderProps {
  exampleId: string
  canEdit: boolean
  theme: Theme
  onExample: (id: string) => void
  onEdit: () => void
  onRun: () => void
  onToggleTheme: () => void
}

/** The title, the example picker, Edit code, Run and the theme switch. */
export function Header(props: HeaderProps) {
  return (
    <header className="flex h-16 flex-none items-center justify-between gap-x-4 gap-y-3 px-6 max-[980px]:h-auto max-[980px]:flex-wrap max-[980px]:py-3">
      <div className="flex items-center gap-3">
        <svg
          aria-hidden="true"
          width="28"
          height="28"
          viewBox="0 0 28 28"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-primary"
        >
          <rect x="3" y="3" width="10" height="7" rx="2" />
          <rect x="9" y="11" width="10" height="7" rx="2" />
          <rect x="15" y="19" width="10" height="7" rx="2" />
        </svg>
        <h1 className="text-xl/7 font-semibold">exec-trac3r</h1>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="example" className="text-dense text-muted-foreground">
          Example
        </label>
        <Select value={props.exampleId} onValueChange={props.onExample}>
          <SelectTrigger id="example" className="w-44">
            <SelectValue placeholder="Your own code" />
          </SelectTrigger>
          <SelectContent>
            {EXAMPLES.map((example) => (
              <SelectItem key={example.id} value={example.id}>
                {example.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button type="button" variant="outline" disabled={!props.canEdit} onClick={props.onEdit}>
          <Pencil className="size-4" />
          Edit code
        </Button>
        <Button type="button" className="font-semibold" onClick={props.onRun}>
          <Play className="size-4 fill-current" />
          Run
        </Button>
        <span aria-hidden="true" className="h-7 w-px bg-border" />
        <ThemeSwitch theme={props.theme} onToggle={props.onToggleTheme} />
      </div>
    </header>
  )
}
