# Execution Flow Tracer

Paste JavaScript, press **Run**, and step through what happened: the result, a replay of every
step with the current line, call stack and variables, and a plain-English description of each step.
The code really runs, inside a sandbox in your browser.

## Run it

```bash
pnpm install
pnpm dev          # http://localhost:5173
```

Needs a current Node LTS and pnpm. Nothing runs until you press Run.

## Commands

| Command         | Does                                                         |
| --------------- | ------------------------------------------------------------ |
| `pnpm dev`      | Vite dev server                                              |
| `pnpm build`    | Typecheck and build to `dist/`                               |
| `pnpm check`    | Typecheck, lint, format check and unit/component tests       |
| `pnpm test`     | Vitest: engine, reducer and component tests                  |
| `pnpm test:e2e` | Playwright in Chromium, Firefox and WebKit (sandbox and app) |

The first time, install the browsers with `pnpm exec playwright install chromium firefox webkit`.

## Safety

Pasted code runs only in a sandboxed iframe (no `allow-same-origin`) with a CSP, in a fresh Worker
per run, with a 3 second timeout. This is built for running your own snippets in your own browser.
A public deployment would need the sandbox iframe served from a separate origin.

## More

- `docs/milestone-1-spec.md`: what is built and why.
- `docs/technical-requirements.md`: stack, TypeScript rules, styling tokens.
- `CLAUDE.md`: notes for working on this repo with Claude Code.
