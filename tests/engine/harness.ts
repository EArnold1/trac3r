// Runs fixture programs the way the worker does, but in Node: parse, instrument, run in a fresh
// `vm` context. Fixtures are our own code, so running them outside the sandbox is allowed here.
import vm from 'node:vm'
import { instrument } from '../../src/engine/instrument'
import { parse } from '../../src/engine/parse'
import { createRecorder } from '../../src/engine/recorder'
import type { Recorder } from '../../src/engine/recorder'
import { describeThrown, show } from '../../src/engine/show'
import type { NotTraced, OutputLine, Shown, Step } from '../../src/engine/types'

export interface Outcome {
  readonly result: Shown | undefined
  readonly error: { name: string; message: string } | undefined
  readonly output: string[]
}

export interface Traced extends Outcome {
  readonly steps: readonly Step[]
  readonly truncated: boolean
  readonly code: string
  readonly notTraced: readonly NotTraced[]
  /** The line the uncaught error was recorded at. */
  readonly errorLine: number | null
}

function sandboxContext(
  extra: Record<string, unknown>,
  onLine?: (level: OutputLine['level'], text: string) => void,
): { context: vm.Context; output: string[] } {
  const output: string[] = []
  const write =
    (level: OutputLine['level']) =>
    (...args: unknown[]): void => {
      const text = args.map((a) => (typeof a === 'string' ? a : show(a).text)).join(' ')
      output.push(text)
      onLine?.(level, text)
    }
  const console = { log: write('log'), warn: write('warn'), error: write('error') }
  return { context: vm.createContext({ console, ...extra }), output }
}

/** The program as written, with no tracing. */
export function runPlain(source: string): Outcome {
  const { context, output } = sandboxContext({})
  try {
    const value: unknown = vm.runInContext(source, context)
    return { result: show(value), error: undefined, output }
  } catch (thrown) {
    return { result: undefined, error: describeThrown(thrown), output }
  }
}

/** The program with trace hooks. */
export function runTraced(source: string, maxSteps?: number): Traced {
  const parsed = parse(source)
  if (!parsed.ok) throw new Error(`Fixture does not parse: ${parsed.error.message}`)
  const hook = '__trace_test'
  const instrumented = instrument(parsed.program, source, parsed.arrows, { hook })
  const recorder: Recorder = createRecorder(instrumented.sites, instrumented.endLoc, {
    lineCount: instrumented.lineCount,
    ...(maxSteps !== undefined && { maxSteps }),
  })
  const { context, output } = sandboxContext({ [hook]: recorder.hooks }, (level, text) => {
    recorder.output(level, text)
  })
  const base = {
    output,
    steps: recorder.steps(),
    code: instrumented.code,
    notTraced: instrumented.notTraced,
  }
  try {
    const result = show(vm.runInContext(instrumented.code, context))
    recorder.finish(result)
    return { ...base, result, error: undefined, truncated: recorder.truncated(), errorLine: null }
  } catch (thrown) {
    recorder.reportUncaught(thrown)
    return {
      ...base,
      result: undefined,
      error: describeThrown(thrown),
      truncated: recorder.truncated(),
      errorLine: recorder.errorLine(thrown),
    }
  }
}

/** One line per step: `kind line value | stack`, for readable expectations. */
export function summarize(steps: readonly Step[]): string[] {
  return steps.map((s) => {
    const stack = s.stack.map((f) =>
      f.fn === '<main>' ? 'main' : `${f.fn}(${f.args.map((a) => a.text).join(',')})`,
    )
    return `${s.kind} ${String(s.loc.line)} ${s.value?.text ?? '-'} | ${stack.join(', ') || 'empty'}`
  })
}
