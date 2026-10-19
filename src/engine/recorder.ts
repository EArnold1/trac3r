// Turns hook calls from instrumented code into steps. Pure: no DOM, so it runs in tests too.
//
// Hooks must never change the program they observe, so every hook body is guarded and a bug
// here can only cost a step, never throw into the user's code.
import { locationOfError } from './error-location'
import { MAX_STEPS } from './limits'
import {
  narrateAssign,
  narrateBranch,
  narrateCall,
  narrateDeclareFunction,
  narrateDeclareVariable,
  narrateEnd,
  narrateError,
  narrateNativeCall,
  narrateOutput,
  narrateReturn,
  narrateUpdate,
  substitute,
} from './narrate'
import type { IdValues, Part } from './narrate'
import { show } from './show'
import type { CallPart, IdRef, ReturnSite, Site } from './sites'
import type { Frame, Loc, OutputLine, Shown, Step, StepKind } from './types'

export type Reader = () => readonly unknown[]
export type Thunk = () => unknown

/** What instrumented code calls. Tokens are opaque to the program. */
export interface Hooks {
  readonly fn: (site: number, reader: Reader | null) => void
  readonly decl: (site: number, reader: Reader | null) => void
  readonly enter: (site: number, args: readonly unknown[], reader: Reader | null) => object | null
  readonly fail: (token: object | null, error: unknown) => void
  readonly leave: (token: object | null) => void
  readonly ret: <T>(site: number, token: object | null, ids: IdValues | null, value: T) => T
  readonly pre: (site: number) => void
  readonly post: <T>(site: number, value: T) => T
  readonly assign: <T>(site: number, reader: Reader | null, ids: IdValues | null, value: T) => T
  readonly update: <T>(
    site: number,
    reader: Reader | null,
    ids: IdValues | null,
    target: Thunk | null,
    value: T,
  ) => T
  readonly cond: <T>(site: number, reader: Reader | null, ids: IdValues | null, value: T) => T
  readonly thrown: <T>(site: number, reader: Reader | null, value: T) => T
  readonly caught: (site: number, reader: Reader | null, error: unknown) => void
  readonly ids: (...thunks: readonly Thunk[]) => IdValues
}

export interface RecorderOptions {
  readonly maxSteps?: number
  /** Lines in the program, to tell a position in it from one in our own code. */
  readonly lineCount?: number
  /**
   * Called when the steps so far should be sent on, so they survive if the run never finishes:
   * every so often while the program runs, and once steps have been dropped for a while.
   */
  readonly onFlush?: () => void
}

export interface Recorder {
  readonly hooks: Hooks
  steps: () => readonly Step[]
  /** More steps happened than were kept. */
  truncated: () => boolean
  /** Ends the program: pops everything and records the `end` step. */
  finish: (result: Shown) => void
  /** Records an error that nothing in the program caught, unless it was already recorded. */
  reportUncaught: (error: unknown) => void
  /** The line an error was recorded at, if it was. */
  errorLine: (error: unknown) => number | null
  /** A console call. Takes the loc of the call that made it. */
  output: (level: OutputLine['level'], text: string) => void
}

interface LiveFrame {
  readonly id: number
  readonly fn: string
  readonly args: readonly Shown[]
  readonly callLine: number | null
  readonly loc: Loc | null
  /** How many pending call sites existed when this frame was entered. */
  readonly pendingDepth: number
  reader: Reader | null
  names: readonly string[]
  lastValues: readonly unknown[] | null
  snapshot: Frame
  failed: boolean
}

const MAX_ARGS = 20
/** A call's result is only written into the narration when it is short. */
const MAX_INLINE_RESULT_CHARS = 30
const FLUSH_EVERY_MS = 250
const FLUSH_AFTER_TRUNCATION_MS = 200
const FLUSH_CHECK_EVERY_STEPS = 32

export function createRecorder(
  sites: readonly Site[],
  endLoc: Loc,
  options: RecorderOptions = {},
): Recorder {
  const maxSteps = options.maxSteps ?? MAX_STEPS
  const lineCount = options.lineCount ?? Number.MAX_SAFE_INTEGER
  const steps: Step[] = []
  const stack: LiveFrame[] = []
  const known = new WeakSet()
  /** Call sites whose callee has not been entered yet. */
  const pending: number[] = []
  let truncated = false
  let closed = false
  let nextFrameId = 1
  let lastLoc: Loc = { line: 1, col: 0, endLine: 1, endCol: 0 }
  let lastFlush = Date.now()
  let truncatedAt = 0
  let flushedAfterTruncation = false
  let outputLines: readonly string[] = []
  /** Results of calls an enclosing expression wants, until that expression is narrated. */
  const results = new Map<number, Shown>()

  function flush(): void {
    lastFlush = Date.now()
    try {
      options.onFlush?.()
    } catch {
      /* tracing must never change the program */
    }
  }

  /**
   * Steps are being dropped. A run that is about to end does not need to send them early, but one
   * that goes on (an infinite loop) does, so the flush waits a moment to see which it is.
   */
  function markTruncated(): void {
    if (!truncated) {
      truncated = true
      truncatedAt = Date.now()
    } else if (!flushedAfterTruncation && Date.now() - truncatedAt > FLUSH_AFTER_TRUNCATION_MS) {
      flushedAfterTruncation = true
      flush()
    }
  }

  function makeFrame(
    id: number,
    fn: string,
    args: readonly Shown[],
    callLine: number | null,
    loc: Loc | null,
  ): LiveFrame {
    const frame: LiveFrame = {
      id,
      fn,
      args,
      callLine,
      loc,
      pendingDepth: pending.length,
      reader: null,
      names: [],
      lastValues: null,
      snapshot: { id, fn, args, callLine, vars: {} },
      failed: false,
    }
    known.add(frame)
    return frame
  }

  stack.push(makeFrame(0, '<main>', [], null, null))

  const capped = (): boolean => steps.length >= maxSteps

  /** Reads this frame's variables, reusing the last snapshot when nothing visible changed. */
  function snapshotFrame(frame: LiveFrame): Frame {
    if (frame.reader === null) return frame.snapshot
    let values: readonly unknown[]
    try {
      values = frame.reader()
    } catch {
      return frame.snapshot
    }
    const last = frame.lastValues
    if (
      last !== null &&
      last.length === values.length &&
      values.every((v, i) => isPrimitive(v) && Object.is(v, last[i]))
    ) {
      return frame.snapshot
    }
    frame.lastValues = values
    frame.snapshot = {
      id: frame.id,
      fn: frame.fn,
      args: frame.args,
      callLine: frame.callLine,
      vars: Object.fromEntries(frame.names.map((name, i) => [name, show(values[i])])),
    }
    return frame.snapshot
  }

  function emit(
    kind: StepKind,
    loc: Loc,
    text: string,
    expr?: string,
    value?: Shown,
    filled?: string,
  ): void {
    lastLoc = loc
    if (closed) return
    if (capped()) {
      markTruncated()
      return
    }
    steps.push({
      index: steps.length,
      kind,
      loc,
      ...(expr !== undefined && { expr }),
      ...(filled !== undefined && filled !== expr && { filled }),
      ...(value !== undefined && { value }),
      text,
      stack: stack.map(snapshotFrame),
      output: outputLines,
    })
    if (steps.length % FLUSH_CHECK_EVERY_STEPS === 0 && Date.now() - lastFlush > FLUSH_EVERY_MS) {
      flush()
    }
  }

  function top(): LiveFrame | undefined {
    return stack.at(-1)
  }

  function setReader(reader: Reader | null, names: readonly string[]): void {
    const frame = top()
    if (frame && typeof reader === 'function') {
      frame.reader = reader
      frame.names = names
    }
  }

  function indexOfFrame(token: object): number {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i] === token) return i
    return -1
  }

  /** Removes a frame and everything above it. Returns it, or undefined if it was already gone. */
  function pop(token: object | null): LiveFrame | undefined {
    if (token === null || !known.has(token)) return undefined
    const index = indexOfFrame(token)
    const frame = stack[index]
    if (index <= 0 || frame === undefined) return undefined
    stack.length = index
    pending.length = Math.min(pending.length, frame.pendingDepth)
    return frame
  }

  /** The values to put into a site's expression text, in source order. */
  function partsFor(
    refs: readonly IdRef[],
    ids: IdValues | null,
    calls: readonly CallPart[],
  ): Part[] {
    const parts: Part[] = refs.map((ref, i) => ({
      start: ref.start,
      end: ref.end,
      value: ids?.[i],
    }))
    for (const call of calls) {
      const result = results.get(call.site)
      results.delete(call.site)
      parts.push({
        start: call.start,
        end: call.end,
        value: result && result.text.length <= MAX_INLINE_RESULT_CHARS ? result : undefined,
      })
    }
    return parts.sort((a, b) => a.start - b.start)
  }

  // ---- errors ----

  /** Errors already recorded, so one that passes through many frames gets one step. */
  const reportedObjects = new WeakMap<object, number>()
  let reportedPrimitive: { readonly value: unknown; readonly line: number } | null = null

  function isObjectLike(value: unknown): value is object {
    return (typeof value === 'object' && value !== null) || typeof value === 'function'
  }

  function reportedLine(error: unknown): number | undefined {
    if (isObjectLike(error)) return reportedObjects.get(error)
    return reportedPrimitive && Object.is(reportedPrimitive.value, error)
      ? reportedPrimitive.line
      : undefined
  }

  function reportError(error: unknown, at: Loc | null, thrownHere: boolean): void {
    if (closed || reportedLine(error) !== undefined) return
    const position = at === null ? locationOfError(error, lineCount) : null
    const loc: Loc =
      at ??
      (position
        ? {
            line: position.line,
            col: Math.max(0, position.col - 1),
            endLine: position.line,
            endCol: position.col,
          }
        : lastLoc)
    if (isObjectLike(error)) reportedObjects.set(error, loc.line)
    else reportedPrimitive = { value: error, line: loc.line }
    const shown = show(error)
    emit('error', loc, narrateError(shown, thrownHere), undefined, shown)
  }

  const hooks: Hooks = {
    fn(id, reader) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'declare-fn') return
        setReader(reader, site.vars)
        emit('declare', site.loc, narrateDeclareFunction(site.name))
      } catch {
        /* tracing must never change the program */
      }
    },

    decl(id, reader) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'declare-var') return
        setReader(reader, site.vars)
        const values = typeof reader === 'function' ? reader() : []
        for (const target of site.targets) {
          const shown = capped() ? undefined : show(values[site.vars.indexOf(target.name)])
          emit(
            'declare',
            target.loc,
            shown ? narrateDeclareVariable(target.name, target.hasInit, shown) : '',
            target.initText ?? undefined,
            shown,
          )
        }
      } catch {
        /* tracing must never change the program */
      }
    },

    enter(id, args, reader) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'fn') return null
        const callSiteId = pending.pop()
        const found = callSiteId === undefined ? undefined : sites[callSiteId]
        const callSite = found?.kind === 'call' ? found : undefined
        const shownArgs = capped() ? [] : args.slice(0, MAX_ARGS).map(show)
        const frame = makeFrame(
          nextFrameId++,
          site.name,
          shownArgs,
          callSite?.loc.line ?? null,
          site.loc,
        )
        frame.reader = typeof reader === 'function' ? reader : null
        frame.names = site.vars
        stack.push(frame)
        emit(
          'call',
          callSite?.loc ?? site.loc,
          capped() ? '' : narrateCall(site.name, shownArgs, callSite?.context ?? null),
          callSite?.expr,
        )
        return frame
      } catch {
        return null
      }
    },

    fail(token, error) {
      try {
        if (token !== null && known.has(token)) {
          const index = indexOfFrame(token)
          const frame = stack[index]
          if (frame) frame.failed = true
        }
        reportError(error, null, false)
      } catch {
        /* tracing must never change the program */
      }
    },

    leave(token) {
      try {
        if (closed) return
        const frame = pop(token)
        if (!frame || frame.failed) return
        // Fell off the end of the function without a `return`.
        const at = frame.loc ?? endLoc
        const loc = {
          line: at.endLine,
          col: Math.max(0, at.endCol - 1),
          endLine: at.endLine,
          endCol: at.endCol,
        }
        const value = capped() ? undefined : show(undefined)
        emit(
          'return',
          loc,
          value ? narrateReturn(frame.fn, frame.args, value, NO_EXPR, []) : '',
          undefined,
          value,
        )
      } catch {
        /* tracing must never change the program */
      }
    },

    ret(id, token, ids, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'return') return value
        const frame = pop(token)
        if (capped()) {
          markTruncated()
          return value
        }
        const shown = show(value)
        const parts = partsFor(site.ids, ids, site.calls)
        emit(
          'return',
          site.loc,
          narrateReturn(frame?.fn ?? '(function)', frame?.args ?? [], shown, site, parts),
          site.expr ?? undefined,
          shown,
          site.expr === null ? undefined : substitute(site.expr, 0, parts),
        )
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    pre(id) {
      if (!closed) pending.push(id)
    },

    post(id, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'call') return value
        if (site.keepResult && !capped()) results.set(id, show(value))
        if (pending.at(-1) !== id) return value
        pending.pop()
        if (!site.statement) return value
        if (capped()) {
          markTruncated()
          return value
        }
        const shown = show(value)
        emit('call', site.loc, narrateNativeCall(site.expr, shown), site.expr, shown)
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    assign(id, reader, ids, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'assign') return value
        setReader(reader, site.vars)
        if (capped()) {
          markTruncated()
          return value
        }
        const shown = show(value)
        emit(
          'assign',
          site.loc,
          narrateAssign(site, partsFor(site.ids, ids, site.calls), shown),
          site.expr,
          shown,
        )
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    update(id, reader, ids, target, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'update') return value
        setReader(reader, site.vars)
        if (capped()) {
          markTruncated()
          return value
        }
        const shown = show(typeof target === 'function' ? target() : value)
        emit('assign', site.loc, narrateUpdate(site, ids ?? [], shown), site.expr, shown)
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    cond(id, reader, ids, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'branch') return value
        setReader(reader, site.vars)
        if (capped()) {
          markTruncated()
          return value
        }
        const shown = show(value)
        const parts = partsFor(site.ids, ids, site.calls)
        emit(
          'branch',
          site.loc,
          narrateBranch(site, parts, shown, Boolean(value)),
          site.expr,
          shown,
          substitute(site.expr, 0, parts),
        )
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    thrown(id, reader, value) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'throw') return value
        setReader(reader, site.vars)
        reportError(value, site.loc, true)
      } catch {
        /* tracing must never change the program */
      }
      return value
    },

    caught(id, reader, error) {
      try {
        const site = sites[id]
        if (closed || site?.kind !== 'caught') return
        setReader(reader, site.vars)
        // Call sites left over from the call that threw will never be matched by a `post`.
        const frame = top()
        if (frame) pending.length = Math.min(pending.length, frame.pendingDepth)
        reportError(error, null, false)
      } catch {
        /* tracing must never change the program */
      }
    },

    ids(...thunks) {
      if (closed || capped()) return []
      return thunks.map((thunk) => {
        try {
          const value = thunk()
          return isPrimitive(value) ? show(value) : undefined
        } catch {
          return undefined
        }
      })
    },
  }

  return {
    hooks: Object.freeze(hooks),
    steps: () => steps,
    truncated: () => truncated,

    finish(result) {
      if (closed) return
      stack.length = 0
      emit('end', endLoc, narrateEnd(result), undefined, result)
      closed = true
    },

    reportUncaught(error) {
      try {
        reportError(error, null, false)
      } catch {
        /* a failure to describe the error must not hide it */
      }
    },

    errorLine: (error) => reportedLine(error) ?? null,

    output(level, text) {
      try {
        if (closed) return
        const siteId = pending.at(-1)
        const found = siteId === undefined ? undefined : sites[siteId]
        const site = found?.kind === 'call' ? found : undefined
        if (site) pending.pop()
        if (capped()) {
          markTruncated()
          return
        }
        outputLines = [...outputLines, text]
        emit('output', site?.loc ?? lastLoc, narrateOutput(level, text), site?.expr, {
          type: 'string',
          text: JSON.stringify(text),
        })
      } catch {
        /* tracing must never change the program */
      }
    },
  }
}

const NO_EXPR: ReturnSite = {
  kind: 'return',
  loc: { line: 0, col: 0, endLine: 0, endCol: 0 },
  expr: null,
  ids: [],
  calls: [],
}

function isPrimitive(value: unknown): boolean {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}
