import test from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES, CATEGORIES, templatesFor, seedFromProfile, SUPPLY_STARTERS } from '../src/templates.js';
import { validateState } from '../src/storage.js';
import { addDays, daysBetween } from '../src/logic.js';
import { mkProfile, mkState, mkVehicle, idGen, T } from './helpers.mjs';

const kind = (t) => t.kind ?? 'interval';
const find = (re, k) => TEMPLATES.filter((t) => re.test(t.title) && (!k || kind(t) === k));
const req = (t) => t.requires ?? {};

test('at least 55 templates, valid shapes by kind', () => {
  assert.ok(TEMPLATES.length >= 55, String(TEMPLATES.length));
  for (const t of TEMPLATES) {
    assert.ok(CATEGORIES.includes(t.category), t.title);
    assert.ok(['interval', 'annual', 'mileage'].includes(kind(t)), t.title);
    assert.equal(typeof t.notes, 'string'); assert.ok(Array.isArray(t.tags), t.title + ' tags');
    assert.ok(t.title.length <= 120);
    if (kind(t) === 'interval') assert.ok(Number.isInteger(t.intervalDays) && t.intervalDays >= 1 && t.intervalDays <= 36500, t.title);
    if (kind(t) === 'annual') {
      assert.ok(Number.isInteger(t.month) && t.month >= 1 && t.month <= 12, t.title);
      assert.ok(Number.isInteger(t.day) && t.day >= 1 && t.day <= 28, t.title);
      assert.ok(t.intervalDays == null, t.title);
    }
    if (kind(t) === 'mileage') {
      assert.ok(Number.isInteger(t.intervalMiles) && t.intervalMiles >= 1 && t.intervalMiles <= 1e6, t.title);
      assert.equal(req(t).vehicle, true, t.title + ' mileage needs requires.vehicle');
      if (t.intervalDays != null) assert.ok(Number.isInteger(t.intervalDays) && t.intervalDays >= 1);
    }
    if (t.requires) for (const k of Object.keys(t.requires)) assert.ok(['homeType', 'hasYard', 'hasPool', 'hasTrailer', 'hasPets', 'vehicle', 'rents', 'system', 'systemLegacy'].includes(k), `${t.title}: unknown requires ${k}`);
    if (req(t).homeType) assert.ok(req(t).homeType.every((h) => ['house', 'condo', 'apartment'].includes(h)));
  }
});
test('no duplicate template titles; at least 8 per category', () => {
  const ts = TEMPLATES.map((t) => t.title.trim().toLowerCase());
  assert.equal(new Set(ts).size, ts.length);
  for (const c of CATEGORIES) assert.ok(TEMPLATES.filter((t) => t.category === c).length >= 8, c);
});
test('required annual templates exist with spec dates', () => {
  const has = (re, m, d) => assert.ok(TEMPLATES.some((t) => kind(t) === 'annual' && re.test(t.title) && t.month === m && t.day === d), `${re} ${m}/${d}`);
  has(/sprinkler/i, 10, 15); has(/smoke/i, 11, 1); has(/smoke/i, 3, 10); has(/furnace/i, 9, 15);
  has(/\b(AC|air.?condition)/i, 4, 15); has(/gutter/i, 11, 1); has(/gutter/i, 4, 15); has(/hose/i, 10, 20);
  assert.ok(find(/water.?heater/i).length >= 1); assert.ok(find(/dryer vent/i).length >= 1); assert.ok(find(/chimney/i).length >= 1);
});
test('required mileage templates exist with spec miles', () => {
  const m = (re, miles) => assert.ok(TEMPLATES.some((t) => kind(t) === 'mileage' && re.test(t.title) && t.intervalMiles === miles), `${re} ${miles}`);
  m(/oil/i, 5000); m(/tire rotation|rotate/i, 7500); m(/brake/i, 12000); m(/engine air/i, 15000); m(/cabin/i, 15000); m(/coolant/i, 30000); m(/transmission/i, 60000);
  const oil = TEMPLATES.find((t) => kind(t) === 'mileage' && /oil/i.test(t.title) && t.intervalMiles === 5000);
  assert.equal(oil.intervalDays, 180);
  assert.ok(TEMPLATES.some((t) => kind(t) === 'annual' && /battery/i.test(t.title) && t.category === 'car'));
  assert.ok(TEMPLATES.some((t) => kind(t) === 'annual' && /registration|inspection/i.test(t.title) && t.category === 'car'));
});
test('trailer, pool, pets, condo variants exist', () => {
  assert.ok(TEMPLATES.some((t) => req(t).hasTrailer === true));
  assert.ok(TEMPLATES.some((t) => req(t).hasPool === true));
  assert.ok(TEMPLATES.some((t) => req(t).hasPets === true));
  assert.ok(TEMPLATES.some((t) => req(t).homeType && !req(t).homeType.includes('house')));
});
test('v1 templates preserved', () => {
  for (const re of [/smoke/i, /hvac|furnace/i, /gutter/i, /mow/i, /oil/i, /water/i]) assert.ok(TEMPLATES.some((t) => re.test(t.title)), String(re));
});

const titlesOf = (p) => templatesFor(p).map((t) => t.title);
test('templatesFor: default house includes core tasks, honors requires', () => {
  const r = templatesFor(mkProfile());
  assert.ok(r.length > 20);
  for (const t of r) {
    if (req(t).hasPool) assert.fail('pool template in no-pool profile: ' + t.title);
    if (req(t).hasTrailer) assert.fail('trailer: ' + t.title);
    if (req(t).hasPets) assert.fail('pets: ' + t.title);
    if (req(t).homeType) assert.ok(req(t).homeType.includes('house'));
  }
});
test('templatesFor: pool/trailer/pets add templates', () => {
  const base = templatesFor(mkProfile()).length;
  assert.ok(templatesFor(mkProfile({ hasPool: true })).length > base);
  assert.ok(templatesFor(mkProfile({ hasTrailer: true })).length > base);
  assert.ok(templatesFor(mkProfile({ hasPets: true })).length > base);
  assert.ok(templatesFor(mkProfile({ hasPool: true })).every((t) => !req(t).hasTrailer));
});
test('templatesFor: condo/apartment exclude yard, gutters, roof', () => {
  for (const homeType of ['condo', 'apartment']) {
    const r = templatesFor(mkProfile({ homeType }));
    assert.ok(r.length >= 10, homeType);
    for (const t of r) {
      assert.notEqual(t.category, 'yard', t.title);
      assert.ok(!/gutter|roof|sprinkler|lawn|mow/i.test(t.title), t.title);
    }
  }
});
test('templatesFor: hasYard false excludes yard category even for houses', () => {
  const r = templatesFor(mkProfile({ hasYard: false }));
  assert.ok(r.length > 10); assert.ok(r.every((t) => t.category !== 'yard'));
  assert.ok(templatesFor(mkProfile({ hasYard: true })).some((t) => t.category === 'yard'));
});
test('templatesFor does not mutate templates and returns new array', () => {
  const before = JSON.stringify(TEMPLATES);
  const a = templatesFor(mkProfile()); a.pop();
  assert.equal(JSON.stringify(TEMPLATES), before);
});
test('templatesFor: house with chimney-like tasks excluded for condos', () => {
  assert.ok(!titlesOf(mkProfile({ homeType: 'condo' })).some((t) => /chimney/i.test(t)));
});

// ---- seedFromProfile ----
const vehs = (n) => Array.from({ length: n }, (_, i) => mkVehicle({ id: 'v' + (i + 1), name: ['Minivan', 'Truck', 'Sedan'][i] }));
const seed = (p = mkProfile(), vs = [], today = T) => seedFromProfile(p, { vehicles: vs, idFn: idGen('s'), today });

test('seedFromProfile: no vehicles -> no vehicle tasks', () => {
  const r = seed();
  assert.ok(r.length > 20);
  assert.ok(r.every((t) => t.vehicleId == null && kind(t) !== 'mileage'));
  assert.ok(r.every((t) => !req(t).vehicle));
});
test('seedFromProfile: vehicle templates instantiated once per vehicle with title suffix', () => {
  const r1 = seed(mkProfile(), vehs(1)), r2 = seed(mkProfile(), vehs(2)), r0 = seed();
  const vt = TEMPLATES.filter((t) => req(t).vehicle && templatesFor(mkProfile()).concat(TEMPLATES).includes(t));
  const n1 = r1.length - r0.length, n2 = r2.length - r0.length;
  assert.ok(n1 >= 8, 'at least the 7 mileage + battery/registration');
  assert.equal(n2, 2 * n1);
  for (const v of vehs(2)) {
    const mine = r2.filter((t) => t.vehicleId === v.id);
    assert.equal(mine.length, n1);
    for (const t of mine) { assert.ok(t.title.endsWith(` — ${v.name}`), t.title); assert.equal(t.lastDoneOdometer, null); }
    const mileage = mine.filter((t) => t.kind === 'mileage');
    assert.ok(mileage.length >= 7);
    for (const t of mileage) assert.ok(t.intervalMiles > 0);
  }
  assert.ok(vt.length > 0);
});
test('seedFromProfile: no duplicate titles per vehicle; unique ids from idFn', () => {
  const r = seed(mkProfile({ hasPool: true, hasPets: true, hasTrailer: true }), vehs(3));
  const keys = r.map((t) => `${t.vehicleId}|${t.title.toLowerCase()}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.equal(new Set(r.map((t) => t.id)).size, r.length);
  assert.ok(r.every((t) => /^s\d+$/.test(t.id)));
});
test('seedFromProfile: stagger startDate over next 30 days, never before today, deterministic', () => {
  const r = seed(mkProfile(), vehs(1));
  const nonAnnual = r.filter((t) => t.kind !== 'annual' && t.lastDone == null);
  assert.ok(nonAnnual.length > 10);
  const offs = nonAnnual.map((t) => { assert.ok(t.startDate, t.title); return daysBetween(T, t.startDate); });
  assert.ok(offs.every((o) => o >= 0 && o <= 30), JSON.stringify(offs));
  assert.ok(new Set(offs).size >= 10, 'spread across many days');
  assert.deepEqual(seed(mkProfile(), vehs(1)), seed(mkProfile(), vehs(1)));
});
test('seedFromProfile: annual tasks keep month/day and have no startDate', () => {
  const r = seed();
  const an = r.filter((t) => t.kind === 'annual');
  assert.ok(an.length >= 10);
  for (const t of an) { assert.equal(t.startDate, null, t.title); assert.ok(t.month >= 1 && t.day >= 1); assert.equal(t.intervalDays, null); }
});
test('seedFromProfile: stagger across year boundary and leap day', () => {
  for (const today of ['2026-12-20', '2028-02-29', '2026-03-08', '2026-11-01', '2026-12-31']) {
    const r = seed(mkProfile(), vehs(1), today);
    for (const t of r.filter((x) => x.startDate)) {
      const o = daysBetween(today, t.startDate);
      assert.ok(o >= 0 && o <= 30, `${today} ${t.title} ${t.startDate}`);
    }
  }
});
test('seedFromProfile: result tasks are valid in a v2 state with those vehicles', () => {
  const vs = vehs(2);
  const tasks = seed(mkProfile({ hasPool: true, hasPets: true, hasTrailer: true }), vs);
  const s = mkState({ vehicles: vs, tasks });
  assert.doesNotThrow(() => validateState(s));
  assert.ok(tasks.every((t) => t.custom === false && t.lastDone === null && Array.isArray(t.links) && Array.isArray(t.tags)));
});
test('seedFromProfile: condo has no yard/gutter tasks; trailer tasks only with hasTrailer', () => {
  const c = seed(mkProfile({ homeType: 'condo' }));
  assert.ok(c.every((t) => t.category !== 'yard' && !/gutter|roof/i.test(t.title)));
  assert.ok(!seed(mkProfile()).some((t) => /trailer/i.test(t.title)));
  assert.ok(seed(mkProfile({ hasTrailer: true })).some((t) => /trailer/i.test(t.title)));
});
test('seedFromProfile: odd vehicle names are kept verbatim in titles', () => {
  const r = seed(mkProfile(), [mkVehicle({ name: '<script>alert(1)</script>' })]);
  assert.ok(r.some((t) => t.title.endsWith(' — <script>alert(1)</script>')));
});
test('seedFromProfile: empty/undefined options tolerated', () => {
  assert.doesNotThrow(() => seedFromProfile(mkProfile(), { idFn: idGen('q'), today: T }));
});
test('seedFromProfile does not mutate TEMPLATES', () => {
  const b = JSON.stringify(TEMPLATES); seed(mkProfile(), vehs(2)); assert.equal(JSON.stringify(TEMPLATES), b);
});

test('SUPPLY_STARTERS shape', () => {
  assert.ok(Array.isArray(SUPPLY_STARTERS) && SUPPLY_STARTERS.length >= 8);
  for (const s of SUPPLY_STARTERS) {
    assert.ok(typeof s.name === 'string' && s.name);
    assert.ok(['water', 'food', 'medical', 'power', 'tools', 'docs', 'other'].includes(s.category), s.name);
    assert.equal(typeof s.unit, 'string'); assert.equal(typeof s.notes, 'string');
    assert.ok(s.key === null || typeof s.key === 'string');
  }
});
