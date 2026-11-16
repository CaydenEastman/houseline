import test from "node:test";
import assert from "node:assert/strict";
import { parseQuick, describeInterval } from "../src/quickadd.js";
import { parseCSV, importTasksCSV } from "../src/importcsv.js";
import { monthlyRecap, previousMonth, currentMonth, weekStreak, recapText } from "../src/recap.js";
import { ageTasks } from "../src/templates.js";
import { addTask, updateProfile } from "../src/logic.js";
import { validateState } from "../src/storage.js";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH } from "../src/dom.js";
import today from "../src/views/today.js";
import { mkState, mkTask, mkCompletion } from "./helpers.mjs";

const T = "2026-11-16";
const idg = () => { let n = 0; return () => `n${++n}`; };

test("quick-add: intervals, fixed dates, categories, errors", () => {
  const a = parseQuick("change furnace filter every 3 months", T).task;
  assert.deepEqual([a.title, a.kind, a.intervalDays, a.category], ["Change furnace filter", "interval", 90, "house"]);
  assert.equal(parseQuick("mow the lawn weekly", T).task.category, "yard");
  const r = parseQuick("Renew registration every January 15", T).task;
  assert.deepEqual([r.kind, r.month, r.day, r.category], ["annual", 1, 15, "car"]);
  assert.equal(parseQuick("rotate tires twice a year", T).task.intervalDays, 182);
  assert.equal(parseQuick("test smoke alarms every other month", T).task.intervalDays, 60 + 1);
  assert.ok(parseQuick("oil change", T).error);
  assert.ok(parseQuick("   ", T).error);
  assert.ok(parseQuick("every week", T).error); // no title
  assert.equal(describeInterval(90), "every 3 months");
  // result is accepted by addTask
  validateState(addTask(mkState(), parseQuick("clean gutters every 6 months", T).task, idg()));
  validateState(addTask(mkState(), parseQuick("every October winterize sprinklers", T).task, idg()));
});

test("CSV: parsing quotes, import rules, duplicates and errors", () => {
  assert.deepEqual(parseCSV('a,b\n"x, y","say ""hi"""\n'), [["a", "b"], ["x, y", 'say "hi"']]);
  const csv = 'Task,Category,Every,Last Done,Notes\nClean gutters,house,6 months,2026-05-01,"top, bottom"\nMow,yard,week,,\nBad,house,whenever,,\nClean gutters,house,1 year,,\n,house,1 year,,\nBadDate,house,1 year,5/17/2026x,';
  const r = importTasksCSV(mkState(), csv, idg(), T);
  assert.equal(r.added, 2);
  assert.equal(r.skipped.length, 4);
  const t = r.state.tasks.find((x) => x.title === "Clean gutters");
  assert.equal(t.intervalDays, 180);
  assert.equal(t.lastDone, "2026-05-01"); assert.equal(t.notes, "top, bottom");
  validateState(r.state);
  const us = importTasksCSV(mkState(), "title,every_days,last_done\nX,30,3/4/2026", idg(), T);
  assert.equal(us.state.tasks[0].lastDone, "2026-03-04");
  assert.throws(() => importTasksCSV(mkState(), "foo,bar\n1,2", idg(), T), /title/);
  assert.throws(() => importTasksCSV(mkState(), "title\nx", idg(), T), /every/);
  assert.throws(() => importTasksCSV(mkState(), "", idg(), T), /header/);
});

test("recap: previous month, counts, spend, streak", () => {
  assert.deepEqual(previousMonth("2026-01-05"), { key: "2025-12", label: "December 2025" });
  const s = mkState({ tasks: [mkTask({ id: "a", lastDone: "2025-01-01", intervalDays: 30 })], completions: [
    mkCompletion({ id: "1", date: "2026-10-03", cost: 40, category: "car", title: "Oil" }),
    mkCompletion({ id: "2", date: "2026-10-20", cost: 10, category: "car" }),
    mkCompletion({ id: "3", date: "2026-10-21", kind: "skipped" }),
    mkCompletion({ id: "4", date: "2026-11-12" }),
  ] });
  const r = monthlyRecap(s, previousMonth(T), T);
  assert.deepEqual([r.done, r.skipped, r.spent, r.topArea.area, r.overdueNow, r.biggest.title], [2, 1, 50, "car", 1, "Oil"]);
  assert.match(recapText(r), /October 2026/);
  assert.equal(monthlyRecap(s, currentMonth(T), T).done, 1);
  assert.ok(weekStreak(s, T) >= 1);
  assert.equal(weekStreak(mkState(), T), 0);
});

test("age tasks: bands, no duplicates, valid, profile field", () => {
  const old = ageTasks("old", [], T), mid = ageTasks("mid", [], T), nw = ageTasks("new", [], T);
  assert.ok(old.length > mid.length && mid.length > nw.length);
  assert.equal(ageTasks("old", ["test sump pump"], T).some((t) => t.title === "Test sump pump"), false);
  assert.deepEqual(ageTasks("bogus", [], T), []);
  const g = idg(); let s = mkState(); for (const t of old) s = addTask(s, t, g);
  validateState(s);
  assert.equal(updateProfile(mkState(), { homeAge: "mid" }).profile.homeAge, "mid");
  assert.throws(() => updateProfile(mkState(), { homeAge: "x" }), /Home age/);
});

import { resetTodayView } from "../src/views/today.js";
import { quickForm } from "../src/quickform.js";
function setup(state) {
  const doc = makeDocument(); const container = doc.createElement("div");
  const calls = { many: [], commits: [] };
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => state, today: () => T, openTaskForm() {}, completeTask() {},
    commit: (next, msg) => { calls.commits.push({ next, msg }); return true; }, markManyDone: (ids) => { calls.many.push(ids); return true; }, setView() {}, newId: idg() };
  resetTodayView();
  today.render(container, ctx);
  return { container, calls, ctx };
}
const btn = (c, f) => [...c.querySelectorAll("button")].find(f);
function quickSetup(state) {
  const { ctx, calls } = setup(state);
  const doc = ctx.doc; const container = doc.createElement("div");
  container.append(quickForm(ctx));
  const type = (text) => { const input = container.querySelector("#v-quick-input"); input.value = text; input.dispatchEvent({ type: "input", bubbles: true, target: input, preventDefault() {} }); };
  const submit = () => { const form = container.querySelector("form"); form.dispatchEvent({ type: "submit", bubbles: false, target: form, preventDefault() {}, stopPropagation() {} }); };
  return { container, calls, type, submit };
}
test("Quick add form: commits a parsed task; bad text shows error", () => {
  const { calls, type, submit } = quickSetup(mkState());
  type("clean gutters every 6 months"); submit();
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].next.tasks[0].title, "Clean gutters");
});
test("Quick add form: without a schedule shows an error and commits nothing", () => {
  const { container, calls, type, submit } = quickSetup(mkState());
  type("clean gutters"); submit();
  assert.equal(calls.commits.length, 0);
  assert.ok(container.textContent.includes("Say how often"));
});
test("Quick add form: a duplicate title asks first, then adds on the second press", () => {
  const { container, calls, type, submit } = quickSetup(mkState({ tasks: [mkTask({ id: "x", title: "Mow the lawn" })] }));
  type("mow the lawn weekly"); submit();
  assert.equal(calls.commits.length, 0);
  assert.ok(container.textContent.includes("already have"));
  submit();
  assert.equal(calls.commits.length, 1);
});
test("Today: select tasks then mark them done together", () => {
  const s = mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2025-01-01", intervalDays: 30 }), mkTask({ id: "b", title: "B", lastDone: "2025-01-01", intervalDays: 30 })] });
  const { container, calls } = setup(s);
  assert.equal(container.querySelectorAll(".v-sel-box").length, 0); // checkboxes only appear in Select mode
  btn(container, (b) => b.textContent === "Select").click();
  btn(container, (b) => b.textContent === "Select all").click();
  btn(container, (b) => /^Mark 2 done today/.test(b.textContent)).click();
  assert.deepEqual(calls.many[0].sort(), ["a", "b"]);
});
test("Today: area chips filter the feed", () => {
  const s = mkState({ tasks: [mkTask({ id: "a", title: "Gutters", category: "house", lastDone: "2025-01-01", intervalDays: 30 }), mkTask({ id: "b", title: "Mow", category: "yard", lastDone: "2025-01-01", intervalDays: 30 })] });
  const { container } = setup(s);
  assert.ok(container.textContent.includes("Gutters") && container.textContent.includes("Mow"));
  btn(container, (b) => /Yard/.test(b.textContent)).click();
  assert.ok(container.textContent.includes("Mow") && !container.textContent.includes("Gutters"));
});

import { estimateFor, runsPerYear, yearlyBudget, rangeText } from "../src/costs.js";
import { mkVehicle } from "./helpers.mjs";
import insights from "../src/views/insights.js";

test("costs: typical estimate, own costs override, unknown is null", () => {
  const t = mkTask({ id: "a", title: "Oil change — Van", kind: "mileage", intervalMiles: 5000, intervalDays: 180, vehicleId: "v1" });
  const base = mkState({ vehicles: [mkVehicle({ id: "v1" })], tasks: [t] });
  const e = estimateFor(t, base);
  assert.deepEqual([e.low, e.high, e.source], [40, 100, "typical"]);
  const own = { ...base, completions: [mkCompletion({ id: "c1", taskId: "a", cost: 62, date: "2026-05-01" }), mkCompletion({ id: "c2", taskId: "a", cost: 80, date: "2026-01-01" })] };
  const o = estimateFor(t, own);
  assert.deepEqual([o.low, o.high, o.source], [62, 80, "yours"]);
  assert.equal(estimateFor(mkTask({ title: "My custom thing" }), base), null);
  assert.equal(rangeText({ low: 0, high: 0 }), "");
  assert.equal(rangeText({ low: 40, high: 100 }), "$40 to $100");
  assert.equal(rangeText({ low: 62, high: 62 }), "$62");
});
test("costs: runs per year and yearly budget", () => {
  const v = mkVehicle({ id: "v1" });
  const mil = mkTask({ id: "m", title: "Oil change", kind: "mileage", intervalMiles: 5000, intervalDays: 180, vehicleId: "v1" });
  assert.ok(Math.abs(runsPerYear(mil, mkState({ vehicles: [v] }), T) - (33 * 365) / 5000) < 1e-9);
  assert.equal(runsPerYear(mkTask({ kind: "annual", month: 3, day: 1 }), mkState(), T), 1);
  assert.equal(runsPerYear(mkTask({ intervalDays: 73 }), mkState(), T), 5);
  const s = mkState({ tasks: [mkTask({ id: "f", title: "Furnace service", kind: "annual", month: 9, day: 15, intervalDays: null, category: "house" }), mkTask({ id: "x", title: "Unknown" })] });
  const b = yearlyBudget(s, T);
  assert.deepEqual([b.low, b.high, b.uncounted], [80, 200, 1]);
  assert.equal(b.items.length, 1);
});
test("Insights shows yearly upkeep with the ballpark caveat", () => {
  const doc = makeDocument(); const container = doc.createElement("div");
  const st = mkState({ tasks: [mkTask({ id: "f", title: "Furnace service", kind: "annual", month: 9, day: 15, category: "house" })] });
  insights.render(container, { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => st, today: () => T, saveFile: async () => false, personName: () => "x" });
  assert.ok(container.textContent.includes("Estimated yearly upkeep"));
  assert.ok(container.textContent.includes("$80 to $200"));
  assert.ok(container.textContent.includes("Ballpark only"));
});
