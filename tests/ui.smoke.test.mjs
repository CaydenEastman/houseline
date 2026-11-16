import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeDocument } from './stubdom.mjs';
import { mount } from '../src/ui.js';
import { freshState } from '../src/storage.js';
import { seedFromProfile } from '../src/templates.js';
import { addVehicle, addItem, addSupply, markDone, skipTask, snoozeTask, updateEmergency } from '../src/logic.js';
import { mkProfile, mkState, idGen, T } from './helpers.mjs';

// The shell starts a 60s midnight-rollover setInterval and toast timers; unref so the test process can exit.
for (const n of ['setInterval', 'setTimeout']) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === 'setInterval' || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fakeStore(extra = {}) {
  const saved = [];
  return Object.assign({ mode: 'local', saved, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true,
    onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {},
    whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }, extra);
}
function seeded({ evil = false } = {}) {
  let s = mkState({ profile: mkProfile({ setupDone: true, hasPool: true, hasPets: true, hasTrailer: true }) });
  const id = idGen('g');
  s = addVehicle(s, { name: evil ? '<img src=x onerror=alert(1)>' : 'Minivan', odometer: 80000 }, id, T);
  s = addVehicle(s, { name: 'Truck', odometer: 12000 }, id, T);
  s = { ...s, tasks: seedFromProfile(s.profile, { vehicles: s.vehicles, idFn: idGen('s'), today: T }) };
  s = addItem(s, { name: evil ? '<script>alert(1)</script>' : 'Furnace', kind: 'hvac', warrantyExpires: '2026-07-01' }, id);
  s = addSupply(s, { name: 'Water', key: 'water', category: 'water', quantity: 2, unit: 'gal', expires: '2026-07-01' }, id);
  s = updateEmergency(s, { contacts: [{ name: evil ? '<b>x</b>' : 'Ann', phone: '555', relation: 'Friend' }], meetingPlace: evil ? '"><script>1</script>' : 'Park' });
  s = markDone(s, s.tasks[0].id, T, { cost: 12.5, notes: 'done' });
  s = skipTask(s, s.tasks[1].id, T);
  s = snoozeTask(s, s.tasks[2].id, '2026-07-01', T);
  return s;
}
const hasScriptEl = (doc) => doc.body.querySelectorAll('script, img').length;

test('fresh state shows the setup wizard, hides the app', async () => {
  const doc = makeDocument();
  await mount(doc, { store: fakeStore(), state: freshState() });
  assert.equal(doc.getElementById('wizard').hidden, false);
  assert.equal(doc.getElementById('app').hidden, true);
  assert.ok(doc.getElementById('wizard').textContent.length > 20);
  assert.equal(doc.body.querySelectorAll('.view-error').length, 0);
});
test('wizard can be completed from stub DOM without throwing (Skip setup / Finish)', async () => {
  const doc = makeDocument(); const store = fakeStore();
  await mount(doc, { store, state: freshState() });
  const wz = doc.getElementById('wizard');
  const btn = wz.querySelectorAll('button').find((b) => /skip/i.test(b.textContent));
  assert.ok(btn, 'a Skip setup button exists');
  btn.click(); await sleep(20);
  assert.equal(doc.getElementById('app').hidden, false);
  assert.ok(store.saved.length >= 1 && store.saved.at(-1).profile.setupDone === true);
  assert.ok(store.saved.at(-1).tasks.length > 10);
});
test('seeded state: all nine tabs render without view errors', async () => {
  const doc = makeDocument();
  await mount(doc, { store: fakeStore(), state: seeded() });
  assert.equal(doc.getElementById('app').hidden, false); assert.equal(doc.getElementById('wizard').hidden, true);
  const labels = doc.getElementById('nav').querySelectorAll('button').map((b) => b.textContent.replace(/[^\w ]/g, '').trim());
  for (const l of ['Today', 'Tasks', 'History', 'Inventory', 'Vehicles', 'Vendors', 'Emergency', 'Calendar', 'Insights']) assert.ok(labels.some((x) => x.endsWith(l)), `${l} in ${JSON.stringify(labels)}`);
  const btns = doc.getElementById('nav').querySelectorAll('button');
  assert.equal(btns.length, 9);
  for (const b of btns) {
    b.click(); await sleep(5);
    assert.equal(doc.body.querySelectorAll('.view-error').length, 0, 'view error in tab ' + b.textContent + ': ' + doc.body.querySelectorAll('.view-error').map((e) => e.textContent).join('|'));
    assert.ok(doc.getElementById('main').textContent.length > 30);
    const cur = doc.getElementById('nav').querySelectorAll('[aria-current]');
    assert.equal(cur.length, 1);
  }
});
test('seeded state with hostile strings: no script/img elements are ever created', async () => {
  const doc = makeDocument();
  await mount(doc, { store: fakeStore(), state: seeded({ evil: true }) });
  for (const b of doc.getElementById('nav').querySelectorAll('button')) { b.click(); await sleep(5); assert.equal(hasScriptEl(doc), 0, b.textContent); assert.equal(doc.body.querySelectorAll('.view-error').length, 0); }
});
test('empty (setup done, no tasks) state renders all tabs', async () => {
  const doc = makeDocument();
  await mount(doc, { store: fakeStore(), state: mkState() });
  for (const b of doc.getElementById('nav').querySelectorAll('button')) { b.click(); await sleep(5); assert.equal(doc.body.querySelectorAll('.view-error').length, 0, b.textContent); }
});
test('cloud-mode store with subscribe + names does not break mount', async () => {
  const doc = makeDocument(); let cb;
  const store = fakeStore({ mode: 'cloud', subscribe: (f) => { cb = f; return () => {}; }, whoAmI: async () => ({ id: 'u1', isOwner: true }), names: async (ids) => Object.fromEntries(ids.map((i) => [i, 'Pat'])) });
  const st = seeded(); st.tasks[0] = { ...st.tasks[0], assignee: 'u2' };
  await mount(doc, { store, state: st });
  await sleep(20);
  if (cb) { assert.doesNotThrow(() => cb(seeded())); await sleep(20); }
  assert.equal(doc.body.querySelectorAll('.view-error').length, 0);
});
test('mount tolerates a store whose calls throw/reject', async () => {
  const doc = makeDocument();
  const store = fakeStore({ whoAmI: async () => { throw new Error('x'); }, names: async () => { throw new Error('y'); }, save: async () => { throw new Error('z'); }, getPhoto: async () => { throw new Error('w'); } });
  await assert.doesNotReject(() => mount(doc, { store, state: seeded() }));
});
test('index.html links styles-views.css, has the six-view shell ids, no external resources, no inline script handlers', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /styles-views\.css/);
  assert.ok(!/(src|href)\s*=\s*["']https?:/i.test(html), 'external resource');
  assert.ok(!/\son\w+\s*=/i.test(html), 'inline handler');
  for (const id of ['app', 'wizard', 'today-strip', 'nav', 'main', 'status', 'task-dialog', 'complete-dialog', 'settings-dialog', 'confirm-dialog', 'add-btn', 'settings-btn']) assert.ok(html.includes(`id="${id}"`), id);
});
