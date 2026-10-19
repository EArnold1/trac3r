import { describe, expect, it } from 'vitest'
import { show } from '../../src/engine/show'

describe('show', () => {
  it('previews primitives', () => {
    expect(show(6)).toEqual({ type: 'number', text: '6' })
    expect(show(-0).text).toBe('-0')
    expect(show('hi')).toEqual({ type: 'string', text: '"hi"' })
    expect(show(true).type).toBe('boolean')
    expect(show(null)).toEqual({ type: 'null', text: 'null' })
    expect(show(undefined).type).toBe('undefined')
    expect(show(5n)).toEqual({ type: 'bigint', text: '5n' })
    expect(show(Symbol('s')).text).toBe('Symbol(s)')
  })

  it('previews arrays and objects like a collapsed DevTools value', () => {
    expect(show([1, 2, 3]).text).toBe('[1, 2, 3]')
    expect(show({ a: 1, b: 2 }).text).toBe('{a: 1, b: 2}')
    expect(show({ a: 1, b: 2, c: 3, d: 4, e: 5 }).text).toBe('{a: 1, b: 2, c: 3, d: 4, …}')
    expect(show([[1], { x: 1 }]).text).toBe('[Array(1), {…}]')
    expect(show([]).text).toBe('[]')
  })

  it('previews functions, classes and errors', () => {
    function factorial() {
      return 1
    }
    expect(show(factorial)).toEqual({ type: 'function', text: 'ƒ factorial' })
    expect(
      show(
        class Foo {
          x = 1
        },
      ).text,
    ).toBe('class Foo')
    expect(show(new TypeError('boom'))).toEqual({ type: 'error', text: 'TypeError: boom' })
  })

  it('carries capped children', () => {
    const big = Array.from({ length: 25 }, (_, i) => i)
    const shown = show(big)
    expect(shown.children).toHaveLength(20)
    expect(shown.omitted).toBe(5)
    expect(
      show({ a: { b: { c: { d: 1 } } } }).children?.[0]?.value.children?.[0]?.value.children?.[0]
        ?.value.children,
    ).toBeUndefined()
  })

  it('marks circular references', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(show(a).children?.[0]?.value.type).toBe('circular')
  })

  it('never runs getters', () => {
    let ran = false
    const o = {
      get x() {
        ran = true
        return 1
      },
    }
    expect(show(o).text).toBe('{x: (...)}')
    expect(ran).toBe(false)
  })

  it('caps the preview text', () => {
    expect(show('x'.repeat(5000)).text.length).toBeLessThanOrEqual(2000)
  })

  it('survives a throwing proxy', () => {
    const p = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('no')
        },
      },
    )
    expect(show(p).text).toBe('[Unreadable]')
  })
})
