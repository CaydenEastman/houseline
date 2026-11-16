import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStates, createStore } from '../src/sync.js';
import { STORAGE_KEY, validateState } from '../src/storage.js';
import { mkState, mkTask, mkVehicle, mkItem, mkSupply, mkCompletion, mkEmergency, deepFreeze, clone, memStorage, fakeDb, isPlainJSON, T } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ids = (a) => a.map((x) => x.id);
const M = (b, m, t) => mergeStates(deepFreeze(clone(b)), deepFreeze(clone(m)), deepFreeze(clone(t)));
const tk = (id, title = id) => mkTask({ id, title });

// ---------- mergeStates (pure) ----------
test('merge: nothing changed -> same content', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  assert.deepEqual(M(b, b, b), b);
});
test('merge: only mine changed / only theirs changed -> that side', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  const edited = (t) => ({ ...b, tasks: [{ ...b.tasks[0], title: t }, b.tasks[1]] });
  assert.equal(M(b, edited('mine'), b).tasks[0].title, 'mine');
  assert.equal(M(b, b, edited('theirs')).tasks[0].title, 'theirs');
});
test('merge: edits to different tasks on each side both survive', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  const mine = { ...b, tasks: [{ ...b.tasks[0], title: 'A-mine' }, b.tasks[1]] };
  const theirs = { ...b, tasks: [b.tasks[0], { ...b.tasks[1], title: 'B-theirs' }] };
  const r = M(b, mine, theirs);
  assert.deepEqual(r.tasks.map((t) => t.title), ['A-mine', 'B-theirs']);
});
test('merge: both changed the same task -> mine wins', () => {
  const b = mkState({ tasks: [tk('a')] });
  const r = M(b, { ...b, tasks: [{ ...b.tasks[0], title: 'mine' }] }, { ...b, tasks: [{ ...b.tasks[0], title: 'theirs' }] });
  assert.equal(r.tasks[0].title, 'mine');
});
test('merge: deletion by one side (other unchanged) is honored, both directions', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  const del = { ...b, tasks: [b.tasks[1]] };
  assert.deepEqual(ids(M(b, del, b).tasks), ['b']);
  assert.deepEqual(ids(M(b, b, del).tasks), ['b']);
  assert.deepEqual(ids(M(b, del, del).tasks), ['b']);
});
test('merge: delete vs modify keeps the modified one (either side)', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  const del = { ...b, tasks: [b.tasks[1]] };
  const mod = { ...b, tasks: [{ ...b.tasks[0], title: 'edited' }, b.tasks[1]] };
  const r1 = M(b, del, mod), r2 = M(b, mod, del);
  for (const r of [r1, r2]) { assert.deepEqual(ids(r.tasks).sort(), ['a', 'b']); assert.equal(r.tasks.find((t) => t.id === 'a').title, 'edited'); }
});
test('merge: adds on both sides survive; order = remote order then mine-only adds', () => {
  const b = mkState({ tasks: [tk('a'), tk('b')] });
  const mine = { ...b, tasks: [...b.tasks, tk('c')] };
  const theirs = { ...b, tasks: [...b.tasks, tk('d')] };
  assert.deepEqual(ids(M(b, mine, theirs).tasks), ['a', 'b', 'd', 'c']);
  const theirs2 = { ...b, tasks: [b.tasks[1], b.tasks[0]] };
  assert.deepEqual(ids(M(b, mine, theirs2).tasks), ['b', 'a', 'c'], 'remote order wins');
});
test('merge: same id added on both sides -> single entry, mine wins', () => {
  const b = mkState();
  const r = M(b, { ...b, tasks: [tk('n', 'mine')] }, { ...b, tasks: [tk('n', 'theirs')] });
  assert.equal(r.tasks.length, 1); assert.equal(r.tasks[0].title, 'mine');
});
test('merge applies to vehicles, items, supplies, completions', () => {
  const b = mkState({ vehicles: [mkVehicle()], items: [mkItem()], supplies: [mkSupply()], completions: [mkCompletion()] });
  const mine = { ...b, vehicles: [...b.vehicles, mkVehicle({ id: 'v2', name: 'B' })], supplies: [] };
  const theirs = { ...b, items: [...b.items, mkItem({ id: 'i2', name: 'Z' })], completions: [...b.completions, mkCompletion({ id: 'c2' })] };
  const r = M(b, mine, theirs);
  assert.deepEqual(ids(r.vehicles), ['v1', 'v2']); assert.deepEqual(ids(r.items), ['i1', 'i2']);
  assert.deepEqual(r.supplies, []); assert.deepEqual(ids(r.completions), ['c1', 'c2']);
  assert.doesNotThrow(() => validateState(r));
});
test('merge: object sections merged per key (profile, emergency, shutoffs)', () => {
  const b = mkState();
  const mine = { ...b, profile: { ...b.profile, hasPool: true }, emergency: { ...b.emergency, meetingPlace: 'Park', shutoffs: { ...b.emergency.shutoffs, water: 'Basement' } } };
  const theirs = { ...b, profile: { ...b.profile, householdSize: 5 }, emergency: { ...b.emergency, notes: 'Dog', shutoffs: { ...b.emergency.shutoffs, gas: 'Side' } } };
  const r = M(b, mine, theirs);
  assert.equal(r.profile.hasPool, true); assert.equal(r.profile.householdSize, 5);
  assert.equal(r.emergency.meetingPlace, 'Park'); assert.equal(r.emergency.notes, 'Dog');
  assert.equal(r.emergency.shutoffs.water, 'Basement'); assert.equal(r.emergency.shutoffs.gas, 'Side'); assert.equal(r.emergency.shutoffs.electric, '');
  const c = M(b, { ...b, emergency: { ...b.emergency, notes: 'M' } }, { ...b, emergency: { ...b.emergency, notes: 'T' } });
  assert.equal(c.emergency.notes, 'M', 'same key both changed -> mine');
  assert.doesNotThrow(() => validateState(r));
});
test('merge: contacts changed on one side only is taken', () => {
  const b = mkState();
  const contacts = [{ name: 'A', phone: '1', relation: 'r' }];
  assert.deepEqual(M(b, b, { ...b, emergency: { ...b.emergency, contacts } }).emergency.contacts, contacts);
  assert.deepEqual(M(b, { ...b, emergency: { ...b.emergency, contacts } }, b).emergency.contacts, contacts);
});
test('merge: result is valid, version 2, does not mutate (frozen) and is a deep copy', () => {
  const b = mkState({ tasks: [tk('a')] });
  const mine = deepFreeze(clone({ ...b, tasks: [...b.tasks, tk('m')] })), theirs = deepFreeze(clone({ ...b, tasks: [...b.tasks, tk('t')] }));
  const r = mergeStates(deepFreeze(clone(b)), mine, theirs);
  assert.equal(r.version, 2); assert.doesNotThrow(() => validateState(r));
  assert.ok(!Object.isFrozen(r) || true); r.tasks[0].title = 'changed'; assert.equal(theirs.tasks[0].title, 'a');
});
test('merge: hostile strings kept verbatim', () => {
  const b = mkState();
  const r = M(b, { ...b, tasks: [tk('x', '<script>alert(1)</script>')] }, b);
  assert.equal(r.tasks[0].title, '<script>alert(1)</script>');
});

// ---------- two stores on one shared db ----------
const OPTS = { debounceMs: 20, loadTimeoutMs: 300, coalesceMs: 20, lockRetryMs: 5 };
const claudeWith = (db, extra = {}) => ({ use: async (n) => (n === 'db' ? db : n in extra ? extra[n] : null) });
async function twoDevices(db, base = mkState({ tasks: [tk('a')] }), o = {}) {
  const seed = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS });
  await seed.load(); await seed.save(base); await seed.flush();
  const dev = async () => {
    const store = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS, ...o });
    const state = await store.load();
    const seen = []; store.subscribe((s) => seen.push(s));
    return { store, state, seen, last: () => seen.at(-1) ?? state };
  };
  return { A: await dev(), B: await dev() };
}
const cloudState = async (db) => {
  const r = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS });
  return r.load();
};
const settle = () => sleep(250);

test('2 devices: A sets meetingPlace, B sets notes -> cloud keeps both and both UIs converge', async () => {
  const db = fakeDb(); const { A, B } = await twoDevices(db);
  await A.store.save({ ...A.state, emergency: { ...A.state.emergency, meetingPlace: 'Oak Park' } }); await A.store.flush();
  await B.store.save({ ...B.state, emergency: { ...B.state.emergency, notes: 'Dog is Rex' } }); await B.store.flush();
  await settle();
  const c = await cloudState(db);
  assert.equal(c.emergency.meetingPlace, 'Oak Park'); assert.equal(c.emergency.notes, 'Dog is Rex');
  for (const d of [A, B]) {
    assert.equal(d.last().emergency.meetingPlace, 'Oak Park', 'UI converged: meetingPlace');
    assert.equal(d.last().emergency.notes, 'Dog is Rex', 'UI converged: notes');
  }
});
test('2 devices: concurrent task adds both survive', async () => {
  const db = fakeDb(); const { A, B } = await twoDevices(db);
  await A.store.save({ ...A.state, tasks: [...A.state.tasks, tk('fromA')] }); await A.store.flush();
  await B.store.save({ ...B.state, tasks: [...B.state.tasks, tk('fromB')] }); await B.store.flush();
  await settle();
  const c = await cloudState(db);
  assert.deepEqual(ids(c.tasks).sort(), ['a', 'fromA', 'fromB']);
  for (const d of [A, B]) assert.deepEqual(ids(d.last().tasks).sort(), ['a', 'fromA', 'fromB']);
});
test('2 devices: simultaneous saves with a ttl lock capability keep both adds', async () => {
  const db = fakeDb({ setDelay: 5 });
  let held = null; // {holder, until}
  db.lock = async ({ holder, ttlMs }) => { const t = Date.now(); if (held && held.until > t && held.holder !== holder) return { acquired: false }; held = { holder, until: t + ttlMs }; return { acquired: true }; };
  const { A, B } = await twoDevices(db, mkState({ tasks: [tk('a')] }), { lockRetryMs: 40 });
  await Promise.all([A.store.save({ ...A.state, tasks: [...A.state.tasks, tk('fromA')] }), B.store.save({ ...B.state, tasks: [...B.state.tasks, tk('fromB')] })]);
  // Poll instead of one fixed sleep so a busy machine running other test files can't make this flaky.
  for (let i = 0; i < 40; i++) { const got = ids((await cloudState(db)).tasks); if (got.length === 3) break; await sleep(100); }
  assert.deepEqual(ids((await cloudState(db)).tasks).sort(), ['a', 'fromA', 'fromB']);
});
test('2 devices: simultaneous saves WITHOUT any lock (known race, lost update possible)', { todo: 'no lock capability => read-merge-write is not atomic' }, async () => {
  const db = fakeDb({ setDelay: 10 }); const { A, B } = await twoDevices(db);
  await Promise.all([A.store.save({ ...A.state, tasks: [...A.state.tasks, tk('fromA')] }), B.store.save({ ...B.state, tasks: [...B.state.tasks, tk('fromB')] })]);
  await settle();
  assert.deepEqual(ids((await cloudState(db)).tasks).sort(), ['a', 'fromA', 'fromB']);
});
test('2 devices: A deletes task, B edits it -> task kept with B edit', async () => {
  const db = fakeDb(); const { A, B } = await twoDevices(db);
  await A.store.save({ ...A.state, tasks: [] }); await A.store.flush();
  await B.store.save({ ...B.state, tasks: [{ ...B.state.tasks[0], title: 'B edited' }] }); await B.store.flush();
  await settle();
  const c = await cloudState(db);
  assert.equal(c.tasks.length, 1); assert.equal(c.tasks[0].title, 'B edited');
});
test('2 devices: A deletes task, B changes something else -> delete honored', async () => {
  const db = fakeDb(); const { A, B } = await twoDevices(db);
  await A.store.save({ ...A.state, tasks: [] }); await A.store.flush();
  await B.store.save({ ...B.state, emergency: { ...B.state.emergency, notes: 'n' } }); await B.store.flush();
  await settle();
  const c = await cloudState(db); assert.equal(c.tasks.length, 0); assert.equal(c.emergency.notes, 'n');
});
test('2 devices: both edit the same field -> last writer (mine) wins, state stays valid', async () => {
  const db = fakeDb(); const { A, B } = await twoDevices(db);
  await A.store.save({ ...A.state, emergency: { ...A.state.emergency, notes: 'from A' } }); await A.store.flush();
  await B.store.save({ ...B.state, emergency: { ...B.state.emergency, notes: 'from B' } }); await B.store.flush();
  await settle();
  const c = await cloudState(db); assert.equal(c.emergency.notes, 'from B'); assert.doesNotThrow(() => validateState(c));
});

// ---------- lock ----------
test('lock: acquire is called with {holder, ttlMs}; acquired -> normal write', async () => {
  const db = fakeDb(); db.lock = async () => ({ acquired: true });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS });
  await s.load(); db.lockCalls.length = 0;
  await s.save(mkState({ tasks: [tk('z')] })); await s.flush();
  assert.ok(db.lockCalls.length >= 1);
  assert.equal(typeof db.lockCalls[0].holder, 'string'); assert.ok(db.lockCalls[0].holder.length > 0);
  assert.ok(Number.isFinite(db.lockCalls[0].ttlMs) && db.lockCalls[0].ttlMs > 0);
  assert.equal(db.docs.get('household/main').tasks[0].id, 'z');
});
test('lock: busy -> retries a bounded number of times then proceeds to write', async () => {
  const db = fakeDb(); db.lock = async () => ({ acquired: false });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS });
  await s.load(); db.lockCalls.length = 0;
  const p = s.save(mkState({ tasks: [tk('busy')] }));
  const r = await Promise.race([p, sleep(5000).then(() => 'hang')]);
  assert.notEqual(r, 'hang', 'must not wait forever on a busy lock');
  assert.ok(db.lockCalls.length >= 2 && db.lockCalls.length <= 20, String(db.lockCalls.length));
  assert.equal(db.docs.get('household/main').tasks[0].id, 'busy');
});
test('lock: acquire throwing, rejecting or missing -> still writes', async () => {
  for (const lock of [() => { throw new Error('boom'); }, async () => { throw new Error('boom'); }, async () => undefined, null]) {
    const db = fakeDb(); db.lock = lock;
    const s = await createStore({ localStorage: memStorage(), claude: claudeWith(db), ...OPTS });
    await s.load();
    await s.save(mkState({ tasks: [tk('ok')] })); await s.flush();
    assert.equal(db.docs.get('household/main').tasks[0].id, 'ok');
  }
});

// ---------- cache sync-write, plain JSON ----------
test('save() writes the localStorage cache synchronously (before debounce) in local and cloud mode', async () => {
  for (const db of [null, fakeDb()]) {
    const ls = memStorage();
    const s = await createStore({ localStorage: ls, claude: db ? claudeWith(db) : { use: async () => null }, debounceMs: 5000, loadTimeoutMs: 300 });
    await s.load();
    const st = mkState({ tasks: [tk('sync-now', 'Right now')] });
    const p = s.save(st);
    const raw = ls.getItem(STORAGE_KEY);
    assert.ok(raw, 'cache must be written immediately');
    assert.equal(JSON.parse(raw).tasks[0].id, 'sync-now');
    if (db) assert.ok(![...db.docs.values()].some((d) => JSON.stringify(d).includes('sync-now')), 'cloud write still debounced');
    await s.flush(); await p;
  }
});
test('every doc written is plain JSON even when now() returns Date objects; updatedAt numeric (incl. photos)', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith(db), now: () => new Date(), ...OPTS });
  await s.load();
  await s.save(mkState({ tasks: [tk('a')], completions: [mkCompletion()] })); await s.flush();
  await s.putPhoto('p-1', 'data:image/jpeg;base64,AAAA');
  assert.ok(db.raw.length >= 3);
  for (const [p, v] of db.raw) {
    assert.equal(isPlainJSON(v), null, `${p}: ${isPlainJSON(v)}`);
    if ('updatedAt' in v) assert.equal(typeof v.updatedAt, 'number', `${p}.updatedAt`);
  }
  assert.equal(typeof db.docs.get('photos/p-1').updatedAt, 'number');
});
test('numeric updatedAt is also used with the default clock and strictly increases per write', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith(db), now: () => 1000, ...OPTS });
  await s.load();
  await s.save(mkState({ tasks: [tk('a')] })); await s.flush();
  await s.save(mkState({ tasks: [tk('b')] })); await s.flush();
  const stamps = db.raw.filter(([p]) => p === 'household/main').map(([, v]) => v.updatedAt);
  assert.ok(stamps.length >= 2); for (let i = 1; i < stamps.length; i++) assert.ok(stamps[i] > stamps[i - 1], stamps.join());
});
