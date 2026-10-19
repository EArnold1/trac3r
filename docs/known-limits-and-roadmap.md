# exec-trac3r: Known Limits, Issues and Roadmap

Updated Oct 19, 2026. This is the living list of what the tracer does not do, what is broken or
unverified, and what comes next. Keep it short and current: when something is fixed, move it to
**Done** with the commit; when a new limit is found, add it here the same day.

Status words: **Open** (not fixed), **Decision needed** (waiting on Arnold), **Planned**, **Idea**
(not a commitment), **Done**.

## Known limits

Things that are true by design or by scope in milestone 1. None of them is a bug.

### Not traced (still runs, lines marked "not traced")

| Area | Detail |
| --- | --- |
| `async` / `await`, generators | The code runs and gives its result. No steps are recorded inside it. |
| Class bodies, getters and setters | Same. A class declaration produces no steps at all. |
| Code the tracer cannot instrument | If instrumenting ever fails, the original code runs untraced and every line is marked. |
| Code run by the program itself | Strings passed to `eval` or `new Function` run but are not traced. |
| Parameter default expressions | Calls and assignments inside a parameter list get no steps, because the frame has not been entered yet. |

### Steps the tracer does not record

| Area | Detail |
| --- | --- |
| `for…of` and `for…in` | They run and their bodies are traced, but there is no per-iteration condition step. Only `for`, `while` and `do/while` have one. |
| `switch` | No step for the discriminant or the case taken. |
| `for (let i = 0; …)` initializer | No `declare` step for the loop variable. It appears in the variables at the first condition step. |
| Loop iteration numbers | The narration says "run the loop body" without counting iterations. |
| Native calls inside an expression | `Math.max(a, b)` inside `x = …` has no step of its own. Only a native call that is a whole statement (`arr.push(4)`) does. |
| Repeated callbacks from native code | `arr.map(cb)`: the first call of `cb` says which line made it, later calls show no "called from" line. |

### Bounds and safety

| Limit | Value |
| --- | --- |
| Steps recorded | 2,000. More steps still run; the first 2,000 are kept and `truncated` is set. |
| Run time | 3 s, then the sandbox is removed and the run is reported as a timeout. |
| Console | 1,000 lines of 10,000 characters. |
| Value previews | 2,000 characters, 20 children per level, 3 levels deep. |
| Memory | A browser cannot cap a Worker's memory. A snippet that allocates huge arrays can still slow or crash the tab. The timeout is the main protection. |
| Where it is safe | Running your own pasted snippets in your own browser. **Never run pasted code on a server.** |
| Public deployment | Needs the sandbox iframe served from a separate origin. Not done; see the open questions. |

### What the trace shows

| Area | Detail |
| --- | --- |
| Variables | Only the frame's own variables. Variables of an enclosing function (closures) are not listed. |
| Block scopes | A variable from a block that has ended can stay listed until the next step in that frame. |
| Values | A one-line preview, like a collapsed DevTools value. The data carries children for a tree, but the UI does not show one yet. |
| Results in narration | A nested call's result is only written into the explanation when it is 30 characters or fewer. |
| Error step after the cap | If the 2,000-step cap was reached before the error, there is no error step. The error and its line are still in the result. |
| Caught errors | A native error (`null.x`) caught by `catch (e)` gets an error step. One caught by `catch {}` or by a destructured parameter gets none, and call-site bookkeeping is not reset there. |
| Language | JavaScript only. |
| Folded calls | A call that an error leaves has no `return` row. It is shown as "did not return" once the trace is past it. |

### Effects of tracing on the program

| Effect | Detail |
| --- | --- |
| Recursion depth | Traced functions use more stack per call, so a very deep recursion overflows sooner than it would untraced. |
| `fn.toString()` | Shows the instrumented source, not the original. |
| Stack traces | `error.stack` lines refer to the instrumented code. Line numbers are unchanged, columns are not. |
| `return` inside a user `finally` | Steps after the `return` and before the function really exits are attributed to the caller's frame. |
| Stack overflow line | The line reported for an overflow is "somewhere in the recursing function": line 1 or 2 in the tests, depending on where the stack ran out. |
| Slowest case | Infinite recursion takes about 0.7 to 1.3 s in the browsers measured (3 s limit). |

## Open issues

| ID | Status | Issue | Notes |
| --- | --- | --- | --- |
| I-1 | Decision needed | The editor has no undo/redo, Tab indent or other default keymap. | The doc asks for CodeMirror's default keymap, which lives in `@codemirror/commands`, a package not in the technical doc's list. Needs approval to add. Not yet tested by hand in each browser. |
| I-2 | Open | Pressing Space right after clicking Run presses Run again instead of starting playback. | The Run button keeps focus and Space activates a focused button. Fix: move focus to the trace or controls when a run finishes. |
| I-3 | Decision needed | `CLAUDE.md` says "never run `git commit`", but Arnold asked for commits in the last session. | Either update the Commits section or keep drafting messages only. |
| I-4 | Open | The main JS bundle is about 935 kB (302 kB gzipped); Vite warns above 500 kB. | Mostly react-dom and CodeMirror. Code-splitting the editor would help. Not urgent. |
| I-5 | Open | Not checked by hand: a screen reader pass, real Safari and Firefox on a device, and keyboard-only use of every control. | axe finds no serious violations on the results screen; that is not a full audit. |
| I-6 | Open | In narration, code is shown in the code font with no background, so `` `n <= 1` is `3 <= 1` `` can read as one run of text. | Match the mockup or add a light tint. Visual only. |
| I-8 | Open | On a phone the sticky controls bar wraps to three rows and covers about a quarter of the screen. | Make it one row there, for example by dropping the Speed label and the hint. |
| I-7 | Open | The stack panel's "just returned" row only appears on a `return` step. An implicit return (no `return` statement) also pops a frame but is shown the same way. | Check that the row reads well for `undefined`. |

## Upcoming

### Milestone 2 (from the spec, not a commitment)

| ID | Status | Feature |
| --- | --- | --- |
| M2-1 | Planned | Call-tree view of recursion: one node per call with its returned value. The data already carries a unique frame `id` per call. |
| M2-2 | Planned | Tracing of async code and generators. |
| M2-3 | Planned | Closures: show variables of enclosing functions. |
| M2-4 | Planned | Expandable objects and arrays (the value tree). The data already has `children` and `omitted`. |

### Smaller improvements that would fit before milestone 2

| ID | Status | Feature |
| --- | --- | --- |
| S-1 | Idea | Steps for `for…of`, `for…in` and `switch`, and a `declare` step for loop initializers. |
| S-2 | Idea | Iteration numbers in loop narration ("iteration 3 of the loop"). |
| S-3 | Idea | Show closure variables as a separate group under the frame's own. |
| S-4 | Idea | Virtualize the trace list if 2,000 rows scroll badly. Needs approval to add a library. |
| S-5 | Idea | A line-level "not traced" explanation visible without hovering (today it is a tooltip). |

### Later milestones

| Milestone | Status | Adds |
| --- | --- | --- |
| 3 | Idea | A second language behind the same data model. |
| 4 | Idea | Shareable links and trace export. |
| Later | Idea | Accept pasted TypeScript by stripping types before running. |

## Open questions from the docs

Not answered yet. Milestone 1 went with the spec's proposals.

1. Build the expandable value tree in milestone 1 or 2? (Went with 2.)
2. Local only, or deploy later? A deployed version needs a cross-origin sandbox iframe, and the app's own CSP must be checked against the `srcdoc` iframe, which inherits it.
3. Accept pasted TypeScript in a later milestone?
4. Show the error colors in the mockup before building? (They are built: `#B42318` on white or on `#FEE4E2`.)

## Done

| When | What |
| --- | --- |
| Oct 19, 2026 | Redesign (mockup v2): one screen with no page scroll, trace folded by call, compact panels, light and dark theme. |
| Oct 17–18, 2026 | Milestone 1: sandbox, parser, instrumenter, recorder, narration, UI, tests. All spec acceptance tests pass in Chromium, Firefox and WebKit. |
