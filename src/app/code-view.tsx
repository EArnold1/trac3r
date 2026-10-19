// CodeMirror 6 wrapped in one component. It has two modes: editing, where the person types, and
// replaying, where it is read-only and decorations follow the current step.
import { javascript } from '@codemirror/lang-javascript'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import {
  Annotation,
  Compartment,
  EditorState,
  RangeSet,
  StateEffect,
  StateField,
} from '@codemirror/state'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  GutterMarker,
  WidgetType,
  drawSelection,
  keymap,
  lineNumberMarkers,
  lineNumbers,
} from '@codemirror/view'
import { tags } from '@lezer/highlight'
import { useEffect, useRef } from 'react'
import type { Loc, NotTraced, NotTracedReason } from '@/engine/types'

/** The step being viewed: its line, the expression on it, and the value to show at the line end. */
export interface CodeHighlight {
  readonly loc: Loc
  readonly chip: string | null
}

export interface CodeError {
  readonly line: number
  readonly message: string
}

interface Overlay {
  readonly highlight: CodeHighlight | null
  readonly error: CodeError | null
  readonly notTraced: readonly NotTraced[]
}

const NOT_TRACED_REASONS: Record<NotTracedReason, string> = {
  class: 'class bodies run but are not traced',
  async: 'async functions run but are not traced',
  generator: 'generators run but are not traced',
  accessor: 'getters and setters run but are not traced',
  unsupported: 'this code could not be traced, so it ran as it is',
}

const setOverlay = StateEffect.define<Overlay>()

const overlayField = StateField.define<Overlay>({
  create: () => ({ highlight: null, error: null, notTraced: [] }),
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setOverlay)) return effect.value
    return value
  },
})

class ChipWidget extends WidgetType {
  constructor(
    private readonly text: string,
    private readonly className: string,
  ) {
    super()
  }

  override eq(other: WidgetType): boolean {
    return (
      other instanceof ChipWidget && other.text === this.text && other.className === this.className
    )
  }

  override toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = this.className
    chip.textContent = this.text
    return chip
  }

  override ignoreEvent(): boolean {
    return true
  }
}

class LineMarker extends GutterMarker {
  constructor(override readonly elementClass: string) {
    super()
  }
}

const TRACE_MARKER = new LineMarker('cm-trace-gutter')
const ERROR_MARKER = new LineMarker('cm-error-gutter')

function offsetAt(state: EditorState, line: number, col: number): number | null {
  if (line < 1 || line > state.doc.lines) return null
  const info = state.doc.line(line)
  return Math.min(info.from + col, info.to)
}

function buildDecorations(state: EditorState) {
  const { highlight, error, notTraced } = state.field(overlayField)
  const ranges: Range<Decoration>[] = []

  for (const range of notTraced) {
    const attributes = { title: `Not traced: ${NOT_TRACED_REASONS[range.reason]}` }
    for (let n = range.line; n <= Math.min(range.endLine, state.doc.lines); n++) {
      ranges.push(
        Decoration.line({ class: 'cm-not-traced', attributes }).range(state.doc.line(n).from),
      )
    }
  }

  if (error && error.line >= 1 && error.line <= state.doc.lines) {
    const info = state.doc.line(error.line)
    ranges.push(Decoration.line({ class: 'cm-error-line' }).range(info.from))
    ranges.push(
      Decoration.widget({
        widget: new ChipWidget(`SyntaxError: ${error.message}`, 'cm-error-chip'),
        side: 1,
      }).range(info.to),
    )
  }

  if (highlight) {
    const { loc } = highlight
    const start = offsetAt(state, loc.line, loc.col)
    const end = offsetAt(state, loc.endLine, loc.endCol)
    if (start !== null) {
      const info = state.doc.lineAt(start)
      ranges.push(Decoration.line({ class: 'cm-trace-line' }).range(info.from))
      if (end !== null && end > start) {
        ranges.push(Decoration.mark({ class: 'cm-trace-expr' }).range(start, end))
      }
      if (highlight.chip !== null) {
        ranges.push(
          Decoration.widget({
            widget: new ChipWidget(highlight.chip, 'cm-value-chip'),
            side: 1,
          }).range(info.to),
        )
      }
    }
  }
  return Decoration.set(ranges, true)
}

function buildGutter(state: EditorState) {
  const { highlight, error } = state.field(overlayField)
  const markers: Range<GutterMarker>[] = []
  if (error && error.line >= 1 && error.line <= state.doc.lines) {
    markers.push(ERROR_MARKER.range(state.doc.line(error.line).from))
  }
  const at = highlight ? offsetAt(state, highlight.loc.line, 0) : null
  if (at !== null) markers.push(TRACE_MARKER.range(at))
  return markers.length > 0 ? RangeSet.of(markers, true) : RangeSet.empty
}

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)' },
  { tag: [tags.number, tags.bool, tags.null], color: 'var(--syntax-number)' },
  { tag: [tags.string, tags.regexp], color: 'var(--syntax-string)' },
  { tag: tags.comment, color: 'var(--faint)', fontStyle: 'italic' },
])

const theme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--card)',
    color: 'var(--foreground)',
    fontSize: '14px',
    // The page fits the window, so a long program scrolls here instead of pushing the rest down.
    maxHeight: 'min(560px, 40vh)',
  },
  '&.cm-focused': { outline: '2px solid var(--ring)', outlineOffset: '-2px' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '24px', overflow: 'auto' },
  '.cm-content': { padding: '12px 0', caretColor: 'var(--foreground)' },
  '.cm-line': { padding: '0 16px 0 4px' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground':
    {
      backgroundColor: 'var(--highlight)',
    },
  '.cm-gutters': {
    backgroundColor: 'var(--card)',
    color: 'var(--faint)',
    border: 'none',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '48px',
    padding: '0 16px 0 0',
    textAlign: 'right',
  },
  '.cm-trace-line': { backgroundColor: 'var(--accent)' },
  '.cm-trace-gutter': {
    backgroundColor: 'var(--accent)',
    color: 'var(--primary)',
    fontWeight: '600',
  },
  '.cm-trace-expr': { backgroundColor: 'var(--highlight)', borderRadius: '3px' },
  '.cm-value-chip, .cm-error-chip': {
    display: 'inline-block',
    margin: '0 16px 0 24px',
    padding: '0 10px',
    border: '1px solid var(--primary)',
    borderRadius: '999px',
    backgroundColor: 'var(--card)',
    fontFamily: 'var(--font-sans)',
    fontSize: '12px',
    lineHeight: '20px',
    fontWeight: '600',
    color: 'var(--accent-ink)',
  },
  '.cm-error-line': { backgroundColor: 'var(--destructive-tint)' },
  '.cm-error-gutter': {
    backgroundColor: 'var(--destructive-tint)',
    color: 'var(--destructive)',
    fontWeight: '600',
  },
  '.cm-error-chip': { borderColor: 'var(--destructive)', color: 'var(--destructive)' },
  '.cm-not-traced': { color: 'var(--faint)' },
})

const baseExtensions: Extension[] = [
  lineNumbers(),
  drawSelection(),
  javascript(),
  syntaxHighlighting(highlightStyle),
  theme,
  overlayField,
  EditorView.decorations.compute([overlayField, 'doc'], buildDecorations),
  lineNumberMarkers.compute([overlayField, 'doc'], buildGutter),
  keymap.of([
    {
      // Escape lets focus leave the editor, so the keyboard is never trapped in it.
      key: 'Escape',
      run: (view) => {
        view.contentDOM.blur()
        return true
      },
    },
  ]),
  EditorView.contentAttributes.of({
    'aria-label': 'Code editor',
    spellcheck: 'false',
    autocorrect: 'off',
    autocapitalize: 'off',
  }),
]

const editableCompartment = new Compartment()

function editableExtension(editable: boolean): Extension {
  return [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]
}

/** Marks a change made by the app, so it is not reported back as something the person typed. */
const fromApp = Annotation.define<boolean>()

interface CodeViewProps {
  source: string
  editable: boolean
  highlight: CodeHighlight | null
  error: CodeError | null
  notTraced: readonly NotTraced[]
  onChange: (source: string) => void
}

export function CodeView({
  source,
  editable,
  highlight,
  error,
  notTraced,
  onChange,
}: CodeViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  useEffect(() => {
    onChangeRef.current = onChange
  })

  // The editor is created once. Everything it shows is then kept in sync by the effects below.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          ...baseExtensions,
          editableCompartment.of(editableExtension(false)),
          EditorView.updateListener.of((update) => {
            if (
              update.docChanged &&
              !update.transactions.some((tr) => tr.annotation(fromApp) === true)
            ) {
              onChangeRef.current(update.state.doc.toString())
            }
          }),
        ],
      }),
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === source) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: source },
      annotations: fromApp.of(true),
    })
  }, [source])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: editableCompartment.reconfigure(editableExtension(editable)),
    })
  }, [editable])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    view.dispatch({ effects: setOverlay.of({ highlight, error, notTraced }) })
    if (highlight) {
      const at = offsetAt(view.state, highlight.loc.line, highlight.loc.col)
      if (at !== null) view.dispatch({ effects: EditorView.scrollIntoView(at, { y: 'nearest' }) })
    }
  }, [highlight, error, notTraced, source])

  return <div ref={hostRef} className="overflow-hidden rounded-b-xl" />
}
