import { describe, expect, it } from 'vitest'
import { runTraced } from './harness'

function texts(source: string, kind: string): string[] {
  return runTraced(source)
    .steps.filter((s) => s.kind === kind)
    .map((s) => s.text)
}

describe('narration uses real values', () => {
  it('puts both recursive results into a fibonacci return', () => {
    const source =
      'function fib(n) {\n  if (n <= 1) return n;\n  return fib(n - 1) + fib(n - 2);\n}\nfib(3);'
    expect(texts(source, 'return').at(-1)).toBe('`fib(3)` is `1 + 1`, so it returns `2`.')
  })

  it('says which call an argument call is needed for', () => {
    const source = 'function f(x) { return x + 1 }\nfunction g(x) { return x * 2 }\nf(g(3));'
    expect(texts(source, 'call')).toEqual([
      '`f(g(3))` needs `g(3)` first, so call it.',
      'Call `f(6)`.',
    ])
  })

  it('uses a call result in an assignment', () => {
    const source = 'function two() { return 2 }\nlet x = 1;\nx = x + two();'
    expect(texts(source, 'assign')).toEqual(['Set `x` to `3`: `x + two()` is `1 + 2`.'])
  })

  it('uses a call result in a condition', () => {
    const source = 'function big(n) { return n > 5 }\nif (big(9)) { 1 }'
    expect(texts(source, 'branch')).toEqual(['`big(9)` is true, so run the `if` branch.'])
  })

  it('does not reuse the result of a call that did not run this time', () => {
    const source = `function side(n) { return n }
let hit = true;
let out = [];
for (let i = 0; i < 2; i++) {
  out.push(hit && side(i) > -1 ? 'a' : 'b');
  hit = false;
}
out;`
    const conditions = texts(source, 'branch').filter((t) => t.includes('side'))
    expect(conditions).toEqual([
      '`hit && side(i) > -1` is `true && 0 > -1`, which is true, so use the value before the `:`.',
      // `side` was skipped, so its old result (0) must not appear; only `i` is filled in.
      '`hit && side(i) > -1` is `false && side(1) > -1`, which is false, so use the value after the `:`.',
    ])
  })

  it('leaves out results that are too long to read inline', () => {
    const source = 'function big() { return "x".repeat(100) }\nlet s = "";\ns = s + big();'
    expect(texts(source, 'assign')[0]).toMatch(/: `s \+ big\(\)` is `"" \+ big\(\)`\.$/)
  })
})
