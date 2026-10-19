import { describe, expect, it } from 'vitest'
import { runPlain, runTraced } from './harness'

const SUM = `let sum = 0;
for (let i = 1; i <= 5; i++) {
  sum += i;
}
sum;`

describe('a for loop summing 1 to 5', () => {
  const traced = runTraced(SUM)

  it('gives the result 15, the same as without tracing', () => {
    expect(traced.result?.text).toBe('15')
    expect(runPlain(SUM).result).toEqual(traced.result)
  })

  it('has one condition step per iteration, then one that ends the loop', () => {
    const tests = traced.steps.filter((s) => s.kind === 'branch')
    expect(tests.map((s) => s.value?.text)).toEqual([
      'true',
      'true',
      'true',
      'true',
      'true',
      'false',
    ])
    expect(tests[0]?.text).toBe('`i <= 5` is `1 <= 5`, which is true, so run the loop body.')
    expect(tests[5]?.text).toBe('`i <= 5` is `6 <= 5`, which is false, so the loop ends.')
  })

  it('shows the variables changing each iteration', () => {
    const sums = traced.steps
      .filter((s) => s.kind === 'assign' && s.expr === 'sum += i')
      .map((s) => s.stack[0]?.vars.sum?.text)
    expect(sums).toEqual(['1', '3', '6', '10', '15'])

    const counters = traced.steps
      .filter((s) => s.kind === 'branch')
      .map((s) => s.stack[0]?.vars.i?.text)
    expect(counters).toEqual(['1', '2', '3', '4', '5', '6'])
  })
})

describe('other loops', () => {
  it('traces a while loop', () => {
    const source = 'let n = 3; while (n > 0) { n--; } n'
    const traced = runTraced(source)
    expect(traced.result?.text).toBe('0')
    expect(traced.steps.filter((s) => s.kind === 'branch').map((s) => s.value?.text)).toEqual([
      'true',
      'true',
      'true',
      'false',
    ])
  })

  it('traces a do-while loop, which tests after the first pass', () => {
    const source = 'let n = 0; do { n++; } while (n < 2); n'
    const traced = runTraced(source)
    expect(traced.result?.text).toBe('2')
    const tests = traced.steps.filter((s) => s.kind === 'branch')
    expect(tests.map((s) => s.text.split(', so ')[1])).toEqual([
      'run the loop body again.',
      'the loop ends.',
    ])
  })

  it('runs a for loop with no test and a for-of without a condition step', () => {
    const traced = runTraced('let s = 0; for (const x of [1, 2, 3]) { s += x } s')
    expect(traced.result?.text).toBe('6')
    expect(traced.steps.filter((s) => s.kind === 'branch')).toHaveLength(0)
  })
})
