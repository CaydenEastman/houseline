import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/sync.js';
import { STORAGE_KEY, validateState, migrate } from '../src/storage.js';
import { mkState, mkTask, memStorage, quotaStorage, clone, v1Fixture } from './helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fake Firestore-like db capability (shape assumed from the db capability: doc(path).get/set/delete/onSnapshot)
function fakeDb({ hang = false, failSet = false, setDelay = 0 } = {}) {
  const docs = new Map(), listeners = new Map(), writes = [];
  const o = { docs, writes, hang, failSet, active: 0, maxActive: 0, unsubscribed: 0 };
  const snap = (p) => { const v = docs.get(p); return { exists: v !== undefined, data: () => (v === undefined ? undefined : clone(v)) }; };
  const colSnap = (name) => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.slice(name.length + 1), exists: true, data: () => clone(v) })) });
  const emit = (p) => {
    for (const cb of [...(listeners.get(p) || [])]) cb(snap(p));
    const col = p.split('/')[0];
    for (const cb of [...(listeners.get('col:' + col) || [])]) cb(colSnap(col));
  };
  o.sizes = []; o.maxDoc = 0;
  o.collection = (name) => ({
    async get() { if (o.hang) return new Promise(() => {}); return colSnap(name); },
    onSnapshot(cb) { const k = 'col:' + name; if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(cb); queueMicrotask(() => cb(colSnap(name))); return () => listeners.get(k).delete(cb); },
  });
  o.remoteSet = (p, v) => { docs.set(p, clone(v)); emit(p); };
  o.doc = (p) => ({
    async get() { if (o.hang) return new Promise(() => {}); return snap(p); },
    async set(v) {
      o.active++; o.maxActive = Math.max(o.maxActive, o.active);
      try {
        if (setDelay) await sleep(setDelay);
        if (o.failSet) throw new Error('network down');
        const bytes = Buffer.byteLength(JSON.stringify(v)); o.maxDoc = Math.max(o.maxDoc, bytes); o.sizes.push([p, bytes]);
        if (bytes > 250_000) throw new Error('document too large');
        writes.push([p, clone(v)]); docs.set(p, clone(v)); emit(p);
      } finally { o.active--; }
    },
    async delete() { docs.delete(p); },
    onSnapshot(cb) { if (!listeners.has(p)) listeners.set(p, new Set()); listeners.get(p).add(cb); queueMicrotask(() => cb(snap(p))); return () => { listeners.get(p).delete(cb); o.unsubscribed++; }; },
  });
  return o;
}
const claudeWith = (caps) => ({ use: async (n) => (n in caps ? caps[n] : null) });
const OPTS = { debounceMs: 25, loadTimeoutMs: 80 };
const stateWith = (title) => mkState({ tasks: [mkTask({ title })] });
const stateWrites = (db) => db.writes.filter(([p]) => p === 'household/main');

test('local mode when db capability is absent / claude missing / use throws', async () => {
  for (const claude of [claudeWith({}), undefined, { use: async () => { throw new Error('x'); } }, { use: () => { throw new Error('sync boom'); } }]) {
    const s = await createStore({ localStorage: memStorage(), claude, ...OPTS });
    assert.equal(s.mode, 'local');
    const st = await s.load();
    assert.equal(st.version, 2); assert.doesNotThrow(() => validateState(st));
  }
});
test('local load: migrates v1 data; fresh when empty', async () => {
  const ls = memStorage({ [STORAGE_KEY]: JSON.stringify(v1Fixture()) });
  const s = await createStore({ localStorage: ls, claude: claudeWith({}), ...OPTS });
  const st = await s.load();
  assert.equal(st.version, 2); assert.equal(st.tasks.length, 3);
  const s2 = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  assert.equal((await s2.load()).profile.setupDone, false);
});
test('local save: cache written synchronously on each save(); final content is last state; unchanged re-save keeps content', async () => {
  const ls = memStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({}), ...OPTS });
  await s.load();
  const a = stateWith('A'), b = stateWith('B'), c = stateWith('C');
  const ps = [s.save(a)];
  assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, 'A', 'sync cache write');
  ps.push(s.save(b), s.save(c));
  await Promise.all(ps);
  assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, 'C');
  await s.save(clone(c)); assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, 'C');
});
test('local save never throws: quota exceeded -> error status', async () => {
  const ls = quotaStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({}), ...OPTS });
  await s.load();
  const events = []; s.onStatus((e) => events.push(e));
  await assert.doesNotReject(async () => { await s.save(stateWith('X')); });
  assert.ok(events.some((e) => e.kind === 'error' || e.kind === 'offline'), JSON.stringify(events));
  assert.ok(events.every((e) => ['saved', 'saving', 'error', 'offline'].includes(e.kind) && typeof e.message === 'string'));
});
test('save of invalid state reports error instead of throwing', async () => {
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  await s.load();
  const events = []; s.onStatus((e) => events.push(e));
  await assert.doesNotReject(async () => { await s.save({ version: 2, bogus: true }); });
  assert.ok(events.some((e) => e.kind === 'error'));
});
test('status: saving then saved; onStatus unsubscribe works', async () => {
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  await s.load();
  const ev = []; const off = s.onStatus((e) => ev.push(e.kind));
  await s.save(stateWith('S'));
  assert.ok(ev.includes('saving') && ev.at(-1) === 'saved', ev.join());
  off(); const n = ev.length; await s.save(stateWith('S2')); assert.equal(ev.length, n);
});
test('a throwing status listener does not break saves', async () => {
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  await s.load(); s.onStatus(() => { throw new Error('listener'); });
  await assert.doesNotReject(async () => { await s.save(stateWith('L')); });
});
test('flush() writes immediately without waiting for debounce', async () => {
  const ls = memStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({}), debounceMs: 5000, loadTimeoutMs: 80 });
  await s.load();
  s.save(stateWith('F'));
  await s.flush();
  assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, 'F');
});

test('cloud: mode, load existing doc (migrated+validated), caches locally', async () => {
  const db = fakeDb(); const ls = memStorage();
  db.docs.set('household/main', { ...migrate(v1Fixture()), completions: undefined, updatedAt: 1, updatedBy: 'other' });
  const s = await createStore({ localStorage: ls, claude: claudeWith({ db }), ...OPTS });
  assert.equal(s.mode, 'cloud');
  const st = await s.load();
  assert.equal(st.version, 2); assert.equal(st.tasks.length, 3);
  assert.equal(stateWrites(db).length, 0, 'must not overwrite existing cloud doc');
  assert.ok(ls.m.has(STORAGE_KEY));
});
test('cloud empty: adopts local data (migrated) and writes it', async () => {
  const db = fakeDb(); const ls = memStorage({ [STORAGE_KEY]: JSON.stringify(v1Fixture()) });
  const s = await createStore({ localStorage: ls, claude: claudeWith({ db }), ...OPTS });
  const st = await s.load();
  assert.equal(st.tasks.length, 3); assert.equal(st.version, 2);
  const w = stateWrites(db);
  assert.equal(w.length, 1);
  assert.equal(w[0][1].version, 2); assert.equal(w[0][1].tasks.length, 3);
  assert.equal(typeof w[0][1].updatedAt, 'number'); assert.ok(w[0][1].updatedBy);
});
test('cloud empty + local empty: writes fresh state', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  const st = await s.load();
  assert.equal(st.profile.setupDone, false);
  assert.equal(stateWrites(db).length, 1);
});
test('cloud load timeout falls back to local with warning', async () => {
  const db = fakeDb({ hang: true });
  const ls = memStorage({ [STORAGE_KEY]: JSON.stringify(v1Fixture()) });
  const s = await createStore({ localStorage: ls, claude: claudeWith({ db }), ...OPTS });
  const t0 = Date.now();
  const st = await s.load();
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(s.mode, 'local'); assert.equal(typeof s.warning, 'string'); assert.ok(s.warning.length > 0);
  assert.equal(st.tasks.length, 3);
});
test('cloud get rejecting falls back to local', async () => {
  const db = fakeDb(); db.doc = () => ({ get: async () => { throw new Error('denied'); }, set: async () => {}, onSnapshot: () => () => {} });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  const st = await s.load();
  assert.equal(s.mode, 'local'); assert.doesNotThrow(() => validateState(st));
});
test('cloud doc with corrupt state: load resolves to a valid state and does not clobber cloud', async () => {
  const db = fakeDb(); db.docs.set('household/main', { version: 9, junk: true, updatedAt: 1, updatedBy: 'o' });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  let st; await assert.doesNotReject(async () => { st = await s.load(); });
  assert.doesNotThrow(() => validateState(st));
  assert.equal(stateWrites(db).length, 0);
});
test('cloud save: debounce burst -> single write of last state; unchanged -> no write; cache in localStorage', async () => {
  const db = fakeDb(); const ls = memStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({ db }), ...OPTS });
  const base = await s.load();
  const n0 = stateWrites(db).length;
  await Promise.all([s.save(stateWith('1')), s.save(stateWith('2')), s.save(stateWith('3'))]);
  assert.equal(stateWrites(db).length, n0 + 1);
  assert.equal(stateWrites(db).at(-1)[1].tasks[0].title, '3');
  assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, '3');
  await s.save(stateWith('3')); assert.equal(stateWrites(db).length, n0 + 1, 'unchanged');
  await s.save(clone(base)); // changed back -> write
  assert.equal(stateWrites(db).length, n0 + 2);
});
test('cloud save: saving the just-loaded state does not write', async () => {
  const db = fakeDb(); db.docs.set('household/main', { ...stateWith('Q'), completions: undefined, updatedAt: 1, updatedBy: 'o' });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  const st = await s.load(); await s.save(st);
  assert.equal(stateWrites(db).length, 0);
});
test('cloud save: one write at a time', async () => {
  const db = fakeDb({ setDelay: 30 });
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const p1 = s.save(stateWith('a')); await sleep(40); const p2 = s.save(stateWith('b')); await sleep(10); const p3 = s.save(stateWith('c'));
  await Promise.all([p1, p2, p3]); await s.flush();
  assert.equal(db.maxActive, 1);
  assert.equal(stateWrites(db).at(-1)[1].tasks[0].title, 'c');
});
test('cloud save failure: no throw, offline/error status, local cache still written, retry later works', async () => {
  const db = fakeDb(); const ls = memStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const ev = []; s.onStatus((e) => ev.push(e.kind));
  db.failSet = true;
  await assert.doesNotReject(async () => { await s.save(stateWith('N')); });
  assert.ok(ev.includes('offline') || ev.includes('error'), ev.join());
  assert.equal(JSON.parse(ls.m.get(STORAGE_KEY)).tasks[0].title, 'N');
  db.failSet = false;
  await s.save(stateWith('N')); // same content as failed one must still be retried
  assert.equal(stateWrites(db).at(-1)[1].tasks[0].title, 'N');
});

test('subscribe: remote change delivered, own echo ignored, unsubscribe stops', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const got = []; const off = s.subscribe((st) => got.push(st));
  assert.equal(typeof off, 'function');
  await s.save(stateWith('mine'));
  await sleep(10);
  assert.equal(got.length, 0, 'own write echoed back');
  db.remoteSet('household/main', { ...stateWith('theirs'), updatedAt: Date.now() + 5, updatedBy: 'someone-else' });
  await sleep(150);
  assert.equal(got.length, 1); assert.equal(got[0].tasks[0].title, 'theirs'); assert.equal(got[0].version, 2);
  off();
  db.remoteSet('household/main', { ...stateWith('later'), updatedAt: Date.now() + 9, updatedBy: 'someone-else' });
  await sleep(150);
  assert.equal(got.length, 1);
});
test('subscribe: remote doc with invalid state is ignored without throwing', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const got = []; s.subscribe((st) => got.push(st));
  assert.doesNotThrow(() => db.remoteSet('household/main', { version: 2, tasks: 'bad', updatedAt: 9e12, updatedBy: 'x' }));
  await sleep(150);
  assert.equal(got.length, 0);
});
test('subscribe in local mode is a harmless no-op', async () => {
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  const off = s.subscribe(() => { throw new Error('never'); });
  assert.equal(typeof off, 'function'); assert.doesNotThrow(() => off());
});
test('remote identical to our last state is not re-delivered', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load(); await s.save(stateWith('same'));
  const got = []; s.subscribe((st) => got.push(st));
  db.remoteSet('household/main', { ...stateWith('same'), updatedAt: Date.now() + 100, updatedBy: 'other' });
  await sleep(150);
  assert.equal(got.length, 0);
});

test('photos local: put/get/delete via motH.photo.<id>; missing -> null', async () => {
  const ls = memStorage();
  const s = await createStore({ localStorage: ls, claude: claudeWith({}), ...OPTS });
  const url = 'data:image/jpeg;base64,AAAA';
  await s.putPhoto('p-1', url);
  assert.equal(ls.m.get('motH.photo.p-1'), url);
  assert.equal(await s.getPhoto('p-1'), url);
  assert.equal(await s.getPhoto('p-nope'), null);
  await s.deletePhoto('p-1'); assert.equal(await s.getPhoto('p-1'), null);
  await assert.doesNotReject(() => s.deletePhoto('p-nope'));
});
test('photos local: quota exceeded -> clear Error', async () => {
  const s = await createStore({ localStorage: quotaStorage(), claude: claudeWith({}), ...OPTS });
  await assert.rejects(() => s.putPhoto('p-1', 'data:image/jpeg;base64,AAAA'), (e) => e instanceof Error && e.message.length > 10);
});
test('photos cloud: stored at photos/<id>, round-trips, delete', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.putPhoto('p-9', 'data:image/jpeg;base64,BBBB');
  assert.ok(db.docs.has('photos/p-9'));
  assert.equal(await s.getPhoto('p-9'), 'data:image/jpeg;base64,BBBB');
  assert.equal(await s.getPhoto('p-none'), null);
  await s.deletePhoto('p-9'); assert.equal(await s.getPhoto('p-9'), null);
});
test('photos are not part of the state document', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load(); await s.putPhoto('p-9', 'data:image/jpeg;base64,BBBB');
  assert.ok(!JSON.stringify(stateWrites(db)).includes('BBBB'));
});

test('whoAmI: no user cap -> id null; with user -> id/isOwner', async () => {
  const a = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  assert.deepEqual(await a.whoAmI(), { id: null, isOwner: false });
  const user = { id: async () => 'u1', isOwner: async () => true, profiles: async () => ({}) };
  const b = await createStore({ localStorage: memStorage(), claude: claudeWith({ user }), ...OPTS });
  assert.deepEqual(await b.whoAmI(), { id: 'u1', isOwner: true });
  const bad = { id: async () => { throw new Error('x'); }, isOwner: async () => { throw new Error('y'); } };
  const c = await createStore({ localStorage: memStorage(), claude: claudeWith({ user: bad }), ...OPTS });
  const r = await c.whoAmI(); assert.equal(r.id, null); assert.equal(r.isOwner, false);
});
test('names: resolves, falls back to "Someone"', async () => {
  const user = { id: async () => 'u1', isOwner: async () => false, profiles: async (ids) => ({ u1: { name: 'Ann' }, u2: { name: '' } }) };
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ user }), ...OPTS });
  assert.deepEqual(await s.names(['u1', 'u2', 'u3']), { u1: 'Ann', u2: 'Someone', u3: 'Someone' });
  assert.deepEqual(await s.names([]), {});
  const s2 = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  assert.deepEqual(await s2.names(['u1']), { u1: 'Someone' });
  const bad = { profiles: async () => { throw new Error('x'); } };
  const s3 = await createStore({ localStorage: memStorage(), claude: claudeWith({ user: bad }), ...OPTS });
  assert.deepEqual(await s3.names(['u1']), { u1: 'Someone' });
});
test('saveFile: uses downloads.save({filename,data}); false when unavailable/declined; never throws', async () => {
  const calls = [];
  const dl = { save: async (a) => { calls.push(a); } };
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: dl }), ...OPTS });
  assert.equal(await s.saveFile('a.html', '<p>x</p>', 'text/html'), true);
  assert.equal(calls[0].filename, 'a.html'); assert.equal(calls[0].data, '<p>x</p>');
  const none = await createStore({ localStorage: memStorage(), claude: claudeWith({}), ...OPTS });
  assert.equal(await none.saveFile('a.ics', 'x', 'text/calendar'), false);
  const declines = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: { save: async () => { throw new Error('user declined'); } } }), ...OPTS });
  assert.equal(await declines.saveFile('a.ics', 'x', 'text/calendar'), false);
  const syncThrow = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: { save: () => { throw new Error('sync'); } } }), ...OPTS });
  assert.equal(await syncThrow.saveFile('a.ics', 'x', 'text/calendar'), false);
});

// ---------- sharded cloud layout (household/main without completions + history/<year>[-x]) ----------
const comp = (i, year, o = {}) => ({ id: 'c' + i, taskId: 't1', title: 'Task', category: 'house', date: `${year}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, kind: 'done', cost: null, notes: 'n'.repeat(80), odometer: null, by: null, photoIds: [], ...o });
const withComps = (cs, title = 'T') => mkState({ tasks: [mkTask({ title })], completions: cs });
const histWrites = (db) => db.writes.filter(([p]) => p.startsWith('history/'));
const histPaths = (db) => [...db.docs.keys()].filter((p) => p.startsWith('history/'));
const body = (v) => { const { updatedAt, updatedBy, ...r } = v; return r; };
const allComps = (db) => histPaths(db).flatMap((p) => db.docs.get(p).completions);

test('shard: main has no completions; completions land in history/<year> docs', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const cs = [comp(1, 2025), comp(2, 2025), comp(3, 2026)];
  await s.save(withComps(cs)); await s.flush();
  const main = db.docs.get('household/main');
  assert.ok(!main.completions || main.completions.length === 0);
  assert.ok(!JSON.stringify(main).includes('"c1"'));
  assert.deepEqual(histPaths(db).sort(), ['history/2025', 'history/2026']);
  assert.deepEqual(db.docs.get('history/2025').completions.map((c) => c.id).sort(), ['c1', 'c2']);
  assert.deepEqual(db.docs.get('history/2026').completions.map((c) => c.id), ['c3']);
});
test('shard: load reassembles full state from main + history docs', async () => {
  const db = fakeDb();
  const writer = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await writer.load();
  const cs = [comp(1, 2024), comp(2, 2025), comp(3, 2026), comp(4, 2026)];
  const st = withComps(cs, 'Shared');
  await writer.save(st); await writer.flush();
  const reader = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  const got = await reader.load();
  assert.equal(got.tasks[0].title, 'Shared');
  assert.deepEqual(got.completions.map((c) => c.id).sort(), ['c1', 'c2', 'c3', 'c4']);
  assert.doesNotThrow(() => validateState(got));
});
test('shard: 3000 completions -> every doc stays under ~220,000 bytes, none lost', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const cs = Array.from({ length: 3000 }, (_, i) => comp(i, 2026, { notes: 'x'.repeat(150), photoIds: ['p-aaaaaaaa'] }));
  await s.save(withComps(cs)); await s.flush();
  assert.ok(db.maxDoc <= 220_000, `largest doc ${db.maxDoc}`);
  for (const p of histPaths(db)) assert.match(p, /^history\/2026(-[a-z]+)?$/);
  assert.ok(histPaths(db).length >= 2, 'must have split into multiple shards');
  assert.equal(allComps(db).length, 3000);
  assert.equal(new Set(allComps(db).map((c) => c.id)).size, 3000);
  const reader = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  assert.equal((await reader.load()).completions.length, 3000);
});
test('shard: only changed shards are written', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  const base = [comp(1, 2025), comp(2, 2026)];
  await s.save(withComps(base)); await s.flush();
  db.writes.length = 0;
  await s.save(withComps([...base, comp(3, 2026)])); await s.flush();
  assert.deepEqual(db.writes.map(([p]) => p), ['history/2026'], JSON.stringify(db.writes.map(([p]) => p)));
  db.writes.length = 0;
  await s.save(withComps([...base, comp(3, 2026)], 'Renamed')); await s.flush();
  assert.deepEqual(db.writes.map(([p]) => p), ['household/main']);
  db.writes.length = 0;
  await s.save(withComps([...base, comp(3, 2026)], 'Renamed')); await s.flush();
  assert.equal(db.writes.length, 0);
});
test('shard: removing all completions of a year does not resurrect them on reload', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  await s.save(withComps([comp(1, 2025), comp(2, 2026)])); await s.flush();
  await s.save(withComps([comp(2, 2026)])); await s.flush();
  const reader = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  assert.deepEqual((await reader.load()).completions.map((c) => c.id), ['c2']);
});
test('shard: subscribe delivers remote history-only and main-only changes; ignores own echo', async () => {
  const db = fakeDb();
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ db }), ...OPTS });
  await s.load();
  await s.save(withComps([comp(1, 2026)])); await s.flush();
  const got = []; s.subscribe((st) => got.push(st));
  await s.save(withComps([comp(1, 2026), comp(2, 2026)])); await s.flush(); await sleep(150);
  assert.equal(got.length, 0, 'own shard writes echoed back');
  const hist = db.docs.get('history/2026');
  db.remoteSet('history/2026', { completions: [...hist.completions, comp(9, 2026)], updatedAt: Date.now() + 1000, updatedBy: 'other' });
  await sleep(150);
  assert.equal(got.length, 1); assert.deepEqual(got[0].completions.map((c) => c.id).sort(), ['c1', 'c2', 'c9']);
  const main = db.docs.get('household/main');
  db.remoteSet('household/main', { ...main, tasks: [mkTask({ title: 'Remote edit' })], updatedAt: Date.now() + 2000, updatedBy: 'other' });
  await sleep(150);
  assert.equal(got.at(-1).tasks[0].title, 'Remote edit'); assert.equal(got.at(-1).completions.length, 3);
});
test('saveFile retries .ics as .ics.txt on rejected_extension', async () => {
  const calls = [];
  const dl = { save: async (a) => { calls.push(a.filename); if (a.filename.endsWith('.ics')) { const e = new Error('no'); e.code = 'rejected_extension'; throw e; } } };
  const s = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: dl }), ...OPTS });
  assert.equal(await s.saveFile('cal.ics', 'BEGIN', 'text/calendar'), true);
  assert.deepEqual(calls, ['cal.ics', 'cal.ics.txt']);
  const always = { save: async () => { const e = new Error('no'); e.code = 'rejected_extension'; throw e; } };
  const s2 = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: always }), ...OPTS });
  assert.equal(await s2.saveFile('cal.ics', 'x', 'text/calendar'), false);
  const other = []; const s3 = await createStore({ localStorage: memStorage(), claude: claudeWith({ downloads: { save: async (a) => { other.push(a.filename); const e = new Error('no'); e.code = 'user_declined'; throw e; } } }), ...OPTS });
  assert.equal(await s3.saveFile('cal.ics', 'x', 'text/calendar'), false);
  assert.deepEqual(other, ['cal.ics'], 'no retry for other errors');
});
