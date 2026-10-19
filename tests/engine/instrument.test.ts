import { describe, expect, it } from 'vitest'
import { EXAMPLES } from '../../src/app/examples'
import { runPlain, runTraced, summarize } from './harness'

/** Programs that must give the same result with and without tracing. */
const PROGRAMS: Record<string, string> = {
  'declarations and a result': 'let a = 1; const b = 2; var c = a + b; c * 2',
  'result survives a trailing declaration': '1 + 1; let a = 2;',
  'result survives a trailing function declaration': '5; function f() {}',
  'function call': 'function add(a, b) { return a + b } add(2, 3)',
  recursion: 'function fact(n) { return n <= 1 ? 1 : n * fact(n - 1) } fact(6)',
  'arrow with expression body': 'const sq = (x) => x * x; sq(7)',
  'arrow returning an object literal': 'const mk = (x) => ({ a: x }); mk(3).a',
  'arrow with a parenthesized body': 'const f = (x) => (x + 1); f(1)',
  'implicit return': 'function f() { 1 + 1 } f()',
  'default and rest parameters':
    'function f(a, b = 2, ...c) { return a + b + c.length } f(1, undefined, 5, 6)',
  'nested calls as arguments':
    'function f(x) { return x + 1 } function g(x) { return x * 2 } f(g(3))',
  closures: 'function counter() { let n = 0; return () => ++n } const c = counter(); c(); c(); c()',
  'compound assignment': 'let s = 0; s += 5; s *= 3; s -= 1; s',
  'update expressions': 'let i = 0; i++; ++i; i--; i',
  'member assignment': 'const o = { n: 1 }; o.n = 5; o.n += 1; o.n',
  'array writes and push': 'const a = [1, 2]; a[0] = 9; a.push(4); a',
  'destructuring declaration':
    'const { x, y } = { x: 1, y: 2 }; const [p, q] = [3, 4]; x + y + p + q',
  'destructuring assignment': 'let a = 1, b = 2; [a, b] = [b, a]; a * 10 + b',
  'chained assignment': 'let a, b; a = b = 4; a + b',
  'optional chaining': 'const o = null; o?.f(1) ?? "none"',
  'optional chain with a call': 'const o = { f() { return { g: () => 5 } } }; o?.f().g()',
  'method calls keep this': 'const o = { v: 3, get() { return this.v } }; o.get()',
  'new and constructor functions': 'function P(x) { this.x = x } new P(4).x',
  'use strict stays a directive': "function f() { 'use strict'; return this } f() === undefined",
  'a const assigned twice throws the same': 'const a = 1; try { a = 2 } catch (e) { e.name }',
  'var hoisting': 'function f() { return typeof v; var v = 1 } f()',
  'loop with statements': 'let s = 0; for (let i = 0; i < 5; i++) { s += i } s',
  'loop body without braces': 'let s = 0; for (let i = 0; i < 4; i++) s += i; s',
  'if without braces': 'let x = 0; if (true) x = 1; x',
  switch: 'let r; switch (2) { case 1: r = "a"; break; case 2: r = "b"; break } r',
  'try catch finally': 'let r = 0; try { null.x } catch (e) { r = 1 } finally { r += 10 } r',
  'getters and setters': 'const o = { get a() { return 1 }, set a(v) {} }; o.a',
  'class declaration': 'class A { constructor() { this.v = 2 } m() { return this.v } } new A().m()',
  generator: 'function* g() { yield 1; yield 2 } [...g()].length',
  'async function': 'async function f() { return 1 } typeof f()',
  'callbacks from native code': '[1, 2, 3].map((x) => x * 2).join()',
  'a thrown error': 'function f() { throw new RangeError("boom") } f()',
  'uses console': 'console.log("hi"); 7',
  'value of an if statement': 'if (true) { 3 } else { 4 }',
  'tagged template': 'function t(s) { return s[0] } t`abc`',
  'shadowed variables': 'let x = 1; { let x = 2; x += 1 } x',
  'sloppy this at top level': 'typeof this',
  'while loop': 'let n = 5; let t = 0; while (n > 0) { t += n; n-- } t',
  'do while loop': 'let i = 0; do { i++ } while (i < 3); i',
  'break and continue':
    'let s = 0; for (let i = 0; i < 10; i++) { if (i % 2) continue; if (i > 6) break; s += i } s',
  'labelled loops':
    'let c = 0; outer: for (let i = 0; i < 3; i++) { for (let j = 0; j < 3; j++) { if (j === 2) continue outer; c++ } } c',
  'a condition with side effects': 'let i = 0; while (i++ < 3) {} i',
  'a for loop with no test': 'let n = 0; for (;;) { if (++n > 3) break } n',
  'nested ternaries':
    'const f = (n) => n < 0 ? "neg" : n === 0 ? "zero" : "pos"; f(-1) + f(0) + f(5)',
  'a comma in a return': 'function f() { return 1, 2 } f()',
  'a comma in a condition': 'let a = 0; if ((a++, a)) { a = 10 } a',
  'an undeclared name in a skipped branch': 'let r = 0; if (false && undeclared) { r = 1 } r',
  'typeof an undeclared name': 'let r = 0; if (typeof missing === "undefined" && 1) { r = 1 } r',
  'a guarded global': 'let r = 0; if (typeof window !== "undefined" && window.x) { r = 1 } r',
  'throwing a string': 'try { throw "x" } catch (e) { e }',
  'catch without a parameter': 'try { null.x } catch { 1 }',
  'catch with a destructured parameter': 'try { throw { a: 1 } } catch ({ a }) { a }',
  'finally after return':
    'let log = 0; function f() { try { return 1 } finally { log = 2 } } f() + log',
  rethrowing:
    'function f() { try { null.x } catch (e) { throw e } } try { f() } catch (e) { e.name }',
  'logical assignment': 'let a = null; a ??= 5; a ||= 7; a &&= 9; a',
  'throw inside a nested call': 'function a() { b() } function b() { throw new Error("deep") } a()',
  'stack overflow': 'function r() { return r() } r()',
}

describe('tracing does not change the result', () => {
  for (const [name, source] of Object.entries(PROGRAMS)) {
    it(name, () => {
      const plain = runPlain(source)
      const traced = runTraced(source)
      expect(traced.result).toEqual(plain.result)
      expect(traced.error).toEqual(plain.error)
      expect(traced.output).toEqual(plain.output)
    })
  }
})

describe('every example in the app', () => {
  const expected: Record<string, string> = { factorial: '6', fibonacci: '3', 'sum-loop': '15' }
  for (const example of EXAMPLES) {
    it(`${example.label} gives the same result with and without tracing`, () => {
      const plain = runPlain(example.source)
      const traced = runTraced(example.source)
      expect(traced.result).toEqual(plain.result)
      expect(traced.result?.text).toBe(expected[example.id])
      expect(traced.error).toBeUndefined()
    })
  }
})

describe('instrumented code', () => {
  it('keeps every line where it was', () => {
    const source = 'function f(a) {\n  const b = a + 1\n  return b\n}\nlet x = f(1)\nx'
    const { code } = runTraced(source)
    expect(code.split('\n')).toHaveLength(source.split('\n').length)
  })
})

describe('declarations, assignments, calls and returns', () => {
  it('traces a function declaration, a call and a return', () => {
    const { steps, result } = runTraced('function add(a, b) { return a + b }\nadd(2, 3)')
    expect(result?.text).toBe('5')
    expect(summarize(steps)).toEqual([
      'declare 1 - | main',
      'call 2 - | main, add(2,3)',
      'return 1 5 | main',
      'end 2 5 | empty',
    ])
  })

  it('shows variables of every frame and the arguments', () => {
    const { steps } = runTraced('function add(a, b) {\n  const s = a + b\n  return s\n}\nadd(2, 3)')
    const inside = steps.find((s) => s.kind === 'declare' && s.value?.text === '5')
    expect(inside?.stack.map((f) => f.fn)).toEqual(['<main>', 'add'])
    expect(inside?.stack[1]?.vars).toEqual({
      a: { type: 'number', text: '2' },
      b: { type: 'number', text: '3' },
      s: { type: 'number', text: '5' },
    })
    expect(inside?.stack[1]?.callLine).toBe(5)
  })

  it('records a declaration with its value and one without', () => {
    const { steps } = runTraced('let a = 4\nvar b\na')
    expect(steps.slice(0, 2).map((s) => [s.kind, s.loc.line, s.value?.text])).toEqual([
      ['declare', 1, '4'],
      ['declare', 2, 'undefined'],
    ])
    expect(steps[0]?.text).toBe('Declare `a` and set it to `4`.')
    expect(steps[1]?.text).toContain('until it is assigned')
  })

  it('records one declare step per name in a destructuring', () => {
    const { steps } = runTraced('const { x, y } = { x: 1, y: 2 }')
    expect(steps.filter((s) => s.kind === 'declare').map((s) => s.value?.text)).toEqual(['1', '2'])
  })

  it('records assignments with real values in the narration', () => {
    const { steps } = runTraced('let s = 1\nlet i = 2\ns += i\ns = i * 3\ni++')
    const assigns = steps.filter((s) => s.kind === 'assign')
    expect(assigns.map((s) => s.value?.text)).toEqual(['3', '6', '3'])
    expect(assigns[0]?.text).toBe('`s += i` computes `1 + 2`, so `s` is now `3`.')
    expect(assigns[1]?.text).toBe('Set `s` to `6`: `i * 3` is `2 * 3`.')
    expect(assigns[2]?.text).toBe('`i++` changes `i` from `2` to `3`.')
  })

  it('updates the array shown in the variables after a write and a push', () => {
    const { steps } = runTraced('const a = [1, 2]\na[0] = 9\na.push(4)\na')
    const write = steps.find((s) => s.kind === 'assign')
    expect(write?.stack[0]?.vars.a?.text).toBe('[9, 2]')
    const push = steps.find((s) => s.kind === 'call')
    expect(push?.text).toBe('Run `a.push(4)`, which returns `3`.')
    expect(push?.stack[0]?.vars.a?.text).toBe('[9, 2, 4]')
  })

  it('pushes and pops frames in order for f(g(x))', () => {
    const { steps } = runTraced(
      'function f(x) { return x + 1 }\nfunction g(x) { return x * 2 }\nf(g(3))',
    )
    expect(summarize(steps)).toEqual([
      'declare 1 - | main',
      'declare 2 - | main',
      'call 3 - | main, g(3)',
      'return 2 6 | main',
      'call 3 - | main, f(6)',
      'return 1 7 | main',
      'end 3 7 | empty',
    ])
  })

  it('records an implicit return as returning undefined', () => {
    const { steps } = runTraced('function f() {\n  1 + 1\n}\nf()')
    const ret = steps.find((s) => s.kind === 'return')
    expect(ret?.value?.text).toBe('undefined')
    expect(ret?.stack.map((f) => f.fn)).toEqual(['<main>'])
  })

  it('names functions from where they are stored', () => {
    const { steps } = runTraced('const add = (a, b) => a + b\nadd(1, 2)')
    expect(steps.find((s) => s.kind === 'call')?.stack[1]?.fn).toBe('add')
  })

  it('attributes callbacks from native code to the call that started them', () => {
    const { steps } = runTraced('[5].map((x) => x + 1)')
    const call = steps.find((s) => s.kind === 'call')
    expect(call?.loc.line).toBe(1)
    expect(call?.stack.map((f) => f.fn)).toEqual(['<main>', '(anonymous)'])
  })

  it('reads a variable changed by a closure from a lower frame', () => {
    const { steps } = runTraced(
      'let count = 0\nfunction inc() { count++ }\nfunction outer() { inc() }\nouter()',
    )
    const update = steps.find((s) => s.kind === 'assign')
    expect(update?.stack[0]?.vars.count?.text).toBe('1')
  })
})

describe('code that is not traced', () => {
  it('runs a class and marks its lines', () => {
    const { result, notTraced, steps } = runTraced('class A {\n  m() { return 2 }\n}\nnew A().m()')
    expect(result?.text).toBe('2')
    expect(notTraced).toEqual([{ line: 1, endLine: 3, reason: 'class' }])
    expect(steps.every((s) => s.stack.length <= 1)).toBe(true)
  })

  it('marks async functions, generators and accessors', () => {
    const { notTraced } = runTraced(
      'async function a() {}\nfunction* g() {}\nconst o = { get x() { return 1 } }',
    )
    expect(notTraced.map((n) => n.reason)).toEqual(['async', 'generator', 'accessor'])
  })
})

describe('the step cap', () => {
  it('keeps the first steps, sets truncated and still returns the right result', () => {
    const source = 'let s = 0; for (let i = 0; i < 50; i++) { s += i } s'
    const { steps, truncated, result } = runTraced(source, 10)
    expect(steps).toHaveLength(10)
    expect(truncated).toBe(true)
    expect(result?.text).toBe('1225')
    expect(runPlain(source).result?.text).toBe('1225')
  })
})
