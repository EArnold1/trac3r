import { ChevronRight, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MAX_STEPS } from '@/engine/limits'
import type { RunResult } from '@/engine/types'
import { cn } from '@/lib/utils'
import { Narration } from './narration'
import { Panel } from './panel'
import type { RunState } from './reducer'
import { timeoutMessage } from './result-panel'
import { buildTraceTree, groupSummary, visibleRows } from './trace-tree'
import type { GroupChoices, VisibleRow } from './trace-tree'

interface TracePanelProps {
  run: RunState
  stepIndex: number
  groupChoices: GroupChoices
  onSelect: (index: number) => void
  onSetGroup: (id: number, open: boolean) => void
  onFoldToCurrent: () => void
  onExpandAll: (ids: readonly number[]) => void
}

function Banners({ run }: { run: RunResult }) {
  return (
    <>
      {run.status === 'timeout' && (
        <Alert variant="destructive">
          <AlertTitle>The run was stopped</AlertTitle>
          <AlertDescription>
            {timeoutMessage()}.{' '}
            {run.steps.length > 0 && `The first ${String(run.steps.length)} steps are shown.`}
          </AlertDescription>
        </Alert>
      )}
      {run.truncated && run.status !== 'timeout' && (
        <Alert>
          <AlertTitle>Only the first {String(MAX_STEPS)} steps are shown</AlertTitle>
          <AlertDescription>
            {run.status === 'error'
              ? 'The program took more steps than that before it failed, so the trace stops before the error. The error itself is in the result.'
              : 'The program took more steps than that. It ran to the end, so the result is correct.'}
          </AlertDescription>
        </Alert>
      )}
    </>
  )
}

/**
 * Scrolls the trace list, and only the list, just far enough to show the row. `scrollIntoView`
 * would also move the page, which on a narrow screen throws the header out of view.
 */
function keepInView(row: HTMLElement) {
  const list = row.parentElement
  if (!list) return
  const rowBox = row.getBoundingClientRect()
  const listBox = list.getBoundingClientRect()
  if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top
  else if (rowBox.bottom > listBox.bottom) list.scrollTop += rowBox.bottom - listBox.bottom
}

function Row({
  item,
  stepIndex,
  onSelect,
  onSetGroup,
}: {
  item: VisibleRow
  stepIndex: number
  onSelect: (index: number) => void
  onSetGroup: (id: number, open: boolean) => void
}) {
  const { row, open } = item
  const { step, group } = row
  const state = step.index === stepIndex ? 'current' : step.index < stepIndex ? 'past' : 'later'
  const current = state === 'current'

  const ref = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (current && ref.current) keepInView(ref.current)
  }, [current])

  return (
    <li
      ref={ref}
      style={{ '--indent': row.indent }}
      className={cn(
        'ml-[calc(var(--indent)*14px)] flex h-7.5 flex-none items-center rounded-md border-l-2',
        row.indent > 0 ? 'border-guide' : 'border-transparent',
        current && 'bg-accent inset-ring-1 inset-ring-primary',
      )}
    >
      {group ? (
        <button
          type="button"
          aria-label={`${open ? 'Fold' : 'Unfold'} ${group.label}`}
          aria-expanded={open}
          onClick={() => {
            onSetGroup(group.id, !open)
          }}
          className="flex size-7 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <ChevronRight
            aria-hidden="true"
            className={cn(
              'size-4 transition-transform motion-reduce:transition-none',
              open && 'rotate-90',
            )}
          />
        </button>
      ) : (
        <span aria-hidden="true" className="w-7 flex-none" />
      )}
      <button
        type="button"
        data-step={step.index + 1}
        aria-current={current ? 'step' : undefined}
        onClick={() => {
          onSelect(step.index)
        }}
        className={cn(
          'flex h-full min-w-0 flex-1 items-center gap-2 rounded-md pr-2.5 text-left text-label transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          current ? 'font-medium' : 'hover:bg-muted',
          state === 'later' && 'text-faint',
        )}
      >
        <span
          className={cn(
            'w-6 flex-none text-right',
            current ? 'font-semibold text-accent-ink' : state === 'past' && 'text-muted-foreground',
          )}
        >
          {step.index + 1}
        </span>
        <Badge
          variant={step.kind === 'error' ? 'destructive' : 'secondary'}
          className={cn(
            'w-14.5 flex-none px-0',
            current && 'bg-card',
            state === 'later' && 'bg-muted',
          )}
        >
          {step.kind}
        </Badge>
        <span className={cn('w-6 flex-none', current && 'text-accent-ink')}>L{step.loc.line}</span>
        <span className="block min-w-0 flex-1 truncate">
          <Narration text={step.text} />
        </span>
        <span
          className={cn(
            'max-w-50 flex-none truncate text-right font-mono',
            current && 'font-semibold',
          )}
        >
          {group ? groupSummary(group, stepIndex, open) : step.value?.text}
        </span>
      </button>
    </li>
  )
}

/**
 * Every step as a row, folded by call. A call is open while the current step is inside it, and
 * every other call is one row. Past steps are normal, the current one is highlighted, later ones dim.
 */
export function TracePanel({
  run,
  stepIndex,
  groupChoices,
  onSelect,
  onSetGroup,
  onFoldToCurrent,
  onExpandAll,
}: TracePanelProps) {
  const done = run.status === 'done' ? run.run : null
  const steps = done?.steps
  const tree = useMemo(() => buildTraceTree(steps ?? []), [steps])
  const rows = useMemo(
    () => visibleRows(tree, stepIndex, groupChoices),
    [tree, stepIndex, groupChoices],
  )
  const total = steps?.length ?? 0
  const hasCalls = tree.groups.size > 0

  const caption =
    done === null ? undefined : (
      <span className="inline-flex items-center gap-2">
        {`${String(total)} ${total === 1 ? 'step' : 'steps'}`}
        {hasCalls && (
          <>
            <Button type="button" variant="outline" size="sm" onClick={onFoldToCurrent}>
              <ChevronsDownUp aria-hidden="true" />
              Fold to current
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                onExpandAll([...tree.groups.keys()])
              }}
            >
              <ChevronsUpDown aria-hidden="true" />
              Expand all
            </Button>
          </>
        )}
      </span>
    )

  return (
    <Panel
      title="Execution trace"
      caption={caption}
      className="min-h-0 flex-1 max-[980px]:max-h-115 max-[980px]:flex-none"
      headerClassName={cn(hasCalls && 'py-1.5 pr-3')}
    >
      {done && (done.status === 'timeout' || done.truncated) && (
        <div className="flex flex-none flex-col gap-2 p-2 pb-0">
          <Banners run={done} />
        </div>
      )}
      {run.status === 'idle' && (
        <p className="p-4 text-dense text-muted-foreground">Press Run to record a trace.</p>
      )}
      {run.status === 'running' && <p className="p-4 text-dense text-muted-foreground">Running…</p>}
      {done && total === 0 && (
        <p className="p-4 text-dense text-muted-foreground">
          Nothing was traced{done.status === 'error' ? ' because the code could not run' : ''}.
        </p>
      )}
      {total > 0 && (
        <ol className="flex min-h-0 flex-1 scroll-thin flex-col gap-px overflow-y-auto p-1.5">
          {rows.map((item) => (
            <Row
              key={item.row.step.index}
              item={item}
              stepIndex={stepIndex}
              onSelect={onSelect}
              onSetGroup={onSetGroup}
            />
          ))}
        </ol>
      )}
    </Panel>
  )
}
