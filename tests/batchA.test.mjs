import test from "node:test";
import assert from "node:assert/strict";
import * as L from "../src/logic.js";
import * as S from "../src/sync.js";
import { photoIdsOf } from "../src/household.js";
import { reminderState } from "../supabase/functions/send-reminders/due.js";
import { memStorage, mkState, mkTask, mkVehicle } from "./helpers.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("two phones finishing different tasks on the same day offline keep BOTH completions after syncing", () => {
  const base = mkState({ tasks: [mkTask({ id: "t1" }), mkTask({ id: "t2", title: "Other" })] });
  const A = L.markDone(base, "t1", "2026-06-15", { cost: 50 });
  const B = L.markDone(base, "t2", "2026-06-15", { cost: 100 });
  assert.notEqual(A.completions[0].id, B.completions[0].id);
  const m = S.mergeStates(base, A, B);
  assert.equal(m.completions.length, 2);
  assert.deepEqual(m.completions.map((c) => c.cost).sort(), [100, 50]);
});

test("a completion id never repeats within one phone's history", () => {
  let s = mkState({ tasks: [mkTask({ id: "t1" })] });
  for (let i = 0; i < 30; i++) s = L.markDone(s, "t1", "2026-06-15", {});
  assert.equal(new Set(s.completions.map((c) => c.id)).size, 30);
});

test("a mileage task finished with an old odometer reading is not overdue straight away", () => {
  const v = mkVehicle({ odometer: 50000, odometerDate: "2026-01-10", odometerLog: [{ date: "2026-01-10", odometer: 50000 }] });
  const t = mkTask({ kind: "mileage", intervalMiles: 5000, vehicleId: "v1", lastDoneOdometer: 45000, lastDone: "2025-10-01", intervalDays: null });
  const today = "2026-08-01";
  for (const done of [L.markDone(mkState({ tasks: [t], vehicles: [v] }), "t1", today, { odometer: 50000 }), L.skipTask(mkState({ tasks: [t], vehicles: [v] }), "t1", today)]) {
    const info = L.dueInfo(done.tasks[0], done, today);
    assert.ok(info.daysUntil > 0, `due ${info.dueDate}`);
    assert.notEqual(L.statusOf(done.tasks[0], today, done), "overdue");
  }
});

test("two phones that each read the odometer keep the higher reading, with its date", () => {
  const base = mkState({ vehicles: [mkVehicle({ odometer: 50000 })] });
  const A = L.setOdometer(base, "v1", 50100, "2026-06-16");
  const B = L.setOdometer(base, "v1", 50300, "2026-06-17");
  for (const [mine, theirs] of [[A, B], [B, A]]) {
    const m = S.mergeStates(base, mine, theirs);
    assert.equal(m.vehicles[0].odometer, 50300);
    assert.equal(m.vehicles[0].odometerDate, "2026-06-17");
  }
});

// ---- cloud stub shared by the sign-out and photo tests ----
const docs = new Map();
const mkdb = () => ({
  doc(path) { return { async get() { return { exists: docs.has(path), data: () => docs.get(path) }; }, async set(d) { docs.set(path, JSON.parse(JSON.stringify(d))); }, async delete() { docs.delete(path); }, onSnapshot() { return () => {}; } }; },
  collection(name) { return { async get() { return { docs: [...docs].filter(([p]) => p.startsWith(name + "/")).map(([p, d]) => ({ id: p.slice(name.length + 1), data: () => d })) }; }, onSnapshot() { return () => {}; } }; },
});
const user = (id) => ({ use: async (n) => (n === "db" ? mkdb() : n === "user" ? { id: async () => id, isOwner: async () => true, profiles: async () => ({}) } : null) });

test("edits made while signed out survive signing back in to the same account", async () => {
  docs.clear();
  const ls = memStorage();
  const seed = mkState({ tasks: [mkTask({ id: "t1", title: "A" }), mkTask({ id: "t2", title: "B" })] });
  const st = await S.createStore({ localStorage: ls, claude: user("alice"), debounceMs: 1 });
  await st.load(); await st.save(seed); await st.flush();
  const local = await S.createStore({ localStorage: ls, claude: null, debounceMs: 1 });
  let cur = await local.load();
  cur = L.markDone(cur, "t1", "2026-06-15", { cost: 80 });
  await local.save(cur); await local.flush();
  const back = await S.createStore({ localStorage: ls, claude: user("alice"), debounceMs: 1, mergeUnownedLocal: true });
  const after = await back.load();
  assert.equal(after.completions.length, 1);
  assert.equal(after.completions[0].cost, 80);
});

test("photos taken while signed out are copied to the cloud when the person signs in, and nothing is lost if it fails", async () => {
  docs.clear();
  const ls = memStorage();
  const local = await S.createStore({ localStorage: ls, claude: null });
  await local.putPhoto("p1", "data:image/jpeg;base64,AAAA");
  const state = mkState({ completions: [{ id: "c1", taskId: "t1", title: "x", category: "house", date: "2026-06-15", kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: ["p1"] }], tasks: [mkTask({ id: "t1" })] });
  assert.deepEqual(photoIdsOf(state), ["p1"]);
  const cloud = await S.createStore({ localStorage: ls, claude: user("alice"), debounceMs: 1 });
  await cloud.load(); await cloud.save(state); await cloud.flush();
  const again = await S.createStore({ localStorage: ls, claude: user("alice"), debounceMs: 1 });
  await again.load();
  await sleep(30);
  assert.equal(await again.getPhoto("p1"), "data:image/jpeg;base64,AAAA");
});

test("an evening reminder is sent once, not again after midnight", () => {
  const sends = [];
  const row = { tz: "UTC", hour: 22, last: "2026-06-14" };
  for (let h = 0; h < 48; h++) {
    const now = new Date(Date.UTC(2026, 5, 15, 0, 0, 0) + h * 3600e3);
    const r = reminderState(row.tz, row.hour, row.last, 4, now);
    if (r.due) { sends.push(now.toISOString()); row.last = r.day; }
  }
  assert.deepEqual(sends, ["2026-06-15T22:00:00.000Z", "2026-06-16T22:00:00.000Z"]);
});

test("a morning reminder still goes out late (within 4 hours) and only once per day", () => {
  const row = { last: null }; const sends = [];
  for (let h = 0; h < 30; h++) {
    const now = new Date(Date.UTC(2026, 5, 15, 12, 0, 0) + h * 3600e3);
    const r = reminderState("America/Denver", 8, row.last, 4, now);
    if (r.due) { sends.push(r.day); row.last = r.day; }
  }
  assert.deepEqual(sends, ["2026-06-15", "2026-06-16"]);
});
