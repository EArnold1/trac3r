import { Badge } from '@/components/ui/badge'
import type { Frame } from '@/engine/types'
import { cn } from '@/lib/utils'
import { describeFrame } from './derive'
import type { StepView } from './derive'
import { Panel } from './panel'

interface StackPanelProps {
  view: StepView | null
  onSelect: (id: number) => void
}

function subtitle(frame: Frame, isTop: boolean): string {
  if (frame.callLine === null) return isTop ? 'running · top level' : 'top level'
  const from = `called from line ${String(frame.callLine)}`
  return isTop ? `running · ${from}` : `waiting · ${from}`
}

/** Newest frame on top, indented by depth. Click a frame to see its variables. */
export function StackPanel({ view, onSelect }: StackPanelProps) {
  const stack = view?.step.stack ?? []
  const frames = [...stack].reverse()
  const selectedId = view && !view.frameIsFinal ? view.frame?.id : undefined

  return (
    <Panel
      title="Call stack"
      className="min-h-0 flex-1 max-[980px]:max-h-80 max-[980px]:flex-none"
      caption={`${String(stack.length)} ${stack.length === 1 ? 'frame' : 'frames'} · newest on top`}
    >
      <div className="flex min-h-0 flex-1 scroll-thin flex-col gap-1.5 overflow-y-auto px-3 pt-2.5 pb-3">
        {view?.popped && (
          <div
            style={{ '--depth': stack.length }}
            className="ml-[calc(var(--depth)*1rem)] flex flex-none items-center justify-between gap-2 rounded-lg border border-dashed border-input px-3 py-2 text-faint"
          >
            <span className="font-mono text-dense line-through">
              {describeFrame(view.popped.frame)}
            </span>
            <span className="text-label">
              returned <span className="font-mono">{view.popped.value?.text ?? 'undefined'}</span>
            </span>
          </div>
        )}
        {frames.length === 0 && (
          <p className="text-dense text-muted-foreground">
            {view ? 'No frames: the program has finished.' : 'Nothing is running.'}
          </p>
        )}
        {frames.map((frame, i) => {
          const depth = stack.length - 1 - i
          const isTop = i === 0
          const selected = frame.id === selectedId
          return (
            <button
              key={frame.id}
              type="button"
              aria-pressed={selected}
              onClick={() => {
                onSelect(frame.id)
              }}
              style={{ '--depth': depth }}
              className={cn(
                'ml-[calc(var(--depth)*1rem)] flex w-[calc(100%-var(--depth)*1rem)] flex-none flex-wrap items-center justify-between gap-x-2 gap-y-0.5 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
                selected ? 'border-primary bg-accent' : 'border-input bg-card hover:bg-muted',
                frame.id === view?.pushedFrameId && 'frame-pushed',
              )}
            >
              <span className={cn('font-mono text-dense break-words', selected && 'font-semibold')}>
                {describeFrame(frame)}
              </span>
              <span
                className={cn(
                  'text-label whitespace-nowrap',
                  selected ? 'text-accent-ink' : 'text-muted-foreground',
                )}
              >
                {subtitle(frame, isTop)}
              </span>
              {frame.id === view?.pushedFrameId && <Badge variant="changed">new</Badge>}
            </button>
          )
        })}
      </div>
    </Panel>
  )
}
