import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../src/app/examples'
import {
  buildTraceTree,
  callState,
  groupSummary,
  isGroupOpen,
  visibleRows,
} from '../../src/app/trace-tree'
import { factorialRun, runResultOf } from './fixtures'

const fibonacciRun = runResultOf(EXAMPLES[1]?.source ?? '')
const fibonacci = buildTraceTree(fibonacciRun.steps)
const factorial = buildTraceTree(factorialRun.steps)

/** The step numbers shown, 1-based as on screen. */
function shown(tree = fibonacci, current = 0, choices = {}) {
  return visibleRows(tree, current, choices).map(({ row }) => row.step.index + 1)
}

describe('buildTraceTree', () => {
  it('finds the calls of fibonacci(4) where the mockup puts them', () => {
    expect(fibonacciRun.steps).toHaveLength(29)
    // [label, first step, last step, returned], 1-based, from docs/mockup/Main.dc.html.
    expect(
      [...fibonacci.groups.values()].map((g) => [
        g.label,
        g.start + 1,
        g.end + 1,
        g.returned?.text,
      ]),
    ).toEqual([
      ['fibonacci(4)', 2, 28, '3'],
      ['fibonacci(3)', 4, 18, '2'],
      ['fibonacci(2)', 6, 14, '1'],
      ['fibonacci(1)', 8, 10, '1'],
      ['fibonacci(0)', 11, 13, '0'],
      ['fibonacci(1)', 15, 17, '1'],
      ['fibonacci(2)', 19, 27, '1'],
      ['fibonacci(1)', 21, 23, '1'],
      ['fibonacci(0)', 24, 26, '0'],
    ])
  })

  it('nests each call in its caller, with top level at depth 0', () => {
    const calls = [...fibonacci.groups.values()]
    expect(calls.map((g) => g.level)).toEqual([1, 2, 3, 4, 4, 3, 2, 3, 3])
    expect(calls.map((g) => g.parent)).toEqual([
      null,
      calls[0]?.id,
      calls[1]?.id,
      calls[2]?.id,
      calls[2]?.id,
      calls[1]?.id,
      calls[0]?.id,
      calls[6]?.id,
      calls[6]?.id,
    ])
  })

  it('puts a call step as the header of its group and the return step last in its body', () => {
    const rows = fibonacci.rows
    expect(rows[0]?.group).toBeNull()
    expect(rows[1]?.group?.label).toBe('fibonacci(4)')
    expect(rows[1]?.indent).toBe(0)
    // Step 3 is the branch inside fibonacci(4), step 28 its return.
    expect(rows[2]).toMatchObject({ within: rows[1]?.group?.id, indent: 1 })
    expect(rows[27]).toMatchObject({ within: rows[1]?.group?.id, indent: 1 })
    expect(rows[27]?.step.kind).toBe('return')
    // The end step is back at top level.
    expect(rows[28]).toMatchObject({ within: null, indent: 0 })
  })

  it('has no calls when the program has none', () => {
    const loop = buildTraceTree(runResultOf(EXAMPLES[2]?.source ?? '').steps)
    expect(loop.groups.size).toBe(0)
    expect(loop.rows.every((row) => row.within === null && row.indent === 0)).toBe(true)
  })

  it('does not treat a native call as a group', () => {
    const run = runResultOf('const a = [1];\na.push(2);\na;')
    const tree = buildTraceTree(run.steps)
    expect(run.steps.some((s) => s.kind === 'call')).toBe(true)
    expect(tree.groups.size).toBe(0)
  })

  it('leaves a call open-ended when it was left by an error', () => {
    const run = runResultOf('function f() {\n  throw new RangeError("bad");\n}\nf();')
    const call = [...buildTraceTree(run.steps).groups.values()][0]
    expect(call).toMatchObject({ label: 'f()', closed: false, returned: null })
    expect(call?.end).toBe(run.steps.length - 1)
  })

  it('keeps a call that was left by a caught error from swallowing the step after it', () => {
    const run = runResultOf(
      'function f() {\n  throw new Error("x");\n}\nlet r = 0;\ntry {\n  f();\n} catch (e) {\n  r = 1;\n}\nr;',
    )
    const tree = buildTraceTree(run.steps)
    const call = [...tree.groups.values()][0]
    expect(call?.closed).toBe(false)
    const after = tree.rows.at(-1)
    expect(after?.within).toBeNull()
    expect(call?.end).toBeLessThan(run.steps.length - 1)
  })
})

describe('visibleRows', () => {
  it('opens only the calls around the current step', () => {
    // Step 1: nothing is running, so every call is one row.
    expect(shown(factorial, 0)).toEqual([1, 2, 11])
    // Step 7: factorial(1) is running inside factorial(2) inside factorial(3).
    expect(shown(factorial, 6)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('folds a finished sibling but keeps the running branch open', () => {
    // Step 7 is the branch in the first fibonacci(2). Its two calls, steps 8 and 11, are folded, and
    // so are the second call of fibonacci(3) (15) and the second fibonacci(2) of fibonacci(4) (19).
    expect(shown(fibonacci, 6)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 11, 14, 15, 18, 19, 28, 29])
  })

  it('shows the call step itself with its body open once it is the current step', () => {
    // On step 8 (the call to fibonacci(1)) that call is open, so its body shows.
    expect(shown(fibonacci, 7)).toContain(9)
    expect(shown(fibonacci, 7)).toContain(10)
  })

  it('lets a manual choice win over the current step in both directions', () => {
    const outer = [...fibonacci.groups.values()][1]?.id ?? -1
    expect(shown(fibonacci, 6, { [outer]: false })).toEqual([1, 2, 3, 4, 19, 28, 29])
    const first = [...fibonacci.groups.values()][3]?.id ?? -1
    expect(shown(fibonacci, 6, { [first]: true })).toContain(9)
  })

  it('hides the body of an open call whose caller is folded', () => {
    const outer = [...fibonacci.groups.values()][0]?.id ?? -1
    const inner = [...fibonacci.groups.values()][1]?.id ?? -1
    expect(shown(fibonacci, 6, { [outer]: false, [inner]: true })).toEqual([1, 2, 29])
  })

  it('shows every row when all calls are opened', () => {
    const all = Object.fromEntries([...fibonacci.groups.keys()].map((id) => [id, true]))
    expect(shown(fibonacci, 0, all)).toHaveLength(29)
  })
})

describe('call state and summary', () => {
  const [outer, , second, third] = [...fibonacci.groups.values()]

  it('tells waiting, running and returned apart', () => {
    if (!third) throw new Error('no call')
    expect(callState(third, 3)).toBe('waiting')
    expect(callState(third, third.start)).toBe('running')
    expect(callState(third, third.end)).toBe('returned')
  })

  it('writes the outcome and the step count when folded', () => {
    if (!second || !third) throw new Error('no call')
    expect(groupSummary(third, 20, false)).toBe('→ 1 · 3 steps')
    expect(groupSummary(third, 3, false)).toBe('3 steps')
    expect(groupSummary(third, third.start, false)).toBe('running · 3 steps')
    expect(groupSummary(third, third.start, true)).toBe('running')
    expect(groupSummary(third, 20, true)).toBe('→ 1')
    expect(groupSummary(third, 3, true)).toBe('')
  })

  it('says a call did not return when an error left it', () => {
    const run = runResultOf('function f() {\n  throw new Error("x");\n}\nf();')
    const call = [...buildTraceTree(run.steps).groups.values()][0]
    if (!call) throw new Error('no call')
    expect(callState(call, call.end)).toBe('running')
    expect(callState(call, call.end + 1)).toBe('unfinished')
    expect(groupSummary(call, call.end + 1, true)).toBe('did not return')
  })

  it('follows the current step unless a choice is made', () => {
    if (!outer) throw new Error('no call')
    expect(isGroupOpen(outer, 5, {})).toBe(true)
    expect(isGroupOpen(outer, 0, {})).toBe(false)
    expect(isGroupOpen(outer, 5, { [outer.id]: false })).toBe(false)
    expect(isGroupOpen(outer, 0, { [outer.id]: true })).toBe(true)
  })
})
