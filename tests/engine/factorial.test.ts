import { describe, expect, it } from 'vitest'
import { runPlain, runTraced, summarize } from './harness'

const SOURCE = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(3);`

describe('factorial(3)', () => {
  const traced = runTraced(SOURCE)

  it('gives the result 6, the same as without tracing', () => {
    expect(traced.result).toEqual({ type: 'number', text: '6' })
    expect(runPlain(SOURCE).result).toEqual(traced.result)
  })

  // The kind, line, value and stack columns of the table in the spec, exactly.
  it('matches the 11 steps in the spec', () => {
    expect(summarize(traced.steps)).toEqual([
      'declare 1 - | main',
      'call 5 - | main, factorial(3)',
      'branch 2 false | main, factorial(3)',
      'call 3 - | main, factorial(3), factorial(2)',
      'branch 2 false | main, factorial(3), factorial(2)',
      'call 3 - | main, factorial(3), factorial(2), factorial(1)',
      'branch 2 true | main, factorial(3), factorial(2), factorial(1)',
      'return 2 1 | main, factorial(3), factorial(2)',
      'return 3 2 | main, factorial(3)',
      'return 3 6 | main',
      'end 5 6 | empty',
    ])
  })

  it('numbers the steps from 0 and keeps the output empty', () => {
    expect(traced.steps.map((s) => s.index)).toEqual([...Array(11).keys()])
    expect(traced.steps.every((s) => s.output.length === 0)).toBe(true)
  })

  it('narrates with the real values', () => {
    const text = traced.steps.map((s) => s.text)
    expect(text[0]).toBe('Declare function `factorial`.')
    expect(text[1]).toBe('Call `factorial(3)`.')
    expect(text[3]).toBe('`n * factorial(n - 1)` needs `factorial(2)` first, so call it.')
    expect(text[5]).toBe('`n * factorial(n - 1)` needs `factorial(1)` first, so call it.')
    expect(text[2]).toBe('`n <= 1` is `3 <= 1`, which is false, so skip the early return.')
    expect(text[6]).toBe('`n <= 1` is `1 <= 1`, which is true, so take the early return.')
    expect(text[7]).toBe('`factorial(1)` returns `1`.')
    expect(text[8]).toBe('`factorial(2)` is `2 * 1`, so it returns `2`.')
    expect(text[9]).toBe('`factorial(3)` is `3 * 2`, so it returns `6`.')
    expect(text[10]).toBe('Program finished. Result: 6.')
  })

  it('shows each frame with its own n', () => {
    const deepest = traced.steps[6]
    expect(deepest?.stack.map((f) => f.vars.n?.text)).toEqual([undefined, '3', '2', '1'])
    expect(deepest?.stack.map((f) => f.callLine)).toEqual([null, 5, 3, 3])
  })

  it('points the highlighted expression at the condition', () => {
    const branch = traced.steps[2]
    expect(branch?.expr).toBe('n <= 1')
    expect(branch?.loc).toMatchObject({ line: 2, endLine: 2 })
    expect(branch ? branch.loc.endCol - branch.loc.col : 0).toBe('n <= 1'.length)
  })
})

describe('factorial(3) filled-in expressions', () => {
  it('puts the values into conditions and returns', () => {
    const traced = runTraced(SOURCE)
    expect(traced.steps[2]?.filled).toBe('3 <= 1')
    expect(traced.steps[6]?.filled).toBe('1 <= 1')
    expect(traced.steps[8]?.filled).toBe('2 * 1')
    expect(traced.steps[9]?.filled).toBe('3 * 2')
  })

  it('leaves it out when nothing was filled in', () => {
    const traced = runTraced(SOURCE)
    expect(traced.steps[7]?.filled).toBeUndefined() // `return 1`
    expect(traced.steps[0]?.filled).toBeUndefined()
  })
})
