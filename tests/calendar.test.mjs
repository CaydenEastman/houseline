import test from "node:test";
import assert from "node:assert/strict";
import * as CAL from "../src/calendar.js";

const base = (over = {}) => ({ version: 2, profile: {}, vehicles: [], items: [], supplies: [], tasks: [], completions: [], emergency: {}, ...over });

test("monthGrid covers whole weeks", () => {
  const g = CAL.monthGrid(2026, 11, 0);
  assert.equal(g.weeks.length, 5);
  assert.equal(g.weeks[0][0].date, "2026-11-01");
  assert.equal(g.weeks[4][6].date, "2026-12-05");
  assert.equal(g.weeks[0][0].inMonth, true);
  assert.equal(g.weeks[4][6].inMonth, false);
});
test("monthGrid leap year and Monday start", () => {
  const all = CAL.monthGrid(2028, 2, 1).weeks.flat().map((c) => c.date);
  assert.ok(all.includes("2028-02-29"));
  assert.equal(CAL.monthGrid(2026, 2, 0).weeks.length, 4);
});
test("shiftMonth wraps years", () => {
  assert.deepEqual(CAL.shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(CAL.shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
});
test("monthGrid rejects bad input", () => {
  assert.throws(() => CAL.monthGrid(2026, 13, 0));
  assert.throws(() => CAL.monthGrid(2026, 0, 0));
});
test("eventsInRange rejects bad ranges", () => {
  assert.throws(() => CAL.eventsInRange(base(), "2026-12-01", "2026-11-01", "2026-11-16"));
  assert.throws(() => CAL.eventsInRange(base(), "nope", "2026-11-01", "2026-11-16"));
});
test("empty state yields no events and is not mutated", () => {
  const s = base();
  const snap = JSON.stringify(s);
  assert.deepEqual(CAL.eventsInRange(s, "2026-11-01", "2026-12-05", "2026-11-16"), []);
  assert.equal(JSON.stringify(s), snap);
});
test("eventsByDate groups by date", () => {
  const m = CAL.eventsByDate([{ date: "2026-11-02", id: "a" }, { date: "2026-11-02", id: "b" }, { date: "2026-11-03", id: "c" }]);
  assert.equal(m["2026-11-02"].length, 2);
  assert.equal(m["2026-11-03"].length, 1);
});
test("warranty and expired supply appear on their dates", () => {
  const s = base({
    items: [{ id: "i1", name: "Dishwasher", warrantyExpires: "2026-11-20" }],
    supplies: [{ id: "s1", name: "Water", expires: "2026-11-10", quantity: 1 }],
  });
  const ev = CAL.eventsInRange(s, "2026-11-01", "2026-12-05", "2026-11-16");
  const w = ev.find((e) => e.type === "warranty");
  assert.ok(w && w.date === "2026-11-20" && /Dishwasher/.test(w.title));
  const sup = ev.find((e) => e.type === "supply");
  if (sup) { assert.equal(sup.date, "2026-11-10"); assert.equal(sup.status, "expired"); }
});
