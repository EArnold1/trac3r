import { describe, expect, it } from 'vitest'
import { deriveView } from '../../src/app/derive'
import { factorialRun, runResultOf } from './fixtures'

describe('deriveView', () => {
  it('returns nothing for a step that does not exist', () => {
    expect(deriveView(factorialRun, 50, null)).toBeNull()
  })

  it('shows the top frame unless another is selected', () => {
    const top = deriveView(factorialRun, 6, null)
    expect(top?.frame?.args[0]?.text).toBe('1')
    const chosen = deriveView(factorialRun, 6, top?.step.stack[1]?.id ?? null)
    expect(chosen?.frame?.args[0]?.text).toBe('3')
  })

  it('falls back to the top frame when the selected one is gone', () => {
    expect(deriveView(factorialRun, 6, 12345)?.frame?.args[0]?.text).toBe('1')
  })

  it('marks a pushed frame and its variables as new in this call', () => {
    const view = deriveView(factorialRun, 5, null)
    expect(view?.pushedFrameId).toBe(view?.step.stack.at(-1)?.id)
    expect(view?.frameIsNew).toBe(true)
    expect(view?.changes.get('n')).toBe('new')
  })

  it('does not mark an unchanged variable', () => {
    const view = deriveView(factorialRun, 6, null)
    expect(view?.frameIsNew).toBe(false)
    expect(view?.pushedFrameId).toBeNull()
    expect(view?.changes.size).toBe(0)
  })

  it('marks a variable that changed, and not one that was set to the same value', () => {
    const run = runResultOf('let s = 0;\ns = 5;\ns = 5;\ns = 6;')
    // Steps: declare 0, assign 5, assign 5 again, assign 6, end.
    expect(deriveView(run, 1, null)?.changes.get('s')).toBe('changed')
    expect(deriveView(run, 2, null)?.changes.has('s')).toBe(false)
    expect(deriveView(run, 3, null)?.changes.get('s')).toBe('changed')
  })

  it('shows the frame that a return step popped, with its value', () => {
    const view = deriveView(factorialRun, 7, null)
    expect(view?.popped?.frame.args[0]?.text).toBe('1')
    expect(view?.popped?.value?.text).toBe('1')
  })

  it('shows the top level as it was left when the program has finished', () => {
    const view = deriveView(factorialRun, 10, null)
    expect(view?.step.kind).toBe('end')
    expect(view?.frameIsFinal).toBe(true)
    expect(view?.frame?.fn).toBe('<main>')
    expect(view?.frame?.vars.factorial?.type).toBe('function')
  })
})
