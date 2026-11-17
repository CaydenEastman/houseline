// Slice of the app's src/logic.js (date helpers + dueInfo + statusOf) so server reminders agree with the app.
// If due-date rules change in src/logic.js, update this copy and redeploy the function.
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
export const MAX_INTERVAL_DAYS = 36500;
export const DEFAULT_MILES_PER_DAY = 33;

function parseISO(iso) {
  const m = typeof iso === "string" ? ISO_RE.exec(iso) : null;
  if (!m) throw new Error(`Invalid date "${iso}": expected YYYY-MM-DD`);
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date "${iso}": no such calendar day`);
  }
  return ms;
}

function formatISO(ms) {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;
export const MAX_COST = 1e9;

/** A real calendar day within a sane range (1900-2200), so later date math can never overflow. */
export function isValidISO(s) {
  try {
    const ms = parseISO(s);
    const y = new Date(ms).getUTCFullYear();
    return y >= MIN_YEAR && y <= MAX_YEAR;
  } catch { return false; }
}

export function daysBetween(aISO, bISO) {
  return Math.round((parseISO(bISO) - parseISO(aISO)) / DAY_MS);
}

export function addDays(iso, n) {
  if (!Number.isInteger(n)) throw new Error("addDays: n must be an integer");
  const ms = parseISO(iso) + n * DAY_MS;
  const year = new Date(ms).getUTCFullYear();
  if (!Number.isFinite(ms) || !(year >= 1 && year <= 9999)) {
    throw new Error("addDays: result is outside the supported date range");
  }
  return formatISO(ms);
}

const yearOf = (iso) => +iso.slice(0, 4);
const pad2 = (n) => String(n).padStart(2, "0");
const isoYMD = (y, m, d) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

const vehicleOf = (task, state) =>
  task.vehicleId && state && Array.isArray(state.vehicles)
    ? state.vehicles.find((v) => v.id === task.vehicleId) || null
    : null;

export function estimateMilesPerDay(vehicle, today) {
  parseISO(today);
  const log = vehicle && Array.isArray(vehicle.odometerLog) ? vehicle.odometerLog : [];
  const cutoff = addDays(today, -365);
  const pts = log.filter((e) => e && isValidISO(e.date) && e.date >= cutoff && e.date <= today && Number.isFinite(e.odometer));
  if (pts.length >= 2) {
    const a = pts[0], b = pts[pts.length - 1];
    const span = daysBetween(a.date, b.date);
    const rate = (b.odometer - a.odometer) / (span || 1);
    if (span >= 14 && rate > 0) return { rate, source: "log" };
  }
  return { rate: DEFAULT_MILES_PER_DAY, source: "default" };
}

function annualDue(task, today) {
  const { month, day } = task;
  if (!Number.isInteger(month) || !Number.isInteger(day)) throw new Error("Annual task needs a month and day");
  if (task.lastDone == null) {
    let y = yearOf(today);
    let o = isoYMD(y, month, day);
    if (o < today) o = isoYMD(y + 1, month, day);
    return o;
  }
  // First occurrence whose (O - 60 days) is strictly after lastDone: done up to 60 days early counts.
  for (let y = yearOf(task.lastDone); ; y++) {
    const o = isoYMD(y, month, day);
    if (addDays(o, -60) > task.lastDone) return o;
  }
}


/** Season window (month numbers, may wrap the new year) for tasks that only make sense part of the year. */
function inSeason(task, month) {
  const a = task.seasonStart, b = task.seasonEnd;
  if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
  return a <= b ? month >= a && month <= b : month >= a || month <= b;
}
/** A due date that falls out of season waits for the first day of the next season. */
function seasonAdjust(task, iso) {
  if (!Number.isInteger(task.seasonStart) || !Number.isInteger(task.seasonEnd)) return iso;
  if (inSeason(task, Number(iso.slice(5, 7)))) return iso;
  const y = Number(iso.slice(0, 4));
  const a = isoYMD(y, task.seasonStart, 1);
  return a >= iso ? a : isoYMD(y + 1, task.seasonStart, 1);
}

export function dueInfo(task, state, today) {
  parseISO(today);
  const kind = task.kind || "interval";
  const out = (dueDate, milesLeft, basis) => ({
    dueDate,
    daysUntil: dueDate == null ? null : daysBetween(today, dueDate),
    milesLeft,
    basis,
  });

  if (kind === "annual") return out(annualDue(task, today), null, "date");

  if (kind === "mileage") {
    const v = vehicleOf(task, state);
    const cap = task.lastDone != null && task.intervalDays ? addDays(task.lastDone, task.intervalDays) : null;
    const haveOdo = v && task.lastDoneOdometer != null && task.intervalMiles != null;
    if (!haveOdo) {
      if (cap) return out(cap, null, "date");
      return out(task.startDate ?? today, null, "start");
    }
    const milesLeft = task.lastDoneOdometer + task.intervalMiles - v.odometer;
    let est, basis = "miles";
    if (milesLeft <= 0) est = today;
    else {
      const { rate } = estimateMilesPerDay(v, today);
      const days = Math.min(MAX_INTERVAL_DAYS, Math.ceil(milesLeft / rate));
      // Count from the day the odometer was last read, not from today: a stale reading means less time is left.
      let from = isValidISO(v.odometerDate) && v.odometerDate < today ? v.odometerDate : today;
      if (isValidISO(task.lastDone) && task.lastDone > from && task.lastDone <= today) from = task.lastDone;
      est = addDays(from, days);
    }
    let due = est;
    if (cap && cap < due) { due = cap; basis = "date"; }
    return out(due, milesLeft, basis);
  }

  // interval
  if (task.lastDone != null) return out(seasonAdjust(task, addDays(task.lastDone, task.intervalDays)), null, "date");
  if (task.startDate != null) return out(seasonAdjust(task, task.startDate), null, "start");
  return out(seasonAdjust(task, today), null, "never");
}

export function statusOf(task, today, state) {
  parseISO(today);
  if (task.snoozedUntil != null && task.snoozedUntil > today) return "snoozed";
  const kind = task.kind || "interval";
  const info = dueInfo(task, state, today);
  const days = info.daysUntil ?? 0;
  if (days < 0 || (info.milesLeft != null && info.milesLeft < 0)) return "overdue";
  if (kind === "annual") return days <= 30 ? "due-soon" : "ok";
  if (kind === "mileage") {
    const milesSoon = info.milesLeft != null && info.milesLeft <= Math.max(200, 0.1 * (task.intervalMiles || 0));
    return days <= 14 || milesSoon ? "due-soon" : "ok";
  }
  const threshold = Math.min(14, Math.max(7, task.intervalDays * 0.1));
  return days <= threshold ? "due-soon" : "ok";
}

/** Local calendar date and hour for a time zone. */
export function localParts(tz, now = new Date()) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

/**
 * Decides whether a phone is due its daily reminder now. `day` is the local date on which the chosen hour fell, which
 * is what "already sent" is keyed on: for a 10pm reminder, the 12am run is still the same reminder, not a new one.
 */
export function reminderState(tz, hour, lastSentOn, windowHours, now = new Date()) {
  const lp = localParts(tz, now);
  const since = (lp.hour - hour + 24) % 24;
  const day = localParts(tz, new Date(now.getTime() - since * 3600e3)).date;
  return { due: since < windowHours && lastSentOn !== day, day, localDate: lp.date };
}

/** 0 (Sunday) to 6 (Saturday) for a YYYY-MM-DD date. */
export function weekdayOf(date) { return new Date(`${date}T12:00:00Z`).getUTCDay(); }

/** True when the date falls on one of the person's quiet days (no reminders that day). */
export function isQuietDay(quietDays, date) { return Array.isArray(quietDays) && quietDays.includes(weekdayOf(date)); }
