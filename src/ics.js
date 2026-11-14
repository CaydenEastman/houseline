// iCalendar (RFC 5545) export. Pure: `today` is a parameter, the clock is never read.
import * as logic from "./logic.js";

const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isoMs(iso) {
  const m = typeof iso === "string" ? ISO_RE.exec(iso) : null;
  if (!m) throw new Error(`Invalid date "${iso}": expected YYYY-MM-DD`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
function msIso(ms) {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, "0")}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
const addDaysISO = (iso, n) => msIso(isoMs(iso) + n * DAY_MS);
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // ISO strings sort lexicographically
const compact = (iso) => iso.replaceAll("-", "");

/** Escape an RFC 5545 TEXT value: backslash, semicolon, comma, newlines. */
export function escapeText(s) {
  return String(s ?? "")
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

const enc = new TextEncoder();

/** Fold one content line at 75 octets (UTF-8 aware, never splits a code point). Returns CRLF-joined physical lines, no trailing CRLF. */
export function foldLine(line) {
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75; // continuation lines start with one space which counts toward 75
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      out.push(cur);
      cur = " ";
      curBytes = 1;
      limit = 75;
    }
    cur += ch;
    curBytes += b;
  }
  out.push(cur);
  return out.join("\r\n");
}

function alarm(trigger, desc) {
  return ["BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(desc)}`, `TRIGGER:${trigger}`, "END:VALARM"];
}

function event({ uid, stamp, date, summary, description, rrule, trigger, categories }) {
  const lines = [
    "BEGIN:VEVENT",
    `UID:${uid}@man-of-the-house`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${compact(date)}`,
    `DTEND;VALUE=DATE:${compact(addDaysISO(date, 1))}`,
    `SUMMARY:${escapeText(summary)}`,
  ];
  if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
  if (rrule) lines.push(`RRULE:${rrule}`);
  if (categories) lines.push(`CATEGORIES:${escapeText(categories)}`);
  lines.push("TRANSP:TRANSPARENT", ...alarm(trigger, summary), "END:VEVENT");
  return lines;
}

function uidSafe(id) {
  return String(id).replace(/[^A-Za-z0-9._~@+-]/g, "-");
}

export function icsFilename(today) {
  isoMs(today);
  return `man-of-the-house-${today}.ics`;
}

/** Shared event planning for ICS/CSV: tasks -> {task, start, kind}. */
function taskStart(task, state, today, horizon) {
  let info;
  try { info = logic.dueInfo(task, state, today); } catch { return null; }
  let start = info && info.dueDate ? info.dueDate : today;
  if (cmp(start, today) < 0) start = today;
  if (task.snoozedUntil && cmp(task.snoozedUntil, today) > 0 && cmp(task.snoozedUntil, start) > 0) start = task.snoozedUntil;
  return cmp(start, horizon) > 0 ? null : start;
}

export function csvFilename(today) {
  isoMs(today);
  return `man-of-the-house-${today}.csv`;
}

function csvCell(v) {
  let s = String(v ?? "").replace(/\r\n|\r/g, "\n");
  if (/^[=+\-@\t]/.test(s)) s = "'" + s; // spreadsheet formula-injection guard
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const usDate = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;

/** Google Calendar CSV import. One row per dated occurrence (CSV cannot recur). */
export function buildCalendarCSV(state, today, opts = {}) {
  const { horizonDays = 400, includeSupplies = true, includeWarranties = true, maxOccurrencesPerTask = 26 } = opts;
  if (typeof logic.dueInfo !== "function") throw new Error("csv: logic.dueInfo is not available");
  isoMs(today);
  if (!Number.isInteger(horizonDays) || horizonDays < 0) throw new Error("horizonDays must be a non-negative integer");
  if (!Number.isInteger(maxOccurrencesPerTask) || maxOccurrencesPerTask < 1) throw new Error("maxOccurrencesPerTask must be a positive integer");
  const horizon = addDaysISO(today, horizonDays);
  const rows = [["Subject", "Start Date", "Start Time", "End Date", "End Time", "All Day Event", "Description", "Location", "Private"]];
  const add = (subject, date, description, location = "") =>
    rows.push([subject, usDate(date), "", usDate(date), "", "True", description, location, "False"]);

  for (const task of state.tasks || []) {
    const start = taskStart(task, state, today, horizon);
    if (!start) continue;
    const kind = task.kind || "interval";
    const parts = [`Category: ${task.category}`];
    if (task.notes) parts.push(task.notes);
    for (const l of task.links || []) parts.push(`${l.label}: ${l.url}`);
    if (kind === "mileage") {
      const v = (state.vehicles || []).find((x) => x.id === task.vehicleId);
      parts.push(`Every ${task.intervalMiles} miles${v ? ` (${v.name})` : ""}. Date is an estimate from your odometer history.`);
      add(`${task.title} (estimated)`, start, parts.join("\n"));
      continue;
    }
    const dates = [start];
    if (kind === "interval" && Number.isInteger(task.intervalDays) && task.intervalDays > 0) {
      for (let d = addDaysISO(start, task.intervalDays); dates.length < maxOccurrencesPerTask && cmp(d, horizon) <= 0; d = addDaysISO(d, task.intervalDays)) dates.push(d);
    } else if (kind === "annual" && Number.isInteger(task.month) && Number.isInteger(task.day)) {
      for (let y = +start.slice(0, 4) + 1; dates.length < maxOccurrencesPerTask; y++) {
        const d = `${String(y).padStart(4, "0")}-${String(task.month).padStart(2, "0")}-${String(task.day).padStart(2, "0")}`;
        if (cmp(d, horizon) > 0) break;
        dates.push(d);
      }
    }
    for (const d of dates) add(task.title, d, parts.join("\n"));
  }
  if (includeSupplies) {
    for (const s of state.supplies || []) {
      if (!s.expires || cmp(s.expires, today) < 0 || cmp(s.expires, horizon) > 0) continue;
      add(`Supply expires: ${s.name}`, s.expires, [`Category: ${s.category}`, s.notes].filter(Boolean).join("\n"));
    }
  }
  if (includeWarranties) {
    for (const it of state.items || []) {
      if (!it.warrantyExpires || cmp(it.warrantyExpires, today) < 0 || cmp(it.warrantyExpires, horizon) > 0) continue;
      add(`Warranty ends: ${it.name}`, it.warrantyExpires, [it.model && `Model: ${it.model}`, it.notes].filter(Boolean).join("\n"), it.location || "");
    }
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export function buildICS(state, today, opts = {}) {
  const { horizonDays = 400, calName = "Man of the House", includeSupplies = true, includeWarranties = true } = opts;
  if (typeof logic.dueInfo !== "function") throw new Error("ics: logic.dueInfo is not available");
  isoMs(today);
  if (!Number.isInteger(horizonDays) || horizonDays < 0) throw new Error("horizonDays must be a non-negative integer");
  const horizon = addDaysISO(today, horizonDays);
  const stamp = `${compact(today)}T000000Z`;
  const body = [];

  for (const task of state.tasks || []) {
    let info;
    try { info = logic.dueInfo(task, state, today); } catch { continue; }
    let start = info && info.dueDate ? info.dueDate : today;
    if (cmp(start, today) < 0) start = today; // overdue: remind from today
    if (task.snoozedUntil && cmp(task.snoozedUntil, today) > 0 && cmp(task.snoozedUntil, start) > 0) start = task.snoozedUntil;
    if (cmp(start, horizon) > 0) continue;
    const kind = task.kind || "interval";
    const vehicle = kind === "mileage" ? (state.vehicles || []).find((v) => v.id === task.vehicleId) : null;
    const descParts = [`Category: ${task.category}`];
    if (kind === "mileage") {
      descParts.push(
        `Every ${task.intervalMiles} miles${task.intervalDays ? ` or ${task.intervalDays} days` : ""}` +
          (vehicle ? ` (${vehicle.name})` : "") + ". Date is an estimate from your odometer history.",
      );
    }
    if (task.notes) descParts.push(task.notes);
    for (const l of task.links || []) descParts.push(`${l.label}: ${l.url}`);
    let rrule = null;
    if (kind === "interval" && Number.isInteger(task.intervalDays) && task.intervalDays > 0) rrule = `FREQ=DAILY;INTERVAL=${task.intervalDays}`;
    else if (kind === "annual") rrule = "FREQ=YEARLY";
    body.push(
      ...event({
        uid: uidSafe(task.id),
        stamp,
        date: start,
        summary: kind === "mileage" ? `${task.title} (estimated)` : task.title,
        description: descParts.join("\n"),
        rrule,
        trigger: "-P1D",
        categories: task.category,
      }),
    );
  }

  if (includeSupplies) {
    for (const s of state.supplies || []) {
      if (!s.expires || cmp(s.expires, today) < 0 || cmp(s.expires, horizon) > 0) continue;
      const d = [`Category: ${s.category}`];
      if (s.quantity != null) d.push(`Quantity: ${s.quantity}${s.unit ? " " + s.unit : ""}`);
      if (s.notes) d.push(s.notes);
      body.push(...event({ uid: `supply-${uidSafe(s.id)}`, stamp, date: s.expires, summary: `Supply expires: ${s.name}`, description: d.join("\n"), trigger: "-P7D", categories: "emergency" }));
    }
  }
  if (includeWarranties) {
    for (const it of state.items || []) {
      if (!it.warrantyExpires || cmp(it.warrantyExpires, today) < 0 || cmp(it.warrantyExpires, horizon) > 0) continue;
      const d = [`Kind: ${it.kind}`];
      if (it.model) d.push(`Model: ${it.model}`);
      if (it.location) d.push(`Location: ${it.location}`);
      if (it.notes) d.push(it.notes);
      body.push(...event({ uid: `warranty-${uidSafe(it.id)}`, stamp, date: it.warrantyExpires, summary: `Warranty ends: ${it.name}`, description: d.join("\n"), trigger: "-P7D", categories: "house" }));
    }
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Man of the House//Maintenance Reminders//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calName)}`,
    ...body,
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
