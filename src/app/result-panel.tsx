import { Badge } from '@/components/ui/badge'
import { TIMEOUT_MS } from '@/engine/limits'
import type { RunResult } from '@/engine/types'
import { cn } from '@/lib/utils'
import { Panel } from './panel'
import type { RunState } from './reducer'

/** The panel is narrow, so only a short value gets the big type. */
const SHORT_RESULT_CHARS = 5

export function timeoutMessage(): string {
  return `Timed out after ${String(TIMEOUT_MS / 1000)} s, possible infinite loop`
}

function Message({ children }: { children: string }) {
  return <p className="p-4 text-dense text-muted-foreground">{children}</p>
}

function Finished({ run }: { run: RunResult }) {
  const result = run.result
  if (run.status === 'error' && run.error) {
    const { name, message, line } = run.error
    const syntax = name === 'SyntaxError'
    return (
      <div className="flex flex-col justify-center gap-1.5 px-4 py-3">
        <p className="font-mono text-dense font-semibold break-words text-destructive">
          {message === '' ? name : `${name}: ${message}`}
        </p>
        <p className="text-label text-muted-foreground">
          {syntax
            ? `${line === null ? 'The code has' : `Line ${String(line)} has`} a syntax error, so nothing ran. Fix it and press Run.`
            : `${line === null ? 'The line is not known.' : `Thrown on line ${String(line)}.`} The trace ends there.`}
        </p>
      </div>
    )
  }
  if (run.status === 'timeout') {
    return (
      <div className="flex flex-col justify-center gap-1.5 px-4 py-3">
        <p className="text-body font-semibold text-destructive">No result</p>
        <p className="text-label text-muted-foreground">{timeoutMessage()}</p>
      </div>
    )
  }
  const text = result?.text ?? 'undefined'
  return (
    <div className="flex flex-col justify-center gap-0.5 px-4 pt-2 pb-2.5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <span
          title={text}
          className={cn(
            'font-mono font-semibold break-all',
            text.length <= SHORT_RESULT_CHARS ? 'text-result' : 'line-clamp-4 text-narration',
          )}
        >
          {text}
        </span>
        <Badge variant="secondary">{result?.type ?? 'undefined'}</Badge>
      </div>
      <span className="text-label text-muted-foreground">
        Last expression, same run as the trace.
      </span>
    </div>
  )
}

/** The final value of the run. It depends on the run only, so stepping never changes it. */
export function ResultPanel({ run }: { run: RunState }) {
  return (
    <Panel
      title="Result"
      className="flex-none basis-47 max-[980px]:basis-auto"
      caption={run.status === 'done' && run.run.status === 'error' ? 'Error' : undefined}
    >
      <div aria-live="polite" className="flex flex-1 flex-col justify-center">
        {run.status === 'idle' && <Message>Press Run to see the result.</Message>}
        {run.status === 'running' && <Message>Running…</Message>}
        {run.status === 'done' && <Finished run={run.run} />}
      </div>
    </Panel>
  )
}
