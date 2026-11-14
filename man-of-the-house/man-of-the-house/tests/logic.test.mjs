import test from 'node:test';
import assert from 'node:assert/strict';
import {
  daysBetween, addDays, nextDue, daysUntilDue, statusOf, markDone,
  addTask, updateTask, deleteTask, sortTasks, summary,
} from '../src/logic.js';

const T = '2026-06-15';
import { mkTask, mkState } from './helpers.mjs';
import { clone } from './helpers.mjs';
const task = (o = {}) => mkTask(o);
const st = (tasks = [], completions = []) => mkState({ tasks, completions });

test('daysBetween basics', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-01'), 0);
  assert.equal(daysBetween('2026-01-01', '2026-01-11'), 10);
  assert.equal(daysBetween('2026-01-11', '2026-01-01'), -10);
});
test('daysBetween across month/year/leap', () => {
  assert.equal(daysBetween('2026-01-31', '2026-02-01'), 1);
  assert.equal(daysBetween('2025-12-31', '2026-01-01'), 1);
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.equal(daysBetween('2025-02-28', '2025-03-01'), 1);
  assert.equal(daysBetween('2025-01-01', '2026-01-01'), 365);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
  assert.equal(daysBetween('1900-02-28', '1900-03-01'), 1); // 1900 not leap
  assert.equal(daysBetween('2000-02-28', '2000-03-01'), 2); // 2000 leap
});
test('daysBetween is DST-safe', () => {
  assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2);
  assert.equal(daysBetween('2026-11-01', '2026-11-02'), 1);
  assert.equal(daysBetween('2026-03-01', '2026-11-30'), 274);
  assert.ok(Number.isInteger(daysBetween('2026-03-08', '2026-03-09')));
});
test('addDays', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(addDays('2025-02-28', 1), '2025-03-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-01-01', 0), '2026-01-01');
  assert.equal(addDays('2026-01-01', 365), '2027-01-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});
test('addDays/daysBetween inverse', () => {
  for (const n of [-400, -1, 0, 1, 59, 366, 1000]) {
    assert.equal(daysBetween('2026-06-15', addDays('2026-06-15', n)), n);
  }
});

test('nextDue', () => {
  assert.equal(nextDue(task({ lastDone: null }), T), T);
  assert.equal(nextDue(task({ lastDone: '2026-06-01', intervalDays: 30 }), T), '2026-07-01');
  assert.equal(nextDue(task({ lastDone: '2025-12-20', intervalDays: 20 }), T), '2026-01-09');
});
test('daysUntilDue', () => {
  assert.equal(daysUntilDue(task({ lastDone: null }), T), 0);
  assert.equal(daysUntilDue(task({ lastDone: '2026-06-10', intervalDays: 10 }), T), 5);
  assert.equal(daysUntilDue(task({ lastDone: '2026-06-01', intervalDays: 10 }), T), -4);
  assert.equal(daysUntilDue(task({ lastDone: T, intervalDays: 30 }), T), 30);
});

test('statusOf: overdue / ok / due-soon (small interval, 7 day window)', () => {
  const mk = (until, interval = 60) =>
    task({ intervalDays: interval, lastDone: addDays(T, until - interval) });
  assert.equal(statusOf(mk(-1), T), 'overdue');
  assert.equal(statusOf(mk(-30), T), 'overdue');
  assert.equal(statusOf(mk(1), T), 'due-soon');
  assert.equal(statusOf(mk(7), T), 'due-soon');
  assert.equal(statusOf(mk(8), T), 'ok');
  assert.equal(statusOf(mk(60), T), 'ok');
});
test('statusOf: 10% of interval when larger than 7, capped at 14', () => {
  const mk = (until, interval) => task({ intervalDays: interval, lastDone: addDays(T, until - interval) });
  // interval 100 -> window 10
  assert.equal(statusOf(mk(10, 100), T), 'due-soon');
  assert.equal(statusOf(mk(11, 100), T), 'ok');
  // interval 365 -> 36.5 capped at 14
  assert.equal(statusOf(mk(14, 365), T), 'due-soon');
  assert.equal(statusOf(mk(15, 365), T), 'ok');
  // interval 1000 -> cap 14
  assert.equal(statusOf(mk(14, 1000), T), 'due-soon');
  assert.equal(statusOf(mk(15, 1000), T), 'ok');
  // interval 30 -> 3 < 7, so 7
  assert.equal(statusOf(mk(7, 30), T), 'due-soon');
  assert.equal(statusOf(mk(8, 30), T), 'ok');
});
test('statusOf: due today is not overdue', () => {
  assert.notEqual(statusOf(task({ lastDone: '2026-06-05', intervalDays: 10 }), T), 'overdue');
});
test('statusOf: never-done task is due now (not overdue, not ok) [spec ambiguity: due-soon assumed]', () => {
  assert.equal(statusOf(task({ lastDone: null }), T), 'due-soon');
});

test('markDone returns new state, sets lastDone, appends completion', () => {
  const s = st([task(), task({ id: 't2' })]);
  const snap = clone(s);
  const n = markDone(s, 't1', T);
  assert.deepEqual(s, snap, 'input mutated');
  assert.notEqual(n, s);
  assert.notEqual(n.tasks, s.tasks);
  assert.equal(n.tasks.find((t) => t.id === 't1').lastDone, T);
  assert.equal(n.tasks.find((t) => t.id === 't2').lastDone, null);
  // v2: completion carries id + title/category snapshots + kind
  assert.equal(n.completions.length, 1);
  const c0 = n.completions[0];
  assert.equal(c0.taskId, 't1'); assert.equal(c0.date, T); assert.equal(c0.kind, 'done');
  assert.equal(c0.title, 'Task'); assert.equal(c0.category, 'house');
  assert.equal(typeof c0.id, 'string'); assert.ok(c0.id.length > 0);
  const n2 = markDone(n, 't1', '2026-06-20');
  assert.equal(n2.completions.length, 2);
  assert.equal(n2.tasks[0].lastDone, '2026-06-20');
  assert.equal(n2.version, 2);
  assert.notEqual(n2.completions[0].id, n2.completions[1].id);
});
test('markDone resets status to ok', () => {
  const n = markDone(st([task({ intervalDays: 90 })]), 't1', T);
  assert.equal(statusOf(n.tasks[0], T), 'ok');
});
test('markDone on unknown id throws or leaves state equivalent', () => {
  const s = st([task()]);
  try {
    const n = markDone(s, 'nope', T);
    assert.deepEqual(n.tasks, s.tasks);
    assert.deepEqual(n.completions, []);
  } catch (e) {
    assert.ok(e instanceof Error);
  }
});

test('addTask adds custom task with id from idFn, immutably', () => {
  const s = st([task()]);
  const snap = clone(s);
  const n = addTask(s, { title: ' Clean grill ', category: 'yard', intervalDays: 30, notes: 'hi' }, () => 'new1');
  assert.deepEqual(s, snap);
  assert.equal(n.tasks.length, 2);
  const t = n.tasks.find((x) => x.id === 'new1');
  assert.ok(t);
  assert.equal(t.title.trim(), 'Clean grill');
  assert.equal(t.category, 'yard');
  assert.equal(t.intervalDays, 30);
  assert.equal(t.notes, 'hi');
  assert.equal(t.lastDone, null);
  assert.equal(t.custom, true);
});
test('addTask defaults notes when omitted', () => {
  const n = addTask(st(), { title: 'X', category: 'car', intervalDays: 5 }, () => 'a');
  assert.equal(typeof n.tasks[0].notes, 'string');
});
test('addTask validation', () => {
  const ok = { title: 'X', category: 'car', intervalDays: 5 };
  const f = (o) => () => addTask(st(), { ...ok, ...o }, () => 'a');
  assert.throws(f({ title: '' }), Error);
  assert.throws(f({ title: '   ' }), Error);
  assert.throws(f({ title: undefined }), Error);
  assert.throws(f({ category: 'boat' }), Error);
  assert.throws(f({ category: undefined }), Error);
  assert.throws(f({ intervalDays: 0 }), Error);
  assert.throws(f({ intervalDays: -3 }), Error);
  assert.throws(f({ intervalDays: NaN }), Error);
  assert.throws(f({ intervalDays: Infinity }), Error);
  assert.throws(f({ intervalDays: 'abc' }), Error);
  assert.throws(f({ intervalDays: undefined }), Error);
  assert.throws(f({ title: 'X' , intervalDays: 0 }), (e) => e instanceof Error && e.message.length > 3);
});
test('addTask error leaves state untouched', () => {
  const s = st([task()]);
  const snap = clone(s);
  assert.throws(() => addTask(s, { title: '', category: 'car', intervalDays: 1 }, () => 'a'));
  assert.deepEqual(s, snap);
});

test('updateTask patches, immutably', () => {
  const s = st([task(), task({ id: 't2' })]);
  const snap = clone(s);
  const n = updateTask(s, 't1', { title: 'New', intervalDays: 10, category: 'car', notes: 'n' });
  assert.deepEqual(s, snap);
  const t = n.tasks.find((x) => x.id === 't1');
  assert.equal(t.title, 'New');
  assert.equal(t.intervalDays, 10);
  assert.equal(t.category, 'car');
  assert.equal(t.notes, 'n');
  assert.equal(t.id, 't1');
  assert.deepEqual(n.tasks.find((x) => x.id === 't2'), s.tasks[1]);
});
test('updateTask validation', () => {
  const s = st([task()]);
  assert.throws(() => updateTask(s, 't1', { category: 'nope' }), Error);
  assert.throws(() => updateTask(s, 't1', { intervalDays: 0 }), Error);
  assert.throws(() => updateTask(s, 't1', { intervalDays: -1 }), Error);
  assert.throws(() => updateTask(s, 't1', { title: '  ' }), Error);
});
test('updateTask partial patch keeps other fields', () => {
  const s = st([task({ notes: 'keep', lastDone: '2026-01-01' })]);
  const n = updateTask(s, 't1', { title: 'Z' });
  assert.equal(n.tasks[0].notes, 'keep');
  assert.equal(n.tasks[0].lastDone, '2026-01-01');
});

test('deleteTask removes task but KEEPS completions (v2), immutably', () => {
  const s = st([task(), task({ id: 't2' })]);
  const done = markDone(s, 't1', T);
  const snap = clone(done);
  const n = deleteTask(done, 't1');
  assert.deepEqual(done, snap);
  assert.deepEqual(n.tasks.map((t) => t.id), ['t2']);
  assert.equal(n.completions.length, 1);
  assert.equal(n.completions[0].title, 'Task');
});
test('deleteTask unknown id: no change or throws', () => {
  const s = st([task()]);
  try { assert.equal(deleteTask(s, 'zzz').tasks.length, 1); } catch (e) { assert.ok(e instanceof Error); }
});

test('sortTasks: overdue first then ascending daysUntilDue; no mutation', () => {
  const a = task({ id: 'a', intervalDays: 100, lastDone: addDays(T, 20 - 100) }); // +20
  const b = task({ id: 'b', intervalDays: 100, lastDone: addDays(T, -5 - 100) }); // -5
  const c = task({ id: 'c', intervalDays: 100, lastDone: addDays(T, 3 - 100) }); // +3
  const d = task({ id: 'd', intervalDays: 100, lastDone: addDays(T, -20 - 100) }); // -20
  const input = [a, b, c, d];
  const out = sortTasks(input, T);
  assert.deepEqual(out.map((t) => t.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(input.map((t) => t.id), ['a', 'b', 'c', 'd']);
  assert.equal(out.length, 4);
});
test('sortTasks empty', () => assert.deepEqual(sortTasks([], T), []));

test('summary counts and byCategory', () => {
  const mk = (id, category, until) =>
    task({ id, category, intervalDays: 100, lastDone: addDays(T, until - 100) });
  const s = st([
    mk('1', 'car', -3), mk('2', 'car', 2), mk('3', 'car', 50),
    mk('4', 'house', -1), mk('5', 'yard', 40), mk('6', 'yard', 60),
  ]);
  const r = summary(s, T);
  assert.equal(r.overdue, 2);
  assert.equal(r.dueSoon, 1);
  assert.equal(r.ok, 3);
  assert.deepEqual(r.byCategory.car, { overdue: 1, dueSoon: 1, ok: 1 });
  assert.deepEqual(r.byCategory.house, { overdue: 1, dueSoon: 0, ok: 0 });
  assert.deepEqual(r.byCategory.yard, { overdue: 0, dueSoon: 0, ok: 2 });
  assert.deepEqual(r.byCategory.emergency, { overdue: 0, dueSoon: 0, ok: 0 });
});
test('summary of empty state', () => {
  const r = summary(st(), T);
  assert.equal(r.overdue + r.dueSoon + r.ok, 0);
  for (const c of ['car', 'house', 'yard', 'emergency']) assert.ok(r.byCategory[c]);
});
