export const T = '2026-06-15';
export const clone = (x) => JSON.parse(JSON.stringify(x));
export const idGen = (p = 'x') => { let n = 0; return () => `${p}${++n}`; };
export function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}
export const mkTask = (o = {}) => ({
  id: 't1', title: 'Task', category: 'house', kind: 'interval', intervalDays: 90,
  month: null, day: null, intervalMiles: null, lastDoneOdometer: null, vehicleId: null,
  lastDone: null, startDate: null, snoozedUntil: null, itemId: null, assignee: null,
  links: [], tags: [], notes: '', custom: false, ...o,
});
export const mkVehicle = (o = {}) => ({
  id: 'v1', name: 'Minivan', odometer: 50000, odometerDate: T, odometerLog: [], ...o,
});
export const mkItem = (o = {}) => ({
  id: 'i1', name: 'Water heater', kind: 'plumbing', location: 'Garage', model: 'WH-100', filterSize: '',
  purchaseDate: null, warrantyExpires: null, notes: '', photoIds: [], ...o,
});
export const mkSupply = (o = {}) => ({
  id: 's1', name: 'Water jugs', key: null, category: 'water', quantity: 1, unit: 'gal', expires: null, notes: '', ...o,
});
export const mkCompletion = (o = {}) => ({
  id: 'c1', taskId: 't1', title: 'Task', category: 'house', date: T, kind: 'done',
  cost: null, notes: '', odometer: null, by: null, photoIds: [], ...o,
});
export const mkEmergency = (o = {}) => ({
  contacts: [], meetingPlace: '', outOfAreaContact: '', shutoffs: { water: '', gas: '', electric: '' }, notes: '', ...o,
});
export const mkProfile = (o = {}) => ({
  setupDone: true, homeType: 'house', hasYard: true, hasPool: false, hasTrailer: false, hasPets: false, householdSize: 2, ...o,
});
export const mkState = (o = {}) => ({
  version: 2, profile: mkProfile(), vehicles: [], items: [], supplies: [], tasks: [], completions: [],
  emergency: mkEmergency(), ...o,
});
export function memStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } };
}
export function quotaStorage(init = {}) {
  const s = memStorage(init);
  s.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; e.code = 22; throw e; };
  return s;
}
// v1 fixture exactly as v1 would persist it
export const v1Fixture = () => ({
  version: 1,
  tasks: [
    { id: 'seed-1', title: 'Change oil', category: 'car', intervalDays: 90, lastDone: '2026-03-01', notes: 'Synthetic', custom: false },
    { id: 'seed-2', title: 'Test smoke detectors', category: 'house', intervalDays: 30, lastDone: null, notes: '', custom: false },
    { id: 'abc', title: 'Mow <b>lawn</b>', category: 'yard', intervalDays: 7, lastDone: '2026-06-10', notes: 'n', custom: true },
  ],
  completions: [
    { taskId: 'seed-1', date: '2026-03-01' },
    { taskId: 'abc', date: '2026-06-10' },
    { taskId: 'gone', date: '2026-01-01' },
  ],
});

// ---- shared fake Firestore-like db (doc + collection + onSnapshot with initial snapshot) ----
const sleepH = (ms) => new Promise((r) => setTimeout(r, ms));
export function fakeDb({ setDelay = 0 } = {}) {
  const docs = new Map(), listeners = new Map(), writes = [], raw = [];
  const o = { docs, writes, raw, lockCalls: [], lock: null };
  const snap = (p) => { const v = docs.get(p); return { exists: v !== undefined, data: () => (v === undefined ? undefined : clone(v)) }; };
  const colSnap = (name) => ({ docs: [...docs.entries()].filter(([k]) => k.startsWith(name + '/')).map(([k, v]) => ({ id: k.slice(name.length + 1), exists: true, data: () => clone(v) })) });
  const emit = (p) => {
    for (const cb of [...(listeners.get(p) || [])]) cb(snap(p));
    const col = p.split('/')[0];
    for (const cb of [...(listeners.get('col:' + col) || [])]) cb(colSnap(col));
  };
  o.remoteSet = (p, v) => { docs.set(p, clone(v)); emit(p); };
  o.collection = (name) => ({
    async get() { return colSnap(name); },
    onSnapshot(cb) { const k = 'col:' + name; if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k).add(cb); queueMicrotask(() => cb(colSnap(name))); return () => listeners.get(k).delete(cb); },
  });
  o.doc = (p) => {
    const d = {
      async get() { return snap(p); },
      async set(v) { if (setDelay) await sleepH(setDelay); raw.push([p, v]); writes.push([p, clone(v)]); docs.set(p, clone(v)); emit(p); },
      async delete() { docs.delete(p); emit(p); },
      onSnapshot(cb) { if (!listeners.has(p)) listeners.set(p, new Set()); listeners.get(p).add(cb); queueMicrotask(() => cb(snap(p))); return () => listeners.get(p).delete(cb); },
    };
    if (p === 'household/lock' && o.lock) d.acquire = (opts) => { o.lockCalls.push(opts); return o.lock(opts); };
    return d;
  };
  return o;
}
export const isPlainJSON = (v, path = '$') => {
  if (v === null || ['string', 'boolean'].includes(typeof v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : `${path}: non-finite`;
  if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const r = isPlainJSON(v[i], `${path}[${i}]`); if (r) return r; } return null; }
  if (typeof v === 'object') {
    const pr = Object.getPrototypeOf(v); if (pr !== Object.prototype && pr !== null) return `${path}: non-plain object ${v.constructor?.name}`;
    for (const [k, x] of Object.entries(v)) { const r = isPlainJSON(x, `${path}.${k}`); if (r) return r; } return null;
  }
  return `${path}: ${typeof v}`;
};
