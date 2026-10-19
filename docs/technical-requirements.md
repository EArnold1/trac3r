# Execution Flow Tracer: Technical Requirements

Oct 17, 2026 · @Arnold

This doc fixes the stack, the TypeScript rules and the styling system for the Execution Flow Tracer. It goes with the Milestone 1 spec, which says what to build; this says how.

## Stack

Use the latest stable version of each at project start, pin exact versions in `package.json`, commit the lockfile, and run on the current Node LTS.

| Layer | Choice | Why |
| --- | --- | --- |
| Language | TypeScript, strict mode | One language for the UI, the engine and the sandbox, with shared types |
| UI | React, function components and hooks only | State is one reducer plus derived values; no class components |
| Build and dev server | Vite | Fast dev loop; also bundles the sandbox Worker |
| Styling | Tailwind CSS v4 through the `@tailwindcss/vite` plugin | Utility classes, tokens as CSS variables, no `tailwind.config.js` |
| Components | shadcn/ui (Radix primitives copied into `src/components/ui`) | Accessible controls we own and can restyle |
| Icons | `lucide-react` | shadcn's default icon set |
| Code editor | CodeMirror 6 | Line and range decorations and inline widgets; much lighter than Monaco |
| Parsing | `acorn`, `magic-string` | As in the spec |
| Fonts | IBM Plex Sans and JetBrains Mono, self-hosted with Fontsource | No external requests, so they work under a strict CSP |
| Unit tests | Vitest | Engine and utilities |
| Component tests | Testing Library | UI panels |
| Browser tests | Playwright | The sandbox iframe and its CSP cannot be tested in jsdom |

## TypeScript

TypeScript is the only language in the repo besides config files and CSS. The code a person pastes is JavaScript, handled as a string; it is never part of the build.

Compiler options (in `tsconfig.app.json`, the file Vite's template creates):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Language rules:

1. **No `any`.** Use `unknown` at boundaries (sandbox messages, JSON) and narrow with hand-written type guards. `no-explicit-any` is an ESLint error.
2. **Variants are discriminated unions** (`StepKind`, run status, sandbox messages). Switch on them exhaustively with a `never` check, so adding a variant breaks the build until every switch handles it.
3. **One definition of each shared type.** Types that cross the sandbox boundary live in `src/engine/types.ts`. The UI imports them and never redeclares them.
4. **Trace data is immutable.** Use `readonly` arrays and properties for `Step`, `Frame` and `RunResult`.
5. **No enums, no default exports** (except where a tool requires one, such as `vite.config.ts`). Use string-literal unions and named exports.
6. **No non-null assertions (`!`) and no `as` casts**, except in the single module that validates messages from the sandbox, with a comment saying why.
7. **`interface` for object shapes, `type` for unions and aliases.** Be consistent.
8. **File names are kebab-case** (`trace-panel.tsx`), matching the files shadcn generates. Exported components are PascalCase.

## Project layout

The code that parses and instruments stays free of the browser, so it can be tested without one. That means the Worker and iframe code cannot live beside it. This layout replaces the file tree in the Milestone 1 spec.

```
exec-tracer/
  src/
    engine/                 pure logic, no DOM, no React
      types.ts              Shown, Frame, Step, RunResult
      limits.ts             MAX_STEPS = 2000, TIMEOUT_MS = 3000
      parse.ts              acorn wrapper, syntax errors with position
      instrument.ts         inserts trace hooks with magic-string
      narrate.ts            plain-English text for each step kind
    runtime/                browser only
      sandbox-host.ts       creates the iframe, enforces the timeout
      worker.ts             Worker entry: runs instrumented code, records steps
      messages.ts           message types and the validating type guards
      index.ts              export function run(source: string): Promise<RunResult>
    components/
      ui/                   shadcn-generated; edit only to restyle
    app/
      app.tsx
      code-view.tsx
      controls.tsx
      result-panel.tsx
      current-value-panel.tsx
      trace-panel.tsx
      stack-panel.tsx
      console-panel.tsx
      reducer.ts
      use-playback.ts
      examples.ts
    lib/
      utils.ts              the cn() helper
    index.css               Tailwind import, tokens, fonts
    main.tsx
  tests/
    engine/                 Vitest, one file per acceptance program
    e2e/                    Playwright: sandbox and end to end
  components.json  eslint.config.js  vite.config.ts
  tsconfig.json  tsconfig.app.json  tsconfig.engine.json  tsconfig.worker.json  tsconfig.node.json
```

Imports go one way only:

| Folder | May import |
| --- | --- |
| `engine` | itself and npm packages (`acorn`, `magic-string`). Nothing from the DOM or React. |
| `runtime` | `engine` |
| `components/ui` | `lib` |
| `app` | `engine` types, `runtime`, `components/ui`, `lib` |

Enforce this twice. `tsconfig.engine.json` sets `lib` to `["ES2022"]` with no DOM, so any DOM use in `engine` fails the typecheck. `tsconfig.worker.json` adds `WebWorker` for `worker.ts` only. ESLint `no-restricted-imports` blocks the other directions.

The iframe's parent must accept a message only when `event.source` is that iframe's window, and must validate every message with the type guards in `messages.ts` before using it.

**Prove this first.** A sandboxed iframe has an opaque origin and cannot load a script from the app's origin, so the Worker script must reach it as text and be started from a blob URL inside the iframe. The iframe's bootstrap script must be allowed in its CSP by hash. Build a throwaway version that runs `1 + 1` this way, with the CSP in place, before writing any tracing code. The spec's CSP line needs that hash added.

## Setup

These steps follow the [shadcn/ui Vite installation guide](https://ui.shadcn.com/docs/installation/vite). The package manager is pnpm, as in that guide; npm works if you swap the commands.

1. Create the project and choose React with TypeScript:

```bash
pnpm create vite@latest exec-tracer
```

2. Add Tailwind and the Node types Vite needs for the `@` alias:

```bash
pnpm add tailwindcss @tailwindcss/vite
pnpm add -D @types/node
```

3. Replace the contents of `src/index.css` with:

```css
@import "tailwindcss";
```

4. Add the `@/*` alias to both `tsconfig.json` and `tsconfig.app.json`, under `compilerOptions`:

```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

5. Set up `vite.config.ts`:

```ts
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})
```

6. Initialize shadcn/ui, then add the components listed under shadcn components below:

```bash
pnpm dlx shadcn@latest init
```

7. Add the remaining dependencies:

```bash
pnpm add acorn magic-string @codemirror/state @codemirror/view @codemirror/language @codemirror/lang-javascript @lezer/highlight
pnpm add @fontsource/ibm-plex-sans @fontsource-variable/jetbrains-mono
pnpm add -D vitest jsdom @testing-library/react @testing-library/jest-dom @playwright/test @axe-core/playwright prettier prettier-plugin-tailwindcss eslint typescript-eslint eslint-plugin-react-hooks eslint-plugin-jsx-a11y
```

The shadcn init installs `lucide-react`, `clsx`, `tailwind-merge` and `class-variance-authority` itself. If a Fontsource import fails, check the package name on npm; the font families are what matter.

## Styling system

All styling is Tailwind utility classes against design tokens defined once in `src/index.css`. The shadcn components read the same tokens, so restyling the app means changing values in one place. The values come from the UI mockup.

### Color tokens

Write values as hex. Keep everything the shadcn init generated (imports, `@layer base`, the `@theme inline` mappings), replace the `:root` values below, and add the app tokens.

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#F3F4F6` | Page background |
| `--foreground` | `#161A22` | Primary text |
| `--card` | `#FFFFFF` | Panels (also `--popover`) |
| `--primary` | `#0B6E78` | Run button, scrubber, active controls |
| `--primary-foreground` | `#FFFFFF` | Text on primary |
| `--secondary` | `#E6EAF0` | Chips and badges (kind, type) |
| `--muted` | `#EEF0F4` | Chip background on dimmed, later steps |
| `--muted-foreground` | `#4B5563` | Captions and panel labels |
| `--accent` | `#D8F0F1` | Current line, current step, current frame |
| `--accent-foreground` | `#161A22` | Text on accent |
| `--border` | `#D9DDE3` | Card and divider borders |
| `--input` | `#C3C9D2` | Borders of buttons, selects and inputs |
| `--ring` | `#0B6E78` | Focus ring |
| `--destructive` | `#B42318` | Errors (proposed, not in the mockup yet; use on white or on `#FEE4E2`) |
| `--faint` | `#6B7280` | Line numbers and later trace rows. 4.8:1 on white, so never on a tinted background |
| `--accent-ink` | `#0B5A63` | Teal text on the accent tint, such as the inline value chip |
| `--highlight` | `#9FD6DB` | The active expression inside the current line |
| `--changed` | `#FFE9A8` | A value that is new or changed in this step |
| `--syntax-keyword` | `#5B3FA0` | Keywords in the editor |
| `--syntax-number` | `#9A4400` | Numbers in the editor |
| `--syntax-string` | `#1A6B3A` | Strings in the editor (proposed) |

Expose the app tokens to Tailwind in the `@theme inline` block, one line each, so `bg-highlight`, `text-faint` and the rest exist:

```css
@theme inline {
  --color-faint: var(--faint);
  --color-accent-ink: var(--accent-ink);
  --color-highlight: var(--highlight);
  --color-changed: var(--changed);
  --color-syntax-keyword: var(--syntax-keyword);
  --color-syntax-number: var(--syntax-number);
  --color-syntax-string: var(--syntax-string);
}
```

### Fonts and type scale

IBM Plex Sans for the interface and JetBrains Mono for code, values and frame names. Import `@fontsource/ibm-plex-sans/400.css`, `/500.css` and `/600.css` and `@fontsource-variable/jetbrains-mono` at the top of `index.css`, and set `--font-sans` to `"IBM Plex Sans", system-ui, sans-serif` and `--font-mono` to `"JetBrains Mono Variable", ui-monospace, monospace` in `@theme`.

Define the type scale as theme tokens so components use names, not pixel values:

| Class | Size / line height | Use |
| --- | --- | --- |
| `text-label` | 13px / 18px | Panel titles (uppercase, semibold, wide tracking), captions, chips |
| `text-dense` | 14px / 20px | Trace rows, code, stack frames, variables |
| `text-body` | 15px / 22px | Default text, controls |
| `text-narration` | 22px / 31px | The current step's description |
| `text-result` | 48px / 56px | The result value (mono, semibold) |

### Rules

1. **Style with Tailwind classes and token classes only** (`bg-card`, `text-muted-foreground`, `border-border`, `bg-accent`). An inline `style` is allowed only to pass a computed value as a CSS variable, such as a frame's depth.
2. **No hex or `rgb()` outside the `:root` block.** A lint step greps `src` for color literals and fails on any.
3. **Compose classes with `cn()`** and define variants with `class-variance-authority`, as the shadcn components do. Order classes with `prettier-plugin-tailwindcss`.
4. **Touch targets are 44px.** Set shadcn's default Button and Select height to `h-11` in the generated files. Icon buttons are 44 by 44.
5. **Spacing follows a 4px grid.** Cards use a 12px radius and `p-4` bodies, controls an 8px radius (`--radius: 0.5rem`), chips are fully rounded, and panels are `gap-4` apart.
6. **The page fits the window.** Above 980px wide it is exactly as tall as the window (at least 640px) with no page scroll: header, two columns (5fr and 7fr) and the controls bar, and only the panels scroll inside. Below 980px it is one column, the page scrolls and the controls bar sticks to the bottom. See `docs/redesign-notes.md`.
7. **Contrast and focus.** Text is at least 4.5:1 and control borders and icons at least 3:1. Every control shows a visible focus ring. State is never color alone: the current step also has `aria-current="step"` and heavier text, and chips carry words.
8. **Light and dark are token sets.** The dark values are a `:root[data-theme='dark']` block in `index.css`; the theme is `data-theme` on `<html>`. Components never branch on the theme, so do not write `dark:` classes. The color-literal check allows hex in both blocks.
9. **Motion is minimal.** Only a 150 to 200 ms highlight when a frame is pushed or popped, and it is disabled under `prefers-reduced-motion`.

## shadcn components

Add the ones the UI needs in one command:

```bash
pnpm dlx shadcn@latest add button card select badge slider scroll-area tooltip alert separator toggle-group
```

| UI part | Built from | Notes |
| --- | --- | --- |
| Run, Edit code, Replay | `Button` | Run uses the default (primary) variant, the others `outline`. 44px high. |
| Previous, Next, Reset | `Button` (`outline`, icon size) with a `lucide-react` icon | Each needs an `aria-label`. Wrap in `Tooltip`. |
| Example and Speed pickers | `Select` | Each has a visible `label`. |
| Panels (Code, Result, Current value, Trace, Call stack, Console) | `Card` with a header row and a body | Panel titles use `text-label`. |
| Kind chips, type chips, "new in this call" | `Badge` (`secondary`, with a `changed` variant) | Add the `changed` variant with `bg-changed`. |
| Step scrubber | `Slider` | Arrow keys on it already move one step, so the global arrow-key shortcut must ignore events from the slider, the editor and the selects. |
| Trace list | A native scrolling `ol` of rows, each a chevron `button` (calls only) and a row `button` | Folded by call. The current row has `aria-current="step"` and the list scrolls to it. |
| Call stack frames | `ToggleGroup` (single) or plain `button`s with `aria-pressed` | Selecting a frame changes the variables shown. |
| Timeout, truncation and error banners | `Alert` | Use the `destructive` variant for errors. |
| Dividers inside panels | `Separator` |  |

Not from shadcn, written by hand: the code view (CodeMirror), a trace row, a stack frame and the value chip. They are built from the same tokens and `Badge`.

Generated files in `src/components/ui` may be edited to restyle them, and nothing else changes there. Do not copy them into `app`.

## Code editor

CodeMirror 6 through its core packages (`@codemirror/state`, `@codemirror/view`, `@codemirror/language`, `@codemirror/lang-javascript`, `@lezer/highlight`), wrapped in one React component, `code-view.tsx`. Do not add a React wrapper library.

The editor has two modes. Editing: the person types and the code is not running. Replaying: the editor is read-only and decorations follow the current step. Switch with a compartment that toggles `EditorState.readOnly` and `EditorView.editable`.

Decorations, all driven by one state field that takes the current step as an effect:

| Decoration | Where | Look |
| --- | --- | --- |
| Line decoration | The current step's line | `bg-accent` across the full line, line number in `text-primary` and semibold |
| Mark decoration | The step's expression range (`loc`) | `bg-highlight`, 3px radius |
| Widget decoration | The end of the current line | The value chip, such as `→ true`: white background, `border-primary`, `text-accent-ink`, fully rounded, 12px text |

Theme and highlighting:

1. Build the theme with `EditorView.theme` and CSS variables only (`var(--card)`, `var(--faint)`), so it follows the tokens.
2. Syntax colors come from a `HighlightStyle` using `--syntax-keyword`, `--syntax-number` and `--syntax-string`. Everything else uses `--foreground`.
3. Font is `font-mono` at 14px with a 24px line height. Line numbers are 48px wide and right-aligned, in `--faint`.
4. Lines marked "not traced" get a subtle `text-faint` style and a tooltip saying why.

The editor must be keyboard-accessible: it keeps CodeMirror's default keymap, and Escape lets focus leave it.

## App state and playback

One `useReducer` in `app.tsx`, no state library. The state:

```ts
type RunState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; run: RunResult };

interface AppState {
  source: string;
  run: RunState;
  mode: 'editing' | 'replaying';
  stepIndex: number;                 // 0-based index into run.steps
  playing: boolean;
  speed: 0.5 | 1 | 2;
  selectedFrameId: number | null;    // null means the top frame
}
```

Rules:

1. **The reducer is pure and exhaustive.** Actions are `edit`, `runStarted`, `runFinished`, `goto`, `next`, `prev`, `reset`, `play`, `pause`, `setSpeed`, `selectFrame` and `backToEditing`. Switch on them with a `never` check and unit-test the reducer.
2. **Derive, do not store.** The current step, the selected frame and the changed variables (a diff against the previous step) are computed while rendering.
3. **Panels are functions of `(run, stepIndex, selectedFrameId)`.** The Result panel depends only on `run`, so stepping never changes it.
4. **After a run finishes**, the mode is `replaying`, `stepIndex` is 0 and `playing` is false.
5. **Runs can be superseded.** Each Run gets an id. Pressing Run while one is in progress kills the old sandbox, and a result from an old id is ignored.
6. **Playback** lives in `use-playback.ts`: a timeout chain at `800 ms / speed` per step that stops on the last step. Stepping by hand pauses playback.
7. **Keyboard.** Left and right arrows step, and Space plays or pauses. One `keydown` listener on the window, ignoring events from the editor, the slider and the selects.
8. **Long traces.** Render the trace list plainly. If 2,000 rows scroll badly, ask before adding a virtualization library.

## Quality gates

Scripts in `package.json`:

| Script | Does |
| --- | --- |
| `dev` | Vite dev server |
| `build` | `tsc -b && vite build` |
| `typecheck` | `tsc -b` across all the tsconfig projects |
| `lint` | ESLint, plus the color-literal check from the styling rules |
| `format:check` | Prettier, including `prettier-plugin-tailwindcss` |
| `test` | Vitest: engine, reducer and component tests |
| `test:e2e` | Playwright: sandbox and end-to-end tests |
| `check` | `typecheck`, `lint`, `format:check` and `test` together |

ESLint uses `typescript-eslint` with the `strictTypeChecked` and `stylisticTypeChecked` presets, `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`. Turn on `no-explicit-any`, `no-non-null-assertion`, `switch-exhaustiveness-check` and the per-folder `no-restricted-imports` rules from the project layout.

Tests:

1. **Vitest, engine.** One file per acceptance program in the spec. Each compares the result with and without instrumentation. The test harness may run its own fixtures with `new Function`; this is the only place outside the sandbox where that is allowed, because the fixtures are our code and not pasted code.
2. **Vitest and Testing Library, UI.** Reducer tests, and panel tests that render a saved `RunResult` fixture of the factorial trace and check the current row (`aria-current`), the value chip and the Result panel.
3. **Playwright, sandbox.** Run in Chromium, Firefox and WebKit, because iframe sandboxing and CSP behave differently between engines. Cover every sandbox test in the spec: no network (including from a nested Worker), no `document`, no cookies or `localStorage`, a 3-second kill that leaves the page responsive, and nothing running without Run.
4. **Playwright, end to end.** Paste the factorial example, press Run, expect the result 6, jump to step 7 and expect the current value `true`. Run axe (`@axe-core/playwright`) on that screen and expect no serious violations.

Browser support is the latest two versions of Chrome, Edge, Firefox and Safari. Starting targets, to be measured and not promised: factorial runs and returns in under 500 ms including sandbox startup, and stepping a 2,000-step trace re-renders in under 16 ms per step. CI runs `check` and `test:e2e` on every push.

## Assumptions and open questions

Assumptions made, each easy to change:

- **pnpm** is the package manager, because the shadcn guide uses it.
- **Hex color values** in the tokens, not the OKLCH values shadcn's init generates. The look is the same.
- **CodeMirror 6, not Monaco.** It is lighter and its decorations are simpler. Monaco's IntelliSense is not needed for pasted snippets.
- **Fonts are self-hosted** through Fontsource, which adds two small dependencies.
- **Light and dark themes**, following the system setting, from v2 of the design.

Open questions:

- Where will it be deployed? The host decides how the sandbox iframe is served, and a public deployment needs it on a separate origin.
- Should a later milestone accept pasted TypeScript by stripping the types before running?
- Should the destructive (error) colors proposed here be shown in the mockup before the build starts?

## Sources

- [shadcn/ui: Vite installation](https://ui.shadcn.com/docs/installation/vite), opened 2026-10-17. Setup steps 1 to 6 follow it.
