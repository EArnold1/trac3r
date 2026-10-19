import { describe, expect, it } from 'vitest'
import { runPlain, runTraced } from './harness'

const SOURCE = `function fib(n) {
  if (n <= 1) return n;
  return fib(n - 1) + fib(n - 2);
}
fib(4);`

/** What the call tree of fib(n) must look like, worked out without the tracer. */
function expectedEvents(n: number): string[] {
  const events: string[] = []
  const fib = (k: number, depth: number): number => {
    events.push(`call fib(${String(k)}) depth ${String(depth)}`)
    const value = k <= 1 ? k : fib(k - 1, depth + 1) + fib(k - 2, depth + 1)
    events.push(`return ${String(value)} depth ${String(depth - 1)}`)
    return value
  }
  fib(n, 1)
  return events
}

describe('fibonacci(4)', () => {
  const traced = runTraced(SOURCE)

  it('gives the result 3, the same as without tracing', () => {
    expect(traced.result?.text).toBe('3')
    expect(runPlain(SOURCE).result).toEqual(traced.result)
  })

  it('pushes and pops frames in the order the recursion runs', () => {
    const events = traced.steps.flatMap((s) => {
      const depth = s.stack.length - 1
      if (s.kind === 'call') {
        const frame = s.stack.at(-1)
        return [`call fib(${frame?.args[0]?.text ?? '?'}) depth ${String(depth)}`]
      }
      if (s.kind === 'return') return [`return ${s.value?.text ?? '?'} depth ${String(depth)}`]
      return []
    })
    expect(events).toEqual(expectedEvents(4))
  })

  it('pops exactly the frame that returned, even with two calls per frame', () => {
    let previous: readonly number[] = [0]
    for (const step of traced.steps) {
      const ids = step.stack.map((f) => f.id)
      if (step.kind === 'call') expect(ids.slice(0, -1)).toEqual(previous)
      if (step.kind === 'return') expect(ids).toEqual(previous.slice(0, -1))
      if (step.kind === 'call' || step.kind === 'return') previous = ids
    }
  })

  it('gives every call its own frame id', () => {
    const calls = traced.steps.filter((s) => s.kind === 'call').map((s) => s.stack.at(-1)?.id)
    expect(new Set(calls).size).toBe(calls.length)
    expect(calls).toHaveLength(9)
  })
})
