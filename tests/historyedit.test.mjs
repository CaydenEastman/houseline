for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
import test from "node:test";
import assert from "node:assert/strict";
import { markDone, skipTask, updateCompletion, deleteCompletion } from "../src/logic.js";
import { plural as p2 } from "../src/dom.js";
import { mkState, mkTask } from "./helpers.mjs";

const base = () => mkState({ tasks: [mkTask({ id: "t1", title: "Filter", lastDone: "2026-01-01", intervalDays: 30 })] });

test("edit a history entry's cost and notes", () => {
  let s = markDone(base(), "t1", "2026-02-01", { cost: 10, notes: "old" });
  const id = s.completions[0].id;
  s = updateCompletion(s, id, { cost: "12.5", notes: "new" });
  assert.equal(s.completions[0].cost, 12.5);
  assert.equal(s.completions[0].notes, "new");
  s = updateCompletion(s, id, { cost: "" });
  assert.equal(s.completions[0].cost, null);
  assert.throws(() => updateCompletion(s, id, { cost: "abc" }));
  assert.throws(() => updateCompletion(s, id, { notes: "x".repeat(2001) }));
  assert.throws(() => updateCompletion(s, "nope", { cost: 1 }));
});
test("deleting the latest entry puts the task back to the one before", () => {
  let s = markDone(base(), "t1", "2026-02-01", {});
  s = markDone(s, "t1", "2026-03-05", {});
  const latest = s.completions.find((c) => c.date === "2026-03-05").id;
  s = deleteCompletion(s, latest);
  assert.equal(s.completions.length, 1);
  assert.equal(s.tasks[0].lastDone, "2026-02-01");
});
test("deleting an older entry leaves the task alone; deleting the only one clears last done", () => {
  let s = markDone(base(), "t1", "2026-02-01", {});
  s = markDone(s, "t1", "2026-03-05", {});
  const older = s.completions.find((c) => c.date === "2026-02-01").id;
  s = deleteCompletion(s, older);
  assert.equal(s.tasks[0].lastDone, "2026-03-05");
  s = deleteCompletion(s, s.completions[0].id);
  assert.equal(s.tasks[0].lastDone, null);
});
test("a skipped entry can be removed and has no cost to edit", () => {
  let s = skipTask(base(), "t1", "2026-02-01");
  const id = s.completions[0].id;
  s = updateCompletion(s, id, { cost: 5 });
  assert.equal(s.completions[0].cost, null);
  s = deleteCompletion(s, id);
  assert.equal(s.completions.length, 0);
});
test("plural handles words ending in y", () => {
  assert.equal(p2(2, "supply"), "2 supplies");
  assert.equal(p2(1, "supply"), "1 supply");
  assert.equal(p2(2, "day"), "2 days");
});

import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
test("Today can group tasks by area", async () => {
  const doc = makeDocument();
  const store = { mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false };
  const s = mkState({ tasks: [
    mkTask({ id: "a", title: "Mow", category: "yard", lastDone: "2020-01-01", intervalDays: 30 }),
    mkTask({ id: "b", title: "Filter", category: "house", lastDone: "2020-01-01", intervalDays: 30 })] });
  await mount(doc, { store, state: s });
  const btn = doc.getElementById("main").querySelectorAll("button").find((b) => /Group by area/.test(b.textContent));
  assert.ok(btn, "group-by-area toggle exists");
  btn.click();
  await new Promise((r) => setTimeout(r, 10));
  const heads = doc.getElementById("main").querySelectorAll(".tf-group").map((x) => x.textContent);
  assert.ok(heads.some((t) => /House/.test(t)) && heads.some((t) => /Yard/.test(t)), heads.join("|"));
});
