import { describe, expect, it } from 'vitest'
import { BOOTSTRAP_HASH, BOOTSTRAP_SOURCE, SANDBOX_CSP } from '../../src/runtime/bootstrap'

describe('bootstrap', () => {
  it('has a CSP hash that matches the script text', async () => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BOOTSTRAP_SOURCE))
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
    expect(BOOTSTRAP_HASH).toBe(expected)
  })

  it('keeps the CSP closed to everything but the bootstrap, blobs and eval', () => {
    expect(SANDBOX_CSP).toMatch(/^default-src 'none'; script-src 'unsafe-eval' blob: 'sha256-/)
    expect(SANDBOX_CSP).toMatch(/; worker-src blob:$/)
    expect(SANDBOX_CSP).not.toMatch(/connect-src|img-src|'self'|\*/)
  })
})
