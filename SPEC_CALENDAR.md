# Calendar view — Spec (addendum to SPEC_V2.md)

Goal: the **Calendar** tab opens on a month grid showing which days items fall on. The existing export panel (CSV / .ics) moves BELOW the grid under its own heading "Export to your calendar". Same rules as SPEC_V2.md (pure modules take `today`, never read the clock; no innerHTML; no alert/confirm/prompt; verify before reporting; only edit files you own).

## src/calendar.js — NEW, pure (owner: CORE-A)
```
export function eventsInRange(state, fromISO, toISO, today) -> Event[]   // inclusive range; sorted by date, then TYPE_ORDER, then title
export function eventsByDate(events) -> { [iso]: Event[] }               // preserves order
export function monthGrid(year, month /*1-12*/, weekStartsOn = 0 /*0=Sun, 1=Mon*/) -> { year, month, weeks: Array<Array<{ date: iso, inMonth: boolean }>> }
        // whole weeks (4..6 rows of 7) covering the month; leading/trailing days belong to adjacent months with inMonth:false
export function gridRange(year, month, weekStartsOn = 0) -> { from: iso, to: iso }   // first and last date shown in the grid
export function shiftMonth(year, month, delta) -> { year, month }                       // handles year wrap
export function monthLabelParts(year, month) -> { year, month }                         // (identity helper; keep simple)
export const TYPE_ORDER = ["task", "supply", "warranty", "done", "skipped"]
export const MAX_EVENTS = 2000

Event = {
  date: iso,
  type: "task" | "supply" | "warranty" | "done" | "skipped",
  id: string,                  // task id / supply id / item id / completion id
  taskId: string | null,       // for task, done, skipped (completion.taskId; may dangle)
  title: string,               // task title, supply name, "Warranty ends: <item name>", completion title snapshot
  category: "car"|"house"|"yard"|"emergency"|null,   // supply → "emergency"; warranty → null
  status: "overdue"|"due-soon"|"ok"|"snoozed"|"done"|"skipped"|"expired"|null,
  estimated: boolean,          // mileage-based task dates
  projected: boolean,          // a repeat beyond the first due date (assumes the task is done on time)
  carried: boolean,            // overdue task shown on `today` because its real due date is before the range
  detail: string               // short human text, e.g. "12 days overdue", "~1,200 mi left", "expires", "cost $45.00"; plain text, no HTML
}
```
Rules:
- Tasks: first due date from `dueInfo(task, state, today)` (use CORE-A's own logic.js). Status for the FIRST occurrence = `statusOf`. Snoozed tasks appear on `max(due, snoozedUntil)` with status `"snoozed"`.
- Overdue tasks: appear on their real due date if inside the range. If the due date is BEFORE `fromISO` and `today` is inside the range, also show once on `today` with `carried: true`, `status: "overdue"`, detail "overdue since <MMM D>" style plain text.
- Repeats: interval tasks project `due + k*intervalDays` for k ≥ 1 inside the range; annual tasks project each later year's (month, day); `projected: true`, `status: "ok"`. Mileage tasks: ONE event, `estimated: true`, no projection. Tasks with no computable date are skipped silently.
- Supplies with `expires` inside the range → `type:"supply"`, status `"expired"` if before today, `"due-soon"` if within 60 days of today, else `"ok"`. Warranties likewise from `item.warrantyExpires` (status `"expired"` / `"due-soon"` / `"ok"`).
- Completions with `date` inside the range → `type:"done"` or `"skipped"` (status `"done"`/`"skipped"`), cost formatted in `detail` when present.
- Hard cap `MAX_EVENTS`; when hit, stop projecting repeats first (never drop first occurrences or history).
- Dates are all local calendar dates as ISO strings; use UTC-safe math (no DST drift). Validate inputs (`fromISO <= toISO`, range ≤ 800 days, valid `weekStartsOn`/`month`) and throw clear `Error`s.

## src/views/calendar.js (owner: UI-B)
Replace the current export-only view with: **month grid on top**, export panel below. Still exports `{ id: "calendar", label: "Calendar", render(container, ctx) }`, idempotent re-render on every state change; keep month/selected-day/filters in module state keyed per container so re-renders don't reset them.
- Header: `‹ Prev` `Today` `Next ›` buttons and a month title (`toLocaleDateString` with month+year); week starts on Sunday.
- Grid: 7 columns, weekday header row, day cells as buttons (`aria-label` like "Wednesday, November 18, 3 items"), today highlighted, out-of-month days dimmed, overdue days marked; each day shows up to 3 small colored chips/dots (color by category or type, plus a SHAPE/text cue so color is not the only signal; overdue visibly distinct) and "+N" for the rest; on narrow screens show dots/count only. Selected day: highlighted, `aria-pressed`/`aria-current` appropriately.
- Keyboard: Arrow keys move between days (roving tabindex), Enter/Space selects, PageUp/PageDown change month, Home/End jump to week start/end; focus is kept after re-render.
- Day detail panel (below the grid, live region announces selection): list for the selected day with icon+title, category badge, status text, `detail`, a "projected"/"estimated" tag when applicable; for task rows buttons **Done** (calls `ctx.completeTask(taskId)` if it exists), **Edit** (`ctx.openTaskForm(task)`); for supply/warranty rows a plain note (no navigation needed). Empty day → friendly empty state.
- Filters: chips to toggle Tasks / Supplies & warranties / Done history, and a category select; filtered events only affect what is drawn.
- Month summary line: "N due this month · M overdue · K done".
- Data: `eventsInRange(state, from, to, today)` with `gridRange`, grouped by `eventsByDate`.
- Export panel: keep ALL existing behavior and copy (CSV + .ics, honesty notes) under the heading "Export to your calendar".
- Styles: `styles-views.css`, selectors prefixed `.v-`, reuse CSS variables; mobile-first, dark mode, reduced motion respected, visible focus.

## src/ui.js (owner: UI-A)
Add `ctx.completeTask(taskId)`: opens the existing "Complete task" dialog for that task (same as the Done button on the Tasks tab), and nothing else. Nothing else changes.

## tests/ (owner: QA)
`calendar.test.mjs` for src/calendar.js from THIS spec (interval/annual/mileage projection, leap day, month grid edge cases incl. February and 6-row months, week start 0/1, overdue carried logic, snoozed, supplies/warranties/completions, MAX_EVENTS, immutability, validation errors) and a stub-DOM smoke test for the view (renders a month from empty and populated state, month navigation, day selection, keyboard moves, filter toggles, export panel still present, user text like `<script>` rendered as text).
