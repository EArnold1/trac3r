import workerSource from 'virtual:worker-source'
import type { RunResult } from '../engine/types'
import { runInSandbox } from './sandbox-host'

export interface RunOptions {
  /** Aborting kills the sandbox and rejects with an AbortError. */
  readonly signal?: AbortSignal
}

/** Runs pasted JavaScript in the sandbox. Never throws for problems in the pasted code. */
export function run(source: string, options?: RunOptions): Promise<RunResult> {
  return runInSandbox(source, workerSource, options?.signal)
}
