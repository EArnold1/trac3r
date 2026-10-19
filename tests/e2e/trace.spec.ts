import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function runCode(page: Page, code: string) {
  return page.evaluate((source) => window.tracerRun(source), code)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/e2e/harness.html')
  await page.waitForFunction(() => typeof window.tracerRun === 'function')
})

const FACTORIAL = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(3);`

test('factorial(3) gives 6 and the 11 steps of the spec', async ({ page }) => {
  const run = await runCode(page, FACTORIAL)
  expect(run.status).toBe('finished')
  expect(run.result?.text).toBe('6')
  expect(
    run.steps.map((s) => [
      s.kind,
      s.loc.line,
      s.value?.text ?? null,
      s.stack
        .map((f) => (f.fn === '<main>' ? 'main' : `f(${f.args.map((a) => a.text).join()})`))
        .join(),
    ]),
  ).toEqual([
    ['declare', 1, null, 'main'],
    ['call', 5, null, 'main,f(3)'],
    ['branch', 2, 'false', 'main,f(3)'],
    ['call', 3, null, 'main,f(3),f(2)'],
    ['branch', 2, 'false', 'main,f(3),f(2)'],
    ['call', 3, null, 'main,f(3),f(2),f(1)'],
    ['branch', 2, 'true', 'main,f(3),f(2),f(1)'],
    ['return', 2, '1', 'main,f(3),f(2)'],
    ['return', 3, '2', 'main,f(3)'],
    ['return', 3, '6', 'main'],
    ['end', 5, '6', ''],
  ])
})

test('a runtime error is reported at the line where it happened', async ({ page }) => {
  const run = await runCode(page, 'let a = null;\nfunction f() {\n  return a.x;\n}\nf();')
  expect(run.status).toBe('error')
  expect(run.error?.name).toBe('TypeError')
  expect(run.error?.line).toBe(3)
  const last = run.steps.at(-1)
  expect(last?.kind).toBe('error')
  expect(last?.loc.line).toBe(3)
  expect(last?.stack.map((f) => f.fn)).toEqual(['<main>', 'f'])
})

test('a thrown error ends the trace at the throw', async ({ page }) => {
  const run = await runCode(page, 'function f() {\n  throw new RangeError("bad");\n}\nf();')
  expect(run.error).toEqual({ name: 'RangeError', message: 'bad', line: 2 })
  expect(run.steps.at(-1)?.kind).toBe('error')
  expect(run.steps.some((s) => s.kind === 'end')).toBe(false)
})

test('a syntax error is reported with its line before anything runs', async ({ page }) => {
  const run = await runCode(page, 'let a = 1;\nlet = = 2;')
  expect(run.status).toBe('error')
  expect(run.error?.name).toBe('SyntaxError')
  expect(run.error?.line).toBe(2)
  expect(run.steps).toEqual([])
})

test('console output is a step with the lines so far', async ({ page }) => {
  const run = await runCode(page, 'console.log("a");\nconsole.log("b");')
  expect(run.output.map((o) => o.text)).toEqual(['a', 'b'])
  const prints = run.steps.filter((s) => s.kind === 'output')
  expect(prints.map((s) => s.output)).toEqual([['a'], ['a', 'b']])
})

test('while (true) {} times out and keeps the first 2,000 steps', async ({ page }) => {
  const run = await runCode(page, 'let n = 0;\nwhile (true) {\n  n++;\n}')
  expect(run.status).toBe('timeout')
  expect(run.steps).toHaveLength(2000)
  expect(run.truncated).toBe(true)
  expect(run.steps[0]?.kind).toBe('declare')
})

test('a loop with no steps at all still times out', async ({ page }) => {
  const run = await runCode(page, 'class A {}\nfor (;;) {}')
  expect(run.status).toBe('timeout')
  expect(run.steps).toEqual([])
  expect(run.notTraced).toEqual([{ line: 1, endLine: 1, reason: 'class' }])
})

test('infinite recursion reports the engine stack overflow and the trace so far', async ({
  page,
}) => {
  // Summarised inside the page: handing 2,000 deep stacks to Node would measure Playwright.
  const run = await page.evaluate(async () => {
    const result = await window.tracerRun('function r(n) {\n  return r(n + 1);\n}\nr(0);')
    return {
      status: result.status,
      name: result.error?.name,
      steps: result.steps.length,
      truncated: result.truncated,
      durationMs: result.durationMs,
    }
  })
  expect(run.status).toBe('error')
  // Firefox calls it InternalError: too much recursion.
  expect(['RangeError', 'InternalError']).toContain(run.name)
  expect(run.steps).toBeGreaterThan(100)
  expect(run.steps).toBeLessThanOrEqual(2000)
  expect(run.durationMs).toBeLessThan(3000)
  console.log(`recursion: ${String(run.steps)} steps in ${run.durationMs.toFixed(0)} ms`)
})

test('more than 2,000 steps still gives the right result', async ({ page }) => {
  const run = await runCode(page, 'let s = 0;\nfor (let i = 0; i < 1000; i++) {\n  s += i;\n}\ns;')
  expect(run.status).toBe('finished')
  expect(run.result?.text).toBe('499500')
  expect(run.steps).toHaveLength(2000)
  expect(run.truncated).toBe(true)
})

test('a class runs and its lines are marked as not traced', async ({ page }) => {
  const run = await runCode(page, 'class A {\n  m() { return 2 }\n}\nnew A().m();')
  expect(run.status).toBe('finished')
  expect(run.result?.text).toBe('2')
  expect(run.notTraced).toEqual([{ line: 1, endLine: 3, reason: 'class' }])
})
