import { describe, expect, it } from 'vitest'
import { runPlain, runTraced } from './harness'

describe('a run with more than 2,000 steps', () => {
  const SOURCE = 'let s = 0;\nfor (let i = 0; i < 1000; i++) {\n  s += i;\n}\ns;'
  const traced = runTraced(SOURCE)

  it('still returns the correct result', () => {
    expect(traced.result?.text).toBe('499500')
    expect(runPlain(SOURCE).result).toEqual(traced.result)
  })

  it('keeps the first 2,000 steps and sets truncated', () => {
    expect(traced.steps).toHaveLength(2000)
    expect(traced.truncated).toBe(true)
    expect(traced.steps.map((s) => s.index)).toEqual([...Array(2000).keys()])
    expect(traced.steps.some((s) => s.kind === 'end')).toBe(false)
  })

  it('is not truncated when it fits exactly', () => {
    const exact = runTraced('let a = 1;\nlet b = 2;\na + b;', 3)
    expect(exact.steps).toHaveLength(3)
    expect(exact.truncated).toBe(false)
  })
})
