import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { FACTORIAL, expandAll, pasteCode, pressRun, traceRow, traceRows } from './helpers'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Execution Flow Tracer' })).toBeVisible()
})

test('paste factorial, run, get 6, jump to step 7 and see true', async ({ page }) => {
  await pasteCode(page, FACTORIAL)
  await pressRun(page)

  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByText('6', { exact: true })).toBeVisible()
  await expect(result.getByText('number')).toBeVisible()

  await expandAll(page)
  await traceRow(page, 7).click()
  const current = page.getByRole('region', { name: 'Current value' })
  await expect(current.getByText('Step 7 of 11 · line 2')).toBeVisible()
  await expect(current.getByText('true', { exact: true })).toBeVisible()
  await expect(page.locator('button[data-step][aria-current="step"]')).toHaveCount(1)
  await expect(page.locator('.cm-trace-line')).toContainText('if (n <= 1) return 1;')
  await expect(page.locator('.cm-value-chip')).toHaveText('→ true')
  // The result does not change as you step.
  await expect(result.getByText('6', { exact: true })).toBeVisible()

  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('typing or pasting code never runs it, only the Run button does', async ({ page }) => {
  await pasteCode(page, 'console.log("ran");\n1;')
  await page.locator('.cm-content').pressSequentially(' ')
  await expect(page.getByText('Press Run to see the result.')).toBeVisible()
  await expect(page.locator('iframe')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Console' })).toContainText('Nothing printed')

  await pressRun(page)
  await expect(page.getByRole('region', { name: 'Console' })).toContainText('Nothing printed')
  await traceRow(page, 1).click()
  await expect(
    page.getByRole('region', { name: 'Result' }).getByText('1', { exact: true }),
  ).toBeVisible()
  await traceRow(page, 2).click()
  await expect(page.getByRole('region', { name: 'Console' })).toContainText('ran')
})

test('the editor is read-only while replaying and editable again after Edit code', async ({
  page,
}) => {
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'false')
  await page.getByRole('button', { name: 'Edit code' }).click()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
  await expect(page.getByText('Press Run to see the result.')).toBeVisible()
})

test('arrow keys step, and Space replays and pauses', async ({ page }) => {
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Step 3 of 11', { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('Step 2 of 11', { exact: true })).toBeVisible()

  await page.getByRole('combobox', { name: 'Speed' }).click()
  await page.getByRole('option', { name: '2x' }).click()
  await page.getByRole('button', { name: 'Replay' }).click()
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible()
  await expect(page.getByText('Step 11 of 11', { exact: true })).toBeVisible({ timeout: 10_000 })
  await expect(page.getByRole('button', { name: 'Replay' })).toBeVisible()
})

test('the scrubber and the back button move through the run', async ({ page }) => {
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  const slider = page.getByRole('slider', { name: 'Step' })
  await slider.focus()
  await page.keyboard.press('End')
  await expect(page.getByText('Step 11 of 11', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Back to the first step' }).click()
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
})

test('a frame in the call stack can be inspected', async ({ page }) => {
  await pressRun(page)
  await expandAll(page)
  await traceRow(page, 7).click()
  await page
    .getByRole('region', { name: 'Call stack' })
    .getByRole('button', { name: /factorial\(3\)/ })
    .click()
  await expect(page.getByText('Variables in factorial(3)')).toBeVisible()
})

test('a syntax error shows inline at its line and runs nothing', async ({ page }) => {
  await pasteCode(page, 'let a = 1;\nlet = = 2;')
  await pressRun(page)
  await expect(page.locator('.cm-error-chip')).toContainText('SyntaxError')
  await expect(page.locator('.cm-error-line')).toContainText('let = = 2;')
  await expect(page.getByText(/Line 2 has a syntax error, so nothing ran/)).toBeVisible()
  await expect(page.locator('.cm-content')).toHaveAttribute('contenteditable', 'true')
})

test('a thrown error replaces the result and ends the trace', async ({ page }) => {
  await pasteCode(page, 'function f() {\n  throw new RangeError("too big");\n}\nf();')
  await pressRun(page)
  const result = page.getByRole('region', { name: 'Result' })
  await expect(result.getByText('RangeError: too big')).toBeVisible()
  await expect(result.getByText(/Thrown on line 2/)).toBeVisible()
  // The error is inside the call to f, which is folded until the trace reaches it.
  await expandAll(page)
  await expect(traceRows(page).last()).toContainText('error')
})

test('an infinite loop is stopped, a banner says so and the page stays responsive', async ({
  page,
}) => {
  await pasteCode(page, 'let n = 0;\nwhile (true) {\n  n++;\n}')
  await pressRun(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByText('Running…')).toBeVisible()
  // Still responsive while the sandbox spins: the page answers, and the Edit button is there.
  expect(await page.evaluate(() => 1 + 1)).toBe(2)
  await expect(page.getByText('The run was stopped')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('Timed out after 3 s, possible infinite loop').first()).toBeVisible()
  await expect(page.getByText(/The first 2000 steps are shown/)).toBeVisible()
  await expect(page.getByText('Only the first 2000 steps are shown')).toHaveCount(0)
  await expect(traceRows(page)).toHaveCount(2000)
})

test('a run with more than 2,000 steps still shows the right result', async ({ page }) => {
  await pasteCode(page, 'let s = 0;\nfor (let i = 0; i < 1000; i++) {\n  s += i;\n}\ns;')
  await pressRun(page)
  await expect(page.getByRole('region', { name: 'Result' }).getByText('499500')).toBeVisible()
  await expect(page.getByText('Only the first 2000 steps are shown')).toBeVisible()
})

test('a class runs and its lines are marked as not traced', async ({ page }) => {
  await pasteCode(page, 'class A {\n  m() { return 2 }\n}\nnew A().m();')
  await pressRun(page)
  await expect(
    page.getByRole('region', { name: 'Result' }).getByText('2', { exact: true }),
  ).toBeVisible()
  await expect(page.locator('.cm-not-traced')).toHaveCount(3)
})

test('the examples dropdown loads and runs fibonacci and the sum loop', async ({ page }) => {
  await page.getByRole('combobox', { name: 'Example' }).click()
  await page.getByRole('option', { name: 'fibonacci(4)' }).click()
  await expect(page.locator('.cm-content')).toContainText('fibonacci')
  await pressRun(page)
  await expect(
    page.getByRole('region', { name: 'Result' }).getByText('3', { exact: true }),
  ).toBeVisible()

  await page.getByRole('combobox', { name: 'Example' }).click()
  await page.getByRole('option', { name: 'Sum loop' }).click()
  await pressRun(page)
  await expect(
    page.getByRole('region', { name: 'Result' }).getByText('15', { exact: true }),
  ).toBeVisible()
})

test('console output shows up to the current step', async ({ page }) => {
  await pasteCode(page, 'console.log("one");\nconsole.log("two");')
  await pressRun(page)
  await traceRow(page, 1).click()
  const consolePanel = page.getByRole('region', { name: 'Console' })
  await expect(consolePanel.getByRole('listitem')).toHaveText(['one'])
  await traceRow(page, 2).click()
  await expect(consolePanel.getByRole('listitem')).toHaveText(['one', 'two'])
})

test('the layout works at phone width without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 })
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})

test('on a narrow screen the controls stay in view however far the page is scrolled', async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 })
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeInViewport()
  const next = page.getByRole('button', { name: 'Next step' })
  await expect(next).toBeInViewport()
  await page.mouse.wheel(0, 3000)
  await expect(next).toBeInViewport()
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
  await next.click()
  await expect(page.getByText('Step 2 of 11', { exact: true })).toBeInViewport()
})

test('on a wide screen the page fits the window and only the panels scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('combobox', { name: 'Example' }).click()
  await page.getByRole('option', { name: 'fibonacci(4)' }).click()
  await pressRun(page)
  await expandAll(page)
  await expect(traceRows(page)).toHaveCount(29)

  const fit = await page.evaluate(() => ({
    scroll: document.documentElement.scrollHeight,
    client: document.documentElement.clientHeight,
  }))
  expect(fit.scroll).toBeLessThanOrEqual(fit.client)
  await expect(page.getByRole('button', { name: 'Next step' })).toBeInViewport()

  // The trace has more rows than fit, so it scrolls inside its own panel.
  const trace = page.getByRole('region', { name: 'Execution trace' }).locator('ol')
  const box = await trace.evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }))
  expect(box.scroll).toBeGreaterThan(box.client)
  await expect(page.getByRole('region', { name: 'Result' })).toBeInViewport({ ratio: 1 })
})

test('the trace folds each call to one row and opens the one being run', async ({ page }) => {
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  // Before anything runs inside factorial(3), it is one row between the declaration and the end.
  await expect(traceRows(page)).toHaveCount(3)
  await expect(traceRow(page, 2)).toContainText('9 steps')

  // Stepping into it opens it and the calls inside it, one by one.
  for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Step 7 of 11', { exact: true })).toBeVisible()
  await expect(traceRows(page)).toHaveCount(11)
  await expect(page.locator('button[data-step][aria-current="step"]')).toHaveText(/true/)

  // Once the call returns, it folds again and says what it gave.
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByRole('button', { name: 'Next step' }).click()
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText('Step 11 of 11', { exact: true })).toBeVisible()
  await expect(traceRows(page)).toHaveCount(3)
  await expect(traceRow(page, 2)).toContainText('→ 6 · 9 steps')
})

test('a call can be opened and folded by hand, and Fold to current undoes it', async ({ page }) => {
  await pressRun(page)
  await expect(traceRows(page)).toHaveCount(3)
  await page.getByRole('button', { name: 'Unfold factorial(3)' }).click()
  await expect(traceRows(page)).toHaveCount(6)
  // The choice sticks while stepping.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByText('Step 2 of 11', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Fold factorial(3)' })).toBeVisible()
  await page.getByRole('button', { name: 'Fold factorial(3)' }).click()
  await expect(traceRows(page)).toHaveCount(3)

  await expandAll(page)
  await expect(traceRows(page)).toHaveCount(11)
  await page.getByRole('button', { name: 'Fold to current' }).click()
  // Back to the rule: factorial(3) holds the current step 2, so it is open and its inner call is not.
  await expect(traceRows(page)).toHaveCount(6)
})

test('the theme follows the system, can be switched, and is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  const html = page.locator('html')
  await expect(html).toHaveAttribute('data-theme', 'dark')
  const toggle = page.getByRole('switch', { name: 'Dark mode' })
  await expect(toggle).toBeChecked()
  const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)

  await toggle.click()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(toggle).not.toBeChecked()
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(dark)

  // The saved choice beats the system setting on the next visit.
  await page.reload()
  await expect(html).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('switch', { name: 'Dark mode' })).not.toBeChecked()
})

test('dark mode has no serious accessibility violations, with an error showing', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await pasteCode(page, 'function f() {\n  throw new RangeError("too big");\n}\nf();')
  await pressRun(page)
  await expect(page.getByText(/Thrown on line 2/)).toBeVisible()
  await expandAll(page)

  const violations = (await new AxeBuilder({ page }).analyze()).violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('the open menus are readable in dark mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await page.getByRole('combobox', { name: 'Example' }).click()
  await expect(page.getByRole('option', { name: 'Sum loop' })).toBeVisible()
  // Radix hides the page from assistive technology while a menu is open and leaves focusable
  // elements inside the hidden part, which axe reports. That is the same in light mode.
  const violations = (
    await new AxeBuilder({ page }).disableRules(['aria-hidden-focus']).analyze()
  ).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([])
})

test('running or stepping does not scroll the page away from the header', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await pressRun(page)
  await expect(page.getByText('Step 1 of 11', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Next step' }).click()
  await expect(page.getByText('Step 2 of 11', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  await expect(page.getByRole('heading', { name: 'Execution Flow Tracer' })).toBeInViewport()
})

test('the trace list scrolls to keep the current step in view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 })
  await page.getByRole('combobox', { name: 'Example' }).click()
  await page.getByRole('option', { name: 'Sum loop' }).click()
  await pressRun(page)
  await expect(page.getByText(/^Step 1 of \d+$/)).toBeVisible()
  const slider = page.getByRole('slider', { name: 'Step' })
  await slider.focus()
  await page.keyboard.press('End')
  const last = page.locator('button[data-step][aria-current="step"]')
  await expect(last).toBeInViewport()
  const list = page.getByRole('region', { name: 'Execution trace' }).locator('ol')
  expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  await page.keyboard.press('Home')
  await expect(last).toBeInViewport()
  // Back at the top, apart from the list's own 6px of padding.
  expect(await list.evaluate((el) => el.scrollTop)).toBeLessThanOrEqual(6)
})
