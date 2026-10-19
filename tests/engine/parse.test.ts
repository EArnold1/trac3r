import { describe, expect, it } from 'vitest'
import { parse } from '../../src/engine/parse'

describe('parse', () => {
  it('parses a script and collects arrow tokens', () => {
    const result = parse('const f = (x) => x + 1;')
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.arrows).toEqual([{ start: 14, end: 16 }])
  })

  it('reports a syntax error with its position and no suffix', () => {
    const result = parse('let a = 1\nlet = = 2')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.line).toBe(2)
      expect(result.error.message).not.toMatch(/\(\d+:\d+\)/)
    }
  })

  it('rejects import and export with a clear message', () => {
    const result = parse('import x from "y"')
    expect(result).toMatchObject({
      ok: false,
      error: { message: 'import and export are not supported' },
    })
  })

  it('rejects a top-level return', () => {
    expect(parse('return 1').ok).toBe(false)
  })
})
