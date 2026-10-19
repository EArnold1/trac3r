import { describe, expect, it } from 'vitest'
import { runPlain, runTraced, summarize } from './harness'

describe('code that throws', () => {
  const SOURCE = `function check(x) {
  if (x < 0) {
    throw new RangeError("negative");
  }
  return x;
}
check(-1);`
  const traced = runTraced(SOURCE)

  it('reports the error name, message and line', () => {
    expect(traced.error).toEqual({ name: 'RangeError', message: 'negative' })
    expect(traced.errorLine).toBe(3)
    expect(traced.result).toBeUndefined()
    expect(runPlain(SOURCE).error).toEqual(traced.error)
  })

  it('ends the trace at the throw, with the stack as it was', () => {
    const last = traced.steps.at(-1)
    expect(last?.kind).toBe('error')
    expect(last?.loc.line).toBe(3)
    expect(last?.text).toBe('Throw `RangeError: negative`.')
    expect(last?.stack.map((f) => f.fn)).toEqual(['<main>', 'check'])
    expect(traced.steps.some((s) => s.kind === 'end')).toBe(false)
    expect(traced.steps.filter((s) => s.kind === 'error')).toHaveLength(1)
  })

  it('does not record the unwinding as returns', () => {
    expect(summarize(traced.steps)).toEqual([
      'declare 1 - | main',
      'call 7 - | main, check(-1)',
      'branch 2 true | main, check(-1)',
      'error 3 RangeError: negative | main, check(-1)',
    ])
  })
})

describe('runtime errors', () => {
  it('find the line even though nothing was thrown by the program', () => {
    const source = 'let a = null;\nfunction f() {\n  return a.x;\n}\nf();'
    const traced = runTraced(source)
    expect(traced.error?.name).toBe('TypeError')
    expect(traced.errorLine).toBe(3)
    expect(traced.steps.at(-1)).toMatchObject({
      kind: 'error',
      stack: [{ fn: '<main>' }, { fn: 'f' }],
    })
    expect(traced.steps.at(-1)?.loc.line).toBe(3)
  })

  it('find the line at the top level', () => {
    const traced = runTraced('let a = 1;\nlet b = null;\nb.x;')
    expect(traced.errorLine).toBe(3)
    expect(traced.steps.at(-1)?.kind).toBe('error')
  })

  it('find the line of an error thrown by a native function', () => {
    const traced = runTraced('let s = "{";\nJSON.parse(s);')
    expect(traced.error?.name).toBe('SyntaxError')
    expect(traced.errorLine).toBe(2)
  })

  it('report an error that was created on another line where it was thrown', () => {
    const traced = runTraced(
      'function make() {\n  return new Error("made");\n}\nconst e = make();\n\nthrow e;',
    )
    expect(traced.errorLine).toBe(6)
  })

  it('report a thrown value that is not an error', () => {
    const traced = runTraced('let x = 1;\nthrow "oops";')
    expect(traced.error).toEqual({ name: 'Uncaught', message: '"oops"' })
    expect(traced.errorLine).toBe(2)
    expect(traced.steps.at(-1)?.text).toBe('Throw `"oops"`.')
  })
})

describe('errors the program catches', () => {
  const SOURCE = `function risky() {
  throw new Error("bad");
}
let outcome = "none";
try {
  risky();
} catch (e) {
  outcome = e.message;
}
outcome;`
  const traced = runTraced(SOURCE)

  it('carry on and finish', () => {
    expect(traced.result?.text).toBe('"bad"')
    expect(traced.steps.at(-1)?.kind).toBe('end')
    expect(runPlain(SOURCE).result).toEqual(traced.result)
  })

  it('are one error step, at the throw, and the stack unwinds afterwards', () => {
    const errors = traced.steps.filter((s) => s.kind === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.loc.line).toBe(2)
    expect(errors[0]?.stack.map((f) => f.fn)).toEqual(['<main>', 'risky'])
    const after = traced.steps[traced.steps.findIndex((s) => s.kind === 'error') + 1]
    expect(after?.kind).toBe('assign')
    expect(after?.stack.map((f) => f.fn)).toEqual(['<main>'])
  })

  it('record a native error that is caught in the same function', () => {
    const t = runTraced('let r = 0;\ntry {\n  null.x;\n} catch (e) {\n  r = 1;\n}\nr;')
    expect(t.result?.text).toBe('1')
    const error = t.steps.find((s) => s.kind === 'error')
    expect(error?.loc.line).toBe(3)
  })

  it('do not leave a stale call site behind for the next call', () => {
    const t = runTraced(`function boom() { throw new Error("x") }
function ok() { return 1 }
try { boom() } catch (e) {}
ok();`)
    const call = t.steps.find((s) => s.kind === 'call' && s.stack.at(-1)?.fn === 'ok')
    expect(call?.loc.line).toBe(4)
  })
})

describe('infinite recursion', () => {
  const SOURCE = 'function r(n) {\n  return r(n + 1);\n}\nr(0);'

  it('reports the engine stack overflow with the trace up to that point', () => {
    const started = Date.now()
    const traced = runTraced(SOURCE)
    expect(traced.error?.name).toBe('RangeError')
    expect(traced.steps).toHaveLength(2000)
    expect(traced.truncated).toBe(true)
    expect(traced.steps.at(-1)?.stack.length).toBeGreaterThan(900)
    // The stack can run out in the entry hook on line 1 or at the call on line 2.
    expect([1, 2]).toContain(traced.errorLine)
    expect(Date.now() - started).toBeLessThan(2500)
  })
})
