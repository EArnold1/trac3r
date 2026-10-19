// Message types and the validating type guards for everything that crosses the sandbox boundary.
// Guards take `unknown` and narrow by hand. Nothing here uses `as`.
import type { Frame, Loc, NotTraced, OutputLine, RunError, Shown, Step } from '../engine/types'

/** Parent to iframe: starts the run. */
export interface StartMessage {
  readonly type: 'start'
  readonly workerSource: string
  readonly code: string
}

/** Iframe to Worker: the code to run. */
export interface RunMessage {
  readonly type: 'run'
  readonly code: string
}

/** Worker to iframe to parent: the finished run. */
export interface WorkerResult {
  readonly type: 'result'
  readonly status: 'finished' | 'error'
  readonly result?: Shown
  readonly error?: RunError
  readonly output: readonly OutputLine[]
  readonly steps: readonly Step[]
  readonly notTraced: readonly NotTraced[]
  readonly truncated: boolean
}

/** The run so far, sent while it is still going so a timeout does not lose it. */
export interface WorkerPartial {
  readonly type: 'partial'
  readonly output: readonly OutputLine[]
  readonly steps: readonly Step[]
  readonly notTraced: readonly NotTraced[]
  readonly truncated: boolean
}

export type WorkerMessage = WorkerResult | WorkerPartial

/** Iframe to parent. */
export type SandboxMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'worker-message'; readonly data: unknown }
  | { readonly type: 'worker-error'; readonly message: string }

const SHOWN_TYPES: readonly string[] = [
  'number',
  'string',
  'boolean',
  'null',
  'undefined',
  'array',
  'object',
  'function',
  'symbol',
  'bigint',
  'error',
  'circular',
]

const STEP_KINDS: readonly string[] = [
  'declare',
  'assign',
  'branch',
  'call',
  'return',
  'output',
  'error',
  'end',
]

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

function isArrayOf<T>(x: unknown, guard: (item: unknown) => item is T): x is readonly T[] {
  return Array.isArray(x) && x.every(guard)
}

function isOptional(x: unknown, guard: (item: unknown) => boolean): boolean {
  return x === undefined || guard(x)
}

function isString(x: unknown): x is string {
  return typeof x === 'string'
}

function isNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x)
}

export function isShown(x: unknown): x is Shown {
  if (!isRecord(x)) return false
  if (typeof x.type !== 'string' || !SHOWN_TYPES.includes(x.type)) return false
  if (!isString(x.text)) return false
  if (!isOptional(x.omitted, isNumber)) return false
  const children = x.children
  if (children === undefined) return true
  return isArrayOf(children, isChild)
}

function isChild(x: unknown): x is { key: string; value: Shown } {
  return isRecord(x) && isString(x.key) && isShown(x.value)
}

function isLoc(x: unknown): x is Loc {
  return (
    isRecord(x) && isNumber(x.line) && isNumber(x.col) && isNumber(x.endLine) && isNumber(x.endCol)
  )
}

/**
 * Steps share frames and output lists, so each distinct object is checked once. Received data is
 * a copy that nothing mutates, which is what makes remembering a pass safe.
 */
const checkedFrames = new WeakSet()
const checkedLines = new WeakSet()

function isOutputList(x: unknown): x is readonly string[] {
  if (typeof x === 'object' && x !== null && checkedLines.has(x)) return true
  if (!isArrayOf(x, isString)) return false
  checkedLines.add(x)
  return true
}

function isFrame(x: unknown): x is Frame {
  if (typeof x === 'object' && x !== null && checkedFrames.has(x)) return true
  const valid = checkFrame(x)
  if (valid && typeof x === 'object' && x !== null) checkedFrames.add(x)
  return valid
}

function checkFrame(x: unknown): boolean {
  if (!isRecord(x)) return false
  const vars = x.vars
  return (
    isNumber(x.id) &&
    isString(x.fn) &&
    isArrayOf(x.args, isShown) &&
    (x.callLine === null || isNumber(x.callLine)) &&
    isRecord(vars) &&
    Object.values(vars).every(isShown)
  )
}

export function isStep(x: unknown): x is Step {
  if (!isRecord(x)) return false
  return (
    isNumber(x.index) &&
    typeof x.kind === 'string' &&
    STEP_KINDS.includes(x.kind) &&
    isLoc(x.loc) &&
    isOptional(x.expr, isString) &&
    isOptional(x.filled, isString) &&
    isOptional(x.value, isShown) &&
    isString(x.text) &&
    isArrayOf(x.stack, isFrame) &&
    isOutputList(x.output)
  )
}

function isOutputLine(x: unknown): x is OutputLine {
  return (
    isRecord(x) &&
    (x.level === 'log' || x.level === 'warn' || x.level === 'error') &&
    isString(x.text)
  )
}

const NOT_TRACED_REASONS: readonly string[] = [
  'class',
  'async',
  'generator',
  'accessor',
  'unsupported',
]

function isNotTraced(x: unknown): x is NotTraced {
  return (
    isRecord(x) &&
    isNumber(x.line) &&
    isNumber(x.endLine) &&
    typeof x.reason === 'string' &&
    NOT_TRACED_REASONS.includes(x.reason)
  )
}

function isRunError(x: unknown): x is RunError {
  return (
    isRecord(x) && isString(x.name) && isString(x.message) && (x.line === null || isNumber(x.line))
  )
}

export function isRunMessage(x: unknown): x is RunMessage {
  return isRecord(x) && x.type === 'run' && isString(x.code)
}

function hasRunData(x: Record<string, unknown>): boolean {
  return (
    isArrayOf(x.output, isOutputLine) &&
    isArrayOf(x.steps, isStep) &&
    isArrayOf(x.notTraced, isNotTraced) &&
    typeof x.truncated === 'boolean'
  )
}

export function isWorkerResult(x: unknown): x is WorkerResult {
  return (
    isRecord(x) &&
    x.type === 'result' &&
    (x.status === 'finished' || x.status === 'error') &&
    isOptional(x.result, isShown) &&
    isOptional(x.error, isRunError) &&
    hasRunData(x)
  )
}

export function isWorkerPartial(x: unknown): x is WorkerPartial {
  return isRecord(x) && x.type === 'partial' && hasRunData(x)
}

/** Which kind of message this is, without checking the data inside it. */
export function workerMessageKind(x: unknown): WorkerMessage['type'] | null {
  if (!isRecord(x)) return null
  return x.type === 'result' || x.type === 'partial' ? x.type : null
}

export function isSandboxMessage(x: unknown): x is SandboxMessage {
  if (!isRecord(x)) return false
  switch (x.type) {
    case 'ready':
      return true
    case 'worker-message':
      // The data is checked by the host once it knows it needs it; see workerMessageKind.
      return workerMessageKind(x.data) !== null
    case 'worker-error':
      return isString(x.message)
    default:
      return false
  }
}
