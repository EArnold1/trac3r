import { EXAMPLES } from '../../src/app/examples'
import type { RunResult } from '../../src/engine/types'
import { runTraced } from '../engine/harness'

/** A RunResult built by really tracing the source, so fixtures cannot drift from the engine. */
export function runResultOf(source: string): RunResult {
  const traced = runTraced(source)
  return {
    status: traced.error ? 'error' : 'finished',
    ...(traced.result && { result: traced.result }),
    ...(traced.error && { error: { ...traced.error, line: traced.errorLine } }),
    output: traced.output.map((text) => ({ level: 'log' as const, text })),
    steps: traced.steps,
    notTraced: traced.notTraced,
    truncated: traced.truncated,
    durationMs: 4,
  }
}

export const FACTORIAL_SOURCE = EXAMPLES[0]?.source ?? ''
export const factorialRun = runResultOf(FACTORIAL_SOURCE)
