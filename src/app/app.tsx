import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'
import type { NotTraced, RunResult, Step } from '@/engine/types'
import { run } from '@/runtime'
import { CodeView } from './code-view'
import type { CodeError, CodeHighlight } from './code-view'
import { ConsolePanel } from './console-panel'
import { Controls } from './controls'
import { CurrentValuePanel } from './current-value-panel'
import { deriveView } from './derive'
import { DEFAULT_EXAMPLE, EXAMPLES } from './examples'
import { Header } from './header'
import { Panel } from './panel'
import { createInitialState, reducer, stepCount } from './reducer'
import type { RunState } from './reducer'
import { ResultPanel } from './result-panel'
import { StackPanel } from './stack-panel'
import { TracePanel } from './trace-panel'
import { usePlayback } from './use-playback'
import { useTheme } from './use-theme'

const NO_LINES: readonly NotTraced[] = []
const MAX_CHIP_CHARS = 24

function chipFor(step: Step): string | null {
  if (!step.value) return null
  const text = step.value.text
  return `→ ${text.length > MAX_CHIP_CHARS ? `${text.slice(0, MAX_CHIP_CHARS)}…` : text}`
}

/** The result shown when the sandbox itself could not run, as opposed to the code failing. */
function sandboxFailure(message: string): RunResult {
  return {
    status: 'error',
    error: { name: 'SandboxError', message, line: null },
    output: [],
    steps: [],
    notTraced: [],
    truncated: false,
    durationMs: 0,
  }
}

/** Keys pressed while typing, scrubbing or choosing must not also step the trace. */
function isFromControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof Element)) return false
  if (
    target.closest(
      '.cm-editor, [role="slider"], [role="combobox"], [role="listbox"], input, textarea, select',
    )
  ) {
    return true
  }
  // Space presses a focused button; leave that to the button.
  return key === ' ' && target.closest('button, a') !== null
}

function codeCaption(run: RunState): string {
  if (run.status === 'running') return 'Running…'
  if (run.status === 'idle') return 'Nothing runs until you press Run'
  if (run.run.error?.name === 'SyntaxError') return 'Not run · fix the syntax error'
  return `Ran in ${String(Math.round(run.run.durationMs))} ms · ${run.run.steps.length > 0 ? 'read-only while replaying' : 'nothing to replay'}`
}

export function App() {
  const [state, dispatch] = useReducer(reducer, DEFAULT_EXAMPLE.source, createInitialState)
  const { theme, toggle: toggleTheme } = useTheme()
  const lastRunId = useRef(0)
  const running = useRef<AbortController | null>(null)

  const total = stepCount(state)
  const done = state.run.status === 'done' ? state.run.run : null
  const view = done ? deriveView(done, state.stepIndex, state.selectedFrameId) : null
  const step = view?.step ?? null

  const handleRun = useCallback(() => {
    // A new Run replaces one that is still going: its sandbox is killed and its result ignored.
    running.current?.abort()
    const controller = new AbortController()
    running.current = controller
    lastRunId.current += 1
    const id = lastRunId.current
    dispatch({ type: 'runStarted', id })
    run(state.source, { signal: controller.signal }).then(
      (result) => {
        dispatch({ type: 'runFinished', id, run: result })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : 'The sandbox failed'
        dispatch({ type: 'runFinished', id, run: sandboxFailure(message) })
      },
    )
  }, [state.source])

  const cancelRun = useCallback(() => {
    running.current?.abort()
    running.current = null
  }, [])

  useEffect(() => cancelRun, [cancelRun])

  const tick = useCallback(() => {
    dispatch({ type: 'tick' })
  }, [])
  usePlayback(state.playing, state.speed, state.stepIndex, tick)

  const { mode, playing } = state
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (mode !== 'replaying' || event.defaultPrevented) return
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (isFromControl(event.target, event.key)) return
      if (event.key === 'ArrowRight') dispatch({ type: 'next' })
      else if (event.key === 'ArrowLeft') dispatch({ type: 'prev' })
      else if (event.key === ' ') dispatch({ type: playing ? 'pause' : 'play' })
      else return
      event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mode, playing])

  const highlight = useMemo<CodeHighlight | null>(
    () => (step ? { loc: step.loc, chip: chipFor(step) } : null),
    [step],
  )
  const error = useMemo<CodeError | null>(
    () =>
      done?.error?.name === 'SyntaxError' && done.error.line !== null
        ? { line: done.error.line, message: done.error.message }
        : null,
    [done],
  )

  const exampleId = EXAMPLES.find((example) => example.source === state.source)?.id ?? ''
  const editable = state.mode === 'editing' && state.run.status !== 'running'

  return (
    <TooltipProvider>
      {/* The page is as tall as the window and only the panels scroll. Below 980px it is one column. */}
      <main className="flex h-screen min-h-160 flex-col overflow-hidden max-[980px]:h-auto max-[980px]:overflow-visible">
        <Header
          exampleId={exampleId}
          canEdit={state.mode === 'replaying'}
          theme={theme}
          onExample={(id) => {
            const example = EXAMPLES.find((candidate) => candidate.id === id)
            if (!example) return
            cancelRun()
            dispatch({ type: 'edit', source: example.source })
          }}
          onEdit={() => {
            dispatch({ type: 'backToEditing' })
          }}
          onRun={handleRun}
          onToggleTheme={toggleTheme}
        />

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4 px-6 max-[980px]:flex max-[980px]:flex-col">
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <Panel title="Code" className="flex-none" caption={codeCaption(state.run)}>
              <CodeView
                source={state.source}
                editable={editable}
                highlight={highlight}
                error={error}
                notTraced={done?.notTraced ?? NO_LINES}
                onChange={(source) => {
                  dispatch({ type: 'edit', source })
                }}
              />
            </Panel>
            <ConsolePanel run={state.run} step={step} />
            <StackPanel
              view={view}
              onSelect={(id) => {
                dispatch({ type: 'selectFrame', id })
              }}
            />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            <div className="flex flex-none items-stretch gap-3 max-[980px]:flex-col">
              <ResultPanel run={state.run} />
              <CurrentValuePanel
                run={state.run}
                view={view}
                stepIndex={state.stepIndex}
                stepTotal={total}
              />
            </div>
            <TracePanel
              run={state.run}
              stepIndex={state.stepIndex}
              groupChoices={state.groupChoices}
              onSelect={(index) => {
                dispatch({ type: 'goto', index })
              }}
              onSetGroup={(id, open) => {
                dispatch({ type: 'setGroup', id, open })
              }}
              onFoldToCurrent={() => {
                dispatch({ type: 'foldToCurrent' })
              }}
              onExpandAll={(ids) => {
                dispatch({ type: 'expandAll', ids })
              }}
            />
          </div>
        </div>

        <Controls
          stepIndex={state.stepIndex}
          stepTotal={total}
          playing={state.playing}
          speed={state.speed}
          onReset={() => {
            dispatch({ type: 'reset' })
          }}
          onPrev={() => {
            dispatch({ type: 'prev' })
          }}
          onNext={() => {
            dispatch({ type: 'next' })
          }}
          onTogglePlay={() => {
            dispatch({ type: state.playing ? 'pause' : 'play' })
          }}
          onSeek={(index) => {
            dispatch({ type: 'goto', index })
          }}
          onSpeed={(speed) => {
            dispatch({ type: 'setSpeed', speed })
          }}
        />
      </main>
    </TooltipProvider>
  )
}
