// Import tasks from a spreadsheet saved as CSV. Pure. Columns (any order, header row required):
// title, category, every_days | every, last_done, notes. Extra columns are ignored.
import { isValidISO, addTask, addDays } from "./logic.js";
import { parseQuick } from "./quickadd.js";

/** Pick the delimiter (comma, semicolon or tab) that the header line uses most, ignoring quoted text. */
function detectDelimiter(src) {
  const first = src.split(/\r\n|\n|\r/)[0] || "";
  let best = ",", bestN = 0;
  for (const d of [",", ";", "\t"]) {
    let n = 0, q = false;
    for (const c of first) { if (c === '"') q = !q; else if (!q && c === d) n++; }
    if (n > bestN) { best = d; bestN = n; }
  }
  return best;
}

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = String(text ?? "").replace(/^﻿/, "");
  const delim = detectDelimiter(src);
  const push = () => { row.push(cell); cell = ""; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; push(); if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (q) throw new Error(`A quote on row ${rows.length + 1} is never closed. Check for a stray " in that row.`);
  push();
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h) => h.trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_|_$/g, "");
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
function toISO(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (isValidISO(s)) return s;
  const m = US_DATE.exec(s);
  if (m) {
    // US order (month/day/year) unless the first number can't be a month, which means day/month/year.
    const [a, b] = [Number(m[1]), Number(m[2])];
    const [mo, d] = a > 12 && b <= 12 ? [b, a] : [a, b];
    const iso = `${m[3]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    return isValidISO(iso) ? iso : undefined;
  }
  return undefined;
}
const CATS = ["car", "house", "yard", "emergency"];
const CAT_ALIAS = {
  cars: "car", vehicle: "car", vehicles: "car", auto: "car", truck: "car",
  home: "house", household: "house", indoor: "house", inside: "house", interior: "house",
  garden: "yard", lawn: "yard", outdoor: "yard", outdoors: "yard", outside: "yard", exterior: "yard",
  safety: "emergency", prep: "emergency", preparedness: "emergency", emergencies: "emergency",
};

/**
 * Returns { state, added, skipped:[{row,reason}] }. Duplicates (same title, case-insensitive) are skipped.
 * `maxRows` guards against huge files.
 */
export function importTasksCSV(state, text, idFn, today, { maxRows = 1000 } = {}) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("The file needs a header row and at least one task.");
  const head = rows[0].map(norm);
  const col = (...names) => head.findIndex((h) => names.includes(h));
  const iTitle = col("title", "task", "name"), iCat = col("category", "area", "type"), iDays = col("every_days", "interval_days", "days");
  const iEvery = col("every", "frequency", "how_often", "interval"), iLast = col("last_done", "last_completed", "last"), iNotes = col("notes", "note");
  if (iTitle < 0) throw new Error('Add a column named "title" (or "task").');
  if (iDays < 0 && iEvery < 0) throw new Error('Add a column named "every_days" (a number) or "every" (like "3 months").');
  if (rows.length - 1 > maxRows) throw new Error(`That's ${rows.length - 1} rows; the limit is ${maxRows} at a time.`);
  const have = new Set(state.tasks.map((t) => t.title.toLowerCase()));
  let next = state, added = 0;
  const skipped = [], warnings = [];
  let unknownCats = 0, unstarted = 0;
  rows.slice(1).forEach((r, k) => {
    const line = k + 2;
    const title = (r[iTitle] || "").trim();
    if (!title) { skipped.push({ row: line, reason: "no title" }); return; }
    if (have.has(title.toLowerCase())) { skipped.push({ row: line, reason: `"${title}" already exists` }); return; }
    let days = null;
    if (iDays >= 0 && (r[iDays] || "").trim() !== "") days = Number((r[iDays] || "").trim());
    let partialFromEvery = null;
    if (days == null && iEvery >= 0 && (r[iEvery] || "").trim() !== "") {
      const p = parseQuick(`${title} every ${r[iEvery].trim().replace(/^every\s+/i, "")}`, today);
      if (p.task) partialFromEvery = p.task;
    }
    if (days != null && (!Number.isInteger(days) || days < 1)) { skipped.push({ row: line, reason: "every_days must be a whole number" }); return; }
    if (days == null && !partialFromEvery) { skipped.push({ row: line, reason: "couldn't read how often" }); return; }
    const last = iLast >= 0 ? toISO(r[iLast]) : null;
    if (last === undefined) { skipped.push({ row: line, reason: "last_done isn't a date (use YYYY-MM-DD)" }); return; }
    let catRaw = iCat >= 0 ? (r[iCat] || "").trim().toLowerCase() : "";
    if (CAT_ALIAS[catRaw]) catRaw = CAT_ALIAS[catRaw];
    if (catRaw && !CATS.includes(catRaw)) unknownCats++;
    try {
      const base = partialFromEvery || { title, kind: "interval", intervalDays: days, category: "house" };
      const category = CATS.includes(catRaw) ? catRaw : base.category;
      const t = { ...base, title, category, lastDone: last, notes: iNotes >= 0 ? (r[iNotes] || "").trim().slice(0, 2000) : "", custom: true };
      // Tasks with no last-done date start on different days (spread over four weeks) instead of all landing on today.
      if (!last && t.kind === "interval") { t.startDate = addDays(today, unstarted % 28); unstarted++; }
      next = addTask(next, t, idFn);
      have.add(title.toLowerCase());
      added++;
    } catch (e) { skipped.push({ row: line, reason: e && e.message ? e.message : "invalid" }); }
  });
  if (unknownCats) warnings.push(`${unknownCats} ${unknownCats === 1 ? "category wasn't" : "categories weren't"} recognized and went under House`);
  if (unstarted > 1) warnings.push("tasks with no last-done date start on different days over the next four weeks");
  return { state: next, added, skipped, warnings };
}
