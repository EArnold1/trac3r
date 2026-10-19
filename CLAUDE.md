# exec-trac3r

A web app for understanding how code runs. Paste code (JavaScript today, more languages planned), press Run, and get two things from the same run:

- **Value**: the result of the last top-level expression, the console output, or the error.
- **Execution trace**: a step-by-step replay with the current line highlighted, the call stack, variables, and plain-English narration of each step.

The code really runs, in a sandbox. It was built because tracing code, recursion especially, is hard to do in your head.

## Docs

Read the relevant doc before changing the area it covers.

- `docs/milestone-1-spec.md`: scope, hard rules, sandbox measures, data model, worked example, acceptance tests.
- `docs/technical-requirements.md`: stack, TypeScript rules, project layout, styling tokens, editor and state rules, quality gates. Its project layout replaces the file tree in the spec.
- `docs/redesign-notes.md`: the current UI (one screen with no page scroll, trace folded by call, light and dark theme). It is newer than the other two where they disagree.
- `docs/mockup/Main.dc.html`: the UI mockup. Open it in a browser or read the markup. It uses inline styles; the app uses Tailwind token classes.

## Stack

TypeScript (strict), React, Vite, Tailwind v4, shadcn/ui, CodeMirror 6 for the editor, `acorn` and `magic-string` for parsing and instrumenting, Vitest, Testing Library and Playwright for tests. Package manager is pnpm. Ask before adding a library that is not in the technical doc.

## How it works

1. **Parse**: `acorn` turns the source into a syntax tree with positions. Syntax errors are reported before anything runs.
2. **Instrument**: `magic-string` inserts trace hooks (function entry and exit, around `return`, in `if` and loop conditions, after assignments, around `console` calls) and wraps the last top-level expression to capture the result.
3. **Run**: the instrumented code runs inside a Worker in a sandboxed iframe. Hooks record steps; each step holds the line, the value produced, a snapshot of the call stack and the console output so far.
4. **View**: the Worker posts one message with the result, the output and the steps. The UI only reads it, so stepping back is moving an index.

The public API is `run(source): Promise<RunResult>` in `src/runtime/index.ts`. Shared types (`Shown`, `Frame`, `Step`, `RunResult`) live in `src/engine/types.ts`.

## Architecture

- `src/engine`: pure logic (parse, instrument, narrate, types, limits). No DOM, no React. Its tsconfig has no DOM lib so a violation fails the typecheck.
- `src/runtime`: browser-only. Sandbox host (iframe and timeout), Worker entry, message types and validating type guards.
- `src/app`: the UI. Panels, a single reducer, playback hook, examples.
- `src/components/ui`: shadcn components. Edit them only to restyle.
- `tests/engine`: Vitest, one file per acceptance program. `tests/e2e`: Playwright, for the sandbox and end to end.

Imports go one way: `app` may import `engine` types, `runtime`, `components/ui` and `lib`; `runtime` may import `engine`; `engine` imports only itself and npm packages. ESLint enforces it.

## Rules that must not break

- Pasted code runs only in the sandbox: a Worker inside an iframe with `sandbox="allow-scripts"` (no `allow-same-origin`), a CSP of `default-src 'none'`, a fresh iframe and Worker per Run, and a 3-second timeout enforced by the parent. Never run pasted code on the main thread, never pass it to `eval` or `new Function` outside the sandbox, and never run it on a server.
- Code runs only when Run is pressed, never on typing, paste or load.
- The trace must not change the result. The same code gives the same result with and without instrumentation; tests run both and compare.
- Every run is bounded: 2,000 recorded steps (keep the first 2,000, set `truncated`, let the run finish), 1,000 console lines of 10,000 characters, `Shown.text` at 2,000 characters, children at 20 per level and 3 levels deep.
- Values cross the sandbox boundary as plain data (type tag, preview string, capped children), never as live objects. The parent accepts messages only when `event.source` is the iframe's window and validates each one with the type guards.
- Syntax the tracer cannot instrument still runs; its lines are marked "not traced".

## UI

- One screen, no page scroll. Only the insides of panels scroll. Replay controls are pinned at the bottom.
- Execution trace is grouped by call. Calls that contain the current step stay open; others fold to one row (return value and step count, or "not reached"). Users can fold and unfold by hand.
- Values are shown as a capped one-line preview, like a collapsed DevTools value.
- Light and dark theme through CSS variables, following the system setting with a switch in the header; the choice is remembered.
- Style with Tailwind token classes only. No hex or `rgb()` outside the token definitions. Touch targets are 44px, except the dense trace rows. Text meets 4.5:1 contrast and every control has a visible focus ring.

## Code conventions

- TypeScript strict, plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`.
- No `any` (use `unknown` and narrow). No enums, no default exports (except where a tool requires one). No non-null assertions or `as` casts, except in the one module that validates sandbox messages.
- Discriminated unions for variants, switched on exhaustively with a `never` check. Trace data is `readonly`.
- React function components and hooks only. App state is one `useReducer`; derive values while rendering instead of storing them.
- Kebab-case file names, PascalCase components.

## Commands

- `pnpm dev`: dev server.
- `pnpm build`: typecheck and production build.
- `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`.
- `pnpm check`: typecheck, lint, format check and unit tests together. Run it before committing.

## Commits

Follow Conventional Commits: `type(scope): summary`, with a short summary in the imperative and an optional scope (`engine`, `runtime`, `app`). For example `feat(engine): add trace data model and run limits`. Use the standard types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `build`, `ci`. Add a body only when the why is not obvious, in a sentence or two, with no bullet lists. Do not add attribution to commit messages.
