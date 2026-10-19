// Inserts trace hooks into the source with magic-string.
//
// Rules that keep the program's behavior unchanged:
//  - Hooks that sit inside an expression return the value they were given (`H.post(1, (H.pre(1), f()))`).
//  - Hooks that are statements are `let` declarations. A declaration has an empty completion value,
//    so the value of the last expression statement, which is the run's result, does not change.
//  - Nothing inserted contains a newline, so line numbers stay the same.
//  - Hooks never throw into the program; see recorder.ts.
import MagicString from 'magic-string'
import type {
  AnonymousFunctionDeclaration,
  AnyNode,
  ArrowFunctionExpression,
  AssignmentExpression,
  CallExpression,
  CatchClause,
  ChainExpression,
  FunctionDeclaration,
  FunctionExpression,
  IfStatement,
  NewExpression,
  Program,
  ThrowStatement,
  UpdateExpression,
  VariableDeclaration,
} from 'acorn'
import type { ArrowToken } from './parse'
import type { BranchConstruct, CallPart, IdRef, Site } from './sites'
import type { Loc, NotTraced, NotTracedReason } from './types'

export interface InstrumentOptions {
  /** The global name the hooks are installed under. Generated per run so code cannot guess it. */
  readonly hook: string
}

export interface InstrumentResult {
  readonly code: string
  readonly sites: readonly Site[]
  readonly notTraced: readonly NotTraced[]
  /** Where the `end` step points: the last top-level statement. */
  readonly endLoc: Loc
  /** Lines in the source, which the instrumented code keeps. */
  readonly lineCount: number
}

type FunctionNode =
  FunctionDeclaration | AnonymousFunctionDeclaration | FunctionExpression | ArrowFunctionExpression

interface Binding {
  readonly name: string
  /** The variable can be read at positions at or after this offset. */
  readonly declEnd: number
}

interface Scope {
  readonly bindings: readonly Binding[]
  /** A function or program scope ends the search for this frame's own variables. */
  readonly isFunction: boolean
}

interface State {
  readonly scopes: readonly Scope[]
  /** Name of the local variable that holds the current frame, or null at top level. */
  readonly frame: string | null
  /** False inside parameter lists, where the frame has not been entered yet. */
  readonly hooks: boolean
  /** True on the spine of an optional chain, where wrapping a call would break short-circuiting. */
  readonly chain: boolean
}

const MAX_IDS_PER_SITE = 12
const IGNORED_IDENTIFIERS: ReadonlySet<string> = new Set(['undefined', 'NaN', 'Infinity'])

export function instrument(
  program: Program,
  source: string,
  arrows: readonly ArrowToken[],
  options: InstrumentOptions,
): InstrumentResult {
  return new Instrumenter(source, arrows, options.hook).run(program)
}

class Instrumenter {
  private readonly ms: MagicString
  private readonly sites: Site[] = []
  private readonly notTraced: NotTraced[] = []
  private temps = 0
  /** Calls that were wrapped, by node, so an enclosing expression can find their sites. */
  private readonly callSites = new Map<AnyNode, number>()

  constructor(
    private readonly source: string,
    private readonly arrows: readonly ArrowToken[],
    private readonly hook: string,
  ) {
    this.ms = new MagicString(source)
  }

  run(program: Program): InstrumentResult {
    const scope: Scope = {
      bindings: [...hoistedVars(program.body), ...lexicalBindings(program.body)],
      isFunction: true,
    }
    this.statements(program.body, { scopes: [scope], frame: null, hooks: true, chain: false })
    const last = program.body.at(-1)
    return {
      code: this.ms.toString(),
      sites: this.sites,
      notTraced: this.notTraced,
      endLoc: last ? this.loc(last) : { line: 1, col: 0, endLine: 1, endCol: 0 },
      lineCount: this.source.split('\n').length,
    }
  }

  // ---- traversal ----

  private visit(node: AnyNode, parent: AnyNode | null, st: State): void {
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
        this.visitFunction(node, parent, st)
        return
      case 'ClassDeclaration':
      case 'ClassExpression':
        this.markNotTraced(node, 'class')
        return
      case 'Property':
        if (node.kind !== 'init') {
          this.markNotTraced(node.value, 'accessor')
          if (node.computed) this.visit(node.key, node, { ...st, chain: false })
          return
        }
        this.children(node, st)
        return
      case 'BlockStatement':
        this.statements(node.body, {
          ...st,
          scopes: [...st.scopes, { bindings: lexicalBindings(node.body), isFunction: false }],
          chain: false,
        })
        return
      case 'SwitchStatement': {
        this.visit(node.discriminant, node, { ...st, chain: false })
        const inner = {
          ...st,
          scopes: [
            ...st.scopes,
            {
              bindings: lexicalBindings(node.cases.flatMap((c) => c.consequent)),
              isFunction: false,
            },
          ],
          chain: false,
        }
        for (const clause of node.cases) {
          if (clause.test) this.visit(clause.test, clause, inner)
          this.statements(clause.consequent, inner)
        }
        return
      }
      case 'ForStatement': {
        const inner = this.withHeadBindings(st, node.init)
        this.children(node, inner)
        if (node.test && st.hooks) this.wrapCondition(node.test, 'for', inner)
        return
      }
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.children(node, { ...st, chain: false })
        if (st.hooks) {
          this.wrapCondition(node.test, node.type === 'WhileStatement' ? 'while' : 'do-while', st)
        }
        return
      case 'IfStatement':
        this.children(node, { ...st, chain: false })
        if (st.hooks) this.wrapCondition(node.test, 'if', st, ifShape(node))
        return
      case 'ConditionalExpression':
        this.children(node, { ...st, chain: false })
        if (st.hooks) this.wrapCondition(node.test, 'ternary', st)
        return
      case 'ThrowStatement':
        this.children(node, { ...st, chain: false })
        if (st.hooks) this.wrapThrow(node, st)
        return
      case 'ForInStatement':
      case 'ForOfStatement':
        this.children(node, this.withHeadBindings(st, node.left))
        return
      case 'CatchClause': {
        const bindings = node.param
          ? boundNames(node.param).map((name) => ({ name, declEnd: node.param?.end ?? 0 }))
          : []
        const inner: State = {
          ...st,
          scopes: [...st.scopes, { bindings, isFunction: false }],
          chain: false,
        }
        this.children(node, inner)
        if (st.hooks && node.param?.type === 'Identifier') {
          this.hookCaught(node, node.param.name, inner)
        }
        return
      }
      case 'ReturnStatement':
        this.visitReturn(node, st)
        return
      case 'CallExpression':
      case 'NewExpression':
        this.visitCall(node, parent, st)
        return
      case 'ChainExpression':
        this.visitChain(node, parent, st)
        return
      case 'MemberExpression':
        this.visit(node.object, node, st)
        this.visit(node.property, node, { ...st, chain: false })
        return
      case 'AssignmentExpression':
        this.children(node, st)
        if (st.hooks) this.wrapAssignment(node, st)
        return
      case 'UpdateExpression':
        this.children(node, st)
        if (st.hooks) this.wrapUpdate(node, st)
        return
      default:
        this.children(node, st)
    }
  }

  private children(node: AnyNode, st: State): void {
    const inner = st.chain ? { ...st, chain: false } : st
    for (const child of childNodes(node)) this.visit(child, node, inner)
  }

  private withHeadBindings(st: State, head: AnyNode | null | undefined): State {
    const bindings =
      head?.type === 'VariableDeclaration' && head.kind !== 'var' ? declaratorBindings(head) : []
    return bindings.length > 0
      ? { ...st, scopes: [...st.scopes, { bindings, isFunction: false }], chain: false }
      : { ...st, chain: false }
  }

  /** Statements in a list: a declaration hook goes after variables, before functions. */
  private statements(list: readonly AnyNode[], st: State): void {
    for (const statement of list) {
      if (st.hooks && statement.type === 'FunctionDeclaration' && isTraceable(statement)) {
        const vars = this.visibleNames(st, statement.end)
        const site = this.addSite({
          kind: 'declare-fn',
          name: statement.id?.name ?? '(anonymous)',
          loc: this.loc(statement),
          vars,
        })
        this.ms.appendLeft(
          statement.start,
          `let ${this.temp()}=${this.hook}.fn(${String(site)},${readerCode(vars)});`,
        )
      }
      this.visit(statement, null, st)
      if (st.hooks && statement.type === 'VariableDeclaration') this.hookDeclaration(statement, st)
    }
  }

  private hookDeclaration(node: VariableDeclaration, st: State): void {
    const vars = this.visibleNames(st, node.end)
    for (const declarator of node.declarations) {
      if (declarator.init) {
        this.callParts(declarator.init, declarator.init.start, this.text(declarator.init), false)
      }
    }
    const targets = node.declarations.flatMap((declarator) =>
      boundNames(declarator.id).map((name) => ({
        name,
        hasInit: declarator.init != null,
        initText: declarator.init ? this.text(declarator.init) : null,
        loc: this.loc(declarator),
      })),
    )
    if (targets.length === 0) return
    const site = this.addSite({ kind: 'declare-var', vars, targets })
    this.ms.appendLeft(
      node.end,
      `;let ${this.temp()}=${this.hook}.decl(${String(site)},${readerCode(vars)});`,
    )
  }

  // ---- functions ----

  private visitFunction(node: FunctionNode, parent: AnyNode | null, st: State): void {
    if (node.async || node.generator) {
      this.markNotTraced(node, node.async ? 'async' : 'generator')
      return
    }
    const frame = `${this.hook}_f`
    const error = `${this.hook}_e`
    const block = node.body.type === 'BlockStatement' ? node.body : null
    const bodyStatements = block ? block.body : []

    const scope: Scope = {
      bindings: [
        ...node.params.flatMap((param) => boundNames(param)).map((name) => ({ name, declEnd: 0 })),
        ...hoistedVars(bodyStatements),
        ...lexicalBindings(bodyStatements),
      ],
      isFunction: true,
    }
    const inner: State = { scopes: [...st.scopes, scope], frame, hooks: true, chain: false }

    for (const param of node.params) this.visit(param, node, { ...inner, hooks: false })
    if (block) this.statements(block.body, inner)
    else this.visit(node.body, node, inner)

    const arrow = node.type === 'ArrowFunctionExpression'
    const entryPos = block ? afterDirectives(block) : this.arrowTokenEnd(node)
    const vars = this.visibleNames(inner, entryPos)
    const site = this.addSite({
      kind: 'fn',
      name: node.id?.name ?? inferName(parent) ?? '(anonymous)',
      loc: this.loc(node),
      vars,
    })
    const args = arrow ? arrowArgs(node.params) : '[].slice.call(arguments)'
    const entry = `const ${frame}=${this.hook}.enter(${String(site)},${args},${readerCode(vars)});try{`
    const exit = `}catch(${error}){${this.hook}.fail(${frame},${error});throw ${error}}finally{${this.hook}.leave(${frame})}`

    if (block) {
      this.ms.appendLeft(entryPos, entry)
      this.ms.appendLeft(block.end - 1, exit)
      return
    }
    // An expression body becomes a block that returns it.
    const body = node.body
    const returnSite = this.addSite({
      kind: 'return',
      loc: this.loc(body),
      expr: this.text(body),
      ids: collectIds(body, body.start),
      calls: this.callParts(body, body.start, this.text(body), true),
    })
    const ids = this.idsCode(collectIds(body, body.start))
    this.ms.appendLeft(
      entryPos,
      `{${entry}return ${this.hook}.ret(${String(returnSite)},${frame},${ids},`,
    )
    this.ms.appendLeft(node.end, `)${exit}}`)
  }

  /** The end of the `=>` that belongs to this arrow function. */
  private arrowTokenEnd(node: FunctionNode): number {
    const from = node.params.at(-1)?.end ?? node.start
    const token = this.arrows.find((t) => t.start >= from && t.end <= node.body.start)
    if (!token) throw new Error('Arrow token not found')
    return token.end
  }

  private visitReturn(node: AnyNode & { type: 'ReturnStatement' }, st: State): void {
    const argument = node.argument
    if (argument) this.visit(argument, node, { ...st, chain: false })
    if (!st.hooks || st.frame === null) return
    if (!argument) {
      const site = this.addSite({
        kind: 'return',
        loc: this.loc(node),
        expr: null,
        ids: [],
        calls: [],
      })
      this.ms.appendLeft(
        node.start + 'return'.length,
        ` ${this.hook}.ret(${String(site)},${st.frame},null,void 0)`,
      )
      return
    }
    const ids = collectIds(argument, argument.start)
    const site = this.addSite({
      kind: 'return',
      loc: this.loc(node),
      expr: this.text(argument),
      ids,
      calls: this.callParts(argument, argument.start, this.text(argument), true),
    })
    // Parentheses keep `return a, b` one argument.
    this.ms.prependRight(
      argument.start,
      `${this.hook}.ret(${String(site)},${st.frame},${this.idsCode(ids)},(`,
    )
    this.ms.appendLeft(argument.end, '))')
  }

  // ---- conditions, throws and catches ----

  private wrapCondition(
    test: AnyNode,
    construct: BranchConstruct,
    st: State,
    shape: IfShape = NO_SHAPE,
  ): void {
    const vars = this.visibleNames(st, test.start)
    const ids = collectIds(test, test.start)
    const site = this.addSite({
      kind: 'branch',
      construct,
      loc: this.loc(test),
      expr: this.text(test),
      ids,
      calls: this.callParts(test, test.start, this.text(test), true),
      vars,
      ...shape,
    })
    this.ms.prependRight(
      test.start,
      `${this.hook}.cond(${String(site)},${readerCode(vars)},${this.idsCode(ids)},(`,
    )
    this.ms.appendLeft(test.end, '))')
  }

  private wrapThrow(node: ThrowStatement, st: State): void {
    const vars = this.visibleNames(st, node.start)
    const site = this.addSite({
      kind: 'throw',
      loc: this.loc(node),
      expr: this.text(node.argument),
      vars,
    })
    this.ms.prependRight(
      node.argument.start,
      `${this.hook}.thrown(${String(site)},${readerCode(vars)},(`,
    )
    this.ms.appendLeft(node.argument.end, '))')
  }

  /** Reports the caught error and drops call sites left over from the failed call. */
  private hookCaught(node: CatchClause, name: string, st: State): void {
    const at = node.body.start + 1
    const vars = this.visibleNames(st, at)
    const site = this.addSite({ kind: 'caught', loc: this.loc(node), vars })
    this.ms.appendLeft(
      at,
      `let ${this.temp()}=${this.hook}.caught(${String(site)},${readerCode(vars)},${name});`,
    )
  }

  // ---- calls ----

  private visitCall(node: CallExpression | NewExpression, parent: AnyNode | null, st: State): void {
    this.visit(node.callee, node, { ...st, chain: node.type === 'CallExpression' && st.chain })
    for (const argument of node.arguments) this.visit(argument, node, { ...st, chain: false })
    if (st.hooks && !st.chain) this.wrapCall(node, parent)
  }

  private visitChain(node: ChainExpression, parent: AnyNode | null, st: State): void {
    this.visit(node.expression, node, { ...st, chain: true })
    if (st.hooks && !st.chain && node.expression.type === 'CallExpression') {
      this.wrapCall(node, parent)
    }
  }

  private wrapCall(node: AnyNode, parent: AnyNode | null): void {
    const site = this.addSite({
      kind: 'call',
      loc: this.loc(node),
      expr: this.text(node),
      statement: parent?.type === 'ExpressionStatement',
      context: null,
      keepResult: false,
    })
    this.callSites.set(node, site)
    // Calls made while working out this one's arguments are "needed first" by this call.
    this.callParts(node, node.start, this.text(node), false)
    const id = String(site)
    this.ms.prependRight(node.start, `${this.hook}.post(${id},(${this.hook}.pre(${id}),`)
    this.ms.appendLeft(node.end, '))')
  }

  /**
   * The outermost wrapped calls strictly inside `root`. Each learns the expression it is part of,
   * and, when `keep` is set, is told to remember its result for the narration.
   */
  private callParts(root: AnyNode, base: number, context: string, keep: boolean): CallPart[] {
    const parts: CallPart[] = []
    const walk = (node: AnyNode): void => {
      const id = node === root ? undefined : this.callSites.get(node)
      if (id !== undefined) {
        const site = this.sites[id]
        if (site?.kind === 'call') {
          this.sites[id] = {
            ...site,
            context: site.context ?? context,
            keepResult: site.keepResult || keep,
          }
        }
        parts.push({ site: id, start: node.start - base, end: node.end - base })
        return
      }
      switch (node.type) {
        case 'FunctionExpression':
        case 'ArrowFunctionExpression':
        case 'FunctionDeclaration':
        case 'ClassExpression':
        case 'ClassDeclaration':
          return
        default:
          for (const child of childNodes(node)) walk(child)
      }
    }
    walk(root)
    return parts
  }

  // ---- assignments ----

  private wrapAssignment(node: AssignmentExpression, st: State): void {
    const vars = this.visibleNames(st, node.start)
    const ids = [
      ...(node.operator !== '=' && node.left.type === 'Identifier'
        ? [{ name: node.left.name, start: 0, end: node.left.end - node.start }]
        : []),
      ...collectIds(node.right, node.start),
    ].slice(0, MAX_IDS_PER_SITE)
    const site = this.addSite({
      kind: 'assign',
      loc: this.loc(node),
      expr: this.text(node),
      operator: node.operator,
      target: this.text(node.left),
      rhsStart: node.right.start - node.start,
      ids,
      calls: this.callParts(node.right, node.start, this.text(node.right), true),
      vars,
    })
    this.ms.prependRight(
      node.start,
      `${this.hook}.assign(${String(site)},${readerCode(vars)},${this.idsCode(ids)},`,
    )
    this.ms.appendLeft(node.end, ')')
  }

  private wrapUpdate(node: UpdateExpression, st: State): void {
    const vars = this.visibleNames(st, node.start)
    const argument = node.argument
    const ids =
      argument.type === 'Identifier'
        ? [
            {
              name: argument.name,
              start: argument.start - node.start,
              end: argument.end - node.start,
            },
          ]
        : []
    const site = this.addSite({
      kind: 'update',
      loc: this.loc(node),
      expr: this.text(node),
      operator: node.operator,
      target: this.text(argument),
      ids,
      vars,
    })
    const target = isSimpleTarget(argument) ? `()=>${this.text(argument)}` : 'null'
    this.ms.prependRight(
      node.start,
      `${this.hook}.update(${String(site)},${readerCode(vars)},${this.idsCode(ids)},${target},`,
    )
    this.ms.appendLeft(node.end, ')')
  }

  // ---- helpers ----

  private addSite(site: Site): number {
    this.sites.push(site)
    return this.sites.length - 1
  }

  private temp(): string {
    this.temps += 1
    return `${this.hook}_${String(this.temps)}`
  }

  private idsCode(refs: readonly IdRef[]): string {
    if (refs.length === 0) return 'null'
    return `${this.hook}.ids(${refs.map((ref) => `()=>${ref.name}`).join(',')})`
  }

  private text(node: AnyNode): string {
    return this.source.slice(node.start, node.end)
  }

  private loc(node: AnyNode): Loc {
    const l = node.loc
    if (!l) throw new Error('The parser did not record locations')
    return { line: l.start.line, col: l.start.column, endLine: l.end.line, endCol: l.end.column }
  }

  private markNotTraced(node: AnyNode, reason: NotTracedReason): void {
    const l = this.loc(node)
    this.notTraced.push({ line: l.line, endLine: l.endLine, reason })
  }

  /** This frame's own variables that can be read at `pos`, in declaration order. */
  private visibleNames(st: State, pos: number): string[] {
    const seen = new Set<string>()
    const visible: Binding[] = []
    for (let i = st.scopes.length - 1; i >= 0; i--) {
      const scope = st.scopes[i]
      if (!scope) continue
      const own = new Map<string, number>()
      for (const binding of scope.bindings) {
        if (seen.has(binding.name)) continue
        own.set(binding.name, Math.min(own.get(binding.name) ?? Infinity, binding.declEnd))
      }
      for (const [name, declEnd] of own) {
        seen.add(name)
        if (declEnd <= pos) visible.push({ name, declEnd })
      }
      if (scope.isFunction) break
    }
    return visible.sort((a, b) => a.declEnd - b.declEnd).map((b) => b.name)
  }
}

// ---- pure helpers ----

function isNode(x: unknown): x is AnyNode {
  return (
    typeof x === 'object' &&
    x !== null &&
    'type' in x &&
    typeof x.type === 'string' &&
    'start' in x &&
    typeof x.start === 'number' &&
    'end' in x &&
    typeof x.end === 'number'
  )
}

/** Child nodes in source order. */
function childNodes(node: AnyNode): AnyNode[] {
  const found: AnyNode[] = []
  const values: unknown[] = Object.values(node)
  for (const value of values) {
    if (Array.isArray(value)) {
      const items: unknown[] = value
      for (const item of items) if (isNode(item)) found.push(item)
    } else if (isNode(value)) {
      found.push(value)
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

interface IfShape {
  readonly thenIsReturn: boolean
  readonly hasElse: boolean
  readonly elseIsIf: boolean
}

const NO_SHAPE: IfShape = { thenIsReturn: false, hasElse: false, elseIsIf: false }

function ifShape(node: IfStatement): IfShape {
  const then = node.consequent
  const thenIsReturn =
    then.type === 'ReturnStatement' ||
    (then.type === 'BlockStatement' &&
      then.body.length === 1 &&
      then.body[0]?.type === 'ReturnStatement')
  return {
    thenIsReturn,
    hasElse: node.alternate != null,
    elseIsIf: node.alternate?.type === 'IfStatement',
  }
}

function isTraceable(node: FunctionNode): boolean {
  return !node.async && !node.generator
}

function readerCode(names: readonly string[]): string {
  return names.length > 0 ? `()=>[${names.join(',')}]` : 'null'
}

function boundNames(pattern: AnyNode | null | undefined): string[] {
  if (!pattern) return []
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name]
    case 'ObjectPattern':
      return pattern.properties.flatMap((p) =>
        p.type === 'Property' ? boundNames(p.value) : boundNames(p.argument),
      )
    case 'ArrayPattern':
      return pattern.elements.flatMap((e) => boundNames(e))
    case 'RestElement':
      return boundNames(pattern.argument)
    case 'AssignmentPattern':
      return boundNames(pattern.left)
    default:
      return []
  }
}

function declaratorBindings(declaration: VariableDeclaration): Binding[] {
  return declaration.declarations.flatMap((d) =>
    boundNames(d.id).map((name) => ({ name, declEnd: d.end })),
  )
}

/** `let`, `const`, class and function declarations directly in a statement list. */
function lexicalBindings(statements: readonly AnyNode[]): Binding[] {
  return statements.flatMap((statement): Binding[] => {
    switch (statement.type) {
      case 'VariableDeclaration':
        return statement.kind === 'var' ? [] : declaratorBindings(statement)
      case 'ClassDeclaration':
      case 'FunctionDeclaration':
        return statement.id ? [{ name: statement.id.name, declEnd: statement.end }] : []
      default:
        return []
    }
  })
}

/** `var` declarations anywhere in the body, not looking inside nested functions or classes. */
function hoistedVars(roots: readonly AnyNode[]): Binding[] {
  const found: Binding[] = []
  const walk = (node: AnyNode): void => {
    switch (node.type) {
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ClassDeclaration':
      case 'ClassExpression':
        return
      case 'VariableDeclaration':
        if (node.kind === 'var') found.push(...declaratorBindings(node))
        return
      default:
        for (const child of childNodes(node)) walk(child)
    }
  }
  for (const root of roots) walk(root)
  return found
}

/** Directives such as 'use strict' must stay first in a function body. */
function afterDirectives(block: AnyNode & { type: 'BlockStatement' }): number {
  let pos = block.start + 1
  for (const statement of block.body) {
    if (statement.type === 'ExpressionStatement' && statement.directive !== undefined) {
      pos = statement.end
    } else break
  }
  return pos
}

function arrowArgs(params: readonly AnyNode[]): string {
  const items = params.map((param) => {
    switch (param.type) {
      case 'Identifier':
        return param.name
      case 'AssignmentPattern':
        return param.left.type === 'Identifier' ? param.left.name : 'void 0'
      case 'RestElement':
        return param.argument.type === 'Identifier' ? `...${param.argument.name}` : 'void 0'
      default:
        return 'void 0'
    }
  })
  return `[${items.join(',')}]`
}

/** Names a function from where it is stored, so `const add = (a, b) => ...` is called add. */
function inferName(parent: AnyNode | null): string | null {
  switch (parent?.type) {
    case 'VariableDeclarator':
      return parent.id.type === 'Identifier' ? parent.id.name : null
    case 'AssignmentExpression':
      if (parent.left.type === 'Identifier') return parent.left.name
      return parent.left.type === 'MemberExpression' &&
        !parent.left.computed &&
        parent.left.property.type === 'Identifier'
        ? parent.left.property.name
        : null
    case 'Property':
      if (parent.computed) return null
      if (parent.key.type === 'Identifier') return parent.key.name
      return parent.key.type === 'Literal' ? String(parent.key.value) : null
    default:
      return null
  }
}

/** A target that can be read again without side effects: `i`, `this.n`, `obj.count`, `a[i]`. */
function isSimpleTarget(node: AnyNode): boolean {
  switch (node.type) {
    case 'Identifier':
    case 'ThisExpression':
      return true
    case 'MemberExpression':
      return (
        !node.optional &&
        isSimpleTarget(node.object) &&
        (node.computed
          ? node.property.type === 'Identifier' || node.property.type === 'Literal'
          : node.property.type === 'Identifier')
      )
    default:
      return false
  }
}

/** Identifiers an expression reads, so the narration can show their values. */
function collectIds(root: AnyNode, base: number): IdRef[] {
  const refs: IdRef[] = []
  const walk = (node: AnyNode): void => {
    if (refs.length >= MAX_IDS_PER_SITE) return
    switch (node.type) {
      case 'Identifier':
        if (!IGNORED_IDENTIFIERS.has(node.name)) {
          refs.push({ name: node.name, start: node.start - base, end: node.end - base })
        }
        return
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'FunctionDeclaration':
      case 'ClassExpression':
      case 'ClassDeclaration':
      case 'ThisExpression':
      case 'Super':
      case 'MetaProperty':
      case 'UpdateExpression':
        return
      case 'UnaryExpression':
        // `typeof missing` is legal where reading `missing` is not.
        if (node.operator !== 'typeof') walk(node.argument)
        return
      case 'MemberExpression':
        walk(node.object)
        if (node.computed) walk(node.property)
        return
      case 'Property':
        if (node.computed) walk(node.key)
        walk(node.value)
        return
      case 'CallExpression':
      case 'NewExpression':
        // A function's name is not a value worth substituting.
        if (node.callee.type !== 'Identifier') walk(node.callee)
        for (const argument of node.arguments) walk(argument)
        return
      case 'AssignmentExpression':
        walk(node.right)
        return
      default:
        for (const child of childNodes(node)) walk(child)
    }
  }
  walk(root)
  return refs
}
