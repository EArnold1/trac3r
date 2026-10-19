// Plain-English text for each step, built from real values rather than source alone.
import type { AssignSite, BranchSite, ReturnSite, UpdateSite } from './sites'
import type { OutputLine, Shown } from './types'

/** What a piece of an expression was worth at run time, as offsets into the expression's text. */
export interface Part {
  readonly start: number
  readonly end: number
  readonly value: Shown | undefined
}

/** Values of the identifiers in a site, in the order the site listed them. */
export type IdValues = readonly (Shown | undefined)[]

const code = (text: string): string => `\`${text}\``

/** Source text from `from` on, with the parts that have a value replaced by it. */
export function substitute(text: string, from: number, parts: readonly Part[]): string {
  let out = ''
  let cursor = from
  for (const part of parts) {
    // A call's result replaces the whole call, so the names inside its arguments are skipped.
    if (part.value === undefined || part.start < cursor) continue
    out += text.slice(cursor, part.start) + part.value.text
    cursor = part.end
  }
  return out + text.slice(cursor)
}

export function describeCall(fn: string, args: readonly Shown[]): string {
  return `${fn}(${args.map((a) => a.text).join(', ')})`
}

export function narrateDeclareFunction(name: string): string {
  return `Declare function ${code(name)}.`
}

export function narrateDeclareVariable(name: string, hasInit: boolean, value: Shown): string {
  return hasInit
    ? `Declare ${code(name)} and set it to ${code(value.text)}.`
    : `Declare ${code(name)}; it is ${code('undefined')} until it is assigned.`
}

/** `context` is the bigger expression the call is only part of, if it is. */
export function narrateCall(fn: string, args: readonly Shown[], context: string | null): string {
  const call = code(describeCall(fn, args))
  return context === null ? `Call ${call}.` : `${code(context)} needs ${call} first, so call it.`
}

export function narrateNativeCall(expr: string, value: Shown): string {
  return `Run ${code(expr)}, which returns ${code(value.text)}.`
}

export function narrateReturn(
  fn: string,
  args: readonly Shown[],
  value: Shown,
  site: ReturnSite,
  parts: readonly Part[],
): string {
  const head = `${code(describeCall(fn, args))} returns ${code(value.text)}`
  if (site.expr === null) return `${head}.`
  const filled = substitute(site.expr, 0, parts)
  return filled === site.expr || filled === value.text
    ? `${head}.`
    : `${code(describeCall(fn, args))} is ${code(filled)}, so it returns ${code(value.text)}.`
}

export function narrateAssign(site: AssignSite, parts: readonly Part[], value: Shown): string {
  const rhs = site.expr.slice(site.rhsStart)
  const filled = substitute(site.expr, site.rhsStart, parts)
  if (site.operator === '=') {
    const head = `Set ${code(site.target)} to ${code(value.text)}`
    return filled === rhs || filled === value.text
      ? `${head}.`
      : `${head}: ${code(rhs)} is ${code(filled)}.`
  }
  const operator = site.operator.slice(0, -1)
  // The target is read first, at the very start of the expression.
  const before = parts.find((part) => part.start === 0)?.value
  return before === undefined
    ? `${code(site.expr)} sets ${code(site.target)} to ${code(value.text)}.`
    : `${code(site.expr)} computes ${code(`${before.text} ${operator} ${filled}`)}, so ${code(site.target)} is now ${code(value.text)}.`
}

export function narrateUpdate(site: UpdateSite, ids: IdValues, value: Shown): string {
  const before = ids[0]
  return before === undefined
    ? `${code(site.expr)} updates ${code(site.target)}; it is now ${code(value.text)}.`
    : `${code(site.expr)} changes ${code(site.target)} from ${code(before.text)} to ${code(value.text)}.`
}

export function narrateEnd(result: Shown | undefined): string {
  return result === undefined || result.type === 'undefined'
    ? 'Program finished.'
    : `Program finished. Result: ${result.text}.`
}

function consequence(site: BranchSite, truthy: boolean): string {
  switch (site.construct) {
    case 'if':
      if (truthy)
        return site.thenIsReturn ? 'take the early return' : `run the ${code('if')} branch`
      if (site.elseIsIf) return 'check the next condition'
      if (site.hasElse) return `run the ${code('else')} branch`
      return site.thenIsReturn ? 'skip the early return' : `skip the ${code('if')} branch`
    case 'ternary':
      return truthy ? 'use the value before the `:`' : 'use the value after the `:`'
    case 'while':
    case 'for':
      return truthy ? 'run the loop body' : 'the loop ends'
    case 'do-while':
      return truthy ? 'run the loop body again' : 'the loop ends'
  }
}

export function narrateBranch(
  site: BranchSite,
  parts: readonly Part[],
  value: Shown,
  truthy: boolean,
): string {
  const expr = code(site.expr)
  let verdict: string
  if (value.type === 'boolean') {
    const filled = substitute(site.expr, 0, parts)
    verdict =
      filled === site.expr
        ? `${expr} is ${value.text}`
        : `${expr} is ${code(filled)}, which is ${value.text}`
  } else {
    verdict = `${expr} is ${code(value.text)}, which is ${truthy ? 'truthy' : 'falsy'}`
  }
  return `${verdict}, so ${consequence(site, truthy)}.`
}

export function narrateError(error: Shown, thrownHere: boolean): string {
  return thrownHere ? `Throw ${code(error.text)}.` : `${code(error.text)} was thrown here.`
}

const MAX_OUTPUT_NARRATION_CHARS = 60

export function narrateOutput(level: OutputLine['level'], text: string): string {
  const short =
    text.length > MAX_OUTPUT_NARRATION_CHARS
      ? `${text.slice(0, MAX_OUTPUT_NARRATION_CHARS)}…`
      : text
  switch (level) {
    case 'log':
      return `Print ${code(short)} to the console.`
    case 'warn':
      return `Print the warning ${code(short)}.`
    case 'error':
      return `Print the error ${code(short)}.`
  }
}
