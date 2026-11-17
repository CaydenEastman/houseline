import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH } from "../src/dom.js";
import today from "../src/views/today.js";
import insights from "../src/views/insights.js";
import vendors from "../src/views/vendors.js";
import calendar, { resetCalendarView } from "../src/views/calendar.js";
import { mkState, mkTask, mkItem, mkCompletion } from "./helpers.mjs";

function setup(view, state, extra = {}) {
  const doc = makeDocument();
  const container = doc.createElement("div");
  const calls = { done: [], commits: [], views: [] };
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => state, today: () => "2026-11-16",
    completeTask: (id) => calls.done.push(id), openTaskForm() {}, saveFile: async () => false, toast() {},
    commit: (next, msg) => { calls.commits.push({ next, msg }); return true; }, setView: (id) => calls.views.push(id), personName: (id) => `P-${id}`, ...extra };
  view.render(container, ctx);
  return { container, ctx, calls, rerender: () => view.render(container, ctx) };
}
const btn = (c, pred) => [...c.querySelectorAll("button")].find(pred);

test("Today: score, overdue group with Done, fixes navigate", () => {
  const s = mkState({ tasks: [mkTask({ id: "a", title: "Fix gutters", lastDone: "2025-01-01", intervalDays: 30 })] });
  const { container, calls } = setup(today, s);
  assert.ok(container.textContent.includes("Home score"));
  assert.ok(container.textContent.includes("1 overdue"));
  btn(container, (b) => (b.getAttribute("aria-label") || "") === "Done: Fix gutters").click();
  assert.deepEqual(calls.done, ["a"]);
  btn(container, (b) => b.getAttribute("data-fk") === "v-fix-0").click();
  assert.equal(calls.views.length, 1);
});
test("Today: empty week shows clear message", () => {
  const { container } = setup(today, mkState());
  assert.ok(container.textContent.includes("You're clear for the week"));
});
test("Insights: renders with data and offers digest/binder buttons", () => {
  const s = mkState({ tasks: [mkTask({ id: "a", assignee: "u1" })], completions: [mkCompletion({ id: "c1", date: "2026-03-01", cost: 120 })] });
  const { container } = setup(insights, s);
  assert.ok(container.textContent.includes("Who has what"));
  assert.ok(container.textContent.includes("P-u1"));
  assert.ok(container.textContent.includes("$120.00"));
  assert.ok(btn(container, (b) => /binder/i.test(b.textContent)));
  assert.ok(btn(container, (b) => /digest/i.test(b.textContent)));
});
test("Insights: blocked downloads fall back to text area", async () => {
  const { container } = setup(insights, mkState());
  btn(container, (b) => /Download home binder/.test(b.textContent)).click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(container.querySelector("#v-ex-area") || container.textContent.includes("Downloads are blocked"));
});
test("Vendors: empty state, add form saves through commit", () => {
  const { container, calls } = setup(vendors, mkState({ items: [mkItem({ id: "i1", name: "Furnace" })] }));
  assert.ok(container.textContent.includes("No contacts yet"));
  btn(container, (b) => b.textContent === "+ Add contact").click();
  const name = container.querySelector("#v-vf-name");
  name.value = "Ace Plumbing"; name.dispatchEvent({ type: "input", bubbles: true, target: name, preventDefault() {} });
  const form = container.querySelector("form");
  form.dispatchEvent({ type: "submit", bubbles: false, target: form, preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].next.vendors[0].name, "Ace Plumbing");
});
test("Vendors: bad email shows an error, no commit", () => {
  const { container, calls } = setup(vendors, mkState());
  btn(container, (b) => b.textContent === "+ Add contact").click();
  const set = (sel, v) => { const el = container.querySelector(sel); el.value = v; el.dispatchEvent({ type: "input", bubbles: true, target: el, preventDefault() {} }); };
  set("#v-vf-name", "X"); set("#v-vf-email", "nope");
  const form = container.querySelector("form");
  form.dispatchEvent({ type: "submit", bubbles: false, target: form, preventDefault() {}, stopPropagation() {} });
  assert.equal(calls.commits.length, 0);
  assert.ok(container.textContent.includes("Email"));
});
test("Calendar: Move snoozes a task to a later day", () => {
  resetCalendarView();
  const s = mkState({ tasks: [mkTask({ id: "a", title: "Change filter", lastDone: "2026-08-24", intervalDays: 100 })] }); // due 2026-12-02
  const { container, calls } = setup(calendar, s);
  [...container.querySelectorAll("[data-day]")].find((b) => b.getAttribute("data-day") === "2026-12-02").click();
  const inp = container.querySelector('input[type="date"]');
  inp.value = "2026-12-20";
  btn(container, (b) => (b.getAttribute("aria-label") || "") === "Move Change filter").click();
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].next.tasks[0].snoozedUntil, "2026-12-20");
});
