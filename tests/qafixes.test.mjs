import test from "node:test";
import assert from "node:assert/strict";
import { parseQuick, describeInterval } from "../src/quickadd.js";
import { parseCSV, importTasksCSV } from "../src/importcsv.js";
import { estimateFor } from "../src/costs.js";
import { validateState } from "../src/storage.js";
import { mkState, mkTask, mkCompletion, idGen } from "./helpers.mjs";

const T = "2026-06-15";

test("quick-add: more units, seasons, miles message, honest notes", () => {
  assert.equal(parseQuick("service furnace every 6 mos", T).task.intervalDays, 180);
  assert.equal(parseQuick("check tires every 1,000 days", T).task.intervalDays, 1000);
  const spring = parseQuick("aerate every spring", T);
  assert.equal(spring.task.kind, "annual");
  assert.equal(spring.task.month, 3);
  assert.match(parseQuick("change oil every 5,000 miles", T).error, /Vehicles tab/);
  assert.match(parseQuick("renew registration every February 30", T).summary, /28th/);
  assert.match(parseQuick("check alarms monthly on the 1st", T).summary, /repeats from today/);
  assert.equal(describeInterval(61), "every other month");
});

test("CSV: semicolons and tabs, unclosed quote, category aliases, day/month dates, staggered starts, big files", () => {
  assert.deepEqual(parseCSV("a;b\nx;y"), [["a", "b"], ["x", "y"]]);
  assert.deepEqual(parseCSV("a\tb\nx\ty"), [["a", "b"], ["x", "y"]]);
  assert.throws(() => parseCSV('a,b\n"oops,1'), /never closed/);
  const csv = "title,category,every_days,last_done\nMow,Garden,7,25/12/2025\nOil,cars,90,\nFilter,Widgets,30,\nSmoke,home,30,";
  const r = importTasksCSV(mkState(), csv, idGen("n"), T);
  assert.equal(r.added, 4);
  const by = (t) => r.state.tasks.find((x) => x.title === t);
  assert.equal(by("Mow").category, "yard");
  assert.equal(by("Mow").lastDone, "2025-12-25");
  assert.equal(by("Oil").category, "car");
  assert.equal(by("Filter").category, "house");
  const starts = ["Oil", "Filter", "Smoke"].map((t) => by(t).startDate);
  assert.equal(new Set(starts).size, 3);
  assert.ok(r.warnings.some((w) => /recognized/.test(w)));
  validateState(r.state);
  const big = "title,every_days\n" + Array.from({ length: 400 }, (_, i) => `Task ${i},30`).join("\n");
  assert.equal(importTasksCSV(mkState(), big, idGen("b"), T).added, 400);
});

test("cost estimates: $0 counts and one huge repair does not set the range", () => {
  const task = mkTask({ id: "t1", title: "Inspect roof" });
  const comps = (costs) => costs.map((c, i) => mkCompletion({ id: `c${i}`, taskId: "t1", date: `2026-0${i + 1}-01`, cost: c }));
  const diy = estimateFor(task, mkState({ completions: comps([0, 0, 0]) }));
  assert.deepEqual([diy.low, diy.high, diy.source], [0, 0, "yours"]);
  const spike = estimateFor(task, mkState({ completions: comps([40, 50, 1200]) }));
  assert.ok(spike.high <= 50);
});
