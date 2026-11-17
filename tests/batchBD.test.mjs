import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH, plural, fmtNum, money, milesText } from "../src/dom.js";
import today, { resetTodayView } from "../src/views/today.js";
import { dueWords } from "../src/views/shared.js";
import { mkState, mkTask } from "./helpers.mjs";

const mount = (state, extra = {}) => {
  const doc = makeDocument(); const container = doc.createElement("div"); const commits = [];
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => state, today: () => "2026-11-16", completeTask() {}, openTaskForm() {}, saveFile: async () => false, toast() {}, markManyDone() {}, setView() {}, personName: (i) => i, commit: (s, m) => { commits.push([s, m]); return true; }, ...extra };
  today.render(container, ctx);
  return { container, commits };
};
const btn = (c, text) => c.querySelectorAll("button").find((b) => b.textContent === text);

test("Today: 'Later' snoozes a task for a week", () => {
  resetTodayView();
  const state = mkState({ tasks: [mkTask({ id: "t1", title: "Mow", lastDone: "2025-01-01", intervalDays: 30 })] });
  const { container, commits } = mount(state);
  btn(container, "Later (1 wk)").click();
  assert.equal(commits.length, 1);
  assert.equal(commits[0][0].tasks[0].snoozedUntil, "2026-11-23");
  assert.match(commits[0][1], /Snoozed until/);
});

test("Today: a brand-new account reads 'Getting started', not 'Needs attention'; after a first completion it is honest again", () => {
  resetTodayView();
  const tasks = [mkTask({ id: "t1", title: "Mow", lastDone: "2025-01-01", intervalDays: 30 })];
  const fresh = mount(mkState({ tasks })).container.textContent;
  assert.ok(fresh.includes("Getting started"));
  assert.ok(!fresh.includes("Needs attention"));
  resetTodayView();
  const used = mount(mkState({ tasks, completions: [{ id: "c1", taskId: "t1", title: "Mow", category: "house", date: "2026-11-01", kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: [] }] })).container.textContent;
  assert.ok(!used.includes("Getting started"));
});

test("one set of formatting helpers: plural, 12,345 numbers, $ with cents, and one wording for miles overdue", () => {
  assert.equal(plural(1, "task"), "1 task");
  assert.equal(plural(3, "task"), "3 tasks");
  assert.equal(fmtNum(12345), "12,345");
  assert.equal(money(1234.5), "$1,234.50");
  assert.equal(milesText(-300), "300 mi overdue");
  assert.equal(milesText(1200), "~1,200 mi left");
  assert.equal(dueWords({ task: { kind: "mileage" }, info: { milesLeft: -40, basis: "miles" }, days: -3 }), "40 mi overdue");
  assert.equal(dueWords({ task: { kind: "interval" }, info: {}, days: -3 }), "3 days overdue");
});

test("standards guard: no duplicate helpers, no mixed number formats, no stale button wording in the source", () => {
  const files = [];
  const walk = (dir) => { for (const e of readdirSync(dir, { withFileTypes: true })) { const p = `${dir}/${e.name}`; if (e.isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
  walk(new URL("../src", import.meta.url).pathname);
  const problems = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    if (!f.endsWith("/dom.js") && /^(export )?const plural = /m.test(src) && !f.endsWith("shared.js")) problems.push(`${f}: own plural()`);
    if (/\.toLocaleString\(\)/.test(src)) problems.push(`${f}: toLocaleString() without a locale (use fmtNum)`);
    if (/Yes, delete/.test(src)) problems.push(`${f}: "Yes, delete" (use "Delete")`);
    if (/mi past due/.test(src)) problems.push(`${f}: "past due" (use "overdue")`);
  }
  assert.deepEqual(problems, []);
});

test("fixes for the phone layout stay in the stylesheets", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8") + readFileSync(new URL("../styles-views.css", import.meta.url), "utf8");
  assert.ok(/\.task \{ flex-wrap: nowrap;/.test(css), "task rows must not wrap into a second column on phones");
  assert.ok(/\[hidden\] \{ display: none !important; \}/.test(css), "hidden form sections must really be hidden");
  assert.ok(/\.status\[popover\]/.test(css), "toasts show above open dialogs");
});
