import { describe, expect, it } from 'vitest'
import { createInitialState, reducer, stepCount } from '../../src/app/reducer'
import type { Action, AppState } from '../../src/app/reducer'
import type { RunResult } from '../../src/engine/types'
import { factorialRun, runResultOf } from './fixtures'

function apply(state: AppState, ...actions: Action[]): AppState {
  return actions.reduce(reducer, state)
}

const started = (id = 1): Action => ({ type: 'runStarted', id })
const finished = (run: RunResult = factorialRun, id = 1): Action => ({
  type: 'runFinished',
  id,
  run,
})
const replaying = apply(createInitialState('code'), started(), finished())

describe('reducer', () => {
  it('starts idle and editing, with the source it was given', () => {
    expect(createInitialState('1 + 1')).toMatchObject({
      source: '1 + 1',
      run: { status: 'idle' },
      mode: 'editing',
      stepIndex: 0,
      playing: false,
      speed: 1,
      selectedFrameId: null,
      groupChoices: {},
    })
  })

  it('edit changes the source and drops any run', () => {
    const state = apply(replaying, { type: 'edit', source: 'x' })
    expect(state).toMatchObject({ source: 'x', run: { status: 'idle' }, mode: 'editing' })
  })

  it('after a run finishes it replays from step 0, paused', () => {
    expect(replaying).toMatchObject({ mode: 'replaying', stepIndex: 0, playing: false })
    expect(stepCount(replaying)).toBe(11)
  })

  it('ignores a result from a run that was replaced', () => {
    const state = apply(
      createInitialState('code'),
      started(1),
      started(2),
      finished(factorialRun, 1),
    )
    expect(state.run).toEqual({ status: 'running', id: 2 })
    expect(apply(state, finished(factorialRun, 2)).run.status).toBe('done')
  })

  it('ignores a result when no run is in progress', () => {
    const state = createInitialState('code')
    expect(reducer(state, finished())).toBe(state)
  })

  it('stays editable when a run has no steps, as after a syntax error', () => {
    const run = { ...factorialRun, status: 'error', steps: [] } as const
    const state = apply(createInitialState('code'), started(), finished(run))
    expect(state.mode).toBe('editing')
    expect(state.run.status).toBe('done')
  })

  it('goto, next and prev stay inside the run', () => {
    expect(apply(replaying, { type: 'goto', index: 99 }).stepIndex).toBe(10)
    expect(apply(replaying, { type: 'goto', index: -4 }).stepIndex).toBe(0)
    expect(apply(replaying, { type: 'prev' }).stepIndex).toBe(0)
    expect(apply(replaying, { type: 'goto', index: 10 }, { type: 'next' }).stepIndex).toBe(10)
  })

  it('stepping forward then back lands on identical state', () => {
    const middle = apply(replaying, { type: 'goto', index: 4 })
    expect(apply(middle, { type: 'next' }, { type: 'prev' })).toEqual(middle)
    expect(apply(middle, { type: 'prev' }, { type: 'next' })).toEqual(middle)
  })

  it('stepping by hand pauses playback', () => {
    const playing = apply(replaying, { type: 'play' })
    expect(playing.playing).toBe(true)
    for (const action of [
      { type: 'next' },
      { type: 'prev' },
      { type: 'goto', index: 3 },
      { type: 'reset' },
    ] as const) {
      expect(reducer(playing, action).playing).toBe(false)
    }
  })

  it('tick keeps playing and stops on the last step', () => {
    let state = apply(replaying, { type: 'goto', index: 8 }, { type: 'play' })
    state = apply(state, { type: 'tick' })
    expect(state).toMatchObject({ stepIndex: 9, playing: true })
    state = apply(state, { type: 'tick' })
    expect(state).toMatchObject({ stepIndex: 10, playing: false })
  })

  it('tick does nothing when paused', () => {
    expect(reducer(replaying, { type: 'tick' })).toBe(replaying)
  })

  it('play from the last step starts again from the first', () => {
    const atEnd = apply(replaying, { type: 'goto', index: 10 })
    expect(apply(atEnd, { type: 'play' })).toMatchObject({ stepIndex: 0, playing: true })
  })

  it('play does nothing without a run', () => {
    const idle = createInitialState('code')
    expect(reducer(idle, { type: 'play' })).toBe(idle)
  })

  it('does not play a run with a single step', () => {
    const one = apply(createInitialState('code'), started(), finished(runResultOf('1 + 1')))
    expect(stepCount(one)).toBe(1)
    expect(apply(one, { type: 'play' }).playing).toBe(false)
  })

  it('remembers speed and the selected frame', () => {
    const state = apply(replaying, { type: 'setSpeed', speed: 2 }, { type: 'selectFrame', id: 3 })
    expect(state).toMatchObject({ speed: 2, selectedFrameId: 3 })
  })

  it('backToEditing drops the run and keeps the code', () => {
    const state = apply(replaying, { type: 'goto', index: 5 }, { type: 'backToEditing' })
    expect(state).toMatchObject({
      source: 'code',
      run: { status: 'idle' },
      mode: 'editing',
      stepIndex: 0,
    })
  })

  it('a new run goes back to step 0', () => {
    const state = apply(replaying, { type: 'goto', index: 5 }, started(2))
    expect(state).toMatchObject({ stepIndex: 0, run: { status: 'running', id: 2 } })
  })

  describe('folding the trace', () => {
    it('remembers which calls were opened or folded by hand', () => {
      const state = apply(
        replaying,
        { type: 'setGroup', id: 3, open: true },
        { type: 'setGroup', id: 5, open: false },
        { type: 'setGroup', id: 3, open: false },
      )
      expect(state.groupChoices).toEqual({ 3: false, 5: false })
    })

    it('Fold to current clears every choice', () => {
      const state = apply(
        replaying,
        { type: 'setGroup', id: 3, open: true },
        { type: 'foldToCurrent' },
      )
      expect(state.groupChoices).toEqual({})
    })

    it('Expand all opens the calls it is given and drops older choices', () => {
      const state = apply(
        replaying,
        { type: 'setGroup', id: 9, open: false },
        { type: 'expandAll', ids: [1, 2, 3] },
      )
      expect(state.groupChoices).toEqual({ 1: true, 2: true, 3: true })
    })

    it('keeps the choices while stepping, and forgets them with the run', () => {
      const chosen = apply(replaying, { type: 'setGroup', id: 3, open: true })
      expect(apply(chosen, { type: 'next' }, { type: 'goto', index: 5 }).groupChoices).toEqual({
        3: true,
      })
      expect(apply(chosen, { type: 'backToEditing' }).groupChoices).toEqual({})
      expect(apply(chosen, { type: 'edit', source: 'x' }).groupChoices).toEqual({})
      expect(apply(chosen, started()).groupChoices).toEqual({})
      expect(apply(chosen, started(2), finished(factorialRun, 2)).groupChoices).toEqual({})
    })
  })
})
