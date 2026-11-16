import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH } from "../src/dom.js";
import view, { resetCalendarView } from "../src/views/calendar.js";
import { mkState, mkTask, mkItem } from "./helpers.mjs";

function setup(state, extra = {}) {
  resetCalendarView();
  const doc = makeDocument();
  const container = doc.createElement("div");
  const calls = { done: [], edit: [] };
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => state, today: () => "2026-11-16",
    completeTask: (id) => calls.done.push(id), openTaskForm: (t) => calls.edit.push(t.id), saveFile: async () => false, toast() {}, ...extra };
  view.render(container, ctx);
  return { container, ctx, calls };
}
const days = (c) => c.querySelectorAll("[data-day]");

test("renders a month grid with Export heading below", () => {
  const { container } = setup(mkState({ tasks: [mkTask({ id: "a", title: "Gutters", lastDone: "2026-08-01", intervalDays: 100 })] }));
  const n = days(container).length;
  assert.ok(n === 35 || n === 42, `cells ${n}`);
  assert.ok(container.textContent.includes("November 2026"));
  assert.ok(container.textContent.includes("Export to your calendar"));
});
test("day cells carry accessible labels and one is tabbable", () => {
  const { container } = setup(mkState());
  const list = [...days(container)];
  assert.ok(list.every((b) => (b.getAttribute("aria-label") || "").length > 0));
  assert.equal(list.filter((b) => b.getAttribute("tabindex") === "0").length, 1);
});
test("selecting a day lists its tasks with Done and Edit", () => {
  const state = mkState({ tasks: [mkTask({ id: "a", title: "Change filter", lastDone: "2026-08-24", intervalDays: 100 })] }); // due 2026-12-02
  const { container, calls } = setup(state);
  const cell = [...days(container)].find((b) => b.getAttribute("data-day") === "2026-12-02");
  assert.ok(cell, "Dec 2 in grid");
  cell.click();
  assert.ok(container.textContent.includes("Change filter"));
  const btns = [...container.querySelectorAll("button")];
  btns.find((b) => (b.getAttribute("aria-label") || "").startsWith("Done:")).click();
  assert.deepEqual(calls.done, ["a"]);
});
test("Next and Prev change the month", () => {
  const { container } = setup(mkState());
  [...container.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Next month").click();
  assert.ok(container.textContent.includes("December 2026"));
});
test("warranty shows on its day", () => {
  const { container } = setup(mkState({ items: [mkItem({ id: "i1", name: "Roof", warrantyExpires: "2026-11-25" })] }));
  [...days(container)].find((b) => b.getAttribute("data-day") === "2026-11-25").click();
  assert.ok(container.textContent.includes("Warranty ends: Roof"));
});
