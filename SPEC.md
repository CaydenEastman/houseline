# Houseline — Prototype Spec

A homeowner maintenance reminder app. Plain HTML/CSS/vanilla JS (ES modules), no build step, no dependencies. Data lives in localStorage. Must run by opening `index.html` (or via a static server).

## Categories
`car`, `house`, `yard`, `emergency`

## Data model (JSON, in localStorage key `motH.v1`)
```
state = {
  version: 1,
  tasks: [Task],
  completions: [{ taskId, date: "YYYY-MM-DD" }]
}
Task = {
  id: string,            // unique
  title: string,
  category: "car"|"house"|"yard"|"emergency",
  intervalDays: number,  // repeat interval, > 0
  lastDone: "YYYY-MM-DD" | null,
  notes: string,
  custom: boolean        // true if user-created
}
```

## Module APIs (src/ files, ES modules, no DOM access except ui.js)

### src/templates.js  (Agent: core)
- `export const CATEGORIES = ["car","house","yard","emergency"]`
- `export const TEMPLATES` — array of Task-like objects WITHOUT id/lastDone: `{title, category, intervalDays, notes}`. At least 8 per category, realistic (oil change ~90/180 days, HVAC filter 90, smoke detector test 30, gutters 180, rotate tires 180, lawn mowing 7, winterize sprinklers 365, rotate emergency water 365, check food storage 180, etc.).
- `export function seedTasks(idFn)` — returns Task[] from all templates, `lastDone: null`.

### src/logic.js  (Agent: core)
Pure functions, take `today` as "YYYY-MM-DD" string param (never read the clock inside).
- `daysBetween(aISO, bISO)` → integer days b - a
- `addDays(iso, n)` → iso
- `nextDue(task, today)` → iso. If `lastDone` null → `today` (due now).
- `daysUntilDue(task, today)` → integer (negative = overdue)
- `statusOf(task, today)` → `"overdue" | "due-soon" | "ok"` (due-soon = within 7 days, or within 10% of interval if larger, max 14)
- `markDone(state, taskId, today)` → NEW state (immutable), sets lastDone, appends completion
- `addTask(state, partial, idFn)` / `updateTask(state, id, patch)` / `deleteTask(state, id)` → NEW state; validate inputs, throw `Error` with clear message on invalid category/interval/title
- `sortTasks(tasks, today)` → overdue first, then by daysUntilDue ascending
- `summary(state, today)` → `{ overdue, dueSoon, ok, byCategory: {car:{overdue,dueSoon,ok},...} }`

### src/storage.js  (Agent: core)
- `loadState(storage)` / `saveState(storage, state)` — `storage` is a localStorage-like object (getItem/setItem) so it's testable. Corrupt/missing JSON → return fresh seeded state. Validates shape.
- `exportJSON(state)` / `importJSON(text)` (throws on invalid)

### src/ui.js + index.html + styles.css  (Agent: ui)
- Imports only from the modules above, uses ONLY the API listed here.
- Features: dashboard summary cards (overdue / due soon / ok), category tabs + "All", task list sorted by `sortTasks`, each row shows title, category badge, status color, "due in N days / N days overdue", [Done] button, edit, delete; Add Task form (title, category, interval days, notes); export/import JSON buttons; empty state; mobile-first responsive layout; keyboard accessible, proper labels, sufficient contrast, dark mode via `prefers-color-scheme`.
- `today` computed once per render from the local date (not UTC).
- Clean, friendly, practical visual design. Header: "Houseline". No external fonts/CDNs.
- Escape all user text when rendering (no innerHTML with user data).

### tests/  (Agent: qa)
- Node built-in test runner (`node --test`), files `tests/*.test.mjs` importing from `../src/*.js` (package.json sets `"type":"module"`).
- Cover logic.js, storage.js, templates.js thoroughly: date math across month/year/leap boundaries, status thresholds, immutability, validation errors, corrupt storage, import/export round trip, template integrity (valid categories, positive intervals, >=8 per category, no duplicate titles).
- QA writes tests from this SPEC, not from the implementation. Report any spec ambiguity or implementation bug found.

## Layout
```
man-of-the-house/
  SPEC.md
  package.json        (lead creates)
  index.html
  styles.css
  src/templates.js logic.js storage.js ui.js main.js
  tests/*.test.mjs
```
`main.js` (ui agent): wires localStorage + ui.js, `import` from `./storage.js` etc.

## Rules
- Only edit your own files. If you need a spec change, say so in your final report instead of editing others' files.
- Final report: files created, anything deviating from spec, known issues. Keep it under 200 words.
