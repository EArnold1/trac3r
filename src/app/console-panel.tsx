import { Badge } from '@/components/ui/badge'
import type { Step } from '@/engine/types'
import { cn } from '@/lib/utils'
import { Panel } from './panel'
import type { RunState } from './reducer'

interface ConsolePanelProps {
  run: RunState
  /** The step being viewed; the console shows what was printed up to it. */
  step: Step | null
}

/** Console lines up to the current step. The full output is part of the run result. */
export function ConsolePanel({ run, step }: ConsolePanelProps) {
  const lines = step?.output ?? []
  const levels = run.status === 'done' ? run.run.output : []
  return (
    <Panel title="Console" caption="Up to this step">
      {lines.length === 0 ? (
        <p className="px-4 py-2.5 font-mono text-dense text-muted-foreground">Nothing printed</p>
      ) : (
        <ol
          // Long output scrolls inside the panel; the tab stop lets the keyboard scroll it.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="flex max-h-36 scroll-thin flex-col overflow-y-auto py-2 font-mono text-dense"
        >
          {lines.map((text, i) => {
            const level = levels[i]?.level ?? 'log'
            const newest = step?.kind === 'output' && i === lines.length - 1
            return (
              <li
                key={i}
                className={cn(
                  'flex items-baseline justify-between gap-3 px-4 py-0.5',
                  newest && 'bg-accent',
                  level === 'error' && 'text-destructive',
                )}
              >
                <span className="break-all whitespace-pre-wrap">{text}</span>
                {level !== 'log' && (
                  <Badge variant={level === 'error' ? 'destructive' : 'secondary'}>{level}</Badge>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </Panel>
  )
}
