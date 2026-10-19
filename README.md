# exec-trac3r

A web app that shows how code runs. Paste JavaScript, press **Run**, and get two things from the same run:

- **Value**: the result of the last top-level expression, the console output, or the error.
- **Execution trace**: a step-by-step replay. Each step shows the current line, the call stack, the variables and a plain-English note on what happened.

The code really runs, in a sandbox in your browser. It was built because tracing code in your head, recursion especially, is hard.

## Run it locally

You need a current Node LTS and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

Nothing runs until you press Run. Not on typing, not on paste, not on load.

### Other commands

| Command         | What it does                                 |
| --------------- | -------------------------------------------- |
| `pnpm build`    | Typecheck and build to `dist/`               |
| `pnpm check`    | Typecheck, lint, format check and unit tests |
| `pnpm test`     | Unit and component tests (Vitest)            |
| `pnpm test:e2e` | End-to-end tests (Playwright)                |

Before the first e2e run, install the browsers: `pnpm exec playwright install chromium firefox webkit`

## What it supports now

JavaScript only.

- Function calls and returns, including recursion
- `if` / `else`, and `for`, `while` and `do/while` loops
- Variable declarations and assignments
- `console` output
- Errors (syntax errors are reported before anything runs)
- Step through the trace forward and back, or play it automatically
- Trace folded by call: open calls stay open, others fold to one row with the return value
- Built-in examples: `factorial(3)`, `fibonacci(4)`, a sum loop
- Light and dark theme (follows the system, with a switch in the header)

## How it works

1. **Parse**: `acorn` reads the code. Syntax errors stop the run here.
2. **Instrument**: `magic-string` adds trace hooks (function entry and exit, `return`, conditions, assignments, `console` calls).
3. **Run**: the code runs in a Worker inside a sandboxed iframe. The hooks record the steps.
4. **View**: the Worker sends back one message with the result, output and steps. The UI only reads it, so stepping back just moves an index.

The trace does not change the result. Tests run the same code with and without it and compare.

## Safety

- Code runs only in a sandboxed iframe (`allow-scripts`, no `allow-same-origin`) with a CSP of `default-src 'none'`.
- A fresh iframe and Worker for every run, and a 3 second timeout.
- Never run on the main thread or on a server.
- Made for running your own snippets in your own browser. A public deployment would need the sandbox iframe on a separate origin.

## Limits

**Run limits**

- 2,000 steps are recorded. After that the code still finishes, but the trace is cut and marked truncated.
- 3 second timeout. If a run takes longer than 3 seconds (for example an infinite loop), the sandbox is removed and the run is reported as a timeout.
- Console: 1,000 lines, 10,000 characters each.
- Value previews: 2,000 characters, 20 children per level, 3 levels deep.
- A browser cannot cap Worker memory, so huge allocations can slow or crash the tab.

**Not traced** (the code runs, the lines are marked "not traced")

- `async` / `await` and generators
- Class bodies, getters and setters
- Code run through `eval` or `new Function`
- Calls inside parameter default values

**Steps not recorded**

- `for…of` and `for…in` have no per-iteration step
- `switch` has no step for the case taken
- Native calls inside an expression, like `Math.max(a, b)` in `x = …`
- No iteration count in loop notes

**What the trace shows**

- Only the frame's own variables, not closure variables
- Values are one-line previews. Objects and arrays do not expand yet
- Tracing makes recursion overflow a little sooner, and `fn.toString()` shows the instrumented source

The full list, open issues and roadmap are in [`docs/known-limits-and-roadmap.md`](docs/known-limits-and-roadmap.md).

## Roadmap

- Call-tree view of recursion
- Async code and generators
- Closure variables
- Expandable objects and arrays
- Other languages, shareable links and trace export (later)

## Tech

TypeScript (strict), React, Vite, Tailwind v4, shadcn/ui, CodeMirror 6, `acorn`, `magic-string`, Vitest, Testing Library, Playwright.

```
src/engine    parse, instrument, narrate, types (pure logic, no DOM)
src/runtime   sandbox host, Worker entry, message checks
src/app       the UI
tests/        engine, runtime and UI tests (Vitest), e2e (Playwright)
```

## Docs

- [`docs/milestone-1-spec.md`](docs/milestone-1-spec.md): scope, rules, data model, acceptance tests
- [`docs/technical-requirements.md`](docs/technical-requirements.md): stack, TypeScript rules, layout, quality gates
- [`docs/redesign-notes.md`](docs/redesign-notes.md): the current UI
- [`docs/known-limits-and-roadmap.md`](docs/known-limits-and-roadmap.md): limits, open issues, roadmap
- [`CLAUDE.md`](CLAUDE.md): notes for working on this repo with Claude Code
