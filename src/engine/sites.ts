// What the instrumenter knows about each hook it inserted. Hooks carry only a site number at
// run time; the recorder looks the rest up here, so instrumented code stays small.
import type { Loc } from './types'

/** An identifier inside an expression, as offsets into that expression's source text. */
export interface IdRef {
  readonly name: string
  readonly start: number
  readonly end: number
}

/** A call inside a larger expression, whose result can stand in for it in the narration. */
export interface CallPart {
  readonly site: number
  readonly start: number
  readonly end: number
}

export interface FnSite {
  readonly kind: 'fn'
  readonly name: string
  readonly loc: Loc
  /** Variable names, in the order the reader returns their values. */
  readonly vars: readonly string[]
}

export interface DeclareFnSite {
  readonly kind: 'declare-fn'
  readonly name: string
  readonly loc: Loc
  readonly vars: readonly string[]
}

export interface DeclareTarget {
  readonly name: string
  readonly hasInit: boolean
  readonly initText: string | null
  readonly loc: Loc
}

export interface DeclareVarSite {
  readonly kind: 'declare-var'
  readonly vars: readonly string[]
  readonly targets: readonly DeclareTarget[]
}

export interface CallSite {
  readonly kind: 'call'
  readonly loc: Loc
  readonly expr: string
  /** The call is a whole statement, so a call to a native function still gets a step. */
  readonly statement: boolean
  /** The larger expression this call is part of, when the call is only a piece of it. */
  readonly context: string | null
  /** An enclosing expression wants this call's result, so the recorder keeps it. */
  readonly keepResult: boolean
}

export interface ReturnSite {
  readonly kind: 'return'
  readonly loc: Loc
  readonly expr: string | null
  readonly ids: readonly IdRef[]
  readonly calls: readonly CallPart[]
}

export interface AssignSite {
  readonly kind: 'assign'
  readonly loc: Loc
  readonly expr: string
  readonly operator: string
  readonly target: string
  /** Where the right-hand side starts inside `expr`. */
  readonly rhsStart: number
  readonly ids: readonly IdRef[]
  readonly calls: readonly CallPart[]
  readonly vars: readonly string[]
}

export interface UpdateSite {
  readonly kind: 'update'
  readonly loc: Loc
  readonly expr: string
  readonly operator: '++' | '--'
  readonly target: string
  readonly ids: readonly IdRef[]
  readonly vars: readonly string[]
}

export type BranchConstruct = 'if' | 'ternary' | 'for' | 'while' | 'do-while'

/** A condition: an `if`, a ternary or a loop test. */
export interface BranchSite {
  readonly kind: 'branch'
  readonly construct: BranchConstruct
  /** The condition expression. */
  readonly loc: Loc
  readonly expr: string
  readonly ids: readonly IdRef[]
  readonly calls: readonly CallPart[]
  readonly vars: readonly string[]
  /** `if` only: what the narration needs to say about the path taken. */
  readonly thenIsReturn: boolean
  readonly hasElse: boolean
  readonly elseIsIf: boolean
}

export interface ThrowSite {
  readonly kind: 'throw'
  readonly loc: Loc
  readonly expr: string
  readonly vars: readonly string[]
}

/** The start of a `catch (e)` block. */
export interface CaughtSite {
  readonly kind: 'caught'
  readonly loc: Loc
  readonly vars: readonly string[]
}

export type Site =
  | FnSite
  | DeclareFnSite
  | DeclareVarSite
  | CallSite
  | ReturnSite
  | AssignSite
  | UpdateSite
  | BranchSite
  | ThrowSite
  | CaughtSite
