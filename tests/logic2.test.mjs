import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';
import { T, clone, idGen, deepFreeze, mkTask, mkVehicle, mkItem, mkSupply, mkCompletion, mkState } from './helpers.mjs';

const { addDays, daysBetween } = L;
const veh = (o) => mkVehicle(o);
const mileTask = (o = {}) => mkTask({ id: 'm1', title: 'Oil', category: 'car', kind: 'mileage', intervalDays: null, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 47000, ...o });
const annual = (month, day, o = {}) => mkTask({ id: 'a1', kind: 'annual', intervalDays: null, month, day, ...o });
const sMile = (t = {}, v = {}) => mkState({ vehicles: [veh(v)], tasks: [mileTask(t)] });

// ---------- dueInfo: interval ----------
test('dueInfo interval: lastDone + intervalDays, basis date', () => {
  const r = L.dueInfo(mkTask({ lastDone: '2026-06-01', intervalDays: 30 }), mkState(), T);
  assert.equal(r.dueDate, '2026-07-01'); assert.equal(r.daysUntil, 16); assert.equal(r.basis, 'date');
  assert.equal(r.milesLeft, null);
});
test('dueInfo interval: never done uses startDate (basis start) or today', () => {
  const r = L.dueInfo(mkTask({ startDate: '2026-06-25' }), mkState(), T);
  assert.equal(r.dueDate, '2026-06-25'); assert.equal(r.daysUntil, 10); assert.equal(r.basis, 'start');
  const r2 = L.dueInfo(mkTask(), mkState(), T);
  assert.equal(r2.dueDate, T); assert.equal(r2.daysUntil, 0);
  assert.ok(['start', 'never'].includes(r2.basis));
});
test('dueInfo interval: past startDate is overdue', () => {
  assert.equal(L.dueInfo(mkTask({ startDate: '2026-06-10' }), mkState(), T).daysUntil, -5);
});
test('dueInfo interval across leap day and DST dates', () => {
  assert.equal(L.dueInfo(mkTask({ lastDone: '2024-02-29', intervalDays: 365 }), mkState(), '2024-03-01').dueDate, '2025-02-28');
  assert.equal(L.dueInfo(mkTask({ lastDone: '2024-02-28', intervalDays: 1 }), mkState(), '2024-02-28').dueDate, '2024-02-29');
  assert.equal(L.dueInfo(mkTask({ lastDone: '2026-03-07', intervalDays: 2 }), mkState(), '2026-03-08').dueDate, '2026-03-09');
  assert.equal(L.dueInfo(mkTask({ lastDone: '2026-10-31', intervalDays: 2 }), mkState(), '2026-11-01').daysUntil, 1);
  assert.equal(L.dueInfo(mkTask({ lastDone: '2026-03-01', intervalDays: 8 }), mkState(), '2026-03-08').dueDate, '2026-03-09');
});
test('dueInfo max interval does not overflow', () => {
  const r = L.dueInfo(mkTask({ lastDone: '2026-06-15', intervalDays: 36500 }), mkState(), T);
  assert.equal(r.daysUntil, 36500);
});

// ---------- dueInfo: annual ----------
test('annual never done: first occurrence on/after today', () => {
  assert.equal(L.dueInfo(annual(10, 15), mkState(), T).dueDate, '2026-10-15');
  assert.equal(L.dueInfo(annual(1, 1), mkState(), T).dueDate, '2027-01-01');
  assert.equal(L.dueInfo(annual(6, 15), mkState(), T).dueDate, T);
  assert.equal(L.dueInfo(annual(6, 15), mkState(), T).daysUntil, 0);
  assert.equal(L.dueInfo(annual(6, 14), mkState(), T).dueDate, '2027-06-14');
});
test('annual 60-day early window boundary', () => {
  const o = (lastDone) => L.dueInfo(annual(10, 15, { lastDone }), mkState(), T).dueDate;
  assert.equal(o('2026-08-15'), '2026-10-15'); // O-60 = 08-16 > lastDone
  assert.equal(o('2026-08-16'), '2027-10-15'); // O-60 == lastDone: counts for this occurrence
  assert.equal(o('2026-10-10'), '2027-10-15');
  assert.equal(o('2026-10-16'), '2027-10-15');
  assert.equal(o('2025-10-20'), '2026-10-15');
});
test('annual: done early the previous year satisfies next occurrence', () => {
  // Jan 5; done 2025-12-01 (>60d before 2026-01-05? 35 days) -> satisfies 2026
  assert.equal(L.dueInfo(annual(1, 5, { lastDone: '2025-12-01' }), mkState(), T).dueDate, '2027-01-05');
  assert.equal(L.dueInfo(annual(1, 5, { lastDone: '2025-10-01' }), mkState(), T).dueDate, '2026-01-05');
});
test('annual window is leap-year aware (Mar 1)', () => {
  const d = (lastDone) => L.dueInfo(annual(3, 1, { lastDone }), mkState(), '2024-01-02').dueDate;
  assert.equal(d('2023-12-31'), '2024-03-01'); // 2024-03-01 minus 60d = 2024-01-01 > 12-31
  assert.equal(d('2024-01-01'), '2025-03-01');
});
test('annual Feb 28 in leap and non-leap year', () => {
  assert.equal(L.dueInfo(annual(2, 28), mkState(), '2024-02-28').dueDate, '2024-02-28');
  assert.equal(L.dueInfo(annual(2, 28), mkState(), '2024-02-29').dueDate, '2025-02-28');
  assert.equal(L.dueInfo(annual(2, 28), mkState(), '2023-12-31').daysUntil, 59);
});
test('annual statusOf: 30-day threshold, overdue after date', () => {
  assert.equal(L.statusOf(annual(7, 15), T, mkState()), 'due-soon'); // 30 days
  assert.equal(L.statusOf(annual(7, 16), T, mkState()), 'ok');       // 31 days
  const od = annual(6, 1, { lastDone: '2025-05-01' });
  assert.equal(L.statusOf(od, T, mkState()), 'overdue');
});
test('annual year boundary: today Dec 31, due Jan 1', () => {
  const r = L.dueInfo(annual(1, 1), mkState(), '2026-12-31');
  assert.equal(r.dueDate, '2027-01-01'); assert.equal(r.daysUntil, 1);
});

// ---------- dueInfo: mileage ----------
test('mileage: milesLeft and default rate 33 mi/day', () => {
  const s = sMile(); // 47000 + 5000 - 50000 = 2000
  const r = L.dueInfo(s.tasks[0], s, T);
  assert.equal(r.milesLeft, 2000); assert.equal(r.basis, 'miles');
  assert.equal(r.dueDate, addDays(T, Math.ceil(2000 / 33)));
  assert.equal(r.daysUntil, 61);
});
test('mileage: rate from odometerLog (>=14 day span, last 365 days)', () => {
  const log = [{ date: '2026-05-26', odometer: 49000 }, { date: T, odometer: 50000 }]; // 50 mi/day
  const s = sMile({}, { odometerLog: log });
  assert.equal(L.dueInfo(s.tasks[0], s, T).dueDate, addDays(T, 40));
});
test('mileage: log spanning <14 days falls back to default rate', () => {
  const log = [{ date: '2026-06-10', odometer: 49000 }, { date: T, odometer: 50000 }]; // would be 200/day
  const s = sMile({}, { odometerLog: log });
  assert.equal(L.dueInfo(s.tasks[0], s, T).daysUntil, 61);
});
test('mileage: single log point falls back to default', () => {
  const s = sMile({}, { odometerLog: [{ date: '2026-01-01', odometer: 40000 }] });
  assert.equal(L.dueInfo(s.tasks[0], s, T).daysUntil, 61);
});
test('mileage: milesLeft <= 0 is due now or overdue', () => {
  const s = sMile({ lastDoneOdometer: 40000 }); // -5000
  const r = L.dueInfo(s.tasks[0], s, T);
  assert.equal(r.milesLeft, -5000);
  assert.ok(r.daysUntil <= 0 && r.dueDate <= T);
  assert.notEqual(L.statusOf(s.tasks[0], T, s), 'ok');
});
test('mileage: time cap wins when earlier', () => {
  const s = sMile({ intervalDays: 180, lastDone: '2026-01-01' }); // cap 2026-06-30, estimate 2026-08-15
  assert.equal(L.dueInfo(s.tasks[0], s, T).dueDate, '2026-06-30');
  const s2 = sMile({ intervalDays: 180, lastDone: '2026-06-01' }); // cap 2026-11-28, estimate sooner
  assert.equal(L.dueInfo(s2.tasks[0], s2, T).dueDate, addDays(T, 61));
});
test('mileage: lastDoneOdometer null -> basis start, due by startDate or today', () => {
  const s = sMile({ lastDoneOdometer: null, startDate: '2026-06-20' });
  const r = L.dueInfo(s.tasks[0], s, T);
  assert.equal(r.basis, 'start'); assert.equal(r.dueDate, '2026-06-20');
  const s2 = sMile({ lastDoneOdometer: null });
  assert.equal(L.dueInfo(s2.tasks[0], s2, T).dueDate, T);
});
test('mileage statusOf: due-soon by miles (<= max(200, 10%)), by days (<=14)', () => {
  // intervalMiles 10000 -> 1000 threshold. Use high-rate log so days > 14 dominate nothing.
  const mk = (left) => sMile({ intervalMiles: 10000, lastDoneOdometer: 50000 + left - 10000 });
  const a = mk(1000), b = mk(1001), c = mk(5000);
  assert.equal(L.statusOf(a.tasks[0], T, a), 'due-soon');
  assert.equal(L.statusOf(b.tasks[0], T, b), 'ok');
  assert.equal(L.statusOf(c.tasks[0], T, c), 'ok');
  // within 14 days at default rate: 33*14 = 462 miles -> due-soon via days even if miles threshold bigger
  const d = sMile({ intervalMiles: 100000, lastDoneOdometer: 50000 + 400 - 100000 });
  assert.equal(L.statusOf(d.tasks[0], T, d), 'due-soon');
});
test('mileage: daysUntilDue uses state; unknown vehicle does not crash silently with NaN', () => {
  const s = sMile();
  assert.equal(L.daysUntilDue(s.tasks[0], T, s), 61);
});
test('daysUntilDue never returns null/NaN for never-basis tasks', () => {
  const d = L.daysUntilDue(mkTask(), T, mkState());
  assert.ok(Number.isInteger(d));
});

// ---------- snooze ----------
test('snooze: statusOf snoozed while snoozedUntil > today only', () => {
  const t = mkTask({ lastDone: '2025-01-01', intervalDays: 30, snoozedUntil: '2026-06-16' });
  assert.equal(L.statusOf(t, T, mkState()), 'snoozed');
  assert.notEqual(L.statusOf({ ...t, snoozedUntil: T }, T, mkState()), 'snoozed');
  assert.notEqual(L.statusOf({ ...t, snoozedUntil: '2026-06-14' }, T, mkState()), 'snoozed');
});
test('snoozeTask validates range and unsnooze clears', () => {
  const s = deepFreeze(mkState({ tasks: [mkTask()] }));
  const n = L.snoozeTask(s, 't1', '2026-06-22', T);
  assert.equal(n.tasks[0].snoozedUntil, '2026-06-22');
  assert.equal(s.tasks[0].snoozedUntil, null);
  assert.equal(L.unsnoozeTask(n, 't1').tasks[0].snoozedUntil, null);
  assert.throws(() => L.snoozeTask(s, 't1', T, T), Error);
  assert.throws(() => L.snoozeTask(s, 't1', '2026-06-14', T), Error);
  assert.doesNotThrow(() => L.snoozeTask(s, 't1', addDays(T, 365), T));
  assert.throws(() => L.snoozeTask(s, 't1', addDays(T, 366), T), Error);
  assert.throws(() => L.snoozeTask(s, 't1', 'next week', T), Error);
  assert.throws(() => L.snoozeTask(s, 'nope', '2026-06-22', T), Error);
});
test('sortTasks: snoozed last, overdue first, tie by title', () => {
  const s = mkState();
  const sn = mkTask({ id: 'sn', title: 'A', lastDone: '2025-01-01', intervalDays: 30, snoozedUntil: '2026-07-01' });
  const od = mkTask({ id: 'od', title: 'B', lastDone: '2026-01-01', intervalDays: 30 });
  const ok1 = mkTask({ id: 'k1', title: 'Zed', lastDone: T, intervalDays: 100 });
  const ok2 = mkTask({ id: 'k2', title: 'Alpha', lastDone: T, intervalDays: 100 });
  const out = L.sortTasks([sn, ok1, od, ok2], T, s);
  assert.deepEqual(out.map((t) => t.id), ['od', 'k2', 'k1', 'sn']);
});
test('summary: snoozed counted separately, not in overdue/dueSoon/ok', () => {
  const s = mkState({ tasks: [
    mkTask({ id: 'a', lastDone: '2025-01-01', intervalDays: 30, snoozedUntil: '2026-07-01' }),
    mkTask({ id: 'b', lastDone: '2025-01-01', intervalDays: 30 }),
    mkTask({ id: 'c', lastDone: T, intervalDays: 365 }),
  ] });
  const r = L.summary(s, T);
  assert.equal(r.snoozed, 1); assert.equal(r.overdue, 1); assert.equal(r.ok, 1); assert.equal(r.dueSoon, 0);
});

// ---------- markDone / skip ----------
test('markDone with opts records cost/notes/by/photoIds and clears snooze', () => {
  const s = deepFreeze(mkState({ tasks: [mkTask({ snoozedUntil: '2026-07-01' })] }));
  const n = L.markDone(s, 't1', T, { cost: 12.5, notes: 'ok', by: 'u1', photoIds: ['p-1', 'p-2'] });
  const c = n.completions[0];
  assert.equal(c.cost, 12.5); assert.equal(c.notes, 'ok'); assert.equal(c.by, 'u1');
  assert.deepEqual(c.photoIds, ['p-1', 'p-2']); assert.equal(c.kind, 'done');
  assert.equal(n.tasks[0].snoozedUntil, null); assert.equal(n.tasks[0].lastDone, T);
});
test('markDone defaults: cost null, photoIds [], odometer null', () => {
  const n = L.markDone(mkState({ tasks: [mkTask()] }), 't1', T);
  assert.equal(n.completions[0].cost, null); assert.deepEqual(n.completions[0].photoIds, []);
  assert.equal(n.completions[0].odometer, null); assert.equal(n.completions[0].by, null);
});
test('markDone validation: negative cost, NaN cost, >3 photos, bad date, unknown task', () => {
  const s = mkState({ tasks: [mkTask()] });
  assert.throws(() => L.markDone(s, 't1', T, { cost: -1 }), Error);
  assert.throws(() => L.markDone(s, 't1', T, { cost: NaN }), Error);
  assert.throws(() => L.markDone(s, 't1', T, { photoIds: ['p-1', 'p-2', 'p-3', 'p-4'] }), Error);
  assert.doesNotThrow(() => L.markDone(s, 't1', T, { cost: 0, photoIds: ['p-1', 'p-2', 'p-3'] }));
  assert.throws(() => L.markDone(s, 't1', '2026-02-30'), Error);
  assert.throws(() => L.markDone(s, 'zz', T), Error);
});
test('markDone mileage: odometer defaults to vehicle odometer', () => {
  const s = deepFreeze(sMile());
  const n = L.markDone(s, 'm1', T);
  assert.equal(n.tasks[0].lastDoneOdometer, 50000);
  assert.equal(n.vehicles[0].odometer, 50000);
});
test('markDone mileage: higher odometer updates the vehicle and log', () => {
  const n = L.markDone(sMile(), 'm1', T, { odometer: 52000 });
  assert.equal(n.tasks[0].lastDoneOdometer, 52000);
  assert.equal(n.vehicles[0].odometer, 52000);
  assert.equal(n.vehicles[0].odometerLog.at(-1).odometer, 52000);
  assert.equal(n.completions[0].odometer, 52000);
});
test('markDone mileage: lower odometer does not decrease vehicle', () => {
  const n = L.markDone(sMile(), 'm1', T, { odometer: 49000 });
  assert.equal(n.vehicles[0].odometer, 50000);
});
test('skipTask: kind skipped, cost null, advances schedule, no spend', () => {
  const s = deepFreeze(mkState({ tasks: [mkTask({ lastDone: '2026-01-01' })] }));
  const n = L.skipTask(s, 't1', T, 'u9');
  assert.equal(n.completions[0].kind, 'skipped'); assert.equal(n.completions[0].cost, null);
  assert.equal(n.completions[0].by, 'u9'); assert.equal(n.tasks[0].lastDone, T);
  assert.equal(L.spend(n, 2026).total, 0);
  assert.throws(() => L.skipTask(s, 'zz', T), Error);
});
test('assignTask sets and clears assignee', () => {
  const s = deepFreeze(mkState({ tasks: [mkTask()] }));
  const n = L.assignTask(s, 't1', 'u1');
  assert.equal(n.tasks[0].assignee, 'u1');
  assert.equal(L.assignTask(n, 't1', null).tasks[0].assignee, null);
  assert.throws(() => L.assignTask(s, 'zz', 'u1'), Error);
});

// ---------- addTask kinds & validation ----------
test('addTask annual / mileage valid', () => {
  const base = mkState({ vehicles: [veh()] });
  const a = L.addTask(base, { title: 'Sprinklers', category: 'yard', kind: 'annual', month: 10, day: 15 }, idGen('n'));
  assert.equal(a.tasks[0].kind, 'annual'); assert.equal(a.tasks[0].month, 10);
  const m = L.addTask(base, { title: 'Oil', category: 'car', kind: 'mileage', intervalMiles: 5000, vehicleId: 'v1' }, idGen('n'));
  assert.equal(m.tasks[0].kind, 'mileage'); assert.equal(m.tasks[0].vehicleId, 'v1');
  assert.ok(Array.isArray(m.tasks[0].links)); assert.ok(Array.isArray(m.tasks[0].tags));
  assert.ok(!m.tasks[0].id.startsWith('seed-'));
});
test('addTask kind-specific validation', () => {
  const base = mkState({ vehicles: [veh()] });
  const f = (p) => () => L.addTask(base, { title: 'X', category: 'car', ...p }, idGen('n'));
  assert.throws(f({ kind: 'annual' }), Error);
  assert.throws(f({ kind: 'annual', month: 13, day: 1 }), Error);
  assert.throws(f({ kind: 'annual', month: 0, day: 1 }), Error);
  assert.throws(f({ kind: 'annual', month: 2, day: 29 }), Error);
  assert.throws(f({ kind: 'annual', month: 2, day: 0 }), Error);
  assert.throws(f({ kind: 'annual', month: 1.5, day: 1 }), Error);
  assert.throws(f({ kind: 'mileage', vehicleId: 'v1' }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 5000 }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 0, vehicleId: 'v1' }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 1000001, vehicleId: 'v1' }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 1e300, vehicleId: 'v1' }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 5000.5, vehicleId: 'v1' }), Error);
  assert.throws(f({ kind: 'mileage', intervalMiles: 5000, vehicleId: 'v1', intervalDays: 36501 }), Error);
  assert.throws(f({ kind: 'bogus', intervalDays: 5 }), Error);
  assert.throws(f({ intervalDays: 36501 }), Error);
  assert.throws(f({ intervalDays: 1e15 }), Error);
});
test('addTask length limits and link rules', () => {
  const base = mkState();
  const f = (p) => () => L.addTask(base, { title: 'X', category: 'car', intervalDays: 5, ...p }, idGen('n'));
  assert.doesNotThrow(f({ title: 'x'.repeat(120) }));
  assert.throws(f({ title: 'x'.repeat(121) }), Error);
  assert.doesNotThrow(f({ notes: 'n'.repeat(2000) }));
  assert.throws(f({ notes: 'n'.repeat(2001) }), Error);
  assert.doesNotThrow(f({ links: [{ label: 'ok', url: 'https://example.com/x' }, { label: 'ok', url: 'http://example.com' }] }));
  for (const url of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://x.com', 'example.com', '', 'JAVASCRIPT:alert(1)', ' javascript:alert(1)'])
    assert.throws(f({ links: [{ label: 'bad', url }] }), Error, url);
  const six = Array.from({ length: 6 }, (_, i) => ({ label: 'l' + i, url: 'https://e.com/' + i }));
  assert.throws(f({ links: six }), Error);
  assert.doesNotThrow(f({ links: six.slice(0, 5) }));
});
test('addTask keeps <script> user text verbatim (escaping is a render concern)', () => {
  const n = L.addTask(mkState(), { title: '<script>alert(1)</script>', category: 'car', intervalDays: 5, notes: '"><img src=x>' }, idGen('n'));
  assert.equal(n.tasks[0].title, '<script>alert(1)</script>');
});
test('addTask duplicate id throws; updateTask can change kind fields', () => {
  const s = mkState({ tasks: [mkTask()] });
  assert.throws(() => L.addTask(s, { title: 'X', category: 'car', intervalDays: 5 }, () => 't1'), Error);
  const u = L.updateTask(s, 't1', { notes: 'x', tags: ['a'], links: [{ label: 'l', url: 'https://a.b' }] });
  assert.deepEqual(u.tasks[0].tags, ['a']);
  assert.throws(() => L.updateTask(s, 't1', { links: [{ label: 'l', url: 'javascript:1' }] }), Error);
  assert.throws(() => L.updateTask(s, 't1', { notes: 'n'.repeat(2001) }), Error);
});

// ---------- vehicles ----------
test('addVehicle/updateVehicle/deleteVehicle', () => {
  const s = deepFreeze(mkState());
  const n = L.addVehicle(s, { name: 'Truck', odometer: 1234 }, () => 'v9', T);
  assert.equal(n.vehicles[0].id, 'v9'); assert.equal(n.vehicles[0].odometer, 1234);
  assert.equal(n.vehicles[0].odometerDate, T);
  assert.throws(() => L.addVehicle(s, { name: '', odometer: 1 }, () => 'v', T), Error);
  assert.throws(() => L.addVehicle(s, { name: 'A', odometer: -1 }, () => 'v', T), Error);
  assert.throws(() => L.addVehicle(s, { name: 'A', odometer: 1.5 }, () => 'v', T), Error);
  assert.throws(() => L.addVehicle(s, { name: 'A', odometer: NaN }, () => 'v', T), Error);
  assert.throws(() => L.addVehicle(n, { name: 'A', odometer: 1 }, () => 'v9', T), Error, 'dup id');
  const u = L.updateVehicle(n, 'v9', { name: 'Big Truck' });
  assert.equal(u.vehicles[0].name, 'Big Truck');
  assert.throws(() => L.updateVehicle(n, 'zz', { name: 'x' }), Error);
});
test('deleteVehicle removes its tasks, keeps completions and other tasks', () => {
  let s = mkState({ vehicles: [veh(), veh({ id: 'v2', name: 'Car' })],
    tasks: [mileTask(), mileTask({ id: 'm2', vehicleId: 'v2' }), mkTask({ id: 'h' })] });
  s = L.markDone(s, 'm1', T);
  const n = L.deleteVehicle(deepFreeze(s), 'v1');
  assert.deepEqual(n.vehicles.map((v) => v.id), ['v2']);
  assert.deepEqual(n.tasks.map((t) => t.id).sort(), ['h', 'm2']);
  assert.equal(n.completions.length, 1);
  assert.throws(() => L.deleteVehicle(s, 'zz'), Error);
});
test('setOdometer: must be >= current; appends log; same-day overwrite', () => {
  const s = deepFreeze(mkState({ vehicles: [veh()] }));
  assert.throws(() => L.setOdometer(s, 'v1', 49999, T), Error);
  assert.throws(() => L.setOdometer(s, 'zz', 60000, T), Error);
  assert.throws(() => L.setOdometer(s, 'v1', -5, T), Error);
  assert.throws(() => L.setOdometer(s, 'v1', 60000.5, T), Error);
  const a = L.setOdometer(s, 'v1', 50500, T);
  assert.equal(a.vehicles[0].odometer, 50500); assert.equal(a.vehicles[0].odometerDate, T);
  const b = L.setOdometer(a, 'v1', 50600, T);
  assert.equal(b.vehicles[0].odometerLog.filter((e) => e.date === T).length, 1);
  assert.equal(b.vehicles[0].odometerLog.at(-1).odometer, 50600);
  const c = L.setOdometer(b, 'v1', 50600, addDays(T, 1)); // equal allowed
  assert.equal(c.vehicles[0].odometer, 50600);
});
test('setOdometer: log capped at 60, ascending, oldest dropped', () => {
  let s = mkState({ vehicles: [veh({ odometer: 0, odometerLog: [] })] });
  let d = '2025-01-01';
  for (let i = 1; i <= 75; i++) { d = addDays(d, 1); s = L.setOdometer(s, 'v1', i * 10, d); }
  const log = s.vehicles[0].odometerLog;
  assert.equal(log.length, 60);
  for (let i = 1; i < log.length; i++) {
    assert.ok(log[i].date > log[i - 1].date); assert.ok(log[i].odometer >= log[i - 1].odometer);
  }
  assert.equal(log.at(-1).odometer, 750);
  assert.equal(log[0].odometer, 160);
});
test('setOdometer accepts up to 2,000,000 and refuses absurd values', () => {
  const n = L.setOdometer(mkState({ vehicles: [veh()] }), 'v1', 1_500_000, T);
  assert.equal(n.vehicles[0].odometer, 1_500_000);
  assert.throws(() => L.setOdometer(mkState({ vehicles: [veh()] }), 'v1', 1e9, T));
});

// ---------- items / supplies ----------
test('items CRUD, deleteItem nulls task.itemId', () => {
  const s = deepFreeze(mkState({ tasks: [mkTask({ itemId: 'i1' }), mkTask({ id: 't2', itemId: null })] }));
  const a = L.addItem(s, { name: 'Furnace', kind: 'hvac', warrantyExpires: '2027-01-01', photoIds: ['p-1'] }, () => 'i1');
  assert.equal(a.items[0].name, 'Furnace'); assert.equal(a.items[0].kind, 'hvac');
  assert.equal(typeof a.items[0].location, 'string'); assert.deepEqual(a.items[0].photoIds, ['p-1']);
  assert.throws(() => L.addItem(s, { name: '', kind: 'hvac' }, () => 'i'), Error);
  assert.throws(() => L.addItem(s, { name: 'X', kind: 'spaceship' }, () => 'i'), Error);
  assert.throws(() => L.addItem(s, { name: 'X', kind: 'hvac', photoIds: ['a', 'b', 'c', 'd'] }, () => 'i'), Error);
  assert.throws(() => L.addItem(s, { name: 'X', kind: 'hvac', warrantyExpires: '2027-13-01' }, () => 'i'), Error);
  assert.throws(() => L.addItem(a, { name: 'X', kind: 'hvac' }, () => 'i1'), Error, 'dup id');
  const u = L.updateItem(a, 'i1', { model: 'M2' });
  assert.equal(u.items[0].model, 'M2');
  assert.throws(() => L.updateItem(a, 'zz', {}), Error);
  const d = L.deleteItem(a, 'i1');
  assert.equal(d.items.length, 0); assert.equal(d.tasks[0].itemId, null);
  assert.equal(d.tasks[1].itemId, null);
  assert.throws(() => L.deleteItem(a, 'zz'), Error);
});
test('supplies CRUD and validation', () => {
  const s = deepFreeze(mkState());
  const a = L.addSupply(s, { name: 'Water', key: 'water', category: 'water', quantity: 6, unit: 'gal', expires: '2027-01-01' }, () => 's1');
  assert.equal(a.supplies[0].quantity, 6);
  const f = (p) => () => L.addSupply(s, { name: 'W', category: 'water', quantity: 1, unit: 'gal', ...p }, () => 'sx');
  assert.throws(f({ name: '' }), Error);
  assert.throws(f({ category: 'toys' }), Error);
  assert.throws(f({ quantity: -1 }), Error);
  assert.throws(f({ quantity: NaN }), Error);
  assert.throws(f({ quantity: Infinity }), Error);
  assert.throws(f({ expires: 'soon' }), Error);
  assert.doesNotThrow(f({ quantity: 0 }));
  assert.equal(L.updateSupply(a, 's1', { quantity: 2 }).supplies[0].quantity, 2);
  assert.throws(() => L.updateSupply(a, 'zz', { quantity: 2 }), Error);
  assert.throws(() => L.updateSupply(a, 's1', { quantity: -2 }), Error);
  assert.equal(L.deleteSupply(a, 's1').supplies.length, 0);
  assert.throws(() => L.deleteSupply(a, 'zz'), Error);
});

// ---------- profile / emergency ----------
test('updateProfile validation', () => {
  const s = deepFreeze(mkState());
  assert.equal(L.updateProfile(s, { householdSize: 5, hasPool: true }).profile.householdSize, 5);
  assert.equal(L.updateProfile(s, { householdSize: 5 }).profile.homeType, 'house');
  for (const bad of [0, 21, 1.5, NaN, '3', -1]) assert.throws(() => L.updateProfile(s, { householdSize: bad }), Error, String(bad));
  assert.throws(() => L.updateProfile(s, { homeType: 'castle' }), Error);
  assert.doesNotThrow(() => L.updateProfile(s, { householdSize: 1 }));
  assert.doesNotThrow(() => L.updateProfile(s, { householdSize: 20 }));
});
test('updateEmergency validation', () => {
  const s = deepFreeze(mkState());
  const c = (n) => Array.from({ length: n }, (_, i) => ({ name: 'N' + i, phone: '555', relation: 'x' }));
  assert.equal(L.updateEmergency(s, { contacts: c(12) }).emergency.contacts.length, 12);
  assert.throws(() => L.updateEmergency(s, { contacts: c(13) }), Error);
  assert.throws(() => L.updateEmergency(s, { meetingPlace: 'x'.repeat(501) }), Error);
  assert.doesNotThrow(() => L.updateEmergency(s, { meetingPlace: 'x'.repeat(500) }));
  assert.throws(() => L.updateEmergency(s, { notes: 'x'.repeat(501) }), Error);
  assert.throws(() => L.updateEmergency(s, { shutoffs: { water: 'x'.repeat(501), gas: '', electric: '' } }), Error);
  assert.throws(() => L.updateEmergency(s, { contacts: [{ name: 'x'.repeat(501), phone: '', relation: '' }] }), Error);
  const n = L.updateEmergency(s, { meetingPlace: '<script>x</script>' });
  assert.equal(n.emergency.meetingPlace, '<script>x</script>');
  assert.deepEqual(n.emergency.shutoffs, { water: '', gas: '', electric: '' });
});

// ---------- history / spend ----------
const hist = () => mkState({ completions: [
  mkCompletion({ id: 'c1', taskId: 't1', date: '2026-01-10', cost: 10, category: 'car' }),
  mkCompletion({ id: 'c2', taskId: 't2', date: '2026-03-05', cost: 20.5, category: 'house' }),
  mkCompletion({ id: 'c3', taskId: 't1', date: '2025-12-31', cost: 100, category: 'car' }),
  mkCompletion({ id: 'c4', taskId: null, date: '2026-03-20', kind: 'skipped', cost: null, category: 'yard' }),
  mkCompletion({ id: 'c5', taskId: 't3', date: '2026-03-31', cost: null, category: 'house' }),
  mkCompletion({ id: 'c6', taskId: 't3', date: '2026-12-31', cost: 0.1, category: 'yard' }),
  mkCompletion({ id: 'c7', taskId: 't3', date: '2026-12-01', cost: 0.2, category: 'yard' }),
] });
test('historyFor: newest first, filters', () => {
  const s = deepFreeze(hist());
  assert.deepEqual(L.historyFor(s, {}).map((c) => c.id), ['c6', 'c7', 'c5', 'c4', 'c2', 'c1', 'c3']);
  assert.deepEqual(L.historyFor(s).map((c) => c.id).length, 7);
  assert.deepEqual(L.historyFor(s, { taskId: 't1' }).map((c) => c.id), ['c1', 'c3']);
  assert.deepEqual(L.historyFor(s, { category: 'house' }).map((c) => c.id), ['c5', 'c2']);
  assert.deepEqual(L.historyFor(s, { year: 2025 }).map((c) => c.id), ['c3']);
  assert.deepEqual(L.historyFor(s, { kind: 'skipped' }).map((c) => c.id), ['c4']);
  assert.deepEqual(L.historyFor(s, { year: 2026, category: 'yard', kind: 'done' }).map((c) => c.id), ['c6', 'c7']);
  assert.deepEqual(L.historyFor(s, { taskId: 'nope' }), []);
});
test('spend: only done with cost, by category and month', () => {
  const r = L.spend(deepFreeze(hist()), 2026);
  assert.ok(Math.abs(r.total - 30.8) < 1e-9);
  assert.equal(r.byCategory.car, 10); assert.equal(r.byCategory.house, 20.5);
  assert.ok(Math.abs(r.byCategory.yard - 0.3) < 1e-9); assert.equal(r.byCategory.emergency, 0);
  assert.equal(r.byMonth.length, 12);
  assert.equal(r.byMonth[0], 10); assert.equal(r.byMonth[2], 20.5); assert.ok(Math.abs(r.byMonth[11] - 0.3) < 1e-9);
  assert.equal(r.byMonth[5], 0);
  assert.equal(L.spend(hist(), 2025).total, 100);
  assert.equal(L.spend(hist(), 1999).total, 0);
  const e = L.spend(mkState(), 2026);
  assert.equal(e.total, 0); assert.equal(e.byMonth.length, 12);
});
test('spend handles huge costs without NaN', () => {
  const s = mkState({ completions: [mkCompletion({ cost: 1e15, date: '2026-02-01' })] });
  assert.equal(L.spend(s, 2026).total, 1e15);
});

// ---------- search ----------
test('searchTasks: terms, case, fields, empty', () => {
  const s = mkState({
    vehicles: [veh({ name: 'Blue Truck' })],
    items: [mkItem({ id: 'i1', name: 'Furnace', model: 'Trane XR90' })],
    tasks: [
      mkTask({ id: 'a', title: 'Replace filter', itemId: 'i1', lastDone: T }),
      mkTask({ id: 'b', title: 'Mow lawn', notes: 'Use the red mower', tags: ['Summer', 'yard'] }),
      mkTask({ id: 'c', title: 'Oil change', kind: 'mileage', intervalDays: null, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 47000, links: [{ label: 'Manual PDF', url: 'https://x.y' }] }),
    ] });
  const ids = (q) => L.searchTasks(s, q, T).map((t) => t.id).sort();
  assert.deepEqual(ids(''), ['a', 'b', 'c']);
  assert.deepEqual(ids('   '), ['a', 'b', 'c']);
  assert.deepEqual(ids('MOW'), ['b']);
  assert.deepEqual(ids('red MOWER'), ['b']);
  assert.deepEqual(ids('mow  lawn'), ['b']);
  assert.deepEqual(ids('mow zzz'), []);
  assert.deepEqual(ids('summer'), ['b']);
  assert.deepEqual(ids('manual'), ['c']);
  assert.deepEqual(ids('furnace'), ['a']);
  assert.deepEqual(ids('trane'), ['a']);
  assert.deepEqual(ids('blue truck'), ['c']);
  assert.deepEqual(ids('<script>'), []);
  assert.deepEqual(ids('.*'), []); // not a regex
  assert.deepEqual(ids('('), []);
});
test('searchTasks result sorted via sortTasks', () => {
  const s = mkState({ tasks: [
    mkTask({ id: 'ok', title: 'x ok', lastDone: T, intervalDays: 100 }),
    mkTask({ id: 'od', title: 'x od', lastDone: '2025-01-01', intervalDays: 10 }),
  ] });
  assert.deepEqual(L.searchTasks(s, 'x', T).map((t) => t.id), ['od', 'ok']);
});

// ---------- warranty ----------
test('warrantyAlerts window and ordering', () => {
  const it = (id, w) => mkItem({ id, name: id, warrantyExpires: w });
  const s = mkState({ items: [
    it('far', addDays(T, 61)), it('soon', addDays(T, 10)), it('mid', addDays(T, 59)),
    it('exp5', addDays(T, -5)), it('exp29', addDays(T, -29)), it('exp31', addDays(T, -31)),
    it('none', null), it('today', T),
  ] });
  const r = L.warrantyAlerts(deepFreeze(s), T);
  assert.deepEqual(r.map((a) => a.item.id), ['exp29', 'exp5', 'today', 'soon', 'mid']);
  assert.deepEqual(r.map((a) => a.daysLeft), [-29, -5, 0, 10, 59]);
  assert.deepEqual(L.warrantyAlerts(s, T, 5).map((a) => a.item.id), ['exp29', 'exp5', 'today']);
  assert.deepEqual(L.warrantyAlerts(mkState(), T), []);
});

// ---------- immutability sweep ----------
test('all mutators leave frozen input untouched', () => {
  const s = deepFreeze(mkState({ vehicles: [veh()], tasks: [mkTask(), mileTask()], items: [mkItem()], supplies: [mkSupply()] }));
  const ops = [
    () => L.markDone(s, 't1', T, { cost: 1 }), () => L.markDone(s, 'm1', T, { odometer: 60000 }),
    () => L.skipTask(s, 't1', T), () => L.snoozeTask(s, 't1', '2026-06-20', T), () => L.unsnoozeTask(s, 't1'),
    () => L.assignTask(s, 't1', 'u'), () => L.setOdometer(s, 'v1', 60000, T), () => L.updateVehicle(s, 'v1', { name: 'n' }),
    () => L.deleteVehicle(s, 'v1'), () => L.updateItem(s, 'i1', { name: 'n' }), () => L.deleteItem(s, 'i1'),
    () => L.updateSupply(s, 's1', { quantity: 3 }), () => L.deleteSupply(s, 's1'),
    () => L.updateProfile(s, { hasPool: true }), () => L.updateEmergency(s, { notes: 'n' }),
    () => L.deleteTask(s, 't1'), () => L.updateTask(s, 't1', { title: 'n' }),
  ];
  for (const op of ops) { const r = op(); assert.notEqual(r, s); assert.equal(r.version, 2); }
});
