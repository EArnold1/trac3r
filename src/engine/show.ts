import { MAX_CHILD_DEPTH, MAX_CHILDREN_PER_LEVEL, MAX_SHOWN_TEXT_CHARS } from './limits'
import type { Shown } from './types'

const PREVIEW_ITEMS = 6
const PREVIEW_PROPS = 4
const NESTED_STRING_CHARS = 30

/** Turns any value into plain data. Real values never leave the sandbox. */
export function show(value: unknown): Shown {
  try {
    return build(value, 0, new Set())
  } catch {
    return { type: 'object', text: '[Unreadable]' }
  }
}

function build(value: unknown, depth: number, ancestors: Set<object>): Shown {
  switch (typeof value) {
    case 'number':
      return { type: 'number', text: formatNumber(value) }
    case 'string':
      return { type: 'string', text: cap(JSON.stringify(value)) }
    case 'boolean':
      return { type: 'boolean', text: String(value) }
    case 'undefined':
      return { type: 'undefined', text: 'undefined' }
    case 'bigint':
      return { type: 'bigint', text: `${String(value)}n` }
    case 'symbol':
      return { type: 'symbol', text: value.toString() }
    case 'function':
      return {
        type: 'function',
        text: cap(describeFunction(value.name, Function.prototype.toString.call(value))),
      }
    case 'object':
      return value === null ? { type: 'null', text: 'null' } : buildObject(value, depth, ancestors)
  }
}

function buildObject(value: object, depth: number, ancestors: Set<object>): Shown {
  if (ancestors.has(value)) return { type: 'circular', text: '[Circular]' }
  if (tagOf(value) === 'Error') return { type: 'error', text: cap(describeError(value)) }
  ancestors.add(value)
  try {
    if (Array.isArray(value)) return buildArray(value, depth, ancestors)
    const special = describeSpecial(value)
    if (special !== undefined) return { type: 'object', text: cap(special) }
    return buildPlainObject(value, depth, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

function buildArray(items: readonly unknown[], depth: number, ancestors: Set<object>): Shown {
  const text = cap(previewArray(items, true))
  if (depth >= MAX_CHILD_DEPTH) return { type: 'array', text }
  const shown = Math.min(items.length, MAX_CHILDREN_PER_LEVEL)
  const children: { key: string; value: Shown }[] = []
  for (let i = 0; i < shown; i++) {
    children.push({ key: String(i), value: build(items[i], depth + 1, ancestors) })
  }
  const omitted = items.length - shown
  return omitted > 0
    ? { type: 'array', text, children, omitted }
    : { type: 'array', text, children }
}

function buildPlainObject(value: object, depth: number, ancestors: Set<object>): Shown {
  const keys = Object.keys(value)
  const text = cap(previewObject(value, keys, true))
  if (depth >= MAX_CHILD_DEPTH) return { type: 'object', text }
  const shownKeys = keys.slice(0, MAX_CHILDREN_PER_LEVEL)
  const children = shownKeys.map((key) => ({
    key,
    value: readProperty(value, key, (v) => build(v, depth + 1, ancestors)),
  }))
  const omitted = keys.length - shownKeys.length
  return omitted > 0
    ? { type: 'object', text, children, omitted }
    : { type: 'object', text, children }
}

/** Reads a data property without ever running a getter. */
function readProperty<T>(object: object, key: string, read: (value: unknown) => T): T {
  const descriptor = Object.getOwnPropertyDescriptor(object, key)
  if (descriptor?.get !== undefined || descriptor?.set !== undefined) {
    return read(GETTER_MARKER)
  }
  const value: unknown = descriptor?.value
  return read(value)
}

const GETTER_MARKER = Symbol('(...)')

function previewArray(items: readonly unknown[], top: boolean): string {
  if (!top) return `Array(${String(items.length)})`
  if (items.length === 0) return '[]'
  const parts = items.slice(0, PREVIEW_ITEMS).map((item) => previewValue(item))
  if (items.length > PREVIEW_ITEMS) parts.push('…')
  return `[${parts.join(', ')}]`
}

function previewObject(value: object, keys: readonly string[], top: boolean): string {
  const prefix = constructorPrefix(value)
  if (!top) return `${prefix}{…}`
  if (keys.length === 0) return `${prefix}{}`
  const parts = keys
    .slice(0, PREVIEW_PROPS)
    .map((key) => `${key}: ${readProperty(value, key, previewValue)}`)
  if (keys.length > PREVIEW_PROPS) parts.push('…')
  return `${prefix}{${parts.join(', ')}}`
}

/** One-line preview of a value nested inside another preview. */
function previewValue(value: unknown): string {
  if (value === GETTER_MARKER) return '(...)'
  if (typeof value === 'string') {
    const short =
      value.length > NESTED_STRING_CHARS ? `${value.slice(0, NESTED_STRING_CHARS)}…` : value
    return JSON.stringify(short)
  }
  if (typeof value === 'object' && value !== null) {
    if (Array.isArray(value)) return previewArray(value, false)
    if (tagOf(value) === 'Error') return describeError(value)
    return describeSpecial(value) ?? previewObject(value, Object.keys(value), false)
  }
  return build(value, MAX_CHILD_DEPTH, new Set()).text
}

function describeSpecial(value: object): string | undefined {
  switch (tagOf(value)) {
    case 'Map':
      return `Map(${String(collectionSize(Map.prototype, value))}) {…}`
    case 'Set':
      return `Set(${String(collectionSize(Set.prototype, value))}) {…}`
    case 'Date': {
      const time: unknown = Date.prototype.getTime.call(value)
      return typeof time === 'number' && !Number.isNaN(time)
        ? new Date(time).toISOString()
        : 'Invalid Date'
    }
    case 'RegExp':
      return RegExp.prototype.toString.call(value)
    default:
      return undefined
  }
}

/**
 * `Object.prototype.toString` works across realms, `instanceof` does not. Code that runs in
 * another realm (tests run it in a `vm` context) still gets the right preview.
 */
export function tagOf(value: unknown): string {
  return Object.prototype.toString.call(value).slice(8, -1)
}

function collectionSize(proto: Map<unknown, unknown> | Set<unknown>, value: object): unknown {
  // The getter runs with the real collection as receiver, so this also works across realms.
  const size: unknown = Reflect.get(proto, 'size', value)
  return size
}

/** Looks a data property up the prototype chain without running any getter. */
function readInherited(object: object, key: string): unknown {
  let current: object | null = object
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key)
    if (descriptor) {
      const found: unknown = descriptor.value
      return descriptor.get === undefined ? found : undefined
    }
    const proto: unknown = Object.getPrototypeOf(current)
    current = typeof proto === 'object' ? proto : null
  }
  return undefined
}

/** The name and message of whatever a program threw. */
export function describeThrown(thrown: unknown): { name: string; message: string } {
  if (isObjectLike(thrown) && tagOf(thrown) === 'Error') {
    const name = readInherited(thrown, 'name')
    const message = readInherited(thrown, 'message')
    return {
      name: typeof name === 'string' ? name : 'Error',
      message: typeof message === 'string' ? message : '',
    }
  }
  return { name: 'Uncaught', message: show(thrown).text }
}

function isObjectLike(value: unknown): value is object {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
}

function describeError(value: object): string {
  const name = readInherited(value, 'name')
  const message = readInherited(value, 'message')
  const label = typeof name === 'string' ? name : 'Error'
  return typeof message === 'string' && message !== '' ? `${label}: ${message}` : label
}

function constructorPrefix(value: object): string {
  const proto: unknown = Object.getPrototypeOf(value)
  if (proto === null) return '[Object: null prototype] '
  const ctor: unknown = Object.getOwnPropertyDescriptor(proto, 'constructor')?.value
  if (typeof ctor !== 'function') return ''
  return ctor.name === 'Object' || ctor.name === '' ? '' : `${ctor.name} `
}

function describeFunction(name: string, source: string): string {
  const label = name === '' ? '(anonymous)' : name
  return source.startsWith('class') ? `class ${label}` : `ƒ ${label}`
}

function formatNumber(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n)
}

function cap(text: string): string {
  return text.length > MAX_SHOWN_TEXT_CHARS ? `${text.slice(0, MAX_SHOWN_TEXT_CHARS - 1)}…` : text
}
