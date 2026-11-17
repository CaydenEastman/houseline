import test from "node:test";
import assert from "node:assert/strict";
import { dueInfo, statusOf, addTask, updateTask } from "../src/logic.js";
import { seedFromProfile } from "../src/templates.js";
import { migrate } from "../src/storage.js";
import { mkState, mkTask, mkProfile, idGen } from "./helpers.mjs";

const mow = (o = {}) => mkTask({ id: "m", title: "Mow", category: "yard", intervalDays: 7, seasonStart: 4, seasonEnd: 10, ...o });

test("a seasonal task that is due in winter waits for the first day of spring", () => {
  const s = mkState({ tasks: [mow({ lastDone: "2026-10-28" })] });
  assert.equal(dueInfo(s.tasks[0], s, "2026-12-15").dueDate, "2027-04-01");
  assert.notEqual(statusOf(s.tasks[0], "2026-12-15", s), "overdue");
});
test("in season it behaves like any interval task", () => {
  const s = mkState({ tasks: [mow({ lastDone: "2026-06-01" })] });
  assert.equal(dueInfo(s.tasks[0], s, "2026-06-20").dueDate, "2026-06-08");
  assert.equal(statusOf(s.tasks[0], "2026-06-20", s), "overdue");
});
test("never done, started in winter: first due is spring of the same or next year", () => {
  const s = mkState({ tasks: [mow()] });
  assert.equal(dueInfo(s.tasks[0], s, "2026-12-15").dueDate, "2027-04-01");
  assert.equal(dueInfo(s.tasks[0], s, "2027-02-15").dueDate, "2027-04-01");
});
test("season windows can wrap the new year", () => {
  const s = mkState({ tasks: [mow({ seasonStart: 11, seasonEnd: 2, lastDone: "2026-03-01", intervalDays: 30 })] });
  assert.equal(dueInfo(s.tasks[0], s, "2026-04-01").dueDate, "2026-11-01");
});
test("starter lawn tasks carry seasons and survive validation and edits", () => {
  const p = mkProfile({ hasYard: true, homeType: "house" });
  const tasks = seedFromProfile(p, { vehicles: [], idFn: idGen("s"), today: "2026-11-16" });
  const lawn = tasks.find((t) => t.title === "Mow lawn");
  assert.equal(lawn.seasonStart, 4);
  const s = migrate({ ...mkState({ profile: p, tasks }), version: 2 });
  assert.equal(s.tasks.find((t) => t.title === "Mow lawn").seasonEnd, 10);
  const edited = updateTask(s, lawn.id, { notes: "x" });
  assert.equal(edited.tasks.find((t) => t.id === lawn.id).seasonStart, 4);
  assert.throws(() => migrate({ ...s, tasks: s.tasks.map((t) => (t.id === lawn.id ? { ...t, seasonStart: 13 } : t)) }));
});
