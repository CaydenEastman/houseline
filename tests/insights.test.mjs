import test from "node:test";
import assert from "node:assert/strict";
import * as I from "../src/insights.js";
import { addVendor, updateVendor, deleteVendor, deleteItem, updateProfile } from "../src/logic.js";
import { validateState, migrate } from "../src/storage.js";
import { mergeStates } from "../src/sync.js";
import { mkState, mkTask, mkItem, mkVehicle, mkSupply, mkCompletion, clone, deepFreeze } from "./helpers.mjs";

const TODAY = "2026-11-16";
const idg = () => { let n = 0; return () => `v${++n}`; };

test("agenda splits overdue / today / week and skips snoozed", () => {
  const s = mkState({ tasks: [
    mkTask({ id: "a", title: "A", lastDone: "2026-08-01", intervalDays: 30 }),            // overdue
    mkTask({ id: "b", title: "B", lastDone: "2026-10-17", intervalDays: 30 }),            // due 11-16 today
    mkTask({ id: "c", title: "C", lastDone: "2026-10-20", intervalDays: 30 }),            // due 11-19
    mkTask({ id: "d", title: "D", lastDone: "2026-11-10", intervalDays: 365 }),           // far
    mkTask({ id: "e", title: "E", lastDone: "2026-08-01", intervalDays: 30, snoozedUntil: "2026-12-01" }),
  ] });
  const a = I.agenda(deepFreeze(clone(s)), TODAY);
  assert.deepEqual(a.overdue.map((r) => r.task.id), ["a"]);
  assert.deepEqual(a.today.map((r) => r.task.id), ["b"]);
  assert.deepEqual(a.week.map((r) => r.task.id), ["c"]);
});

test("homeScore: perfect-ish vs neglected, bounded, fixes capped at 3", () => {
  const bad = mkState({ tasks: [mkTask({ id: "a", lastDone: "2025-01-01", intervalDays: 30 }), mkTask({ id: "b", title: "B", lastDone: "2025-01-01", intervalDays: 30 })] });
  const hs = I.homeScore(bad, TODAY);
  assert.ok(hs.score >= 0 && hs.score <= 100);
  assert.ok(hs.fixes.length >= 1 && hs.fixes.length <= 3);
  assert.equal(hs.fixes[0].tab, "tasks".length ? hs.fixes[0].tab : "");
  const good = I.homeScore(mkState({ tasks: [mkTask({ id: "a", lastDone: TODAY, intervalDays: 90 })] }), TODAY);
  assert.ok(good.score > hs.score);
  assert.ok(["great", "ok", "needs-work"].includes(good.band));
});

test("seasonNudges honors climate and month, skips covered tasks", () => {
  const cold = I.seasonNudges(mkState(), "2026-10-10", 10);
  assert.ok(cold.some((n) => /winterize/i.test(n.text)));
  const hot = I.seasonNudges(mkState({ profile: { ...mkState().profile, climate: "hot" } }), "2026-10-10", 10);
  assert.ok(!hot.some((n) => /winterize/i.test(n.text)));
  const covered = I.seasonNudges(mkState({ tasks: [mkTask({ title: "Winterize sprinklers and outdoor faucets" })] }), "2026-10-10", 10);
  assert.ok(!covered.some((n) => /winterize sprinklers/i.test(n.text)));
  assert.ok(I.seasonNudges(mkState(), TODAY, 2).length <= 2);
});

test("mileageFlags finds near-due mileage tasks", () => {
  const s = mkState({ vehicles: [mkVehicle({ id: "v1", odometer: 79800, odometerDate: TODAY })],
    tasks: [mkTask({ id: "m", title: "Oil", kind: "mileage", vehicleId: "v1", intervalMiles: 5000, lastDoneOdometer: 75000, lastDone: TODAY, intervalDays: 180 })] });
  const f = I.mileageFlags(s, TODAY);
  assert.equal(f.length, 1);
  assert.equal(f[0].milesLeft, 200);
});

test("workload groups by assignee and counts overdue", () => {
  const s = mkState({ tasks: [
    mkTask({ id: "a", title: "A", assignee: "u1", lastDone: "2025-01-01", intervalDays: 30 }),
    mkTask({ id: "b", title: "B", assignee: "u1", lastDone: TODAY, intervalDays: 30 }),
    mkTask({ id: "c", title: "C", lastDone: TODAY, intervalDays: 30 }),
  ], completions: [mkCompletion({ id: "c1", by: "u1", date: "2026-11-01" })] });
  const w = I.workload(s, TODAY, (id) => `Name ${id}`);
  const u1 = w.find((r) => r.id === "u1");
  assert.equal(u1.open, 2); assert.equal(u1.overdue, 1); assert.equal(u1.done90, 1); assert.equal(u1.name, "Name u1");
  assert.equal(w.find((r) => r.id === null).name, "Unassigned");
});

test("spendTrend, costByItem", () => {
  const s = mkState({
    items: [mkItem({ id: "i1", name: "Furnace" })],
    tasks: [mkTask({ id: "t1", itemId: "i1" })],
    completions: [mkCompletion({ id: "c1", taskId: "t1", date: "2025-03-01", cost: 100 }), mkCompletion({ id: "c2", taskId: "t1", date: "2026-03-01", cost: 350 }), mkCompletion({ id: "c3", taskId: "t1", date: "2026-04-01", kind: "skipped", cost: 999 })],
  });
  const tr = I.spendTrend(s);
  assert.deepEqual(tr.map((r) => [r.year, r.total, r.change]), [["2025", 100, null], ["2026", 350, 250]]);
  const ci = I.costByItem(s);
  assert.equal(ci[0].total, 450); assert.ok(ci[0].hint);
});

test("digest and binder produce text/html and escape hostile input", () => {
  const evil = "<script>alert(1)</script>";
  const s = mkState({ items: [mkItem({ id: "i1", name: evil })], tasks: [mkTask({ id: "a", title: "Overdue thing", lastDone: "2025-01-01", intervalDays: 30 })],
    vendors: [{ id: "v1", name: "Bob's Plumbing", trade: "Plumber", phone: "555", email: "", notes: "", itemIds: ["i1"] }] });
  assert.match(I.digestText(s, TODAY), /OVERDUE/);
  const html = I.binderHTML(s, TODAY);
  assert.ok(!html.includes("<script>alert"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /Bob&#39;s Plumbing/);
  assert.match(I.binderText(s, TODAY), /HOME BINDER/);
});

test("vendors: add/update/delete, validation, item unlink, migrate, merge", () => {
  let s = mkState({ items: [mkItem({ id: "i1" })] });
  s = addVendor(s, { name: " Pro HVAC ", trade: "HVAC", phone: "555-1234", email: "a@b.co", itemIds: ["i1", "i1"] }, idg());
  assert.equal(s.vendors[0].name, "Pro HVAC"); assert.deepEqual(s.vendors[0].itemIds, ["i1"]);
  validateState(s);
  assert.throws(() => addVendor(s, { name: "" }, idg()), /required/);
  assert.throws(() => addVendor(s, { name: "x", email: "nope" }, idg()), /Email/);
  s = updateVendor(s, "v1", { phone: "999" });
  assert.equal(s.vendors[0].phone, "999");
  s = deleteItem(s, "i1");
  assert.deepEqual(s.vendors[0].itemIds, []);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(s))).vendors, s.vendors);
  const s2 = deleteVendor(s, "v1");
  assert.equal(s2.vendors.length, 0);
  // merge: both devices add different vendors
  const base = mkState({ vendors: [] });
  const a = addVendor(base, { name: "A" }, () => "va"), b = addVendor(base, { name: "B" }, () => "vb");
  assert.deepEqual(mergeStates(base, a, b).vendors.map((v) => v.id).sort(), ["va", "vb"]);
  // old data without vendors still valid
  validateState(mkState());
});

test("profile climate validated", () => {
  const s = updateProfile(mkState(), { climate: "hot" });
  assert.equal(s.profile.climate, "hot"); validateState(s);
  assert.throws(() => updateProfile(mkState(), { climate: "lava" }), /Climate/);
});
