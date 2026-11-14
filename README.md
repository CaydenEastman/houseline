# Man of the House

A home maintenance reminder app for car, house, yard, and emergency prep. Plain HTML, CSS, and JavaScript modules. No build step and no dependencies.

## Features

- **Setup wizard:** asks about your home, yard, pool, trailer, pets, household size, and vehicles, then creates only the tasks that apply, with first due dates spread over the next 30 days.
- **Three kinds of tasks:** repeat every N days, yearly on a date (seasonal), or by vehicle mileage. Snooze, skip, assign, search, add links and notes.
- **Vehicles:** odometer tracking with a miles-per-day estimate for mileage-based due dates.
- **Inventory:** appliances, filter sizes, paint colors, warranty dates with expiry alerts, photos.
- **History:** every completion with cost, notes, and photos, plus spend by category and by month.
- **Emergency:** 72-hour readiness score, supply tracker with expiry dates, and a household info sheet.
- **Calendar export:** Google Calendar CSV or an `.ics` file (a one-time import, not a live feed).
- **Sync and sharing:** when hosted as a Claude artifact, data syncs across devices and can be shared with a household member through the platform's shared storage. Without it, data stays in the browser's local storage.

## Run it

Serve the folder with any static server and open it in a browser:

```
python3 -m http.server 8080
```

## Test it

Requires Node 22 or newer.

```
npm test
```

## Layout

- `index.html`, `styles.css`, `styles-views.css`: the page.
- `src/`: logic, storage, sync, calendar export, readiness scoring, photos, and the UI shell and wizard.
- `src/views/`: History, Inventory, Vehicles, Emergency, and Calendar screens.
- `tests/`: the test suite.
- `SPEC.md`, `SPEC_V2.md`: the contracts the modules were built against.

## Known limits

- The hosted version cannot send email or push notifications. Reminders come from importing the calendar export into a calendar app.
- If two devices change the same field at the same moment, the later save wins.
- Not yet tested in a real browser; layout, dark mode, and the photo picker still need a visual check.
