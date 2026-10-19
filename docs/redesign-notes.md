# Redesign notes (mockup v2)

Source of truth: `docs/mockup/Main.dc.html` (interactive: step, replay, fold, stack pick, theme switch). Content is `fibonacci(4)`, 29 steps, shown at step 7.

## Layout: one screen, no page scroll
- Page is exactly the viewport tall (`100vh`, min 640px). Header (64px) on top, replay controls pinned at the bottom (they sit in the page flow, so nothing is covered). Only the panels' insides scroll.
- Two columns, 5fr / 7fr.
  - Left: Code (auto height), Console (auto height), Call stack (fills the rest, scrolls inside).
  - Right: a strip with Result (188px wide) beside Current value, then Execution trace filling the rest, scrolling inside.
- Current value is compact: expression -> value -> type on one line, narration on one line, variables as chips under it.
- Below 980px wide it becomes one column and the page scrolls; the controls bar sticks to the bottom.

## Execution trace folds by call
- A call is a group: its header row is the `call` step, its body is everything until the matching `return`.
- A group is open when the current step is inside it (the current call and all its callers). Every other call folds to one row:
  - finished: `-> 1 · 3 steps`
  - not reached yet: `3 steps`, dimmed
  - running but folded by hand: `running · 3 steps`
- Chevron toggles a group by hand (manual state wins over the automatic rule). "Fold to current" clears manual state; "Expand all" opens everything.
- Rows: past = normal, current = accent fill with ring and `aria-current="step"`, later = dimmed. Narration is one line with an ellipsis (full text is in Current value). Rows are 30px high, down from 44px, to fit; the chevron and row are separate buttons.
- Indentation is 14px per call level, with a 2px guide on the left of each nested row.
- Stack shown is the stack after the current step, as in the spec. Clicking a frame selects it for the variables chips.

## Theme
- Light and dark are CSS variables on the app root, switched by `data-theme="light|dark"`. A pill switch (sun / moon, `role="switch"`) sits in the header. Light values are the existing tokens; dark values are new.
- Dark tokens: bg #0E1217, card #161B22, fg #E6EAF0, muted #A3ADBB, faint #8893A3, border #2A323D, input #3A4452, primary #4FB8C2 (text on it #04252A), accent #12383D, accent-ink #8ADCE4, highlight #17525A, changed #5A4710, chip #252D38, chip-soft #1C232C, guide #3A4452, syntax keyword #B9A2FF / number #FFA866.
- Initial theme is not wired to `prefers-color-scheme` in the mockup; the app should default to the system setting and remember the choice.

## As built
Where the code differs from, or adds to, the notes above.
- The theme is `data-theme` on `<html>`, not on the app root, so menus and tooltips (which Radix renders outside the root) get the tokens. A small script in `index.html` sets it before the first paint; `use-theme.ts` keeps it, follows the system while nothing is saved, and stores the choice under `tracer-theme`.
- Dark values not in the notes: destructive `#F97066`, its tint `#3B1A18`, string `#7ED89A`. The dark keyword is `#C4B1FF` (the mockup's `#B9A2FF` is 4.0:1 on the highlight, under the 4.5:1 rule). The light string is `#17612F` (was `#1A6B3A`, 4.1:1 on the highlight).
- The fold logic is `src/app/trace-tree.ts`. Calls are found from the stack snapshot on each step, not from the step kind, so a native call (`arr.push(4)`) is a plain row and a call left by an error is a group with no return row. Checked against the mockup's `fibonacci(4)`: 29 steps, 9 calls, same first and last step for each.
- Hand-folded state (`groupChoices`) is in the reducer, so it resets with a new run. Actions: `setGroup`, `foldToCurrent`, `expandAll`. The two buttons show only when the program makes calls.
- A trace row's step button carries `data-step` (1-based) for the tests. Rows inside a folded call do not exist, so a test that jumps to a row inside a call opens it first (Expand all).
- The trace list scrolls itself to the current row. It does not use `scrollIntoView`, which also moved the page on a narrow screen.
- The code editor is capped at `min(560px, 40vh)` so a long program scrolls inside its panel and leaves room for the stack. Console output is capped at 144px and scrolls.
- The Result panel gives the value 48px only up to 5 characters; longer values use 22px and clamp at four lines. Errors use 15px mono.
- The page has no 1232px maximum width: it fills the window, as in the mockup.
