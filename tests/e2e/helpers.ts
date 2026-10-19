import type { Page } from '@playwright/test'

/**
 * Replaces the code in the editor by selecting it all and typing, with real key presses. (Firefox
 * emulates `insertText` with composition events, which leaves CodeMirror empty, and a synthetic
 * paste event carries no data there.) Nothing runs until Run is pressed.
 */
export async function pasteCode(page: Page, code: string): Promise<void> {
  const edit = page.getByRole('button', { name: 'Edit code' })
  if (await edit.isEnabled()) await edit.click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type(code)
}

/** A row of the execution trace by its step number (1-based). It exists only while its call is open. */
export function traceRow(page: Page, step: number) {
  return page.locator(`button[data-step="${String(step)}"]`)
}

/** Every row of the trace that is on screen. */
export function traceRows(page: Page) {
  return page.locator('button[data-step]')
}

export async function expandAll(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Expand all' }).click()
}

export async function pressRun(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Run', exact: true }).click()
}

export const FACTORIAL = `function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(3);`
