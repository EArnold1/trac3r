// Worker entry. Runs inside the sandboxed iframe, started from a blob URL.
import { instrument } from '../engine/instrument'
import type { InstrumentResult } from '../engine/instrument'
import { MAX_CONSOLE_LINE_CHARS, MAX_CONSOLE_LINES } from '../engine/limits'
import { parse } from '../engine/parse'
import { createRecorder } from '../engine/recorder'
import type { Recorder } from '../engine/recorder'
import { describeThrown, show } from '../engine/show'
import type { NotTraced, OutputLine, RunError } from '../engine/types'
import { isRunMessage } from './messages'
import type { WorkerMessage, WorkerResult } from './messages'

const post = (message: WorkerMessage): void => {
  self.postMessage(message)
}

// Second layer after the CSP: the globals that could reach the network or other storage.
const BLOCKED_GLOBALS = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'EventSource',
  'WebTransport',
  'importScripts',
  'indexedDB',
  'caches',
  'BroadcastChannel',
  'SharedWorker',
] as const

for (const name of BLOCKED_GLOBALS) {
  Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false })
}

const output: OutputLine[] = []
let recorder: Recorder | null = null

function record(level: OutputLine['level'], args: readonly unknown[]): void {
  if (output.length >= MAX_CONSOLE_LINES) return
  const joined = args.map((a) => (typeof a === 'string' ? a : show(a).text)).join(' ')
  const text = joined.slice(0, MAX_CONSOLE_LINE_CHARS)
  output.push({ level, text })
  recorder?.output(level, text)
}

Object.assign(console, {
  log: (...args: unknown[]) => {
    record('log', args)
  },
  info: (...args: unknown[]) => {
    record('log', args)
  },
  debug: (...args: unknown[]) => {
    record('log', args)
  },
  warn: (...args: unknown[]) => {
    record('warn', args)
  },
  error: (...args: unknown[]) => {
    record('error', args)
  },
})

/** Unguessable, so the program cannot find or replace the hooks by name. */
function hookName(): string {
  const parts = crypto.getRandomValues(new Uint32Array(3))
  return `__t${Array.from(parts, (n) => n.toString(36)).join('')}`
}

function failure(
  error: RunError,
  extra: { steps?: WorkerResult['steps']; notTraced?: readonly NotTraced[]; truncated?: boolean },
): WorkerResult {
  return {
    type: 'result',
    status: 'error',
    error,
    output,
    steps: extra.steps ?? [],
    notTraced: extra.notTraced ?? [],
    truncated: extra.truncated ?? false,
  }
}

/** Runs the original code with no hooks. Used when the code cannot be instrumented. */
function runUntraced(code: string): WorkerResult {
  const notTraced: NotTraced[] = [
    { line: 1, endLine: code.split('\n').length, reason: 'unsupported' },
  ]
  try {
    // Indirect eval: global scope, and its completion value is the last expression's value.
    const value: unknown = (0, eval)(code)
    return {
      type: 'result',
      status: 'finished',
      result: show(value),
      output,
      steps: [],
      notTraced,
      truncated: false,
    }
  } catch (thrown) {
    return failure({ ...describeThrown(thrown), line: null }, { notTraced })
  }
}

function execute(code: string): WorkerResult {
  const parsed = parse(code)
  if (!parsed.ok) {
    return failure(
      { name: 'SyntaxError', message: parsed.error.message, line: parsed.error.line },
      {},
    )
  }

  const hook = hookName()
  let instrumented: InstrumentResult
  try {
    instrumented = instrument(parsed.program, code, parsed.arrows, { hook })
  } catch {
    // Syntax the tracer cannot instrument still runs; its lines are marked as not traced.
    return runUntraced(code)
  }

  const traced = createRecorder(instrumented.sites, instrumented.endLoc, {
    lineCount: instrumented.lineCount,
    onFlush: () => {
      post({
        type: 'partial',
        output,
        steps: traced.steps(),
        notTraced: instrumented.notTraced,
        truncated: traced.truncated(),
      })
    },
  })
  recorder = traced
  Object.defineProperty(self, hook, { value: traced.hooks, writable: false, configurable: false })

  // If the run never finishes, the page still gets the notes about untraced lines.
  post({
    type: 'partial',
    output: [],
    steps: [],
    notTraced: instrumented.notTraced,
    truncated: false,
  })

  try {
    const value: unknown = (0, eval)(instrumented.code)
    const result = show(value)
    traced.finish(result)
    return {
      type: 'result',
      status: 'finished',
      result,
      output,
      steps: traced.steps(),
      notTraced: instrumented.notTraced,
      truncated: traced.truncated(),
    }
  } catch (thrown) {
    traced.reportUncaught(thrown)
    return failure(
      { ...describeThrown(thrown), line: traced.errorLine(thrown) },
      {
        steps: traced.steps(),
        notTraced: instrumented.notTraced,
        truncated: traced.truncated(),
      },
    )
  }
}

self.onmessage = (event: MessageEvent<unknown>) => {
  if (!isRunMessage(event.data)) return
  self.onmessage = null
  post(execute(event.data.code))
}
