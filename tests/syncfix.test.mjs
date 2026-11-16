import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates } from '../src/sync.js';
import { validateState } from '../src/storage.js';
import { isValidISO, MAX_COST } from '../src/logic.js';
import { mkState, mkTask, mkVehicle, mkItem, mkCompletion, clone } from './helpers.mjs';

const M = (b, m, t) => mergeStates(clone(b), clone(m), clone(t));

test('delete item on one device + new task linked to it on the other: both survive, link dropped', () => {
  const b = mkState({ items: [mkItem({ id: 'i1', name: 'Furnace' })], tasks: [mkTask({ id: 't1' })] });
  const mine = { ...b, items: [], tasks: [...b.tasks, mkTask({ id: 'tA', title: 'A' })] };
  const theirs = { ...b, tasks: [...b.tasks, mkTask({ id: 'tB', title: 'B', itemId: 'i1' })] };
  const out = M(b, mine, theirs);
  assert.ok(validateState(out));
  assert.deepEqual(out.tasks.map((t) => t.id).sort(), ['t1', 'tA', 'tB']);
  assert.equal(out.tasks.find((t) => t.id === 'tB').itemId, null);
});

test('delete vehicle + new mileage task for it on the other device: vehicle is kept', () => {
  const v = mkVehicle({ id: 'v1' });
  const b = mkState({ vehicles: [v] });
  const mine = { ...b, vehicles: [] };
  const theirs = { ...b, tasks: [mkTask({ id: 'm1', kind: 'mileage', intervalDays: null, intervalMiles: 5000, lastDoneOdometer: 0, vehicleId: 'v1' })] };
  const out = M(b, mine, theirs);
  assert.ok(validateState(out));
  assert.equal(out.vehicles.length, 1);
  assert.equal(out.tasks.length, 1);
});

test('different fields of the same task edited on two devices: both edits survive', () => {
  const b = mkState({ tasks: [mkTask({ id: 't1' })] });
  const mine = { ...b, tasks: [{ ...b.tasks[0], assignee: 'Mallory' }] };
  const theirs = { ...b, tasks: [{ ...b.tasks[0], snoozedUntil: '2026-07-01' }] };
  const t = M(b, mine, theirs).tasks[0];
  assert.equal(t.assignee, 'Mallory');
  assert.equal(t.snoozedUntil, '2026-07-01');
});

test('same task completed on two devices: the later lastDone wins', () => {
  const b = mkState({ tasks: [mkTask({ id: 't1', lastDone: '2026-05-01' })] });
  const mine = { ...b, tasks: [{ ...b.tasks[0], lastDone: '2026-06-15' }] };
  const theirs = { ...b, tasks: [{ ...b.tasks[0], lastDone: '2026-06-16' }] };
  assert.equal(M(b, mine, theirs).tasks[0].lastDone, '2026-06-16');
  assert.equal(M(b, theirs, mine).tasks[0].lastDone, '2026-06-16');
});

test('dates are limited to 1900-2200 and costs to a sane maximum', () => {
  assert.equal(isValidISO('9999-12-31'), false);
  assert.equal(isValidISO('0001-01-01'), false);
  assert.equal(isValidISO('2026-02-28'), true);
  const s = mkState({ tasks: [mkTask({ id: 't1', lastDone: '9999-12-31' })] });
  assert.throws(() => validateState(s));
  const c = mkState({ completions: [mkCompletion({ id: 'c1', cost: 1e308 })] });
  assert.throws(() => validateState(c));
  assert.ok(MAX_COST >= 1e6);
});

import { dueInfo, snoozeTask } from '../src/logic.js';
test('mileage due date counts from the odometer reading date, not today', () => {
  const v = mkVehicle({ id: 'v1', odometer: 50000, odometerDate: '2026-01-01', odometerLog: [] });
  const t = mkTask({ id: 'm1', kind: 'mileage', intervalDays: null, intervalMiles: 5000, lastDoneOdometer: 47000, vehicleId: 'v1' });
  const s = mkState({ vehicles: [v], tasks: [t] });
  const info = dueInfo(t, s, '2026-07-01');
  assert.ok(info.daysUntil < 0, 'a reading from six months ago should make this overdue, got ' + info.daysUntil);
});
test('snoozing to a day before the task is due is rejected', () => {
  const t = mkTask({ id: 't1', lastDone: '2026-06-01', intervalDays: 90 });
  const s = mkState({ tasks: [t] });
  assert.throws(() => snoozeTask(s, 't1', '2026-07-01', '2026-06-15'), /before it's due/);
  assert.ok(snoozeTask(s, 't1', '2026-09-15', '2026-06-15'));
});
