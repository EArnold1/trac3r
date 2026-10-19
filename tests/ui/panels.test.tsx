// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLES } from '../../src/app/examples'
import { ConsolePanel } from '../../src/app/console-panel'
import { CurrentValuePanel } from '../../src/app/current-value-panel'
import { deriveView } from '../../src/app/derive'
import { ResultPanel } from '../../src/app/result-panel'
import { StackPanel } from '../../src/app/stack-panel'
import { TracePanel } from '../../src/app/trace-panel'
import type { RunState } from '../../src/app/reducer'
import type { RunResult } from '../../src/engine/types'
import { factorialRun, runResultOf } from './fixtures'
import './setup'

afterEach(cleanup)

const noop = vi.fn()
const done = (run: RunResult): RunState => ({ status: 'done', run })

function nth<T>(items: readonly T[], index: number): T {
  const item = items[index]
  if (item === undefined) throw new Error(`No item at ${String(index)}`)
  return item
}
const factorial = done(factorialRun)

describe('ResultPanel', () => {
  it('shows the value and its type, large', () => {
    render(<ResultPanel run={factorial} />)
    const panel = screen.getByRole('region', { name: 'Result' })
    expect(within(panel).getByText('6')).toBeInTheDocument()
    expect(within(panel).getByText('number')).toBeInTheDocument()
  })

  it('says it is the last expression of the same run', () => {
    render(<ResultPanel run={factorial} />)
    expect(screen.getByText('Last expression, same run as the trace.')).toBeInTheDocument()
  })

  it('keeps a long value small enough for the narrow panel', () => {
    const long = {
      ...factorialRun,
      result: { type: 'string', text: '"a long string value"' },
    } as const
    render(<ResultPanel run={done(long)} />)
    expect(screen.getByText('"a long string value"')).not.toHaveClass('text-result')
    cleanup()
    render(<ResultPanel run={factorial} />)
    expect(screen.getByText('6')).toHaveClass('text-result')
  })

  it('takes only the run, so stepping cannot change it', () => {
    // The panel has no step prop at all; rendering it twice gives the same text.
    const first = render(<ResultPanel run={factorial} />).container.textContent
    cleanup()
    expect(render(<ResultPanel run={factorial} />).container.textContent).toBe(first)
  })

  it('shows what to do before a run, and while one is going', () => {
    render(<ResultPanel run={{ status: 'idle' }} />)
    expect(screen.getByText('Press Run to see the result.')).toBeInTheDocument()
    cleanup()
    render(<ResultPanel run={{ status: 'running', id: 1 }} />)
    expect(screen.getByText('Running…')).toBeInTheDocument()
  })

  it('replaces the value with the error and its line', () => {
    render(
      <ResultPanel
        run={done(runResultOf('function f() {\n  throw new RangeError("big");\n}\nf();'))}
      />,
    )
    expect(screen.getByText('RangeError: big')).toBeInTheDocument()
    expect(screen.getByText(/Thrown on line 2/)).toBeInTheDocument()
  })

  it('says a syntax error stopped the run before it started', () => {
    const run: RunResult = {
      status: 'error',
      error: { name: 'SyntaxError', message: 'Unexpected token', line: 2 },
      output: [],
      steps: [],
      notTraced: [],
      truncated: false,
      durationMs: 1,
    }
    render(<ResultPanel run={done(run)} />)
    expect(screen.getByText(/Line 2 has a syntax error, so nothing ran/)).toBeInTheDocument()
  })

  it('reports a timeout instead of a result', () => {
    const run: RunResult = {
      status: 'timeout',
      output: [],
      steps: [],
      notTraced: [],
      truncated: false,
      durationMs: 3000,
    }
    render(<ResultPanel run={done(run)} />)
    expect(screen.getByText('No result')).toBeInTheDocument()
    expect(screen.getByText('Timed out after 3 s, possible infinite loop')).toBeInTheDocument()
  })
})

describe('TracePanel', () => {
  const handlers = {
    groupChoices: {},
    onSelect: noop,
    onSetGroup: noop,
    onFoldToCurrent: noop,
    onExpandAll: noop,
  }
  const rowButtons = () => screen.getAllByRole('button').filter((b) => b.dataset.step !== undefined)
  const stepNumbers = () => rowButtons().map((b) => b.dataset.step)

  it('lists the steps of the open calls and marks only the current one', () => {
    render(<TracePanel run={factorial} stepIndex={6} {...handlers} />)
    expect(rowButtons()).toHaveLength(11)
    const current = rowButtons().filter((row) => row.getAttribute('aria-current') === 'step')
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent('7')
    expect(current[0]).toHaveTextContent('branch')
    expect(current[0]).toHaveTextContent('true')
  })

  it('folds every call the current step is not inside to one row', () => {
    render(<TracePanel run={factorial} stepIndex={0} {...handlers} />)
    expect(stepNumbers()).toEqual(['1', '2', '11'])
    expect(rowButtons()[1]).toHaveTextContent('9 steps')
    expect(screen.getByRole('button', { name: 'Unfold factorial(3)' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('says how a folded call ended once it has finished', () => {
    render(<TracePanel run={factorial} stepIndex={10} {...handlers} />)
    expect(stepNumbers()).toEqual(['1', '2', '11'])
    expect(rowButtons()[1]).toHaveTextContent('→ 6 · 9 steps')
  })

  it('keeps the calls around the current step open', () => {
    render(<TracePanel run={factorial} stepIndex={6} {...handlers} />)
    expect(screen.getByRole('button', { name: 'Fold factorial(1)' })).toHaveAttribute(
      'aria-expanded',
      'true',
    )
    expect(rowButtons()[1]).toHaveTextContent('running')
    expect(rowButtons()[1]).not.toHaveTextContent('steps')
  })

  it('opens or folds a call by hand, and the choice wins over the current step', () => {
    const onSetGroup = vi.fn()
    const { rerender } = render(
      <TracePanel run={factorial} stepIndex={0} {...handlers} onSetGroup={onSetGroup} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unfold factorial(3)' }))
    expect(onSetGroup).toHaveBeenCalledWith(expect.any(Number), true)

    const id = onSetGroup.mock.calls[0]?.[0] as number
    rerender(
      <TracePanel run={factorial} stepIndex={0} {...handlers} groupChoices={{ [id]: true }} />,
    )
    expect(stepNumbers()).toEqual(['1', '2', '3', '4', '10', '11'])
    // Open by hand, so the header no longer counts its steps.
    expect(rowButtons()[1]).not.toHaveTextContent('steps')
  })

  it('has Fold to current and Expand all when the program makes calls', () => {
    const onFoldToCurrent = vi.fn()
    const onExpandAll = vi.fn()
    render(
      <TracePanel
        run={factorial}
        stepIndex={0}
        {...handlers}
        onFoldToCurrent={onFoldToCurrent}
        onExpandAll={onExpandAll}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Fold to current' }))
    expect(onFoldToCurrent).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(onExpandAll).toHaveBeenCalledWith([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
  })

  it('has nothing to fold in a program without calls', () => {
    const loop = runResultOf(EXAMPLES[2]?.source ?? '')
    render(<TracePanel run={done(loop)} stepIndex={0} {...handlers} />)
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Fold|Unfold) / })).not.toBeInTheDocument()
    expect(rowButtons()).toHaveLength(loop.steps.length)
  })

  it('shows the narration with real values', () => {
    render(<TracePanel run={factorial} stepIndex={6} {...handlers} />)
    expect(screen.getByText(/which is true, so take the early return/)).toBeInTheDocument()
    expect(screen.getByText('Program finished. Result: 6.')).toBeInTheDocument()
  })

  it('jumps to a step when its row is clicked', () => {
    const onSelect = vi.fn()
    render(<TracePanel run={factorial} stepIndex={6} {...handlers} onSelect={onSelect} />)
    fireEvent.click(nth(rowButtons(), 4))
    expect(onSelect).toHaveBeenCalledWith(4)
  })

  it('shows a banner for a timeout, with the steps that were kept', () => {
    const run: RunResult = {
      ...factorialRun,
      status: 'timeout',
      steps: factorialRun.steps.slice(0, 3),
      truncated: true,
    }
    render(<TracePanel run={done(run)} stepIndex={0} {...handlers} />)
    expect(screen.getByText('The run was stopped')).toBeInTheDocument()
    expect(screen.getByText(/The first 3 steps are shown/)).toBeInTheDocument()
    // The timeout banner already says so; a second one would be noise.
    expect(screen.queryByText('Only the first 2000 steps are shown')).not.toBeInTheDocument()
  })

  it('says the trace stops before the error when a failing run had more steps', () => {
    const run: RunResult = { ...factorialRun, status: 'error', truncated: true }
    render(<TracePanel run={done(run)} stepIndex={0} {...handlers} />)
    expect(
      screen.getByText(/before it failed, so the trace stops before the error/),
    ).toBeInTheDocument()
  })

  it('shows a banner when there were more steps than were kept', () => {
    render(
      <TracePanel run={done({ ...factorialRun, truncated: true })} stepIndex={0} {...handlers} />,
    )
    expect(screen.getByText('Only the first 2000 steps are shown')).toBeInTheDocument()
    expect(screen.queryByText('The run was stopped')).not.toBeInTheDocument()
  })
})

describe('CurrentValuePanel', () => {
  const at = (index: number, selected: number | null = null) => {
    const view = deriveView(factorialRun, index, selected)
    return <CurrentValuePanel run={factorial} view={view} stepIndex={index} stepTotal={11} />
  }

  it('shows the expression with its values, the value and its type', () => {
    render(at(6))
    expect(screen.getByText('Step 7 of 11 · line 2')).toBeInTheDocument()
    // Once as the expression with its values, once inside the narration.
    expect(screen.getAllByText('1 <= 1')).toHaveLength(2)
    expect(screen.getByText('true')).toBeInTheDocument()
    expect(screen.getByText('boolean')).toBeInTheDocument()
  })

  it('shows the variables of the top frame', () => {
    render(at(6))
    expect(screen.getByText('Variables in factorial(1)')).toBeInTheDocument()
    expect(screen.getByText('n')).toBeInTheDocument()
  })

  it('shows the variables of the frame that was selected', () => {
    const view = deriveView(factorialRun, 6, null)
    const outer = view?.step.stack[1]?.id ?? null
    render(at(6, outer))
    expect(screen.getByText('Variables in factorial(3)')).toBeInTheDocument()
  })

  it('highlights what is new in the call that was just made', () => {
    render(at(5))
    expect(screen.getByText('new in this call')).toBeInTheDocument()
  })

  it('shows the top level as it ended when the program has finished', () => {
    render(at(10))
    expect(screen.getByText('Variables in main (as it ended)')).toBeInTheDocument()
  })

  it('says so when an expression has no value yet', () => {
    render(at(1))
    expect(screen.getByText('call · no value yet')).toBeInTheDocument()
  })

  it('shows the variables as chips beside their label', () => {
    render(at(6))
    const label = screen.getByText('Variables in factorial(1)')
    expect(label.parentElement).toHaveTextContent('n1')
  })

  it('says what to do before there is a run', () => {
    render(<CurrentValuePanel run={{ status: 'idle' }} view={null} stepIndex={0} stepTotal={0} />)
    expect(screen.getByText(/Run the code, then step through it/)).toBeInTheDocument()
  })
})

describe('StackPanel', () => {
  it('lists the frames newest first, with the one inspected marked', () => {
    render(<StackPanel view={deriveView(factorialRun, 6, null)} onSelect={noop} />)
    const frames = screen.getAllByRole('button')
    expect(frames.map((f) => f.textContent)).toEqual([
      expect.stringContaining('factorial(1)'),
      expect.stringContaining('factorial(2)'),
      expect.stringContaining('factorial(3)'),
      expect.stringContaining('main'),
    ])
    expect(frames[0]).toHaveAttribute('aria-pressed', 'true')
    expect(frames[1]).toHaveAttribute('aria-pressed', 'false')
    expect(frames[0]).toHaveTextContent('running · called from line 3')
    expect(frames[3]).toHaveTextContent('top level')
  })

  it('reports the number of frames', () => {
    render(<StackPanel view={deriveView(factorialRun, 6, null)} onSelect={noop} />)
    expect(screen.getByText('4 frames · newest on top')).toBeInTheDocument()
  })

  it('selects a frame when it is clicked', () => {
    const onSelect = vi.fn()
    const view = deriveView(factorialRun, 6, null)
    render(<StackPanel view={view} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /factorial\(2\)/ }))
    expect(onSelect).toHaveBeenCalledWith(view?.step.stack[2]?.id)
  })

  it('shows the frame that just returned, with its value', () => {
    render(<StackPanel view={deriveView(factorialRun, 7, null)} onSelect={noop} />)
    expect(screen.getByText(/returned/)).toHaveTextContent('returned 1')
  })

  it('says so when the program has finished and nothing is on the stack', () => {
    render(<StackPanel view={deriveView(factorialRun, 10, null)} onSelect={noop} />)
    expect(screen.getByText('No frames: the program has finished.')).toBeInTheDocument()
  })
})

describe('ConsolePanel', () => {
  const run = runResultOf('console.log("a");\nconsole.log("b");\n1;')

  it('shows nothing printed before anything was', () => {
    render(<ConsolePanel run={done(run)} step={null} />)
    expect(screen.getByText('Nothing printed')).toBeInTheDocument()
  })

  it('shows the lines printed up to the current step, in order', () => {
    render(<ConsolePanel run={done(run)} step={run.steps[1] ?? null} />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a', 'b'])
  })

  it('shows only the first line at the first output step', () => {
    render(<ConsolePanel run={done(run)} step={run.steps[0] ?? null} />)
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['a'])
  })
})
