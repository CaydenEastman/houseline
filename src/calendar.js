// Calendar data for the month-grid view. Pure: never reads the clock, never mutates its input.
// Everything is a local calendar date string (YYYY-MM-DD); date math is UTC-safe (no DST drift).
import { addDays, daysBetween, isValidISO, dueInfo, statusOf } from "./logic.js";

export const TYPE_ORDER = ["task", "supply", "warranty", "done", "skipped"];
export const MAX_EVENTS = 2000;
export const MAX_RANGE_DAYS = 800;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad2 = (n) => String(n).padStart(2, "0");
const isoYMD = (y, m, d) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
const yearOf = (iso) => +iso.slice(0, 4);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const withCommas = (n) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const short = (iso) => `${MONTHS[+iso.slice(5, 7) - 1]} ${+iso.slice(8, 10)}`;

function weekday(iso) {
  return new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
}

function checkMonth(year, month, weekStartsOn) {
  if (!Number.isInteger(year) || year < 2 || year > 9998) throw new Error("year must be a whole number from 2 to 9998");
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error("month must be a whole number from 1 to 12");
  if (!Number.isInteger(weekStartsOn) || weekStartsOn < 0 || weekStartsOn > 6) {
    throw new Error("weekStartsOn must be a whole number from 0 (Sunday) to 6");
  }
}

/** Whole weeks (4 to 6 rows of 7) covering the month; leading/trailing days have inMonth:false. */
export function monthGrid(year, month, weekStartsOn = 0) {
  checkMonth(year, month, weekStartsOn);
  const first = isoYMD(year, month, 1);
  const lead = (weekday(first) - weekStartsOn + 7) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const rows = Math.ceil((lead + daysInMonth) / 7);
  const start = addDays(first, -lead);
  const prefix = `${String(year).padStart(4, "0")}-${pad2(month)}`;
  const weeks = [];
  for (let r = 0; r < rows; r++) {
    const week = [];
    for (let c = 0; c < 7; c++) {
      const date = addDays(start, r * 7 + c);
      week.push({ date, inMonth: date.startsWith(prefix) });
    }
    weeks.push(week);
  }
  return { year, month, weeks };
}

/** First and last date shown in the month grid. */
export function gridRange(year, month, weekStartsOn = 0) {
  const { weeks } = monthGrid(year, month, weekStartsOn);
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

/** Move by `delta` months, wrapping years. */
export function shiftMonth(year, month, delta) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("year and month must be whole numbers (month 1 to 12)");
  }
  if (!Number.isInteger(delta)) throw new Error("delta must be a whole number");
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12 + 12) % 12 + 1 };
}

export function monthLabelParts(year, month) {
  return { year, month };
}

function mk(fields) {
  return {
    taskId: null, category: null, status: null, estimated: false, projected: false, carried: false, detail: "",
    ...fields,
  };
}

function taskDetail(task, info, status, today) {
  if (status === "snoozed") return `snoozed until ${short(task.snoozedUntil)}`;
  if (status === "overdue") {
    if (info.milesLeft != null && info.milesLeft < 0) return `${withCommas(-info.milesLeft)} mi past due`;
    return `${plural(Math.abs(info.daysUntil ?? 0), "day")} overdue`;
  }
  if (info.basis === "miles" && info.milesLeft != null) return `~${withCommas(info.milesLeft)} mi left (estimated date)`;
  if (info.basis === "never" || info.basis === "start") return info.dueDate <= today ? "due today" : `first due in ${plural(info.daysUntil ?? 0, "day")}`;
  const n = info.daysUntil ?? 0;
  return n <= 0 ? "due today" : `due in ${plural(n, "day")}`;
}

/**
 * Every dated thing between fromISO and toISO (inclusive): task due dates (plus projected repeats),
 * supply expiries, warranty ends, and past completions. Sorted by date, then TYPE_ORDER, then title.
 * Projected repeats assume each task is done on its due date; they are only drawn after `today`.
 */
export function eventsInRange(state, fromISO, toISO, today) {
  if (!state || typeof state !== "object") throw new Error("state is required");
  for (const [label, v] of [["fromISO", fromISO], ["toISO", toISO], ["today", today]]) {
    if (!isValidISO(v)) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  }
  if (fromISO > toISO) throw new Error("fromISO must not be after toISO");
  if (daysBetween(fromISO, toISO) > MAX_RANGE_DAYS) throw new Error(`Range is too long (max ${MAX_RANGE_DAYS} days)`);

  const inRange = (d) => d >= fromISO && d <= toISO;
  const core = [];       // first occurrences, supplies, warranties, history: never dropped
  const projections = []; // repeats: dropped first if the cap is hit

  for (const task of state.tasks || []) {
    let info, status;
    try {
      info = dueInfo(task, state, today);
      status = statusOf(task, today, state);
    } catch { continue; } // an unreadable task never breaks the calendar
    if (info.dueDate == null) continue;

    const snoozed = status === "snoozed";
    const date = snoozed && task.snoozedUntil > info.dueDate ? task.snoozedUntil : info.dueDate;
    const base = { type: "task", id: task.id, taskId: task.id, title: task.title, category: task.category };
    const estimated = (task.kind || "interval") === "mileage" && info.basis === "miles";

    if (inRange(date)) {
      core.push(mk({ ...base, date, status, estimated, detail: taskDetail(task, info, status, today) }));
    } else if (status === "overdue" && date < fromISO && inRange(today)) {
      core.push(mk({ ...base, date: today, status, carried: true, detail: `overdue since ${short(date)}` }));
    }

    if (snoozed) continue;
    const kind = task.kind || "interval";
    if (kind === "interval" && Number.isInteger(task.intervalDays) && task.intervalDays > 0) {
      // An overdue task is assumed done today, so its repeats count from today, not from the missed date.
      const projBase = info.dueDate < today ? today : info.dueDate;
      const gap = daysBetween(projBase, fromISO);
      let k = gap > 0 ? Math.ceil(gap / task.intervalDays) : 1;
      if (k < 1) k = 1;
      for (; projections.length < MAX_EVENTS * 2; k++) {
        let d;
        try { d = addDays(projBase, k * task.intervalDays); } catch { break; }
        if (d > toISO) break;
        if (d >= fromISO && d > today) {
          projections.push(mk({ ...base, date: d, status: "ok", projected: true, detail: "repeat (if done on time)" }));
        }
      }
    } else if (kind === "annual" && Number.isInteger(task.month) && Number.isInteger(task.day)) {
      for (let y = Math.max(yearOf(info.dueDate) + 1, yearOf(fromISO)); y <= yearOf(toISO); y++) {
        const o = isoYMD(y, task.month, task.day);
        if (o > toISO) break;
        if (o >= fromISO && o > today) {
          projections.push(mk({ ...base, date: o, status: "ok", projected: true, detail: "yearly repeat" }));
        }
      }
    }
  }

  const expiry = (iso) => {
    if (iso < today) return ["expired", `expired ${plural(daysBetween(iso, today), "day")} ago`];
    const n = daysBetween(today, iso);
    return [n <= 60 ? "due-soon" : "ok", n === 0 ? "expires today" : `expires in ${plural(n, "day")}`];
  };

  for (const s of state.supplies || []) {
    if (!s || !isValidISO(s.expires) || !inRange(s.expires)) continue;
    const [status, detail] = expiry(s.expires);
    core.push(mk({ date: s.expires, type: "supply", id: s.id, title: s.name, category: "emergency", status, detail }));
  }
  for (const it of state.items || []) {
    if (!it || !isValidISO(it.warrantyExpires) || !inRange(it.warrantyExpires)) continue;
    const [status, detail] = expiry(it.warrantyExpires);
    core.push(mk({ date: it.warrantyExpires, type: "warranty", id: it.id, title: `Warranty ends: ${it.name}`, status, detail }));
  }
  for (const c of state.completions || []) {
    if (!c || !isValidISO(c.date) || !inRange(c.date)) continue;
    const skipped = c.kind === "skipped";
    const cost = !skipped && typeof c.cost === "number" ? `cost $${c.cost.toFixed(2)}` : skipped ? "skipped" : "done";
    core.push(mk({
      date: c.date, type: skipped ? "skipped" : "done", id: c.id, taskId: c.taskId ?? null,
      title: c.title, category: c.category ?? null, status: skipped ? "skipped" : "done", detail: cost,
    }));
  }

  const room = Math.max(0, MAX_EVENTS - core.length);
  const all = core.concat(projections.slice(0, room));
  const rank = (t) => TYPE_ORDER.indexOf(t);
  all.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
      : rank(a.type) - rank(b.type)
      || (a.title.toLowerCase() < b.title.toLowerCase() ? -1 : a.title.toLowerCase() > b.title.toLowerCase() ? 1 : 0)
      || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return all;
}

/** Group an event list by date, keeping order. */
export function eventsByDate(events) {
  const out = {};
  for (const e of events) (out[e.date] || (out[e.date] = [])).push(e);
  return out;
}
