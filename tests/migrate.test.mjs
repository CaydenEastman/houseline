import test from 'node:test';
import assert from 'node:assert/strict';
import { migrate, validateState, freshState } from '../src/storage.js';
import { CATEGORIES } from '../src/templates.js';
import { v1Fixture, deepFreeze, clone, mkState, mkTask } from './helpers.mjs';

test('v1 -> v2 adds defaults to tasks', () => {
  const m = migrate(deepFreeze(v1Fixture()));
  assert.equal(m.version, 2);
  assert.doesNotThrow(() => validateState(m));
  for (const t of m.tasks) {
    assert.equal(t.kind, 'interval');
    assert.deepEqual(t.links, []); assert.deepEqual(t.tags, []);
    for (const k of ['month', 'day', 'intervalMiles', 'lastDoneOdometer', 'vehicleId', 'startDate', 'snoozedUntil', 'itemId', 'assignee']) assert.equal(t[k], null, k);
  }
  const orig = v1Fixture();
  m.tasks.forEach((t, i) => {
    for (const k of ['id', 'title', 'category', 'intervalDays', 'lastDone', 'notes', 'custom']) assert.equal(t[k], orig.tasks[i][k], k);
  });
});
test('v1 -> v2 profile/collections', () => {
  const m = migrate(v1Fixture());
  assert.equal(m.profile.setupDone, true);
  assert.ok(m.profile.householdSize >= 1 && m.profile.householdSize <= 20);
  assert.deepEqual(m.vehicles, []); assert.deepEqual(m.items, []); assert.deepEqual(m.supplies, []);
  assert.ok(Array.isArray(m.emergency.contacts));
});
test('v1 -> v2 completions: ids, snapshots, dangling task', () => {
  const m = migrate(v1Fixture());
  assert.equal(m.completions.length, 3);
  assert.equal(new Set(m.completions.map((c) => c.id)).size, 3);
  assert.ok(m.completions.every((c) => typeof c.id === 'string' && c.id));
  const c0 = m.completions[0];
  assert.equal(c0.taskId, 'seed-1'); assert.equal(c0.title, 'Change oil'); assert.equal(c0.category, 'car');
  assert.equal(c0.date, '2026-03-01'); assert.equal(c0.kind, 'done'); assert.equal(c0.cost, null);
  assert.deepEqual(c0.photoIds, []);
  assert.equal(m.completions[1].title, 'Mow <b>lawn</b>');
  assert.equal(m.completions[2].title, 'Task'); assert.ok(CATEGORIES.includes(m.completions[2].category));
});
test('v1 -> v2 does not mutate input', () => {
  const f = deepFreeze(v1Fixture()); assert.doesNotThrow(() => migrate(f));
});
test('v1 empty collections', () => {
  const m = migrate({ version: 1, tasks: [], completions: [] });
  assert.equal(m.version, 2); assert.deepEqual(m.tasks, []);
});
test('v2 passes through unchanged', () => {
  const s = mkState({ tasks: [mkTask()] });
  assert.deepEqual(migrate(clone(s)), s);
  assert.deepEqual(migrate(freshState()), freshState());
});
test('migrate is idempotent', () => {
  const a = migrate(v1Fixture());
  assert.deepEqual(migrate(clone(a)), a);
});
test('migrate throws on garbage / unknown versions', () => {
  for (const v of [null, undefined, [], 'x', 3, {}, { version: 0 }, { version: 3, tasks: [], completions: [] },
    { version: '2' }, { version: 1.5, tasks: [], completions: [] }, { tasks: [], completions: [] }, { version: -1 }]) {
    assert.throws(() => migrate(v), Error, JSON.stringify(v));
  }
});
test('migrate of invalid v1 content throws', () => {
  const f = v1Fixture(); f.tasks[0].intervalDays = 1e15;
  assert.throws(() => migrate(f), Error);
  const g = v1Fixture(); g.tasks[1].id = 'seed-1';
  assert.throws(() => migrate(g), Error);
  const h = v1Fixture(); h.completions[0].date = 'nope';
  assert.throws(() => migrate(h), Error);
  assert.throws(() => migrate({ version: 1, tasks: 'x', completions: [] }), Error);
});
test('v1 with duplicate completion rows migrates with unique ids', () => {
  const f = v1Fixture(); f.completions.push({ ...f.completions[0] });
  const m = migrate(f);
  assert.equal(new Set(m.completions.map((c) => c.id)).size, m.completions.length);
});
