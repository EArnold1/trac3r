// Shared data model. These types cross the sandbox boundary as plain data.

/** A value as shown to the user. Real values never leave the sandbox. */
export interface Shown {
  readonly type:
    | 'number'
    | 'string'
    | 'boolean'
    | 'null'
    | 'undefined'
    | 'array'
    | 'object'
    | 'function'
    | 'symbol'
    | 'bigint'
    | 'error'
    | 'circular'
  /** One-line preview, like a collapsed DevTools value: 6, "hi", [1, 2, 3], ƒ factorial */
  readonly text: string
  /** Arrays and objects only, at most 20 entries per level and 3 levels deep. */
  readonly children?: readonly { readonly key: string; readonly value: Shown }[]
  /** Entries left out because of those caps. */
  readonly omitted?: number
}

export type StepKind =
  'declare' | 'assign' | 'branch' | 'call' | 'return' | 'output' | 'error' | 'end'

export interface Frame {
  /** Unique per call. */
  readonly id: number
  /** 'factorial', or '<main>' for top level. */
  readonly fn: string
  readonly args: readonly Shown[]
  /** Line that made the call. */
  readonly callLine: number | null
  /** This frame's own variables. */
  readonly vars: Readonly<Record<string, Shown>>
}

export interface Loc {
  readonly line: number
  readonly col: number
  readonly endLine: number
  readonly endCol: number
}

export interface Step {
  readonly index: number
  readonly kind: StepKind
  readonly loc: Loc
  /** Source of the expression, e.g. 'n <= 1'. */
  readonly expr?: string
  /** The expression with the values it used put in, e.g. '3 <= 1'. Branches and returns only. */
  readonly filled?: string
  /** What that expression produced at this step. */
  readonly value?: Shown
  /** Plain-English narration shown to the user. */
  readonly text: string
  /** Snapshot after this step, bottom to top. */
  readonly stack: readonly Frame[]
  /** Console lines so far. */
  readonly output: readonly string[]
}

export type NotTracedReason = 'class' | 'async' | 'generator' | 'accessor' | 'unsupported'

/** A range of lines that runs but is not traced. */
export interface NotTraced {
  readonly line: number
  readonly endLine: number
  readonly reason: NotTracedReason
}

export interface RunError {
  readonly name: string
  readonly message: string
  readonly line: number | null
}

export interface OutputLine {
  readonly level: 'log' | 'warn' | 'error'
  readonly text: string
}

export interface RunResult {
  readonly status: 'finished' | 'error' | 'timeout'
  /** Value of the last top-level expression. */
  readonly result?: Shown
  readonly error?: RunError
  /** All console output. */
  readonly output: readonly OutputLine[]
  readonly steps: readonly Step[]
  /** Lines that ran without being traced. */
  readonly notTraced: readonly NotTraced[]
  /** More than 2,000 steps happened; the first 2,000 are kept. */
  readonly truncated: boolean
  readonly durationMs: number
}
