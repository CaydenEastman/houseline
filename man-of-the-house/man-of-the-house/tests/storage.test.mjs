import test from 'node:test';
import assert from 'node:assert/strict';
import { loadState, saveState, exportJSON, importJSON, validateState, STORAGE_KEY, BACKUP_KEY, STATE_VERSION, MAX_STATE_BYTES, freshState } from '../src/storage.js';
import { mkState, mkTask, mkVehicle, mkItem, mkSupply, mkCompletion, memStorage, quotaStorage, clone, v1Fixture } from './helpers.mjs';

const good = () => mkState({
  vehicles: [mkVehicle({ odometerLog: [{ date: '2026-05-01', odometer: 49000 }, { date: '2026-06-01', odometer: 50000 }] })],
  items: [mkItem({ photoIds: ['p-1'] })],
  supplies: [mkSupply({ key: 'water' })],
  tasks: [
    mkTask({ id: 'a', title: 'T', lastDone: '2026-01-02', itemId: 'i1', links: [{ label: 'x', url: 'https://e.com' }] }),
    mkTask({ id: 'b', kind: 'annual', intervalDays: null, month: 10, day: 15 }),
    mkTask({ id: 'c', kind: 'mileage', intervalDays: 180, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 45000 }),
  ],
  completions: [mkCompletion({ id: 'c1', taskId: 'a' }), mkCompletion({ id: 'c2', taskId: 'deleted-task' })],
});

test('constants', () => {
  assert.equal(STATE_VERSION, 2);
  assert.equal(MAX_STATE_BYTES, 900_000);
});
test('good() fixture is valid (guards the other tests)', () => assert.doesNotThrow(() => validateState(good())));

test('freshState: v2, setup not done, defaults, no tasks/vehicles', () => {
  const s = freshState();
  assert.equal(s.version, 2);
  assert.equal(s.profile.setupDone, false);
  assert.equal(s.profile.householdSize, 2); assert.equal(s.profile.homeType, 'house'); assert.equal(s.profile.hasYard, true);
  assert.deepEqual(s.tasks, []); assert.deepEqual(s.vehicles, []); assert.deepEqual(s.completions, []);
  assert.doesNotThrow(() => validateState(s));
  assert.notEqual(freshState(), freshState());
});

test('loadState with empty storage returns a valid fresh v2 state, no backup written', () => {
  const m = memStorage();
  const s = loadState(m);
  assert.equal(s.version, 2); assert.equal(s.profile.setupDone, false);
  assert.doesNotThrow(() => validateState(s));
  assert.equal(m.m.size, 0);
});
test('save then load round trip', () => {
  const m = memStorage();
  saveState(m, good());
  assert.ok(m.m.has(STORAGE_KEY));
  assert.deepEqual(JSON.parse(m.m.get(STORAGE_KEY)), good());
  assert.deepEqual(loadState(m), good());
});
test('loadState migrates stored v1 data to v2', () => {
  const s = loadState(memStorage({ [STORAGE_KEY]: JSON.stringify(v1Fixture()) }));
  assert.equal(s.version, 2); assert.equal(s.tasks.length, 3);
  assert.equal(s.profile.setupDone, true);
  assert.ok(s.tasks.every((t) => t.kind === 'interval'));
});

const bad = (fn) => { const g = good(); fn(g); return g; };
const invalid = {
  'version 3': (g) => { g.version = 3; },
  'version 1': (g) => { g.version = 1; },
  'profile missing': (g) => { delete g.profile; },
  'bad homeType': (g) => { g.profile.homeType = 'castle'; },
  'householdSize 0': (g) => { g.profile.householdSize = 0; },
  'householdSize 21': (g) => { g.profile.householdSize = 21; },
  'householdSize float': (g) => { g.profile.householdSize = 2.5; },
  'hasYard string': (g) => { g.profile.hasYard = 'yes'; },
  'tasks not array': (g) => { g.tasks = {}; },
  'vehicles missing': (g) => { delete g.vehicles; },
  'items null': (g) => { g.items = null; },
  'supplies missing': (g) => { delete g.supplies; },
  'emergency missing': (g) => { delete g.emergency; },
  'bad category': (g) => { g.tasks[0].category = 'zzz'; },
  'bad kind': (g) => { g.tasks[0].kind = 'weekly'; },
  'interval without intervalDays': (g) => { g.tasks[0].intervalDays = null; },
  'intervalDays 1e15': (g) => { g.tasks[0].intervalDays = 1e15; },
  'intervalDays 36501': (g) => { g.tasks[0].intervalDays = 36501; },
  'intervalDays float': (g) => { g.tasks[0].intervalDays = 1.5; },
  'annual without month': (g) => { g.tasks[1].month = null; },
  'annual day 29': (g) => { g.tasks[1].day = 29; },
  'annual month 13': (g) => { g.tasks[1].month = 13; },
  'mileage without vehicleId': (g) => { g.tasks[2].vehicleId = null; },
  'mileage without intervalMiles': (g) => { g.tasks[2].intervalMiles = null; },
  'intervalMiles too big': (g) => { g.tasks[2].intervalMiles = 1000001; },
  'bad lastDone': (g) => { g.tasks[0].lastDone = 'yesterday'; },
  'impossible lastDone 02-30': (g) => { g.tasks[0].lastDone = '2026-02-30'; },
  'leap day in non-leap year': (g) => { g.tasks[0].lastDone = '2026-02-29'; },
  'bad startDate': (g) => { g.tasks[0].startDate = '2026/01/01'; },
  'bad snoozedUntil': (g) => { g.tasks[0].snoozedUntil = 5; },
  'dangling vehicleId': (g) => { g.tasks[2].vehicleId = 'ghost'; },
  'dangling itemId': (g) => { g.tasks[0].itemId = 'ghost'; },
  'javascript link': (g) => { g.tasks[0].links = [{ label: 'x', url: 'javascript:alert(1)' }]; },
  'too many links': (g) => { g.tasks[0].links = Array.from({ length: 6 }, () => ({ label: 'x', url: 'https://a.b' })); },
  'links not array': (g) => { g.tasks[0].links = 'x'; },
  'tags not array of strings': (g) => { g.tasks[0].tags = [1]; },
  'title too long': (g) => { g.tasks[0].title = 'x'.repeat(121); },
  'notes too long': (g) => { g.tasks[0].notes = 'x'.repeat(2001); },
  'empty title': (g) => { g.tasks[0].title = ' '; },
  'duplicate task ids': (g) => { g.tasks[1].id = 'a'; },
  'duplicate vehicle ids': (g) => { g.vehicles.push(mkVehicle()); },
  'duplicate item ids': (g) => { g.items.push(mkItem()); },
  'duplicate supply ids': (g) => { g.supplies.push(mkSupply()); },
  'duplicate completion ids': (g) => { g.completions[1].id = 'c1'; },
  'negative odometer': (g) => { g.vehicles[0].odometer = -1; },
  'float odometer': (g) => { g.vehicles[0].odometer = 1.5; },
  'odometerLog > 60': (g) => { g.vehicles[0].odometerLog = Array.from({ length: 61 }, (_, i) => ({ date: new Date(Date.UTC(2025, 0, 1 + i)).toISOString().slice(0, 10), odometer: i })); },
  'odometerLog not ascending': (g) => { g.vehicles[0].odometerLog = [{ date: '2026-06-01', odometer: 5 }, { date: '2026-05-01', odometer: 6 }]; },
  'odometerLog bad date': (g) => { g.vehicles[0].odometerLog = [{ date: 'x', odometer: 5 }]; },
  'item bad kind': (g) => { g.items[0].kind = 'rocket'; },
  'item >3 photos': (g) => { g.items[0].photoIds = ['a', 'b', 'c', 'd']; },
  'item bad warranty': (g) => { g.items[0].warrantyExpires = 'never'; },
  'supply bad category': (g) => { g.supplies[0].category = 'toys'; },
  'supply negative quantity': (g) => { g.supplies[0].quantity = -1; },
  'supply NaN quantity': (g) => { g.supplies[0].quantity = NaN; },
  'supply bad expires': (g) => { g.supplies[0].expires = '2026-13-01'; },
  'completion bad kind': (g) => { g.completions[0].kind = 'maybe'; },
  'completion bad date': (g) => { g.completions[0].date = 'bad'; },
  'completion negative cost': (g) => { g.completions[0].cost = -1; },
  'completion >3 photos': (g) => { g.completions[0].photoIds = ['a', 'b', 'c', 'd']; },
  'completion bad category': (g) => { g.completions[0].category = 'x'; },
  'completion missing title': (g) => { delete g.completions[0].title; },
  '13 contacts': (g) => { g.emergency.contacts = Array.from({ length: 13 }, () => ({ name: 'a', phone: '1', relation: 'r' })); },
  'shutoffs missing': (g) => { delete g.emergency.shutoffs; },
  'meetingPlace not string': (g) => { g.emergency.meetingPlace = 5; },
};
for (const [name, fn] of Object.entries(invalid)) {
  test(`validateState rejects: ${name}`, () => {
    assert.throws(() => validateState(bad(fn)), Error);
  });
}
test('validateState accepts a task with dangling completion taskId (history survives deletion)', () => {
  assert.doesNotThrow(() => validateState(good()));
  assert.equal(good().completions[1].taskId, 'deleted-task');
});
test('validateState accepts null taskId completions and null references', () => {
  const g = good(); g.completions[0].taskId = null; g.tasks[0].itemId = null;
  assert.doesNotThrow(() => validateState(g));
});
test('validateState accepts max sizes', () => {
  const g = good();
  g.tasks[0].title = 'x'.repeat(120); g.tasks[0].notes = 'n'.repeat(2000);
  g.tasks[0].links = Array.from({ length: 5 }, () => ({ label: 'x', url: 'http://a.b' }));
  g.items[0].photoIds = ['a', 'b', 'c'];
  g.emergency.contacts = Array.from({ length: 12 }, () => ({ name: 'a', phone: '1', relation: 'r' }));
  g.profile.householdSize = 20;
  assert.doesNotThrow(() => validateState(g));
});
test('validateState keeps <script> strings (no mangling)', () => {
  const g = good(); g.tasks[0].title = '<script>alert(1)</script>';
  assert.equal(validateState(g).tasks[0].title, '<script>alert(1)</script>');
});
for (const [name, v] of [['null', null], ['array', []], ['string', 'x'], ['number', 3], ['empty object', {}]]) {
  test(`validateState rejects ${name}`, () => assert.throws(() => validateState(v), Error));
}

for (const [name, raw] of [
  ['invalid JSON', '{not json'], ['empty string', ''], ['null literal', 'null'], ['number', '42'], ['array', '[]'],
  ['string', '"hi"'], ['newer version', JSON.stringify({ ...good(), version: 3 })],
  ['truncated v2', '{"version":2,"tasks":['], ['bad category', JSON.stringify(bad(invalid['bad category']))],
]) {
  test(`loadState falls back to fresh v2 on ${name}`, () => {
    const s = loadState(memStorage({ [STORAGE_KEY]: raw }));
    assert.equal(s.version, 2); assert.equal(s.profile.setupDone, false);
    assert.doesNotThrow(() => validateState(s));
  });
}
test('loadState backs up corrupt/newer data under BACKUP_KEY', () => {
  for (const raw of ['{oops', JSON.stringify({ version: 3, tasks: [] })]) {
    const m = memStorage({ [STORAGE_KEY]: raw });
    loadState(m);
    assert.equal(m.m.get(BACKUP_KEY), raw);
  }
});
test('loadState does not throw if getItem throws, or if backup write hits quota', () => {
  const badStore = { getItem() { throw new Error('boom'); }, setItem() {} };
  assert.equal(loadState(badStore).version, 2);
  const q = quotaStorage({ [STORAGE_KEY]: '{oops' });
  assert.equal(loadState(q).version, 2);
});

test('saveState quota exceeded: throws Error, previous data intact', () => {
  const m = memStorage();
  saveState(m, good());
  const before = m.m.get(STORAGE_KEY);
  const q = { ...m, getItem: m.getItem, setItem: () => { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; } };
  assert.throws(() => saveState(q, mkState()), Error);
  assert.equal(m.m.get(STORAGE_KEY), before);
});
test('saveState rejects invalid state without writing', () => {
  const m = memStorage();
  assert.throws(() => saveState(m, { version: 2 }), Error);
  assert.equal(m.m.size, 0);
});
test('saveState throws a clear error above MAX_STATE_BYTES and writes nothing', () => {
  const g = mkState();
  for (let i = 0; i < 480; i++) g.tasks.push(mkTask({ id: 'big' + i, title: 'T' + i, notes: 'é'.repeat(1000) })); // ~2 bytes/char
  assert.ok(JSON.stringify(g).length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify(g)) > MAX_STATE_BYTES);
  const m = memStorage();
  assert.throws(() => saveState(m, g), (e) => e instanceof Error && /size|large|big|limit|bytes|storage/i.test(e.message));
  assert.equal(m.m.size, 0);
});
test('saveState just under the limit is accepted', () => {
  const g = mkState();
  for (let i = 0; i < 100; i++) g.tasks.push(mkTask({ id: 'k' + i, title: 'T' + i, notes: 'a'.repeat(2000) }));
  assert.ok(Buffer.byteLength(JSON.stringify(g)) < MAX_STATE_BYTES);
  assert.doesNotThrow(() => saveState(memStorage(), g));
});

test('exportJSON parses back to the state; import/export round trip', () => {
  assert.deepEqual(JSON.parse(exportJSON(good())), good());
  assert.deepEqual(importJSON(exportJSON(good())), good());
  assert.deepEqual(importJSON(exportJSON(freshState())), freshState());
});
test('exportJSON contains no photo data', () => {
  const g = good(); g.items[0].photoIds = ['p-abc'];
  const t = exportJSON(g);
  assert.ok(!/data:image/.test(t));
});
test('exportJSON rejects invalid state', () => assert.throws(() => exportJSON({}), Error));
test('importJSON throws Error on invalid input', () => {
  for (const t of ['nope', '', 'null', '[]', '{}', '"x"', '42', 'true',
    JSON.stringify({ version: 2 }), JSON.stringify({ ...good(), version: 99 }),
    JSON.stringify(bad(invalid['dangling vehicleId'])), JSON.stringify(bad(invalid['duplicate task ids'])),
    JSON.stringify({ version: 1, tasks: 'x', completions: [] }), JSON.stringify({ version: 1, tasks: [{ id: 'a' }], completions: [] }),
  ]) assert.throws(() => importJSON(t), Error, t.slice(0, 40));
});
test('importJSON migrates v1 text', () => {
  const s = importJSON(JSON.stringify(v1Fixture()));
  assert.equal(s.version, 2);
});
test('importJSON with __proto__ key does not pollute prototypes', () => {
  const txt = JSON.stringify(good()).replace('{', '{"__proto__":{"polluted":1},');
  try { importJSON(txt); } catch { /* either is fine */ }
  assert.equal({}.polluted, undefined);
});
test('importJSON does not alias or mutate input objects across calls', () => {
  const t = exportJSON(good());
  const a = importJSON(t), b = importJSON(t);
  a.tasks[0].title = 'changed';
  assert.notEqual(b.tasks[0].title, 'changed');
});
