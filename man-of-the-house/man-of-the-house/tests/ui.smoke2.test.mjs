import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument } from './stubdom.mjs';
import { mount } from '../src/ui.js';
import { addVehicle, addItem } from '../src/logic.js';
import { mkState, mkTask, mkVehicle, mkItem, mkProfile, memStorage, fakeDb, T } from './helpers.mjs';

for (const n of ['setInterval', 'setTimeout']) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === 'setInterval' || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fakeStore(extra = {}) {
  const calls = { deletePhoto: [], flush: 0 }, saved = [];
  return Object.assign({ mode: 'local', saved, calls, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => { calls.flush++; return true; },
    onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async (id) => { calls.deletePhoto.push(id); },
    whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }, extra);
}
const withVehicle = () => mkState({ vehicles: [mkVehicle({ id: 'v1', name: 'Minivan', odometer: 80000 })], tasks: [mkTask({ id: 'x', title: 'Existing' })] });
const setVal = (el, v) => { el.value = String(v); el.dispatchEvent({ type: 'input', bubbles: true, target: el, preventDefault() {} }); el.dispatchEvent({ type: 'change', bubbles: true, target: el, preventDefault() {} }); };
const submit = async (doc) => { const form = doc.getElementById('task-dialog').querySelector('form'); form.dispatchEvent({ type: 'submit', bubbles: false, target: form, preventDefault() {}, stopPropagation() {} }); await sleep(20); };

async function openMileageForm(doc, app) {
  doc.getElementById('add-btn').click(); await sleep(5);
  const dlg = doc.getElementById('task-dialog');
  assert.ok(dlg.textContent.includes('Add task'));
  setVal(dlg.querySelector('#f-title'), 'Oil change');
  setVal(dlg.querySelector('#f-kind'), 'mileage');
  setVal(dlg.querySelector('#f-miles'), 5000);
  setVal(dlg.querySelector('#f-vehicle'), 'v1');
  return dlg;
}

test('mileage task form has "Odometer at last service" and saves it as lastDoneOdometer', async () => {
  const doc = makeDocument(), store = fakeStore();
  await mount(doc, { store, state: withVehicle() });
  const dlg = await openMileageForm(doc);
  assert.ok(/Odometer at last service/i.test(dlg.textContent), 'field label');
  assert.ok(dlg.querySelector('#f-odo'), 'odometer input');
  setVal(dlg.querySelector('#f-odo'), 76500);
  await submit(doc);
  const t = store.saved.at(-1).tasks.find((x) => x.title === 'Oil change');
  assert.ok(t, 'task saved'); assert.equal(t.kind, 'mileage'); assert.equal(t.vehicleId, 'v1'); assert.equal(t.intervalMiles, 5000);
  assert.equal(t.lastDoneOdometer, 76500);
});
test('blank last-service odometer saves null; invalid values are rejected in-page, nothing saved', async () => {
  const doc = makeDocument(), store = fakeStore();
  await mount(doc, { store, state: withVehicle() });
  let dlg = await openMileageForm(doc);
  await submit(doc);
  assert.equal(store.saved.at(-1).tasks.find((x) => x.title === 'Oil change').lastDoneOdometer, null);
  for (const bad of ['-5', '1.5', 'abc']) {
    const n = store.saved.length;
    doc.getElementById('add-btn').click(); await sleep(5);
    dlg = await openMileageForm(doc);
    setVal(doc.getElementById('task-dialog').querySelector('#f-title'), 'Bad ' + bad);
    setVal(doc.getElementById('task-dialog').querySelector('#f-odo'), bad);
    await submit(doc);
    assert.equal(store.saved.length, n, `invalid odometer ${bad} must not save`);
    assert.ok(doc.getElementById('task-dialog').querySelector('[role="alert"], .form-error, .err, .error') || /odometer/i.test(doc.getElementById('task-dialog').textContent));
  }
});
test('editing a mileage task prefills the last-service odometer', async () => {
  const doc = makeDocument(), store = fakeStore();
  const st = withVehicle(); st.tasks = [mkTask({ id: 'm', title: 'Oil', kind: 'mileage', intervalDays: null, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 77777 })];
  const { ctx } = await mount(doc, { store, state: st });
  ctx.openTaskForm(st.tasks[0]); await sleep(5);
  assert.equal(doc.getElementById('task-dialog').querySelector('#f-odo').value, '77777');
});

// ---------- deferred photo removal (fake timers) ----------
test('ctx.photos.remove is deferred ~30s and only deletes if unreferenced', async (t) => {
  const doc = makeDocument(), store = fakeStore();
  const st = mkState({ items: [mkItem({ id: 'i1', photoIds: ['p-used'] })] });
  const { ctx } = await mount(doc, { store, state: st });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await ctx.photos.remove('p-free'); await ctx.photos.remove('p-used');
    mock.timers.tick(10_000); await Promise.resolve();
    assert.deepEqual(store.calls.deletePhoto, [], 'must not delete immediately / before ~30s');
    mock.timers.tick(25_000); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(store.calls.deletePhoto, ['p-free']);
  } finally { mock.timers.reset(); }
});
test('photo that becomes referenced during the delay (undo) is not deleted', async () => {
  const doc = makeDocument(), store = fakeStore();
  const { ctx, getState } = await mount(doc, { store, state: mkState({ items: [mkItem({ id: 'i1', photoIds: [] })] }) });
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await ctx.photos.remove('p-back');
    const s = getState(); ctx.commit({ ...s, items: [{ ...s.items[0], photoIds: ['p-back'] }] }, 'restored', { undoable: false });
    mock.timers.tick(40_000); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(store.calls.deletePhoto, []);
  } finally { mock.timers.reset(); }
});

// ---------- flush on pagehide / visibilitychange (main.js) ----------
async function bootMain(db, tag) {
  const doc = makeDocument(); doc.visibilityState = 'visible';
  const winL = {};
  const win = { localStorage: memStorage(), claude: { use: async (n) => (n === 'db' ? db : null) }, addEventListener: (t, f) => { (winL[t] ||= []).push(f); }, removeEventListener() {} };
  Object.assign(globalThis, { document: doc, window: win });
  await import(`../src/main.js?boot=${tag}`);
  await sleep(150);
  return { doc, win, winL };
}
const cloudTasks = (db) => (db.docs.get('household/main')?.tasks || []).length;
test('main.js flushes the store on pagehide (before the 600ms debounce)', async () => {
  const db = fakeDb(); const { doc, win, winL } = await bootMain(db, 'pagehide');
  try {
    assert.ok(winL.pagehide?.length, 'pagehide listener registered');
    const skip = doc.getElementById('wizard').querySelectorAll('button').find((b) => /skip/i.test(b.textContent));
    assert.ok(skip); skip.click(); await sleep(30);
    assert.equal(cloudTasks(db), 0, 'not yet written (debounced)');
    for (const f of winL.pagehide) f({ type: 'pagehide' });
    await sleep(100);
    assert.ok(cloudTasks(db) > 10, 'flush must have pushed the pending state to the cloud: ' + cloudTasks(db));
  } finally { delete globalThis.window; delete globalThis.document; }
});
test('main.js flushes the store when the page becomes hidden (visibilitychange)', async () => {
  const db = fakeDb(); const { doc } = await bootMain(db, 'visibility');
  try {
    assert.ok((doc._ev.visibilitychange || []).length >= 1);
    const skip = doc.getElementById('wizard').querySelectorAll('button').find((b) => /skip/i.test(b.textContent));
    skip.click(); await sleep(30);
    assert.equal(cloudTasks(db), 0);
    doc.visibilityState = 'visible'; doc.hidden = false;
    for (const f of doc._ev.visibilitychange) f({ type: 'visibilitychange' });
    await sleep(60); assert.equal(cloudTasks(db), 0, 'visible must not force a flush');
    doc.visibilityState = 'hidden'; doc.hidden = true;
    for (const f of doc._ev.visibilitychange) f({ type: 'visibilitychange' });
    await sleep(100);
    assert.ok(cloudTasks(db) > 10, 'hidden must flush: ' + cloudTasks(db));
  } finally { delete globalThis.window; delete globalThis.document; }
});
