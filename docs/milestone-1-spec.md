# exec-trac3r: Milestone 1 Spec

Oct 17, 2026 · @Arnold

Milestone 1 is a web app where you paste JavaScript, run it, and get two things back: the **value** (the result of the run, plus the value at each step) and the **execution trace** (a step-by-step replay of how it got there).

## Goal and scope

Help a developer follow code that is hard to trace in their head, recursion especially, by running it for real and replaying the run one step at a time.

**In milestone 1**

- Paste a block of JavaScript into an editor and press Run. The code runs for real, in a sandbox.
- See the result: the value of the last expression, everything printed with `console.log`, or the error the code threw.
- See the execution trace: step forward and back through the run, or replay it automatically.
- At every step, see the current value (what the expression on that line produced), the highlighted line, a plain-English description, the call stack and the variables in scope.
- Get a clear message when the code has a syntax error, throws, or runs too long.

**Not in milestone 1**

- Tracing of async code, generators and class bodies (they still run and still give a result, but are not traced), a call-tree view of recursion, an expandable value tree, imports, and network access.
- Other languages, saved or shared traces, user accounts.

## Hard rules

1. **Run pasted code only in the sandbox described below.** A Worker inside a locked-down iframe, with a 3-second timeout. Never run pasted code on the page's main thread, and never pass it to `eval` or `new Function` outside that sandbox.
2. **The trace must not change the result.** Instrumentation only observes: the same code gives the same result with and without it. A test runs both and compares.
3. **Every run is bounded.** Record at most 2,000 steps. If more happen, keep the first 2,000, set `truncated`, and let the run finish so the result stays correct. At 3 seconds, stop and report "Timed out after 3 s, possible infinite loop". A real stack overflow is shown as the error it is, with the trace up to that point.
4. **Values cross the sandbox boundary as plain data (a type tag, a preview string and capped children)**, never as live objects.
5. **The engine has no UI dependencies.** Nothing under `src/engine` imports the DOM or React, so it can later run in a CLI or in tests alone.
6. **Syntax the tracer cannot instrument still runs.** Mark those lines "not traced" instead of failing.

## Sandbox measures

The sandbox exists for one case: a person running a snippet they pasted, on their own machine. Each measure below answers one threat, and every one needs a test.

| Threat | Measure |
| --- | --- |
| Reaching the app's page, cookies or storage | Run in an iframe with `sandbox="allow-scripts"` and no `allow-same-origin`. The code gets an opaque origin with no access to the app's DOM, cookies or `localStorage`. |
| Network calls, including from a nested Worker | The iframe page carries a CSP of `default-src 'none'; script-src 'unsafe-eval' blob: 'sha256-<bootstrap hash>'; worker-src blob:`. That blocks `fetch`, `XMLHttpRequest`, `WebSocket` and any loading, and blob Workers inherit the policy. Deleting those globals inside the Worker is a second layer, not the main one. |
| Infinite loops | A fresh Worker for every Run, inside the iframe. The parent starts a 3-second timer and, when it fires, removes the iframe, which kills the Worker and everything in it. |
| Runaway output or huge values | At most 1,000 console lines of 10,000 characters each, `Shown.text` capped at 2,000 characters, and children at 20 entries per level and 3 levels deep, and 2,000 recorded steps. |
| State leaking between runs | A new iframe and Worker for every Run. Nothing is reused. |
| Code tampering with the tracer | Hooks live in a closure under an unguessable name. Code that fakes its own trace only changes its own display. |
| Code running without a Run | Nothing executes while typing, on load or on paste. Only the Run button starts a run. |

Known limits: a browser cannot cap a Worker's memory, so a snippet that allocates huge arrays can still slow or crash the tab, and the timeout is the main protection. This design is for running your own pasted snippets in your own browser. Never run pasted code on a server, and a public deployment needs the iframe served from a separate origin.

## How it works

Four stages. Parse, instrument and view are pure functions, so each can be tested on its own.

1. **Parse.** `acorn` turns the source into an ESTree syntax tree with line and column on every node. Syntax errors are reported with their position before anything runs.
2. **Instrument.** Walk the tree and insert small hook calls with `magic-string`, which keeps the original code and line numbers intact. Hooks go at function entry and exit, around `return`, in `if` and loop conditions, after assignments, and around `console` calls. The last top-level expression statement is wrapped so its value is captured as the result.
3. **Run in the sandbox.** The instrumented code runs inside the worker. Hooks append steps, each holding a snapshot of the call stack, the variables and the value produced. `console.log` is replaced by a function that records output.
4. **View.** The worker posts back one message with the result, the output and the steps. The UI only reads it, so stepping back is just moving an index.

The program runs once, at full speed, before any replay starts, so the result and output are the real ones and the replay is a recording of that run. Snapshots are copied by value as display strings, and the 2,000-step cap keeps memory small.

## What the tracer covers

Everything the browser's JavaScript engine supports runs, because the code really runs. Tracing in milestone 1 covers the rows below. Anything else (`async` / `await`, generators, class bodies, getters and setters) runs untraced, its lines marked "not traced". `import` and `export` are not allowed.

| Category | Traced in milestone 1 |
| --- | --- |
| Declarations | `let`, `const`, `var`, function declarations, arrow functions and function expressions |
| Assignments | `=`, compound assignment such as `+=`, `++` and `--`, array and object property writes |
| Calls | every call and return, including recursion and calls nested as arguments such as `f(g(x))` |
| Branches | `if` / `else` and ternary conditions, with the value and the path taken |
| Loops | `for`, `while`, `do` / `while`: one step per iteration, with the condition value |
| Output | `console.log`, `console.warn`, `console.error` |
| Errors | `throw` and runtime errors, with the line where they happened |

## Trace step model

The one public function is `run(source: string): Promise<RunResult>`, in `src/runtime/index.ts`. Types live in `src/engine/types.ts`.

```ts
// A value as shown to the user. Real values never leave the sandbox.
interface Shown {
  type: 'number' | 'string' | 'boolean' | 'null' | 'undefined' | 'array'
      | 'object' | 'function' | 'symbol' | 'bigint' | 'error' | 'circular';
  text: string;                    // one-line preview, like a collapsed DevTools value:
                                   // 6, "hi", [1, 2, 3], {a: 1, b: 2, …}, ƒ factorial
  children?: readonly { key: string; value: Shown }[];  // arrays and objects only,
                                   // at most 20 entries per level and 3 levels deep
  omitted?: number;                // entries left out because of those caps
}

type StepKind =
  | 'declare'   // variable or function declared
  | 'assign'    // variable or property updated
  | 'branch'    // if, loop or ternary condition evaluated
  | 'call'      // function entered
  | 'return'    // function exited with a value
  | 'output'    // console call
  | 'error'     // something threw
  | 'end';      // program finished

interface Frame {
  id: number;                      // unique per call, needed for the later call tree
  fn: string;                      // 'factorial', or '<main>' for top level
  args: Shown[];
  callLine: number | null;         // line that made the call
  vars: Record<string, Shown>;     // this frame's own variables
}

interface Step {
  index: number;
  kind: StepKind;
  loc: { line: number; col: number; endLine: number; endCol: number };
  expr?: string;                   // source of the expression, e.g. 'n <= 1'
  value?: Shown;                   // what that expression produced at this step
  text: string;                    // plain-English narration shown to the user
  stack: Frame[];                  // snapshot after this step, bottom to top
  output: string[];                // console lines so far
}

interface RunResult {
  status: 'finished' | 'error' | 'timeout';
  result?: Shown;                  // value of the last top-level expression
  error?: { name: string; message: string; line: number | null };
  output: { level: 'log' | 'warn' | 'error'; text: string }[];   // all console output
  steps: Step[];
  truncated: boolean;              // more than 2,000 steps happened; the first 2,000 are kept
  durationMs: number;
}
```

The UI always shows two things. The **value**: `result` for the whole run, and `step.value` for the step being viewed. The **trace**: the list of `steps`. Narration must use real values, not just source text. Write "`n <= 1` is `3 <= 1`, which is false, so skip the early return", not "evaluate condition".

## UI requirements

Two panes: the code on the left, value and trace on the right, and a controls bar under both. A separate mockup shows the target layout at step 7 of the factorial example, where the stack is deepest.

| Area | Behavior |
| --- | --- |
| Code editor (CodeMirror 6) | Editable. Nothing runs until Run is pressed. After a run it is read-only, the current step's line is highlighted, and a small chip at the end of that line shows the value (for example `→ true`). |
| Result | The final value of the run, large, with its type. Always visible and it does not change as you step. An error replaces it with the error message and line. |
| Current value | The expression at the current step and the value it produced, plus the variables of the selected frame. Changed values are highlighted. |
| Execution trace | Every step as a row: number, kind, line, narration and its value. Past steps normal, the current step highlighted, later steps dimmed. Clicking a row jumps to it. |
| Call stack | Newest frame on top, indented by depth. A pushed frame is briefly highlighted, a popped frame shows its return value. Click a frame to inspect its variables. |
| Console | Lines printed up to the current step. The full output is part of the result. |
| Controls | Run, Edit code, Replay / Pause, Previous, Next, Reset, speed (0.5x, 1x, 2x) and a scrubber labeled "step n of N". Left and right arrow keys step. |
| Examples | A dropdown with factorial, fibonacci and a sum loop. |
| Errors | Syntax errors show inline at the line, before anything runs. A thrown error shows in the Result area and as the last trace step. A timeout or truncation shows a banner above the trace. |

## Worked example: factorial(3)

This program must give the result 6 and produce the 11 steps below. Treat the kind, line, value and stack columns as exact test expectations; the wording of the narration may differ.

```js
function factorial(n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}
factorial(3);
```

In the stack column, `f` stands for `factorial`, `main` is the top level, and the stack reads bottom to top.

| # | Line | Kind | Value | Stack after step | Narration |
| --- | --- | --- | --- | --- | --- |
| 1 | 1 | declare | none | main | Declare function `factorial`. |
| 2 | 5 | call | none | main, f(3) | Call `factorial(3)`. |
| 3 | 2 | branch | false | main, f(3) | `3 <= 1` is false, so skip the early return. |
| 4 | 3 | call | none | main, f(3), f(2) | `n * factorial(n - 1)` needs `factorial(2)` first, so call it. |
| 5 | 2 | branch | false | main, f(3), f(2) | `2 <= 1` is false. |
| 6 | 3 | call | none | main, f(3), f(2), f(1) | Needs `factorial(1)`, so call it. |
| 7 | 2 | branch | true | main, f(3), f(2), f(1) | `1 <= 1` is true, so take the early return. |
| 8 | 2 | return | 1 | main, f(3), f(2) | `factorial(1)` returns 1. |
| 9 | 3 | return | 2 | main, f(3) | `factorial(2)` is `2 * 1`, so it returns 2. |
| 10 | 3 | return | 6 | main | `factorial(3)` is `3 * 2`, so it returns 6. |
| 11 | 5 | end | 6 | empty | Program finished. Result: 6. |

## Stack and project structure

TypeScript, Vite, React, Tailwind and shadcn/ui for the app; `acorn` and `magic-string` for parsing and instrumenting; CodeMirror 6 for the editor; Vitest and Playwright for tests. The Technical Requirements doc has the full stack, the TypeScript rules and the styling system. Ask before adding any other library.

```
exec-trac3r/
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
      messages.ts           message types and validating type guards
      index.ts              export function run(source: string): Promise<RunResult>
    components/ui/          shadcn components
    app/
      app.tsx
      code-view.tsx         CodeMirror, line highlight, inline value chip
      controls.tsx
      result-panel.tsx
      current-value-panel.tsx
      trace-panel.tsx
      stack-panel.tsx
      console-panel.tsx
      reducer.ts
      use-playback.ts
      examples.ts
  tests/engine/             one test file per acceptance program below
  tests/e2e/                Playwright: sandbox and end to end
```

## Build order for the first session

1. Scaffold Vite, React and TypeScript, and add Vitest.
2. Write `types.ts` and `limits.ts` from the data model above.
3. Build the sandbox first: a worker that runs plain code and returns the result and console output, with the timeout. Test an infinite loop, a thrown error, and `document` being undefined.
4. Add `parse.ts` and `instrument.ts` for declarations, assignments, calls and returns. Check that results are identical with and without instrumentation.
5. Add branches, loops and errors. Make the factorial(3) trace above pass exactly.
6. Write narration for every step kind, using real values.
7. Build the UI: editor, Run, Result, Current value, trace, call stack, console, controls, examples.
8. Handle errors, timeouts and truncation in the UI.
9. Run every acceptance test, then try each example by hand in the browser.

Commit after each numbered step.

## Acceptance tests

Milestone 1 is done when all of these pass.

- [ ] `factorial(3)` gives the result 6 and matches the 11-step trace above (kinds, lines, values, stacks).
- [ ] `fibonacci(4)` gives the result 3, and its frames are pushed and popped in the correct order even though each frame makes two recursive calls.
- [ ] A `for` loop summing 1 to 5, ending in `sum;`, gives the result 15 and shows the variable changing each iteration.
- [ ] `console.log` output appears in the console in order and in the run's output data.
- [ ] An `if` / `else if` / `else` chain takes the correct branch and the narration says why.
- [ ] Array `push` and index access update the array shown in the variables.
- [ ] Code that throws shows the error name, message and line, and the trace ends at the throw.
- [ ] `while (true) {}` is stopped after 3 seconds with status `timeout`, the page stays responsive, and the first 2,000 steps are shown.
- [ ] Infinite recursion reports the engine's stack overflow error, with the trace up to that point.
- [ ] A program that takes more than 2,000 steps still returns the correct result, with `truncated` set.
- [ ] A `class` declaration still runs and gives the right result, with its lines marked "not traced".
- [ ] Every example gives the same result with and without instrumentation (tests run both).
- [ ] Pasted code cannot see `document` or `window`, and `fetch` is unavailable inside the run.
- [ ] Stepping forward then back lands on identical state.

* [ ] A snippet that tries `fetch`, `XMLHttpRequest`, `WebSocket`, or `fetch` from a nested `new Worker` cannot reach the network, and cannot read the app's cookies or `localStorage`.
* [ ] Typing or pasting code never executes it; only the Run button does.

## Later milestones and open questions

Ideas for after milestone 1, not commitments:

| Milestone | Adds |
| --- | --- |
| 2 | A call-tree view of recursion (one node per call, with its returned value), tracing of async code and generators, closures, and expandable objects |
| 3 | A second language behind the same data model |
| 4 | Shareable links and trace export |

Open questions:

- Values show as a capped one-line preview, like a collapsed DevTools value, and the data already carries children for an expandable tree. Should the tree itself be built in milestone 1, or in milestone 2 as proposed?
- Local-only for now, or deploy somewhere later? A deployed version needs a stricter sandbox, such as a cross-origin iframe.
