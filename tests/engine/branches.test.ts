import { describe, expect, it } from 'vitest'
import { runPlain, runTraced } from './harness'

const GRADE = `function grade(n) {
  if (n >= 90) return "A";
  else if (n >= 80) return "B";
  else return "C";
}
grade(85);`

function conditions(source: string): string[] {
  return runTraced(source)
    .steps.filter((s) => s.kind === 'branch')
    .map((s) => s.text)
}

describe('an if / else if / else chain', () => {
  it('takes the right branch, the same as without tracing', () => {
    for (const [score, expected] of [
      [95, 'A'],
      [85, 'B'],
      [10, 'C'],
    ] as const) {
      const source = GRADE.replace('grade(85)', `grade(${String(score)})`)
      expect(runTraced(source).result?.text).toBe(`"${expected}"`)
      expect(runPlain(source).result?.text).toBe(`"${expected}"`)
    }
  })

  it('says why: each condition with its values and the path taken', () => {
    expect(conditions(GRADE)).toEqual([
      '`n >= 90` is `85 >= 90`, which is false, so check the next condition.',
      '`n >= 80` is `85 >= 80`, which is true, so take the early return.',
    ])
  })

  it('skips conditions after the one that matched', () => {
    expect(conditions(GRADE.replace('grade(85)', 'grade(95)'))).toHaveLength(1)
  })
})

describe('if without returns', () => {
  const SOURCE = (x: number) => `let x = ${String(x)};
let r;
if (x > 5) {
  r = "big";
} else {
  r = "small";
}
r;`

  it('names the if and the else branch', () => {
    expect(conditions(SOURCE(9))).toEqual([
      '`x > 5` is `9 > 5`, which is true, so run the `if` branch.',
    ])
    expect(conditions(SOURCE(1))).toEqual([
      '`x > 5` is `1 > 5`, which is false, so run the `else` branch.',
    ])
  })

  it('says it skips the if when there is no else', () => {
    expect(conditions('let x = 1; if (x > 5) { x = 0 }')).toEqual([
      '`x > 5` is `1 > 5`, which is false, so skip the `if` branch.',
    ])
  })
})

describe('other conditions', () => {
  it('explains a condition that is not a boolean', () => {
    expect(conditions('let name = "ada"; if (name) { name = "x" }')).toEqual([
      '`name` is `"ada"`, which is truthy, so run the `if` branch.',
    ])
    expect(conditions('let n = 0; if (n) { n = 1 }')).toEqual([
      '`n` is `0`, which is falsy, so skip the `if` branch.',
    ])
  })

  it('traces a ternary', () => {
    const traced = runTraced('const a = 4; const b = a > 3 ? "hi" : "lo"; b')
    expect(traced.result?.text).toBe('"hi"')
    expect(conditions('const a = 4; const b = a > 3 ? "hi" : "lo"')).toEqual([
      '`a > 3` is `4 > 3`, which is true, so use the value before the `:`.',
    ])
  })

  it('keeps a comma expression in a condition or return as one value', () => {
    expect(runTraced('let a = 0; if ((a++, a)) { a = 10 } a').result?.text).toBe('10')
    expect(runTraced('function f() { return 1, 2 } f()').result?.text).toBe('2')
  })
})
