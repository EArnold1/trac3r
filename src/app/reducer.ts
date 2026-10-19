import type { RunResult } from '@/engine/types'
import type { GroupChoices } from './trace-tree'

export type Speed = 0.5 | 1 | 2

export type RunState =
  | { readonly status: 'idle' }
  /** `id` tells a result that arrives late apart from the run that is current. */
  | { readonly status: 'running'; readonly id: number }
  | { readonly status: 'done'; readonly run: RunResult }

export interface AppState {
  readonly source: string
  readonly run: RunState
  readonly mode: 'editing' | 'replaying'
  /** 0-based index into run.steps. */
  readonly stepIndex: number
  readonly playing: boolean
  readonly speed: Speed
  /** null means the top frame. */
  readonly selectedFrameId: number | null
  /** Calls in the trace that were folded or opened by hand; the rest follow the current step. */
  readonly groupChoices: GroupChoices
}

export type Action =
  | { readonly type: 'edit'; readonly source: string }
  | { readonly type: 'runStarted'; readonly id: number }
  | { readonly type: 'runFinished'; readonly id: number; readonly run: RunResult }
  | { readonly type: 'goto'; readonly index: number }
  | { readonly type: 'next' }
  | { readonly type: 'prev' }
  | { readonly type: 'reset' }
  /** One step of automatic playback. Unlike `next`, it keeps playing. */
  | { readonly type: 'tick' }
  | { readonly type: 'play' }
  | { readonly type: 'pause' }
  | { readonly type: 'setSpeed'; readonly speed: Speed }
  | { readonly type: 'selectFrame'; readonly id: number | null }
  | { readonly type: 'setGroup'; readonly id: number; readonly open: boolean }
  /** Back to the automatic rule: only the current call and its callers are open. */
  | { readonly type: 'foldToCurrent' }
  | { readonly type: 'expandAll'; readonly ids: readonly number[] }
  | { readonly type: 'backToEditing' }

export function createInitialState(source: string): AppState {
  return {
    source,
    run: { status: 'idle' },
    mode: 'editing',
    stepIndex: 0,
    playing: false,
    speed: 1,
    selectedFrameId: null,
    groupChoices: {},
  }
}

export function stepCount(state: AppState): number {
  return state.run.status === 'done' ? state.run.run.steps.length : 0
}

function clampIndex(state: AppState, index: number): number {
  return Math.min(Math.max(index, 0), Math.max(stepCount(state) - 1, 0))
}

/** Moving by hand: stays put on a run with no steps and stops playback. */
function moveTo(state: AppState, index: number): AppState {
  return { ...state, stepIndex: clampIndex(state, index), playing: false }
}

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'edit':
      return {
        ...state,
        source: action.source,
        run: { status: 'idle' },
        mode: 'editing',
        stepIndex: 0,
        playing: false,
        selectedFrameId: null,
        groupChoices: {},
      }
    case 'runStarted':
      return {
        ...state,
        run: { status: 'running', id: action.id },
        stepIndex: 0,
        playing: false,
        selectedFrameId: null,
        groupChoices: {},
      }
    case 'runFinished': {
      // A result from a run that has since been replaced is ignored.
      if (state.run.status !== 'running' || state.run.id !== action.id) return state
      return {
        ...state,
        run: { status: 'done', run: action.run },
        // With nothing to replay, such as after a syntax error, the code stays editable.
        mode: action.run.steps.length > 0 ? 'replaying' : 'editing',
        stepIndex: 0,
        playing: false,
        selectedFrameId: null,
        groupChoices: {},
      }
    }
    case 'goto':
      return moveTo(state, action.index)
    case 'next':
      return moveTo(state, state.stepIndex + 1)
    case 'prev':
      return moveTo(state, state.stepIndex - 1)
    case 'reset':
      return moveTo(state, 0)
    case 'tick': {
      if (!state.playing) return state
      const last = stepCount(state) - 1
      const stepIndex = Math.min(state.stepIndex + 1, Math.max(last, 0))
      return { ...state, stepIndex, playing: stepIndex < last }
    }
    case 'play': {
      const count = stepCount(state)
      if (count === 0) return state
      // Playing from the end starts over.
      const stepIndex = state.stepIndex >= count - 1 ? 0 : state.stepIndex
      return { ...state, stepIndex, playing: count > 1 }
    }
    case 'pause':
      return { ...state, playing: false }
    case 'setSpeed':
      return { ...state, speed: action.speed }
    case 'selectFrame':
      return { ...state, selectedFrameId: action.id }
    case 'setGroup':
      return { ...state, groupChoices: { ...state.groupChoices, [action.id]: action.open } }
    case 'foldToCurrent':
      return { ...state, groupChoices: {} }
    case 'expandAll':
      return {
        ...state,
        groupChoices: Object.fromEntries(action.ids.map((id) => [id, true] as const)),
      }
    case 'backToEditing':
      return {
        ...state,
        run: { status: 'idle' },
        mode: 'editing',
        stepIndex: 0,
        playing: false,
        selectedFrameId: null,
        groupChoices: {},
      }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}
