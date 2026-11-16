// Import tasks from a spreadsheet saved as CSV. Pure. Columns (any order, header row required):
// title, category, every_days | every, last_done, notes. Extra columns are ignored.
import { isValidISO, addTask } from "./logic.js";
import { parseQuick } from "./quickadd.js";

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const src = String(text ?? "").replace(/^﻿/, "");
  const push = () => { row.push(cell); cell = ""; };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") push();
    else if (c === "\n" || c === "\r") { if (c === "\r" && src[i + 1] === "\n") i++; push(); if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
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
  if (m) { const iso = `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`; return isValidISO(iso) ? iso : undefined; }
  return undefined;
}
const CATS = ["car", "house", "yard", "emergency"];

/**
 * Returns { state, added, skipped:[{row,reason}] }. Duplicates (same title, case-insensitive) are skipped.
 * `maxRows` guards against huge files.
 */
export function importTasksCSV(state, text, idFn, today, { maxRows = 300 } = {}) {
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
  const skipped = [];
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
    const catRaw = iCat >= 0 ? (r[iCat] || "").trim().toLowerCase() : "";
    try {
      const base = partialFromEvery || { title, kind: "interval", intervalDays: days, category: "house" };
      const category = CATS.includes(catRaw) ? catRaw : base.category;
      const t = { ...base, title, category, lastDone: last, notes: iNotes >= 0 ? (r[iNotes] || "").trim().slice(0, 2000) : "", custom: true };
      if (!last && t.kind === "interval") t.startDate = today;
      next = addTask(next, t, idFn);
      have.add(title.toLowerCase());
      added++;
    } catch (e) { skipped.push({ row: line, reason: e && e.message ? e.message : "invalid" }); }
  });
  return { state: next, added, skipped };
}
