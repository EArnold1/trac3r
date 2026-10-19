// Groups the flat list of steps into calls, so the trace can fold each call to one row. Everything
// is worked out from the stack snapshot on each step, never from the step kind: a `call` step that
// is a native call (`arr.push(4)`) pushes no frame, and a frame can end without a `return` step.
import type { Frame, Shown, Step } from '@/engine/types'
import { describeFrame } from './derive'

/** One call to a function the tracer follows. Top level is not a call. */
export interface CallGroup {
  /** The frame id. */
  readonly id: number
  /** `factorial(3)`, as the call was made. */
  readonly label: string
  /** The caller's frame id, or null when called from top level. */
  readonly parent: number | null
  /** 1 for a call made from top level. */
  readonly level: number
  /** Index of the `call` step, which is the group's header row. */
  readonly start: number
  /** Index of the last step in the call: its `return` step, or the last step it was running. */
  readonly end: number
  /** The call ended with a `return` step. False after an error that left the call without one. */
  readonly closed: boolean
  readonly returned: Shown | null
}

export interface TraceRow {
  readonly step: Step
  /** Set when this row is the `call` step that opens a group. */
  readonly group: CallGroup | null
  /** The call whose body holds this row, or null at top level. A header sits in its caller. */
  readonly within: number | null
  /** Nesting depth for indentation. */
  readonly indent: number
}

export interface TraceTree {
  readonly rows: readonly TraceRow[]
  readonly groups: ReadonlyMap<number, CallGroup>
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

export function buildTraceTree(steps: readonly Step[]): TraceTree {
  const groups = new Map<number, Mutable<CallGroup>>()
  const rows: TraceRow[] = []
  let previous: readonly Frame[] = []

  steps.forEach((step, index) => {
    const stack = step.stack
    const top = stack.at(-1)
    const before = new Set(previous.map((frame) => frame.id))
    const now = new Set(stack.map((frame) => frame.id))

    // Frame 0 of the stack is top level. Any other frame that is new on this step is a call.
    if (top !== undefined && stack.length > 1 && !before.has(top.id)) {
      const callerId = stack.length > 2 ? (stack[stack.length - 2]?.id ?? null) : null
      const group: Mutable<CallGroup> = {
        id: top.id,
        label: describeFrame(top),
        parent: callerId,
        level: stack.length - 1,
        start: index,
        end: index,
        closed: false,
        returned: null,
      }
      groups.set(top.id, group)
      rows.push({ step, group, within: callerId, indent: group.level - 1 })
    } else {
      // The shallowest frame that went away is the one returning; any above it were abandoned.
      const returning =
        step.kind === 'return' ? previous.slice(1).find((frame) => !now.has(frame.id)) : undefined
      const group = returning === undefined ? undefined : groups.get(returning.id)
      if (group !== undefined) {
        group.end = index
        group.closed = true
        group.returned = step.value ?? null
        rows.push({ step, group: null, within: group.id, indent: group.level })
      } else {
        const owner = stack.length > 1 ? top : undefined
        rows.push({
          step,
          group: null,
          within: owner?.id ?? null,
          indent: owner === undefined ? 0 : stack.length - 1,
        })
      }
    }

    // A call that never returns runs to the last step it was on the stack.
    for (const frame of stack.slice(1)) {
      const group = groups.get(frame.id)
      if (group !== undefined && !group.closed) group.end = index
    }
    previous = stack
  })

  return { rows, groups }
}

/** The manual choices: group id to open or folded. A group with no choice follows the step. */
export type GroupChoices = Readonly<Record<number, boolean>>

/** A call is open when the current step is inside it, unless it was opened or folded by hand. */
export function isGroupOpen(group: CallGroup, current: number, choices: GroupChoices): boolean {
  return choices[group.id] ?? (group.start <= current && current <= group.end)
}

export type CallState = 'waiting' | 'running' | 'returned' | 'unfinished'

export function callState(group: CallGroup, current: number): CallState {
  if (current < group.start) return 'waiting'
  if (group.closed && current >= group.end) return 'returned'
  if (!group.closed && current > group.end) return 'unfinished'
  return 'running'
}

/** What a header row says on its right: the outcome, and the step count when folded. */
export function groupSummary(group: CallGroup, current: number, open: boolean): string {
  const state = callState(group, current)
  const parts: string[] = []
  if (state === 'returned') parts.push(`→ ${group.returned?.text ?? 'undefined'}`)
  else if (state === 'running') parts.push('running')
  else if (state === 'unfinished') parts.push('did not return')
  if (!open) {
    const count = group.end - group.start + 1
    parts.push(`${String(count)} ${count === 1 ? 'step' : 'steps'}`)
  }
  return parts.join(' · ')
}

export interface VisibleRow {
  readonly row: TraceRow
  /** For a header row: the call is open. */
  readonly open: boolean
}

/** The rows to draw: those not hidden inside a folded call. */
export function visibleRows(
  tree: TraceTree,
  current: number,
  choices: GroupChoices,
): readonly VisibleRow[] {
  const shown = new Map<number, boolean>()
  // A call's body is shown when it and every call around it is open.
  const bodyShown = (id: number | null): boolean => {
    if (id === null) return true
    const known = shown.get(id)
    if (known !== undefined) return known
    const group = tree.groups.get(id)
    const result =
      group === undefined || (isGroupOpen(group, current, choices) && bodyShown(group.parent))
    shown.set(id, result)
    return result
  }

  const visible: VisibleRow[] = []
  for (const row of tree.rows) {
    if (!bodyShown(row.within)) continue
    visible.push({ row, open: row.group !== null && isGroupOpen(row.group, current, choices) })
  }
  return visible
}
