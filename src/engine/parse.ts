import { parse as acornParse, tokTypes } from 'acorn'
import type { Position, Program } from 'acorn'

export interface ParseError {
  readonly message: string
  /** 1-based. */
  readonly line: number
  /** 0-based. */
  readonly col: number
}

/** The `=>` tokens, which the instrumenter needs to turn expression bodies into blocks. */
export interface ArrowToken {
  readonly start: number
  readonly end: number
}

export type ParseResult =
  | { readonly ok: true; readonly program: Program; readonly arrows: readonly ArrowToken[] }
  | { readonly ok: false; readonly error: ParseError }

/** Parses a script. A syntax error comes back with its position; nothing has run yet. */
export function parse(source: string): ParseResult {
  const arrows: ArrowToken[] = []
  try {
    const program = acornParse(source, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      locations: true,
      allowHashBang: true,
      onToken: (token) => {
        if (token.type === tokTypes.arrow) arrows.push({ start: token.start, end: token.end })
      },
    })
    return { ok: true, program, arrows }
  } catch (thrown) {
    if (isAcornError(thrown)) {
      return {
        ok: false,
        error: {
          message: friendlyMessage(thrown.message),
          line: thrown.loc.line,
          col: thrown.loc.column,
        },
      }
    }
    throw thrown
  }
}

interface AcornError extends SyntaxError {
  readonly loc: Position
}

function isAcornError(x: unknown): x is AcornError {
  return (
    x instanceof SyntaxError &&
    'loc' in x &&
    typeof x.loc === 'object' &&
    x.loc !== null &&
    'line' in x.loc &&
    typeof x.loc.line === 'number' &&
    'column' in x.loc &&
    typeof x.loc.column === 'number'
  )
}

function friendlyMessage(message: string): string {
  if (message.includes("'import' and 'export' may appear only with")) {
    return 'import and export are not supported'
  }
  // acorn appends " (line:column)"; the position is reported separately.
  return message.replace(/\s*\(\d+:\d+\)$/, '')
}
