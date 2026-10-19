import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

async function runCode(page: Page, code: string) {
  return page.evaluate((source) => window.tracerRun(source), code)
}

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/e2e/harness.html')
  await page.waitForFunction(() => typeof window.tracerRun === 'function')
})

test('returns the value of the last expression', async ({ page }) => {
  const result = await runCode(page, '1 + 1')
  expect(result.status).toBe('finished')
  expect(result.result).toEqual({ type: 'number', text: '2' })
  expect(result.durationMs).toBeLessThan(2000)
})

test('returns a trace that passes validation across the sandbox boundary', async ({ page }) => {
  const result = await runCode(page, 'function add(a, b) { return a + b }\nadd(2, 3)')
  expect(result.status).toBe('finished')
  expect(result.result?.text).toBe('5')
  expect(result.steps.map((s) => s.kind)).toEqual(['declare', 'call', 'return', 'end'])
  expect(result.steps[1]?.stack.map((f) => f.fn)).toEqual(['<main>', 'add'])
})

test('collects console output in order', async ({ page }) => {
  const result = await runCode(
    page,
    `console.log('a'); console.warn('b'); console.error('c', {x: 1}); 0`,
  )
  expect(result.output).toEqual([
    { level: 'log', text: 'a' },
    { level: 'warn', text: 'b' },
    { level: 'error', text: 'c {x: 1}' },
  ])
})

test('reports a thrown error', async ({ page }) => {
  const result = await runCode(page, `throw new TypeError('boom')`)
  expect(result.status).toBe('error')
  expect(result.error?.name).toBe('TypeError')
  expect(result.error?.message).toBe('boom')
})

test('reports a syntax error without crashing', async ({ page }) => {
  const result = await runCode(page, 'let = = 1')
  expect(result.status).toBe('error')
  expect(result.error?.name).toBe('SyntaxError')
})

test('cannot see document, window or the network globals', async ({ page }) => {
  const result = await runCode(
    page,
    `[typeof document, typeof window, typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof localStorage].join()`,
  )
  expect(result.result?.text).toBe('"undefined,undefined,undefined,undefined,undefined,undefined"')
})

test('stops an infinite loop after 3 seconds and the page stays responsive', async ({ page }) => {
  await page.evaluate(() => {
    window.__pending = window.tracerRun('while (true) {}')
  })
  // The main thread is free while the sandbox spins.
  expect(await page.evaluate(() => 1 + 1)).toBe(2)
  const result = await page.evaluate(() => window.__pending)
  expect(result.status).toBe('timeout')
  expect(result.durationMs).toBeGreaterThanOrEqual(2900)
  expect(result.durationMs).toBeLessThan(5000)
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('shares no state between runs', async ({ page }) => {
  await runCode(page, 'var leaked = 1; globalThis.alsoLeaked = 2')
  const result = await runCode(page, 'typeof leaked + typeof alsoLeaked')
  expect(result.result?.text).toBe('"undefinedundefined"')
})

test('leaves no iframe behind', async ({ page }) => {
  await runCode(page, '1')
  await expect(page.locator('iframe')).toHaveCount(0)
})

test('the app page cookies and storage are out of reach', async ({ page }) => {
  await page.evaluate(() => {
    document.cookie = 'secret=1'
    localStorage.setItem('secret', '1')
  })
  const result = await runCode(page, `typeof document + typeof localStorage + typeof parent`)
  expect(result.result?.text).toBe('"undefinedundefinedundefined"')
})

test('a nested Worker cannot reach the network', async ({ page }) => {
  const probe = 'https://tracer-probe.test/ping'
  const hits: string[] = []
  await page.route('https://tracer-probe.test/**', (route) => {
    hits.push(route.request().url())
    return route.fulfill({ body: 'ok', headers: { 'access-control-allow-origin': '*' } })
  })

  // Control: the same probe from a plain blob Worker on the page does reach the network.
  await page.evaluate(async (url) => {
    const src = `fetch(${JSON.stringify(url)}).then(() => postMessage(1), () => postMessage(0))`
    const w = new Worker(URL.createObjectURL(new Blob([src])))
    await new Promise((resolve) => {
      w.onmessage = resolve
    })
  }, probe)
  expect(hits).toHaveLength(1)
  hits.length = 0

  // In the sandbox: spawn the Worker, then keep the run alive long enough for it to try.
  await runCode(
    page,
    `
    const src = 'fetch(${probe}).catch(() => {}); new WebSocket("wss://tracer-probe.test/ws"); try { new XMLHttpRequest().open("GET", "${probe}") } catch {}';
    new Worker(URL.createObjectURL(new Blob([src])));
    const t = Date.now(); while (Date.now() - t < 700) {}
    `,
  )
  expect(hits).toHaveLength(0)
})
