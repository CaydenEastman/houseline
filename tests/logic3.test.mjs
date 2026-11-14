import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/logic.js';
import { migrate, validateState } from '../src/storage.js';
import { seedFromProfile } from '../src/templates.js';
import { buildICS } from '../src/ics.js';
import { T, mkState, mkTask, mkVehicle, mkProfile, idGen, deepFreeze, v1Fixture } from './helpers.mjs';

test('updateVehicle rename rewrites " — old" title suffix for that vehicle only', () => {
  const s = deepFreeze(mkState({ vehicles: [mkVehicle({ id: 'v1', name: 'Old' }), mkVehicle({ id: 'v2', name: 'Other' })], tasks: [
    mkTask({ id: 'a', title: 'Oil — Old', vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 }),
    mkTask({ id: 'b', title: 'Tires — Old', vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 }),
    mkTask({ id: 'c', title: 'Custom thing', vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 }),
    mkTask({ id: 'd', title: 'Oil — Old', vehicleId: 'v2', kind: 'mileage', intervalDays: null, intervalMiles: 5000 }),
    mkTask({ id: 'e', title: 'Wash — Old', vehicleId: null }),
    mkTask({ id: 'f', title: 'Old — Old Town', vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 }),
  ] }));
  const n = L.updateVehicle(s, 'v1', { name: 'New Van' });
  const t = (id) => n.tasks.find((x) => x.id === id).title;
  assert.equal(t('a'), 'Oil — New Van'); assert.equal(t('b'), 'Tires — New Van');
  assert.equal(t('c'), 'Custom thing'); assert.equal(t('d'), 'Oil — Old'); assert.equal(t('e'), 'Wash — Old');
  assert.equal(t('f'), 'Old — Old Town', 'only a trailing suffix is rewritten');
  assert.equal(n.vehicles[0].name, 'New Van');
  assert.doesNotThrow(() => validateState(n));
});
test('updateVehicle without rename leaves titles; same name is a no-op for titles', () => {
  const s = mkState({ vehicles: [mkVehicle({ name: 'Van' })], tasks: [mkTask({ title: 'Oil — Van', vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 })] });
  assert.equal(L.updateVehicle(s, 'v1', { odometer: 60000 }).tasks[0].title, 'Oil — Van');
  assert.equal(L.updateVehicle(s, 'v1', { name: 'Van' }).tasks[0].title, 'Oil — Van');
});
test('rename that would push a task title over 120 chars does not corrupt state', () => {
  const longBase = 'x'.repeat(100);
  const s = mkState({ vehicles: [mkVehicle({ name: 'A' })], tasks: [mkTask({ title: `${longBase} — A`, vehicleId: 'v1', kind: 'mileage', intervalDays: null, intervalMiles: 5000 })] });
  let n; try { n = L.updateVehicle(s, 'v1', { name: 'B'.repeat(80) }); } catch (e) { assert.ok(e instanceof Error); return; }
  assert.ok(n.tasks[0].title.length <= 120, 'title length ' + n.tasks[0].title.length);
  assert.doesNotThrow(() => validateState(n));
});
test('vehicle names capped at 80 chars (add and update)', () => {
  const s = mkState({ vehicles: [mkVehicle()] });
  assert.doesNotThrow(() => L.addVehicle(s, { name: 'n'.repeat(80), odometer: 1 }, () => 'v9', T));
  assert.throws(() => L.addVehicle(s, { name: 'n'.repeat(81), odometer: 1 }, () => 'v9', T), Error);
  assert.doesNotThrow(() => L.updateVehicle(s, 'v1', { name: 'n'.repeat(80) }));
  assert.throws(() => L.updateVehicle(s, 'v1', { name: 'n'.repeat(81) }), Error);
});
test('validateState rejects 81-char vehicle name; migrate truncates it to 80 instead of throwing', () => {
  const s = mkState({ vehicles: [mkVehicle({ name: 'n'.repeat(100) })] });
  assert.throws(() => validateState(s), Error);
  let m; assert.doesNotThrow(() => { m = migrate(JSON.parse(JSON.stringify(s))); });
  assert.equal(m.vehicles[0].name.length, 80); assert.doesNotThrow(() => validateState(m));
});
test('validateState rejects unknown top-level keys; migrate drops them first', () => {
  const s = { ...mkState(), bogus: 1, __extra: { a: 1 } };
  assert.throws(() => validateState(s), Error);
  const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.ok(!('bogus' in m) && !('__extra' in m)); assert.doesNotThrow(() => validateState(m));
  const v1 = { ...v1Fixture(), junk: true };
  const m1 = migrate(v1); assert.ok(!('junk' in m1)); assert.doesNotThrow(() => validateState(m1));
});
test('migrate keeps all known top-level keys', () => {
  const s = mkState(); const m = migrate(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(Object.keys(m).sort(), Object.keys(s).sort());
});
test('seedFromProfile never produces titles > 120 chars even with 80-char vehicle names', () => {
  const v = mkVehicle({ name: 'V'.repeat(80) });
  const tasks = seedFromProfile(mkProfile({ hasPool: true, hasPets: true, hasTrailer: true }), { vehicles: [v], idFn: idGen('s'), today: T });
  assert.ok(tasks.length > 10);
  for (const t of tasks) assert.ok(t.title.length <= 120, `${t.title.length}: ${t.title}`);
  assert.doesNotThrow(() => validateState(mkState({ vehicles: [v], tasks })));
  const keys = tasks.map((t) => `${t.vehicleId}|${t.title}`); assert.equal(new Set(keys).size, keys.length, 'truncation must not create duplicate titles');
});

// ICS: semicolons etc. in every text field incl. category-bearing description
test('ICS: semicolon in title/notes/link label/vehicle/supply/item shows as \; and never as a bare ;', () => {
  const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
  const st = mkState({ tasks: [mkTask({ title: 'a;b', notes: 'c;d,e\\f\ng', lastDone: T, links: [{ label: 'l;m', url: 'https://x.y/?a=1;b=2' }] })],
    supplies: [{ id: 's', name: 'S;1', key: null, category: 'water', quantity: 1, unit: 'g', expires: L.addDays(T, 20), notes: '' }],
    items: [{ id: 'i', name: 'I;1', kind: 'hvac', location: '', model: '', filterSize: '', purchaseDate: null, warrantyExpires: L.addDays(T, 20), notes: '', photoIds: [] }] });
  const ics = unfold(buildICS(st, T));
  for (const l of ics.split('\r\n')) {
    const m = /^(SUMMARY|DESCRIPTION|LOCATION):(.*)$/.exec(l); if (!m) continue;
    assert.ok(!/(^|[^\\]);/.test(m[2].replace(/\\\\/g, '')), `bare ; in ${l}`);
  }
  assert.ok(ics.includes('SUMMARY:a\\;b')); assert.ok(ics.includes('c\\;d\\,e\\\\f\\ng'));
  assert.ok(ics.includes('S\\;1')); assert.ok(ics.includes('I\\;1'));
});
