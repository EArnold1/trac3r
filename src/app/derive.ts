// Everything the panels show is worked out here from (run, stepIndex, selectedFrameId); none of it
// is stored in state.
import type { Frame, RunResult, Shown, Step } from '@/engine/types'

export type VarChange = 'new' | 'changed'

export interface StepView {
  readonly step: Step
  readonly previous: Step | null
  /** The frame whose variables are shown. */
  readonly frame: Frame | null
  /** The program has finished, so this is the top level frame as it was left. */
  readonly frameIsFinal: boolean
  /** Variables that are new or have a new value since the previous step. */
  readonly changes: ReadonlyMap<string, VarChange>
  /** The frame is new in this step, so all its variables are new in this call. */
  readonly frameIsNew: boolean
  /** The frame that was pushed by this step, if any. */
  readonly pushedFrameId: number | null
  /** The frame that this step popped, with the value it returned. */
  readonly popped: { readonly frame: Frame; readonly value: Shown | null } | null
}

export function deriveView(
  run: RunResult,
  stepIndex: number,
  selectedFrameId: number | null,
): StepView | null {
  const step = run.steps[stepIndex]
  if (!step) return null
  const previous = stepIndex > 0 ? (run.steps[stepIndex - 1] ?? null) : null

  const selected = step.stack.find((frame) => frame.id === selectedFrameId)
  const live = selected ?? step.stack.at(-1) ?? null
  const frameIsFinal = live === null
  // When the program has finished the stack is empty; show the top level as it was left.
  const frame = live ?? previous?.stack[0] ?? null

  const before = previous?.stack.find((candidate) => candidate.id === frame?.id)
  const frameIsNew =
    !frameIsFinal && frame !== null && frame.fn !== '<main>' && before === undefined
  const changes = new Map<string, VarChange>()
  if (frame && !frameIsFinal) {
    for (const [name, value] of Object.entries(frame.vars)) {
      const old = before?.vars[name]
      if (old === undefined) changes.set(name, 'new')
      else if (old.text !== value.text) changes.set(name, 'changed')
    }
  }

  const top = step.stack.at(-1)
  const previousTop = previous?.stack.at(-1)
  const pushedFrameId =
    top && !previous?.stack.some((f) => f.id === top.id) && previous ? top.id : null
  const popped =
    previousTop && !step.stack.some((f) => f.id === previousTop.id) && step.kind === 'return'
      ? { frame: previousTop, value: step.value ?? null }
      : null

  return { step, previous, frame, frameIsFinal, changes, frameIsNew, pushedFrameId, popped }
}

export function describeFrame(frame: Frame): string {
  return frame.fn === '<main>' ? 'main' : `${frame.fn}(${frame.args.map((a) => a.text).join(', ')})`
}
