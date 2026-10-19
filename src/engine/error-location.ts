// Finds where in the program an error happened. A runtime error such as `null.x` has no hook at
// the point of the throw, so the position has to come from the error itself. Instrumented code
// keeps the original line numbers, so a position in it is a position in the source.

export interface ErrorPosition {
  /** 1-based. */
  readonly line: number
  /** 1-based. */
  readonly col: number
}

/** Frames of code run through `eval`, as Chromium and Node print them, then as Firefox does. */
const EVAL_FRAME_PATTERNS: readonly RegExp[] = [/<anonymous>:(\d+):(\d+)/, /> eval:(\d+):(\d+)/]

function readProperty(object: object, key: string): unknown {
  try {
    return Reflect.get(object, key)
  } catch {
    return undefined
  }
}

function within(line: number, col: number, lineCount: number): ErrorPosition | null {
  return line >= 1 && line <= lineCount && col >= 1 ? { line, col } : null
}

/**
 * The position of the innermost frame in the traced program, or null when the engine does not say.
 * Chromium and Firefox put it in `stack`. WebKit leaves eval frames out of `stack` but sets
 * `line` and `column` on the error.
 */
export function locationOfError(error: unknown, lineCount: number): ErrorPosition | null {
  if (typeof error !== 'object' || error === null) return null

  const stack = readProperty(error, 'stack')
  if (typeof stack === 'string') {
    for (const frame of stack.split('\n')) {
      for (const pattern of EVAL_FRAME_PATTERNS) {
        const match = pattern.exec(frame)
        const position = match && within(Number(match[1]), Number(match[2]), lineCount)
        if (position) return position
      }
    }
  }

  const line = readProperty(error, 'line')
  const column = readProperty(error, 'column')
  if (typeof line === 'number' && typeof column === 'number') {
    return within(line, column, lineCount)
  }
  return null
}
