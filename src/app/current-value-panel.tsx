import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { describeFrame } from './derive'
import type { StepView } from './derive'
import { Narration } from './narration'
import { Panel } from './panel'
import type { RunState } from './reducer'

interface CurrentValuePanelProps {
  run: RunState
  view: StepView | null
  stepIndex: number
  stepTotal: number
}

function Placeholder({ children }: { children: string }) {
  return <p className="p-4 text-dense text-muted-foreground">{children}</p>
}

/** What the expression at this step produced, in words, and the variables of the chosen frame. */
export function CurrentValuePanel({ run, view, stepIndex, stepTotal }: CurrentValuePanelProps) {
  const caption = view ? (
    <Badge variant="secondary">
      Step {stepIndex + 1} of {stepTotal} · line {view.step.loc.line}
    </Badge>
  ) : undefined
  const className = 'min-w-0 flex-1'

  if (!view) {
    return (
      <Panel title="Current value" caption={caption} className={className}>
        <Placeholder>
          {run.status === 'done'
            ? 'Nothing was traced, so there are no steps to show.'
            : 'Run the code, then step through it to see each value here.'}
        </Placeholder>
      </Panel>
    )
  }

  const { step, frame } = view
  const isError = step.kind === 'error'
  const variables = frame ? Object.entries(frame.vars) : []

  return (
    <Panel title="Current value" caption={caption} className={className}>
      <div className="flex flex-col gap-1.5 px-4 pt-2.5 pb-3">
        {/* One line: the expression, what it gave, and the type. */}
        <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
          {step.expr !== undefined && (
            <code className="rounded-sm bg-accent px-1.5 font-mono text-[16px]/7 break-all">
              {step.filled ?? step.expr}
            </code>
          )}
          {step.value ? (
            <>
              {step.expr !== undefined && (
                <ArrowRight aria-label="gives" className="size-4.5 text-muted-foreground" />
              )}
              <span
                className={cn(
                  'font-mono text-[28px]/9 font-semibold break-all',
                  isError && 'text-destructive',
                )}
              >
                {step.value.text}
              </span>
              <Badge variant="secondary">{step.value.type}</Badge>
            </>
          ) : (
            step.expr !== undefined && <Badge variant="secondary">{step.kind} · no value yet</Badge>
          )}
        </div>
        <p className="text-body">
          <Narration text={step.text} />
        </p>
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="text-label text-muted-foreground">
            {frame
              ? `Variables in ${describeFrame(frame)}${view.frameIsFinal ? ' (as it ended)' : ''}`
              : 'Variables'}
          </span>
          {variables.length === 0 && (
            <span className="text-label text-muted-foreground">No variables yet.</span>
          )}
          {variables.map(([name, value]) => {
            const change = view.changes.get(name)
            return (
              <span
                key={name}
                className="inline-flex max-w-full items-center gap-2 rounded-full border border-border px-2.5 py-0.5 font-mono text-label"
              >
                <span className="text-muted-foreground">{name}</span>
                <span className="truncate font-semibold">{value.text}</span>
                {change && (
                  <Badge variant="changed" className="-mr-1.5 font-sans">
                    {view.frameIsNew ? 'new in this call' : change === 'new' ? 'new' : 'changed'}
                  </Badge>
                )}
              </span>
            )
          })}
        </div>
      </div>
    </Panel>
  )
}
