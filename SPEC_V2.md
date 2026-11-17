# Houseline v2 — Spec

v2 extends v1 (see SPEC.md, still the baseline). Same stack: plain HTML/CSS/vanilla ES modules, no build, no deps, no external resources. Node ≥22 for tests (`npm test` = `node --test tests/*.test.mjs`).
The app is hosted in a sandboxed page: no `alert/confirm/prompt`, no `window.print`, no `<a download>` (use the `downloads` capability), no service workers, no remote fetch. `window.claude.use(name)` returns a capability or `null`; always handle `null`.

**Hard rules for everyone**
1. Only edit the files you own. Need a contract change? Say so in your final report; don't edit others' files.
2. Pure modules never read the clock: `today` ("YYYY-MM-DD", local) is always a parameter.
3. Never innerHTML with user text; use `h()` from `src/dom.js` (already written; read it).
4. Existing v1 behavior for interval tasks must keep working. Existing exports keep their names; new parameters are optional. The 57 existing tests may only change where this spec *intentionally* changes behavior (state `version` 1→2, never-done handling); QA owns those edits.
5. Before your final report, VERIFY with `ls`/`node --check`/a real run. Do not claim a file exists or a check passed unless you ran it. Report what you did NOT verify.
6. Final report under 250 words: files, deviations, known issues, unverified items.

## State v2 (`version: 2`)
```
state = {
  version: 2,
  profile:  { setupDone: bool, homeType: "house"|"condo"|"apartment", hasYard: bool, hasPool: bool,
              hasTrailer: bool, hasPets: bool, householdSize: int 1..20 },
  vehicles: [Vehicle], items: [Item], supplies: [Supply],
  tasks: [Task], completions: [Completion],
  emergency: Emergency
}
Vehicle = { id, name, odometer: int>=0, odometerDate: iso, odometerLog: [{date: iso, odometer: int}] /*max 60, ascending*/ }
Item = { id, name, kind: "appliance"|"hvac"|"plumbing"|"electrical"|"paint"|"exterior"|"other",
         location: string, model: string, filterSize: string, purchaseDate: iso|null,
         warrantyExpires: iso|null, notes: string, photoIds: [string] /*max 3*/ }
Task = {
  id, title, category: "car"|"house"|"yard"|"emergency",
  kind: "interval"|"annual"|"mileage",
  intervalDays: int 1..36500 | null,      // interval: required. mileage: optional time cap. annual: null
  month: int 1..12 | null, day: int 1..28 | null,   // annual only (required there)
  intervalMiles: int 1..1000000 | null, lastDoneOdometer: int | null, vehicleId: string | null, // mileage only (intervalMiles+vehicleId required there)
  lastDone: iso|null, startDate: iso|null,  // startDate = first due date when lastDone is null
  snoozedUntil: iso|null, itemId: string|null, assignee: string|null /*opaque user id*/,
  links: [{label: string, url: string /*http(s) only*/}] /*max 5*/, tags: [string],
  notes: string, custom: bool
}
Completion = { id, taskId: string|null, title, category, date: iso, kind: "done"|"skipped",
               cost: number|null (>=0), notes: string, odometer: int|null, by: string|null, photoIds: [string] /*max 3*/ }
   // title+category are SNAPSHOTS so history survives task deletion (taskId may dangle)
Supply = { id, name, key: string|null /*matches a readiness REQUIREMENT key*/, category: "water"|"food"|"medical"|"power"|"tools"|"docs"|"other",
           quantity: number>=0, unit: string, expires: iso|null, notes }
Emergency = { contacts: [{name, phone, relation}] /*max 12*/, meetingPlace: string, outOfAreaContact: string,
              shutoffs: { water: string, gas: string, electric: string }, notes: string }
   // UI must warn: do NOT store SSNs, account or policy numbers.
```
IDs: seed ids are `seed-N`; app-created ids are `t-<time36><rand>` style (never `seed-`). Photo ids `p-…`.

## src/templates.js  (owner: CORE-A)
Keep `CATEGORIES`, `TEMPLATES`, `seedTasks` (v1 behavior; may now include new fields).
New:
- Each template: `{title, category, kind, intervalDays?, month?, day?, intervalMiles?, notes, tags:[string], requires?: {homeType?: [..], hasYard?, hasPool?, hasTrailer?, hasPets?, vehicle?: true}}`.
- Needs at least 55 templates: keep the v1 ones; add **annual/seasonal** (e.g. winterize sprinklers Oct 15, smoke-detector batteries Nov 1 and Mar 10, furnace service Sep 15, AC service Apr 15, gutters Nov 1 and Apr 15, hose bibs Oct 20, water-heater flush, dryer vent, chimney if house…), **mileage** vehicle tasks (`requires.vehicle:true`: oil 5000mi+180d cap, tire rotation 7500mi, brake inspection 12000mi, engine air filter 15000mi, cabin filter 15000mi, coolant 30000mi, transmission fluid 60000mi, plus annual battery test, registration/inspection), **trailer** (requires hasTrailer), **pool**, **pets**, condo/apartment variants (no gutters/yard).
- `export function templatesFor(profile)` → templates whose `requires` all hold. Condo/apartment exclude yard/gutter/roof tasks. `hasYard:false` excludes yard category.
- `export function seedFromProfile(profile, { vehicles = [], idFn, today })` → `Task[]`. Vehicle templates are instantiated once PER vehicle with title `"<title> — <vehicle.name>"`, `vehicleId` set, `lastDoneOdometer: null`. For templates with `lastDone` null, set `startDate` **staggered** deterministically so first due dates spread across the next 30 days (e.g. index-based, never before `today`); annual tasks keep their month/day (no startDate). Seed ids via `idFn`. No duplicate titles within a vehicle.
- Provide `SUPPLY_STARTERS`: array of `{name,key,category,unit,notes}` the Emergency view can offer.

## src/logic.js  (owner: CORE-A)
Keep every v1 export. Extend (all pure, return NEW state, throw `Error` with clear messages on invalid input; `ctx` = the full state when a function needs vehicles):
- `statusOf(task, today, state?)` → `"overdue"|"due-soon"|"ok"|"snoozed"`. `snoozedUntil > today` → `"snoozed"` (unless overdue by more than 30 days past snooze? NO — keep simple: snoozed wins while snoozedUntil > today). Interval threshold as v1. Annual threshold 30 days. Mileage: due-soon when ≤ 14 days OR ≤ 10% of intervalMiles (min 200) left.
- `dueInfo(task, state, today)` → `{ dueDate: iso|null, daysUntil: int|null, milesLeft: int|null, basis: "date"|"miles"|"start"|"never" }`.
  - interval: lastDone? lastDone+intervalDays : (startDate ?? today).
  - annual: occurrence O_y = (y, month, day). If lastDone is null: first O on/after today. Else: first O (scanning from lastDone's year) with `O − 60 days > lastDone` (done up to 60 days early counts for that occurrence).
  - mileage: miles left = (lastDoneOdometer ?? vehicle.odometer at last known) + intervalMiles − vehicle.odometer; if lastDoneOdometer null, treat as due by `startDate ?? today` basis "start". Estimated date = today + ceil(milesLeft/rate); rate = miles/day from odometerLog (last ≤ 365 days, min 2 points spanning ≥ 14 days) else default 33. dueDate = earliest of estimate and (lastDone+intervalDays if cap set). milesLeft ≤ 0 → due today/overdue.
- `daysUntilDue(task, today, state?)` uses `dueInfo` (null→ throw not allowed: return 0 for "never").
- `markDone(state, taskId, today, opts = {cost, notes, odometer, by, photoIds})` → appends a Completion (`kind:"done"`), sets `lastDone=today`, clears snooze; mileage: `lastDoneOdometer = opts.odometer ?? vehicle.odometer`, and if `opts.odometer` > vehicle odometer, call setOdometer logic. Validates cost>=0, ≤3 photoIds.
- `skipTask(state, taskId, today, by?)` → like markDone but `kind:"skipped"`, cost null (counts as "advanced the schedule", never counts toward spend).
- `snoozeTask(state, taskId, untilISO, today)` (until must be > today, ≤ today+365) / `unsnoozeTask(state, taskId)`.
- `deleteTask` now KEEPS completions (history preserved).
- `assignTask(state, taskId, userIdOrNull)`.
- Vehicles: `addVehicle(state,{name,odometer},idFn,today)`, `updateVehicle(state,id,patch)`, `deleteVehicle(state,id)` (also deletes that vehicle's tasks, keeps their completions), `setOdometer(state, vehicleId, miles, today)` (must be ≥ current, else throw; appends log, max 60, same-day overwrite).
- Items: `addItem/updateItem/deleteItem(state,…)` (deleteItem nulls `task.itemId`).
- Supplies: `addSupply/updateSupply/deleteSupply`.
- `updateProfile(state, patch)`, `updateEmergency(state, patch)` (validate max contacts/lengths: strings ≤ 500 chars).
- `historyFor(state, { taskId?, category?, year?, kind? })` → Completion[] newest first.
- `spend(state, year?)` → `{ total, byCategory: {car,house,yard,emergency}, byMonth: [12 numbers] }` counting only `kind:"done"` with cost.
- `searchTasks(state, query, today)` → Task[] matching (case-insensitive, all whitespace-separated terms must match) title, notes, tags, link labels, linked item name/model, vehicle name; sorted via `sortTasks`. Empty query → all.
- `warrantyAlerts(state, today, withinDays = 60)` → `[{ item, daysLeft }]` for items whose warranty is within window or expired within the last 30 days; ascending.
- `sortTasks(tasks, today, state?)`: snoozed last; overdue first; then by daysUntil; tie by title.
- `summary(state, today)` → v1 shape plus `snoozed` count; snoozed tasks are NOT counted in overdue/dueSoon/ok.
- Validation limits: title ≤ 120 chars, notes ≤ 2000, link url must be http(s).

## src/storage.js  (owner: CORE-A)
- `validateState(s)` validates v2 fully (every field above, ids unique per collection, vehicle/item references exist or are null, kind-specific requirements). `export const STATE_VERSION = 2`.
- `migrate(raw)` → v2 state. v1 → v2: add defaults (`kind:"interval"`, nulls, `links:[]`, `tags:[]`), completions get ids + title/category snapshots from tasks (unknown task → title "Task"), `profile.setupDone:true`. v2 passes through. Anything else throws.
- `freshState()` (exported): v2 with `profile.setupDone:false`, defaults (`householdSize:2, homeType:"house", hasYard:true`), NO tasks/vehicles (the wizard seeds them).
- `loadState(storage)` / `saveState` / `exportJSON` / `importJSON` as v1 but migrating on load/import (load keeps the corrupt-backup behavior and `BACKUP_KEY`). Photos are NOT part of exportJSON.
- `MAX_STATE_BYTES = 900_000`; `saveState` throws a clear error above it.

## src/ics.js  (owner: CORE-B)
- `buildICS(state, today, { horizonDays = 400, calName = "Houseline" } = {})` → string, RFC 5545: CRLF line endings, lines folded at 75 octets (UTF-8 aware), TEXT escaping (`\\ ; , \n`), stable `UID: <id>@man-of-the-house`, `DTSTAMP`, all-day `DTSTART;VALUE=DATE`, `VALARM` display alarm `TRIGGER:-P1D` (supply/warranty events `-P7D`).
- One VEVENT per task starting at its next due date (`dueInfo`; if snoozed, at max(due, snoozedUntil)): interval → `RRULE:FREQ=DAILY;INTERVAL=n`; annual → `RRULE:FREQ=YEARLY`; mileage → a single non-repeating event titled with "(estimated)". Plus one event per supply with `expires` and per item with `warrantyExpires` in range ("Warranty ends: …"). Skip tasks whose first date is beyond the horizon. Description includes category, notes, links.
- `icsFilename(today)` → `houseline-YYYY-MM-DD.ics`.
This is a one-time file import, NOT a live subscription; the Calendar view must say so.

## src/readiness.js  (owner: CORE-B)
- `REQUIREMENTS`: array of `{ key, label, category, unit, perPersonPerDay?: number, days?: number, fixed?: number }` — e.g. water (1 gal/person/day × 3 days), food (meals), flashlights (fixed), batteries, first-aid kit, radio, phone chargers/power bank, medications (7-day), cash, copies of documents, whistle, N95 masks, blankets, pet supplies if `profile.hasPets`.
- `readiness(state, today)` → `{ score: 0..100, items: [{ key, label, unit, needed, have, status: "ok"|"low"|"missing", expiringSoon: bool }], expiring: [{supply, daysLeft}], expired: [supply] }`. `have` = sum of non-expired supply quantities with that `key`; low = 1..99% of needed. Score = mean of per-item min(1, have/needed) × 100, rounded. Supplies expiring within 60 days → `expiring`.
- `emergencySheetHTML(state, today)` → a complete standalone HTML document string, print-friendly CSS inline, no scripts, EVERYTHING escaped: household size, contacts, meeting place, out-of-area contact, shutoff locations, readiness summary, notes, date. A "Print this page" line explaining Ctrl/Cmd+P (no button; scripts are not allowed).
- `emergencySheetText(state, today)` → same content as plain text (for Copy).

## src/photos.js  (owner: CORE-B)
- `export const PHOTO_MAX_DIM = 800, PHOTO_QUALITY = 0.72, PHOTO_MAX_BYTES = 150_000`.
- `async downscaleImage(file, { doc = document } = {})` → data URL (`image/jpeg`) fitting PHOTO_MAX_DIM via canvas; rejects non-images; throws if still > PHOTO_MAX_BYTES after one retry at lower quality.
- `newPhotoId()` → `p-…`.
- `fitSize(w, h, max)` → `{w,h}` pure, exported for tests.

## src/sync.js  (owner: CORE-B)
`createStore({ localStorage, claude, now })` → `Promise<Store>`; `Store`:
- `mode`: `"cloud"` (db capability present) or `"local"`.
- `async load()` → state (migrated, validated). Cloud: read doc `household/main` (`{state, updatedAt, updatedBy}`); if absent, adopt local data (migrate) and write it. Local: loadState. 10 s timeout on cloud load then fall back to local with `mode:"local"` + `warning`.
- `save(state)` → debounced (≈600 ms), only writes when the serialized state changed, one write at a time; always also writes localStorage as a cache. Returns a Promise resolving when flushed; `flush()` available. Never throws into the UI: reports via `onStatus(cb)` callbacks `{ kind: "saved"|"saving"|"error"|"offline", message }`.
- `subscribe(cb)` → unsubscribe fn. Cloud: `onSnapshot` on `household/main`, ignoring echoes of our own writes (compare `updatedBy`+`updatedAt`/hash); calls `cb(newState)` for remote changes. Local: no-op.
- `async putPhoto(id, dataUrl)`, `async getPhoto(id)` → dataURL|null, `async deletePhoto(id)`: cloud → doc `photos/<id>`; local → localStorage key `motH.photo.<id>` (catch quota errors, throw a clear message).
- `async whoAmI()` → `{ id: string|null, isOwner: bool }` using the `user` capability (`null` → id null).
- `async names(ids)` → `{ [id]: string }` via `user.profiles` (fallback `"Someone"`).
- `async saveFile(filename, text, mime)` → uses `downloads.save({filename, data})`; returns `true`, or `false` if unavailable/declined; throws nothing.
Everything here must be written to degrade gracefully and be unit-testable by passing a fake `claude` object (`{ use: async (name) => … }`) and fake `localStorage`.

## UI (owners: UI-A shell, UI-B views)
Context object `ctx` that UI-A passes to every view and to the wizard:
```
ctx = { doc, h /*bound: (tag, attrs, ...kids) => Element*/, getState(), commit(nextState, message?, { undoable = true } = {}),
        today() /*local YYYY-MM-DD*/, store, me /*{id,isOwner}*/, names /*{id:name} cache*/,
        openTaskForm(taskOrNull), toast(message), photos: { add(file) -> id, url(id) -> Promise<dataURL|null>, remove(id) },
        saveFile(filename, text, mime) -> Promise<bool> }
```
`commit` runs validation via `saveState`-compatible checks and re-renders.

### UI-A owns: `index.html`, `styles.css`, `src/ui.js`, `src/main.js`, `src/wizard.js`
- Navigation (accessible tablist or nav): **Tasks | History | Inventory | Vehicles | Emergency | Calendar**. Keyboard accessible, `aria-current`, focus kept sensible. Views are imported statically: `./views/history.js`, `inventory.js`, `vehicles.js`, `emergency.js`, `calendar.js`, each exporting `{ id, label, render(container, ctx) }`; `render` is called on every state change and must be idempotent. The shell must tolerate a view throwing (show an inline error in that view only).
- **First-run wizard** (`state.profile.setupDone === false`): steps — home type + yard/pool/trailer/pets + household size; add vehicles (name + current odometer, ≥0 vehicles); review count of tasks that will be created; Finish → `seedFromProfile`, set `setupDone:true`, seed `supplies` not required. "Skip setup" allowed (loads a generic set via `seedFromProfile` with defaults). Settings entry (in header) "Re-run setup" that ADDS missing tasks but never duplicates/deletes (match on title+vehicleId).
- **Tasks view**: v1 features + search box (`searchTasks`), status filter chips (All / Overdue / Due soon / Snoozed), assignee filter if `store.mode==="cloud"`, per-row: Done (opens a small "Complete task" dialog: cost, notes, odometer for mileage tasks, photo attach up to 3, defaults to quick-complete via Enter), **Skip**, **Snooze** (presets 1 wk/2 wk/1 mo + date), Edit, Delete (confirm in-page, no `confirm()`), assignee chip; shows due text for all kinds (miles for mileage tasks: "~1,200 mi left (≈ 5 weeks)"); notes + links (http/https only, `rel="noopener noreferrer"`, `target="_blank"`).
- **Task form** supports all three kinds (interval / yearly on a date / by mileage + vehicle), item link, links list, tags, assignee, notes.
- **Banner**: top-of-page "Today" strip summarizing overdue + due-today counts, warranty alerts (`warrantyAlerts`), expiring/expired supplies, and a sync-status pill (Saved / Saving… / Offline / Local only).
- Cloud mode: if `store.subscribe` delivers a remote state, replace state and re-render without losing the open dialog; show a toast "Updated from another device".
- `main.js`: `createStore`, `load`, first render, `window.claude`-absent safe. Photos via `src/photos.js` + `store.putPhoto/getPhoto`.
- Keep a11y: labels, focus management (restore focus after re-render as in v1), live-region announcements, contrast, dark mode, `prefers-reduced-motion`.
- Link `styles-views.css` from index.html.

### UI-B owns: `src/views/*.js` (history, inventory, vehicles, emergency, calendar), `styles-views.css` (selectors prefixed `.v-`)
- **History**: filter by category/year/kind, chronological list with cost, notes, photo thumbnails (tap to enlarge in an in-page dialog), who completed (names), spend panel using `spend()` (by category with simple CSS bars and by month), "skipped" shown distinctly, empty state.
- **Inventory**: items CRUD (name, kind, location, model, filter size, purchase date, warranty date with expiring badge, notes, up to 3 photos), list grouped by kind, shows tasks linked to each item, "Add maintenance task for this item" via `ctx.openTaskForm({itemId})`.
- **Vehicles**: vehicles CRUD, odometer update (validates ≥ current; shows miles/day estimate), per-vehicle task list with miles-left, service history link, "Add vehicle tasks" button that instantiates missing vehicle templates for that vehicle via `seedFromProfile`-style helper (call `templatesFor` + create tasks; never duplicates).
- **Emergency**: (1) readiness score + requirement checklist from `readiness()` with quick "+ add supply" prefilled from `SUPPLY_STARTERS`; (2) supplies list CRUD with expiry badges; (3) emergency info form (contacts, meeting place, out-of-area contact, shutoffs, notes) with the "no SSNs / account numbers" warning; (4) "Emergency sheet": preview text, **Copy** button (clipboard, in a click handler, catch refusal) and **Download .html** via `ctx.saveFile`, explaining to open it and press Ctrl/Cmd+P (no print button).
- **Calendar**: explains plainly that this exports a one-time `.ics` file to import into Google/Apple/Outlook calendar (NOT a live feed; re-export after big changes); options: horizon, include supplies/warranties; Download via `ctx.saveFile`; fallback "Copy .ics text" if downloads unavailable. A clear note that reminders come from the calendar app's alerts, since this page can't send email/push.
- Use `ctx.h`, `ctx.commit`, no direct DOM globals other than `ctx.doc`. All forms inline in the view (no `alert/confirm/prompt`), validation errors shown in-page.

## tests/ (owner: QA)
Write from THIS spec, not the implementation. Node test runner. Files: update existing (`logic`, `storage`, `templates`, `regression`) for intentional changes; add `logic2.test.mjs` (kinds, dueInfo incl. leap years & annual window, miles estimate, snooze/skip/history/spend/search/warranty/vehicle/item/supply CRUD, immutability, validation errors), `migrate.test.mjs` (v1→v2 incl. real v1 fixtures; corrupt; newer version), `ics.test.mjs` (folding, escaping, CRLF, RRULEs, UIDs stable, horizon), `readiness.test.mjs` (scoring, expiry, escaping in sheet HTML with `<script>` payloads), `photos.test.mjs` (`fitSize`), `sync.test.mjs` (fake claude/localStorage: cloud vs local, adopt-local-on-empty, debounce/no-write-when-unchanged, remote echo ignored, timeout fallback, saveFile fallback), `templates2.test.mjs` (`templatesFor`, `seedFromProfile`: stagger, per-vehicle instantiation, no duplicate titles, condo excludes yard/gutters). Also a **UI smoke test** `ui.smoke.test.mjs` with a minimal stub DOM (QA writes it; keep it small) that mounts the app from fresh state (wizard shown) and from a seeded state (all six tabs render without throwing). Report implementation bugs (file/function/repro) without editing `src/`.
