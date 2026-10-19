import { describe, expect, it } from 'vitest'
import { runPlain, runTraced } from './harness'

const SOURCE = `console.log("first");
function shout(s) {
  console.warn(s + "!");
}
shout("second");
console.error("third", 3);
7;`

describe('console output', () => {
  const traced = runTraced(SOURCE)

  it('appears in order, the same as without tracing', () => {
    expect(traced.output).toEqual(['first', 'second!', 'third 3'])
    expect(runPlain(SOURCE).output).toEqual(traced.output)
    expect(traced.result?.text).toBe('7')
  })

  it('is a step on the line that printed it, with the lines so far', () => {
    const prints = traced.steps.filter((s) => s.kind === 'output')
    expect(prints.map((s) => s.loc.line)).toEqual([1, 3, 6])
    expect(prints.map((s) => s.output)).toEqual([
      ['first'],
      ['first', 'second!'],
      ['first', 'second!', 'third 3'],
    ])
    expect(prints.map((s) => s.text)).toEqual([
      'Print `first` to the console.',
      'Print the warning `second!`.',
      'Print the error `third 3`.',
    ])
  })

  it('shows the frame that printed', () => {
    const inside = traced.steps.find((s) => s.kind === 'output' && s.loc.line === 3)
    expect(inside?.stack.map((f) => f.fn)).toEqual(['<main>', 'shout'])
  })

  it('does not also record the call as a separate step', () => {
    const lineOne = traced.steps.filter((s) => s.loc.line === 1)
    expect(lineOne.map((s) => s.kind)).toEqual(['output'])
  })

  it('keeps earlier lines on later steps', () => {
    expect(traced.steps.at(-1)?.output).toEqual(['first', 'second!', 'third 3'])
  })
})
