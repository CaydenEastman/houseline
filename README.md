# Houseline

A home maintenance reminder app for car, house, yard, and emergency prep. Plain HTML, CSS, and JavaScript modules. No build step and no dependencies. It installs on a phone like a normal app (PWA) and works offline.

## What it does

**Everyday use (phone-first, five bottom buttons)**

- **Today:** a feed of what needs doing, with a home-readiness score ring that opens to the best next steps. Filter chips by area (car, house, yard, emergency), a big **Done** button on each card, and a **Select** mode to mark several done at once.
- **Calendar:** month view with due dates, overdue tasks projected forward, and a "move to a later day" option.
- **+ Add:** type a task in plain words ("change furnace filter every 3 months", "oil change every 5,000 miles", "winterize sprinklers in fall"), or open the full form, log mileage, add an emergency supply, or add a home item.
- **Home** and **You:** tile screens that lead to everything else, with badges for overdue tasks, warranty alerts, mileage past due, and expiring supplies.

**Behind the tiles**

- **Setup wizard:** asks about your home, yard, pool, trailer, pets, household size, and vehicles, then creates only the tasks that apply, with first due dates spread over the next month. Re-runnable; it only adds missing tasks.
- **Three kinds of tasks:** every N days, yearly on a date (seasonal), or by vehicle mileage. Snooze, skip, assign, search, notes, links.
- **Vehicles:** odometer tracking with a miles-per-day estimate that drives mileage due dates.
- **Inventory:** appliances, filter sizes, paint colors, warranty dates with expiry alerts, photos.
- **Vendors:** contractors and service providers linked to the items they work on.
- **History and Insights:** every completion with cost, notes, and photos; spend by category and month; cost estimates for upcoming tasks based on what you actually paid.
- **Emergency:** 72-hour readiness score, supply tracker with expiry dates, and a household info sheet.
- **Import:** bring tasks in from a CSV (comma, semicolon, or tab separated; day/month dates; category aliases; warnings for anything it skipped or guessed).
- **Calendar export:** Google Calendar CSV or an `.ics` file (a one-time import, not a live feed).
- **Backup:** export and import your data as a file or pasted text, with undo after a restore and a "recent changes" log on the device.
- **Accessibility and comfort:** text size and look settings, 44px touch targets, screen-reader labels, dark mode.

**App features (PWA)**

- Installable: icon, full-screen window, works with no signal.
- Daily reminder notification when something is overdue or due. It is sent when the app is opened, at most once a day, and only if you turn it on in Settings.

## Where your data lives

| Where it runs | Storage | Two-device sync |
|---|---|---|
| Claude artifact (private link) | Claude's per-user storage | Yes, with a household member too |
| Any other web host (GitHub Pages, etc.), no Supabase configured | This browser's local storage | No. Use Export/Import backup |
| Any web host with Supabase configured and the user signed in | Your Supabase database and private photo bucket, cached on the device | Yes, instantly, with offline edits uploaded when the connection returns |

The app picks one in `src/main.js` and falls back to local mode by itself. Cloud mode needs a Supabase project: follow `supabase/SETUP.md`, then fill in `config.js`. Sign in from **More, Account** (email link or Google). Until a Supabase project is configured, the Account screens are hidden and the app stays local. Local data is per browser and per device; clearing site data deletes it, so export a backup now and then.

## Run it

Serve the folder with any static server and open it in a browser:

```
npm start        # python3 -m http.server 8080
```

Service workers and install prompts need `localhost` or HTTPS.

## Put it online (GitHub Pages)

1. Repo **Settings, Pages**, source "Deploy from a branch", branch `main`, folder `/ (root)`.
2. Open `https://<user>.github.io/houseline/`.
3. On the phone: iPhone Safari, Share, **Add to Home Screen**. Android Chrome, menu, **Install app**.

All paths are relative, so it works from a subfolder. To ship an update, push to `main`; when the phone is online it picks up the new files on the next open. If you add or rename a file under `src/`, add it to the `SHELL` list in `sw.js` (a test fails if you forget).

## Test it

Requires Node 22 or newer.

```
npm test
```

Runs against a small stub DOM (`tests/stubdom.mjs`), so there is no browser dependency. One test is an intentional TODO: it documents a known sync race when the storage backend has no lock.

## Layout

- `index.html`, `styles.css`, `styles-views.css`: the page. Phone layout is the default; wider screens get a top nav.
- `manifest.webmanifest`, `sw.js`, `icons/`: install and offline support.
- `src/`: logic, storage, sync (3-way merge for two devices), quick add, CSV import, calendar export, readiness scoring, cost estimates, photos, reminders (`pwa.js`), and the UI shell and wizard.
- `src/views/`: Today, Calendar, Home/You hubs, Inventory, Vehicles, Vendors, Emergency, History, Insights.
- `src/supabase.js`, `src/auth.js`, `config.js`, `supabase/`: the cloud backend (fetch only, no SDK), sign-in session handling, and the SQL for tables, security rules and the photo bucket.
- `tests/`: the test suite, including a fake Supabase server (`tests/fakesupa.mjs`) that enforces the same household-isolation rules.
- `SPEC.md`, `SPEC_V2.md`, `SPEC_CALENDAR.md`: the contracts the modules were built against.
- `TODO.md`: what is left to make this a full product.

## Known limits

- Morning push reminders (signed in, installed app) arrive even when the app is closed. Without signing in, reminders only fire when the app is opened. iPhone needs the app added to the Home Screen first.
- Changes from another phone arrive instantly over a live connection (Supabase Realtime). If that connection is blocked, the app falls back to checking every 20 seconds.
- Saves to the cloud are conditional: if another phone saved first, the app re-reads, merges, and saves again, so one save never silently overwrites another.
- Sharing: a household (up to 6 people) shares one set of tasks through an invite code; see `supabase/SETUP.md`.
- Photos are not part of backups (neither the manual export nor the nightly database backups).
- Nightly database backups keep 14 days; crash reports go to the `client_errors` table; `npm test` runs on GitHub for every push.
- If two devices change the same field at the same moment, the later save wins (the merge handles most other cases).
- Layout is tested in headless Chrome at 320 to 414px wide, not yet on a range of real phones.
