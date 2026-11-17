// Persistence layer: cloud (claude `db` capability) with localStorage cache/fallback.
// Everything degrades gracefully; nothing here throws into the UI except put/getPhoto contracts noted below.
import * as storage from "./storage.js";
import { photoIdsOf } from "./household.js";

const DOC_STATE = "household/main";
const PHOTO_PREFIX = "motH.photo.";
const SENTINEL_TIMEOUT = Symbol("timeout");
const DIRTY_KEY = "motH.dirty"; // "1" while this device holds edits the cloud has not received yet
const BASE_KEY = "motH.base"; // the last state both sides agreed on; the merge ancestor for those edits
const OWNER_KEY = "motH.owner"; // which account the cached data belongs to

const errMsg = (e) => (e && e.message ? e.message : String(e));

async function useCap(claude, name) {
  try {
    if (!claude || typeof claude.use !== "function") return null;
    return (await claude.use(name)) || null;
  } catch {
    return null;
  }
}

/** Normalize a DocumentSnapshot (or a plain object) to its data or null. */
function snapData(snap) {
  if (snap == null) return null;
  if (typeof snap.data === "function") return snap.exists === false ? null : (snap.data() ?? null);
  if (snap.exists === false) return null;
  return snap;
}

function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((res) => { t = setTimeout(() => res(SENTINEL_TIMEOUT), ms); });
  return Promise.race([promise, timer]).finally(() => clearTimeout(t));
}

function randomId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}


const MAIN_PATH = "household/main";
const HISTORY_COLLECTION = "history";
export const MAX_SHARD_BYTES = 200_000; // history chunks are split above this
export const MAX_DOC_BYTES = 220_000; // hard ceiling for any cloud doc (platform cap is 256 KiB)
const encoder = new TextEncoder();
const byteLen = (s) => encoder.encode(s).length;

/** JSON with sorted keys, so comparisons don't depend on key order. */
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") {
    return "{" + Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  }
  return JSON.stringify(v) ?? "null";
}

function suffix(n) {
  let s = "";
  do { s = String.fromCharCode(97 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

/**
 * Split a v2 state into cloud docs (content only, no updatedAt/updatedBy).
 * Returns { "household/main": {...state sans completions}, "history/<year>[-a..]": {completions:[...]} }.
 * Throws an Error with .tooLarge=true if main alone exceeds maxDocBytes.
 */
export function shardState(state, { maxShardBytes = MAX_SHARD_BYTES, maxDocBytes = MAX_DOC_BYTES } = {}) {
  const { completions = [], ...rest } = state;
  const docs = {};
  docs[MAIN_PATH] = rest;
  const mainBytes = byteLen(JSON.stringify(rest));
  if (mainBytes > maxDocBytes) {
    const e = new Error(`Your data (without history) is ${mainBytes} bytes, over the ${maxDocBytes}-byte cloud limit. It is still saved on this device. Remove some photos' notes, items or tasks to sync again.`);
    e.tooLarge = true;
    throw e;
  }
  const byYear = new Map();
  for (const c of completions) {
    const y = String(c.date).slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y).push(c);
  }
  for (const y of [...byYear.keys()].sort()) {
    const chunks = [];
    let cur = [], size = 0;
    for (const c of byYear.get(y)) {
      const n = byteLen(JSON.stringify(c)) + 1;
      if (cur.length && size + n > maxShardBytes) { chunks.push(cur); cur = []; size = 0; }
      cur.push(c); size += n;
    }
    if (cur.length) chunks.push(cur);
    chunks.forEach((chunk, i) => {
      const id = chunks.length === 1 ? y : `${y}-${suffix(i)}`;
      docs[`${HISTORY_COLLECTION}/${id}`] = { completions: chunk };
    });
  }
  return docs;
}

const stripStamps = ({ updatedAt, updatedBy, ...rest }) => rest; // eslint-disable-line no-unused-vars

/** Inverse of shardState. `main` and `hist` ({id: data}) are raw doc bodies. Returns the raw (unvalidated) state or null. */
export function assembleState(main, hist = {}) {
  if (!main || typeof main !== "object") return null;
  if (main.version === undefined && main.state && typeof main.state === "object") return main.state; // legacy single-doc layout
  if (main.version === undefined) return null;
  const completions = [];
  for (const id of Object.keys(hist).sort()) {
    const c = hist[id] && hist[id].completions;
    if (Array.isArray(c)) completions.push(...c);
  }
  return { ...stripStamps(main), completions };
}

/** Raw doc bodies -> {path: stamp-free content} for comparison. */
function contentMap(main, hist) {
  const out = {};
  if (main) out[MAIN_PATH] = stripStamps(main);
  for (const id of Object.keys(hist)) out[`${HISTORY_COLLECTION}/${id}`] = stripStamps(hist[id]);
  return out;
}


const ID_ARRAYS = ["tasks", "vehicles", "items", "supplies", "completions", "vendors", "people"];
const FIELDWISE = ["tasks", "items", "vendors", "vehicles", "supplies", "people"];
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => canon(a) === canon(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Per-value rule: only one side changed vs base -> that side; both changed -> mine. */
function pick(b, m, t) {
  if (same(m, b)) return t;
  if (same(t, b)) return m;
  return m;
}

/** Field-by-field merge of one record: each field takes the side that changed it (mine wins a true conflict). */
function mergeFields(b, m, t) {
  if (!isPlain(b) || !isPlain(m) || !isPlain(t)) return pick(b, m, t);
  const out = {};
  for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const v = pick(b[k], m[k], t[k]);
    if (v !== undefined) out[k] = v;
  }
  // Two phones read the odometer: the higher reading wins, with its date and log (mileage only goes up).
  if (typeof m.odometer === "number" && typeof t.odometer === "number" && !same(m.odometer, b.odometer) && !same(t.odometer, b.odometer)) {
    const src = t.odometer > m.odometer ? t : m;
    for (const k of ["odometer", "odometerDate", "odometerLog"]) { if (k in src) out[k] = src[k]; else delete out[k]; }
  }
  // Both sides completed the same task: the later date (and its odometer) wins instead of "mine".
  if (typeof m.lastDone === "string" && typeof t.lastDone === "string" && !same(m.lastDone, b.lastDone) && !same(t.lastDone, b.lastDone)) {
    const src = t.lastDone > m.lastDone ? t : m;
    out.lastDone = src.lastDone;
    if ("lastDoneOdometer" in src) out.lastDoneOdometer = src.lastDoneOdometer;
  }
  // One phone finished the task while another snoozed it: finishing wins, as it does on a single phone.
  if ("lastDone" in out && out.lastDone !== b.lastDone && out.snoozedUntil != null && "snoozedUntil" in out) out.snoozedUntil = null;
  return out;
}

function mergeById(b, m, t, fieldwise = false) {
  const idx = (arr) => { const map = new Map(); for (const x of Array.isArray(arr) ? arr : []) if (x && x.id != null) map.set(x.id, x); return map; };
  const B = idx(b), M = idx(m), T = idx(t);
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(t) ? t : []) {
    if (!x || x.id == null) continue;
    const id = x.id;
    seen.add(id);
    const inM = M.has(id), inB = B.has(id);
    if (inM) out.push(inB ? (fieldwise ? mergeFields(B.get(id), M.get(id), x) : pick(B.get(id), M.get(id), x)) : M.get(id)); // both added same id -> mine
    else if (!inB) out.push(x); // remote addition
    else if (!same(x, B.get(id))) out.push(x); // I deleted, they modified -> keep theirs
    // else: I deleted, they didn't touch -> deleted
  }
  for (const x of Array.isArray(m) ? m : []) {
    if (!x || x.id == null || seen.has(x.id)) continue;
    const inB = B.has(x.id);
    if (!inB) out.push(x); // my addition
    else if (!same(x, B.get(x.id))) out.push(x); // they deleted, I modified -> keep mine
    // else: they deleted, I didn't touch -> deleted
  }
  return out;
}

function mergeObjects(b, m, t) {
  const out = {};
  const keys = new Set([...Object.keys(b || {}), ...Object.keys(m || {}), ...Object.keys(t || {})]);
  for (const k of keys) {
    const bv = b ? b[k] : undefined, mv = m ? m[k] : undefined, tv = t ? t[k] : undefined;
    let v;
    if (isPlain(mv) && isPlain(tv) && (bv === undefined || isPlain(bv))) v = mergeObjects(bv, mv, tv);
    else v = pick(bv, mv, tv);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Pure 3-way merge of full states. Never mutates inputs; returns plain JSON.
 * id-keyed arrays merge per id; objects (profile, emergency, emergency.shutoffs, ...) merge per key.
 * Conflicts (both sides changed the same thing) take MINE; delete-vs-modify keeps the modified one.
 */
export function mergeStates(base, mine, theirs) {
  const b = base || {}, m = mine || {}, t = theirs || {};
  const out = {};
  const keys = new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)]);
  for (const k of keys) {
    let v;
    if (ID_ARRAYS.includes(k)) v = mergeById(b[k], m[k], t[k], FIELDWISE.includes(k));
    else if (isPlain(m[k]) && isPlain(t[k]) && (b[k] === undefined || isPlain(b[k]))) v = mergeObjects(b[k], m[k], t[k]);
    else v = pick(b[k], m[k], t[k]);
    if (v !== undefined) out[k] = v;
  }
  out.version = m.version ?? t.version ?? b.version;
  return repairRefs(clone(out), [b, m, t]);
}

/**
 * After a merge, one side may reference something the other deleted (a new task on a deleted item, a new
 * mileage task on a deleted vehicle). Keep the data: bring a deleted vehicle back, and unlink missing
 * items/vehicles from tasks and vendors, so validation passes and nothing is silently thrown away.
 */
export function repairRefs(s, sources = []) {
  const ids = (k) => new Set((s[k] || []).map((x) => x.id));
  const vIds = ids("vehicles"), iIds = ids("items");
  for (const t of s.tasks || []) {
    if (t.kind === "mileage" && t.vehicleId && !vIds.has(t.vehicleId)) {
      let back = null;
      for (const src of sources) { back = (src.vehicles || []).find((v) => v && v.id === t.vehicleId) || back; }
      if (back) { s.vehicles = [...(s.vehicles || []), clone(back)]; vIds.add(back.id); }
    }
    if (t.kind !== "mileage" && t.vehicleId && !vIds.has(t.vehicleId)) t.vehicleId = null;
    if (t.itemId && !iIds.has(t.itemId)) t.itemId = null;
  }
  for (const v of s.vendors || []) {
    if (Array.isArray(v.itemIds)) v.itemIds = v.itemIds.filter((x) => iIds.has(x));
  }
  return s;
}

export async function createStore({ localStorage, claude, mergeUnownedLocal = false, now = () => Date.now(), loadTimeoutMs = 10_000, debounceMs = 600, coalesceMs = 50, lockRetryMs = 150 } = {}) {
  const db = await useCap(claude, "db");
  const ls = localStorage || null;
  let mode = db ? "cloud" : "local";
  let warning = null;
  const clientId = randomId();
  let myId = null;
  let idResolved = false;

  const statusCbs = new Set();
  let lastStatus = null;
  const emit = (kind, message) => {
    lastStatus = { kind, message };
    for (const cb of [...statusCbs]) { try { cb(lastStatus); } catch { /* ignore listener bugs */ } }
  };

  let lastSerialized = null; // JSON of the last state known to be persisted/received (fast "unchanged" check)
  let lastDocs = {}; // cloud: {path: canon(content)} of what the cloud is known to hold
  let lastWriteAt = 0;
  let writing = false;
  let pending = null;
  let timer = null;
  let waiters = [];
  let inflight = null;
  let onRemoteChange = null; // set by subscribe
  let base = null; // last known cloud state (3-way merge ancestor)
  const subscribers = new Set();
  let needsSync = false; // the last cloud write failed; local data is ahead of the cloud
  let cloudFailed = false; // the cloud could not be reached at load: running on this device's copy for now
  let retryTimer = null;
  let retryDelay = 5000;
  let retryFails = 0;
  let lastOnlineAt = 0;
  const subs = new Map(); // subscriber callback -> detach function (null until the cloud is attached)

  // ---- unsynced-edit bookkeeping, kept in localStorage so a closed tab or a restart cannot lose edits ----
  const isDirty = () => needsSync || (!!ls && (() => { try { return ls.getItem(DIRTY_KEY) === "1"; } catch { return false; } })());
  function markDirty(ancestor) { // remembers the ancestor only the first time, so repeated failures keep the oldest one
    if (!ls) return;
    try {
      if (ls.getItem(DIRTY_KEY) !== "1") { ls.setItem(BASE_KEY, JSON.stringify(ancestor || storage.freshState())); ls.setItem(DIRTY_KEY, "1"); }
    } catch { /* storage full: the edit itself is still cached */ }
  }
  function clearDirty() { needsSync = false; if (!ls) return; try { ls.removeItem(DIRTY_KEY); ls.removeItem(BASE_KEY); } catch { /* ignore */ } }
  function savedBase() {
    if (!ls) return null;
    try { const raw = ls.getItem(BASE_KEY); return raw ? storage.validateState(storage.migrate(JSON.parse(raw))) : null; } catch { return null; }
  }
  const stampOwner = (uid) => { if (ls && uid) { try { ls.setItem(OWNER_KEY, uid); } catch { /* ignore */ } } };

  // Offline-first: a failed cloud write keeps the data on this device and tries again when the network returns,
  // then on a growing delay (5 s up to 2 min). The 3-way merge makes late writes safe.
  function retryNow() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (!ls || !isDirty() || mode !== "cloud" || writing || pending) return;
    const local = readLocal();
    if (!local.has) return; // never push an empty stand-in over the cloud
    try { save(local.state); } catch { /* the next trigger tries again */ }
  }
  function scheduleRetry() {
    if (retryTimer || mode !== "cloud") return;
    retryTimer = setTimeout(() => { retryTimer = null; retryNow(); }, retryDelay);
    if (retryTimer && typeof retryTimer.unref === "function") retryTimer.unref();
    retryDelay = Math.min(retryDelay * 2, 120_000);
  }

  // Cloud was unreachable at load: when the network is back, load again, merging anything edited meanwhile.
  async function reconnect() {
    if (!cloudFailed || !db || writing) return;
    cloudFailed = false;
    mode = "cloud"; warning = null;
    const before = lastSerialized;
    const state = await load();
    if (mode !== "cloud") { cloudFailed = true; return; }
    for (const [cb, detach] of [...subs]) { if (!detach) subs.set(cb, attach(cb)); }
    if (JSON.stringify(state) !== before) for (const cb of [...subs.keys()]) { try { cb(state); } catch { /* ignore listener bugs */ } }
  }
  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("online", () => {
      const t = Date.now();
      if (t - lastOnlineAt < 3000) return; // a flapping connection must not hammer the server
      lastOnlineAt = t; retryDelay = 5000; retryFails = 0;
      if (cloudFailed) reconnect().catch(() => {}); else retryNow();
    });
  }

  async function resolveId() {
    if (idResolved) return myId;
    idResolved = true;
    try {
      const u = await useCap(claude, "user");
      const id = u && typeof u.id === "function" ? await u.id() : null;
      myId = typeof id === "string" ? id : null;
    } catch { myId = null; }
    return myId;
  }

  function readLocal() {
    if (!ls) return { state: storage.freshState(), has: false };
    return { state: storage.loadState(ls), has: true };
  }

  function cacheLocal(state, serialized) {
    if (!ls) return null;
    try { ls.setItem(storage.STORAGE_KEY, serialized ?? JSON.stringify(state)); return null; }
    catch (e) { return e; }
  }

  async function fetchHistory() {
    const out = {};
    if (typeof db.collection !== "function") return out;
    const snap = await db.collection(HISTORY_COLLECTION).get();
    for (const d of (snap && snap.docs) || []) { const data = d.data(); if (data) out[d.id] = data; }
    return out;
  }

  async function readRemote() {
    const [mainSnap, hist] = await Promise.all([db.doc(MAIN_PATH).get(), fetchHistory()]);
    const main = snapData(mainSnap);
    const raw = main && main.version !== undefined ? assembleState(main, hist) : null;
    const state = raw ? storage.validateState(storage.migrate(raw)) : null;
    const contents = {};
    if (state) for (const [p, c] of Object.entries(contentMap(main, hist))) contents[p] = canon(c);
    return { state, contents };
  }

  async function acquireLock() {
    try {
      const ref = db.doc("household/lock");
      if (!ref || typeof ref.acquire !== "function") return;
      // Wait up to roughly 3 s for the other device to finish its write before going ahead without the lock.
      for (let i = 0; i < 20; i++) {
        const r = await ref.acquire({ holder: clientId, ttlMs: 8000 });
        if (r && r.acquired) return;
        await new Promise((res) => setTimeout(res, lockRetryMs * (0.5 + Math.random())));
      }
    } catch { /* lock is best-effort: proceed without it */ }
  }

  // Best effort: free the lock as soon as the write is done so the other device doesn't have to wait out the timer.
  async function releaseLock() {
    try {
      const ref = db.doc("household/lock");
      if (ref && typeof ref.release === "function") await ref.release({ holder: clientId });
    } catch { /* the lock expires on its own */ }
  }

  async function writeShards(state, serialized) {
    const wanted = shardState(state); // may throw tooLarge
    const wantedCanon = {};
    for (const [path, content] of Object.entries(wanted)) wantedCanon[path] = canon(content);
    await resolveId();
    const stamp = () => { const updatedAt = Math.max(now(), lastWriteAt + 1); lastWriteAt = updatedAt; return { updatedAt, updatedBy: myId ?? clientId }; };
    const setDoc = async (path) => {
      await db.doc(path).set({ ...JSON.parse(JSON.stringify(wanted[path])), ...stamp() });
      lastDocs[path] = wantedCanon[path];
    };
    // History shards first, main last (main acts as the commit marker), then obsolete deletes.
    for (const path of Object.keys(wanted)) if (path !== MAIN_PATH && lastDocs[path] !== wantedCanon[path]) await setDoc(path);
    if (lastDocs[MAIN_PATH] !== wantedCanon[MAIN_PATH]) await setDoc(MAIN_PATH);
    for (const path of Object.keys(lastDocs)) {
      if (!(path in wanted)) { await db.doc(path).delete(); delete lastDocs[path]; }
    }
    void serialized;
  }

  async function loadInner() {
    if (mode === "cloud") {
      try {
        const res = await withTimeout(Promise.all([db.doc(MAIN_PATH).get(), fetchHistory()]), loadTimeoutMs);
        if (res === SENTINEL_TIMEOUT) throw new Error("Cloud storage did not answer in time");
        const uid = await resolveId();
        // Another account's cached data must never be published into this account.
        let owner = null; try { owner = ls ? ls.getItem(OWNER_KEY) : null; } catch { /* ignore */ }
        if (ls && uid && owner && owner !== uid) { try { ls.removeItem(storage.STORAGE_KEY); } catch { /* ignore */ } clearDirty(); }
        const main = snapData(res[0]);
        const hist = res[1];
        const raw = assembleState(main, hist);
        if (raw) {
          const remote = storage.validateState(storage.migrate(raw));
          lastDocs = {};
          if (main && main.version !== undefined) for (const [p, c] of Object.entries(contentMap(main, hist))) lastDocs[p] = canon(c);
          base = remote;
          // Edits made while offline (or before first sign-in) are merged in, never overwritten.
          const local = readLocal();
          const unowned = !owner && mergeUnownedLocal && local.has && (local.state.tasks.length > 0 || local.state.profile.setupDone);
          const ancestor = isDirty() ? (savedBase() || storage.freshState()) : (unowned ? storage.freshState() : null);
          if (ancestor && local.has) {
            let merged = remote;
            try { merged = storage.validateState(mergeStates(ancestor, local.state, remote)); } catch { merged = remote; }
            lastSerialized = JSON.stringify(remote);
            stampOwner(uid);
            if (!same(merged, remote)) {
              cacheLocal(merged, JSON.stringify(merged));
              markDirty(remote); // until the upload below succeeds
              pending = merged;
              setTimeout(() => { flush(); }, 0);
              emit("saving", "Saving…");
              return merged;
            }
            clearDirty();
          }
          lastSerialized = JSON.stringify(remote);
          cacheLocal(remote, lastSerialized);
          stampOwner(uid);
          emit("saved", "Synced");
          return remote;
        }
        // Empty cloud: adopt this device's data and publish every shard.
        const { state } = readLocal();
        lastSerialized = JSON.stringify(state);
        lastDocs = {};
        for (const [id, data] of Object.entries(hist)) lastDocs[`${HISTORY_COLLECTION}/${id}`] = canon(stripStamps(data)); // known, so obsolete ones get deleted
        try {
          writing = true;
          await writeShards(state, lastSerialized);
          base = state;
          clearDirty(); stampOwner(uid);
          cacheLocal(state, lastSerialized);
          emit("saved", "Saved");
        } catch (e) {
          lastSerialized = null; // force a retry on the next save
          if (!(e && e.tooLarge)) { markDirty(storage.freshState()); needsSync = true; scheduleRetry(); }
          emit(e && e.tooLarge ? "error" : "offline", e && e.tooLarge ? errMsg(e) : `Could not upload to cloud yet: ${errMsg(e)}`);
        } finally { writing = false; }
        return state;
      } catch (e) {
        mode = "local"; cloudFailed = true;
        const was = readLocal();
        if (was.has) markDirty(was.state); // what is cached now is the last copy the cloud agreed with, if nothing was dirty already
        warning = `Cloud storage unavailable (${errMsg(e)}). Using data on this device only.`;
        emit("offline", warning);
      }
    }
    const { state } = readLocal();
    lastSerialized = JSON.stringify(state);
    return state;
  }

  async function load() {
    const st = await loadInner();
    setTimeout(() => { uploadLocalPhotos(st); }, 0);
    return st;
  }

  async function drain() {
    let ok = true;
    while (pending) {
      const state = pending;
      pending = null;
      const batch = waiters;
      waiters = [];
      let result = true;
      try {
        const serialized = JSON.stringify(state);
        if (serialized !== lastSerialized) {
          storage.validateState(state);
          emit("saving", "Saving…");
          const cacheErr = cacheLocal(state, serialized);
          if (mode === "cloud") {
            writing = true;
            try {
              await acquireLock();
              let toWrite = state;
              // If another phone saves between our read and our write, the server refuses ours (it is conditional on what we
              // read). Then we simply read again and merge again, up to three times.
              for (let attempt = 0; ; attempt++) {
                try {
                  const remote = await readRemote();
                  const unchanged = !remote.state
                    || (Object.keys(remote.contents).length === Object.keys(lastDocs).length
                      && Object.entries(remote.contents).every(([p, c]) => lastDocs[p] === c));
                  if (!unchanged) {
                    lastDocs = { ...remote.contents }; // diff the write against what the cloud really holds
                    try {
                      toWrite = storage.validateState(mergeStates(base || savedBase() || remote.state, state, remote.state));
                    } catch (e) {
                      // Never overwrite the other device's data with ours: leave the cloud alone and retry on the next change.
                      throw new Error(`could not combine with changes from another device (${errMsg(e)})`);
                    }
                  }
                  await writeShards(toWrite, JSON.stringify(toWrite));
                  break;
                } catch (e) {
                  if (e && e.conflict && attempt < 3) { toWrite = state; continue; }
                  throw e;
                }
              }
              base = toWrite;
              lastSerialized = JSON.stringify(toWrite);
              if (!same(toWrite, state)) {
                let deliver = toWrite;
                if (pending) { // newer local edits queued meanwhile: carry the remote changes into them
                  try { deliver = storage.validateState(mergeStates(state, pending, toWrite)); pending = deliver; } catch { deliver = toWrite; }
                }
                for (const cb of [...subscribers]) { try { cb(deliver); } catch { /* ignore listener bugs */ } }
              }
              clearDirty(); retryDelay = 5000; retryFails = 0;
              emit("saved", "Saved");
            } catch (e) {
              result = false;
              if (e && e.tooLarge) emit("error", errMsg(e));
              else {
                markDirty(base || storage.freshState()); needsSync = true;
                // Network trouble is retried for a while; a refusal from the server (4xx) or a merge conflict is not hammered.
                const refused = e && ((e.status >= 400 && e.status < 500 && ![401, 408, 429].includes(e.status)) || /could not combine/.test(errMsg(e)));
                if (!refused && ++retryFails <= 12) scheduleRetry();
                emit("offline", `Saved on this device; will sync when the connection is back (${errMsg(e)}).`);
              }
            } finally { writing = false; await releaseLock(); }
          } else if (cacheErr) {
            result = false;
            emit("error", `Could not save on this device: ${errMsg(cacheErr)}`);
          } else {
            lastSerialized = serialized;
            emit("saved", "Saved on this device");
          }
        }
      } catch (e) {
        result = false;
        emit("error", `Could not save: ${errMsg(e)}`);
      }
      ok = ok && result;
      batch.forEach((w) => w(result));
    }
    if (onRemoteChange) onRemoteChange(); // re-check remote views that arrived mid-write
    return ok;
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    const run = async () => {
      if (inflight) await inflight.catch(() => {});
      if (!pending) return true;
      inflight = drain().finally(() => { inflight = null; });
      return inflight;
    };
    return run().catch(() => false);
  }

  function save(state) {
    pending = state;
    // Signed out (or cloud unreachable) on a phone that belongs to an account: what is cached right now is the last copy
    // the cloud agreed with. Remember it as the merge ancestor so these edits are merged in at the next sign-in.
    if (mode !== "cloud" && ls && !isDirty()) {
      let owner = null; try { owner = ls.getItem(OWNER_KEY); } catch { /* ignore */ }
      if (owner) { const prior = readLocal(); markDirty(prior.has ? prior.state : storage.freshState()); }
    }
    try { // synchronous local cache so a commit right before the tab closes is never lost
      const ser = JSON.stringify(state);
      if (ser !== lastSerialized) { storage.validateState(state); const err = cacheLocal(state, ser); if (err && mode === "local") emit("error", `Could not save on this device: ${errMsg(err)}`); }
    } catch { /* drain() reports validation problems */ }
    return new Promise((resolve) => {
      waiters.push(resolve);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; flush(); }, debounceMs);
    });
  }

  function subscribe(cb) {
    if (!db) return () => {};
    subs.set(cb, mode === "cloud" ? attach(cb) : null); // attached later by reconnect() if the cloud was unreachable now
    return () => { const d = subs.get(cb); subs.delete(cb); if (d) d(); };
  }

  function attach(cb) {
    let active = true;
    subscribers.add(cb);
    let remoteMain; // undefined = not yet received
    let remoteHist; // undefined = not yet received
    let coalesce = null;
    const unsubs = [];
    const histSub = typeof db.collection === "function";
    const histListen = histSub && typeof db.collection(HISTORY_COLLECTION).onSnapshot === "function";

    async function process() {
      coalesce = null;
      if (!active || writing || pending || inflight || remoteMain === undefined) return;
      if (isDirty()) { retryNow(); return; } // our unsent edits go through the merge path first; never overwrite them
      try {
        let hist = remoteHist;
        if (hist === undefined) { if (histListen) return; hist = await fetchHistory(); }
        const main = remoteMain;
        if (!main) return;
        const remote = contentMap(main, hist);
        const same = main.version !== undefined
          && Object.keys(remote).length === Object.keys(lastDocs).length
          && Object.entries(remote).every(([p, c]) => lastDocs[p] === canon(c));
        if (same) return;
        const raw = assembleState(main, hist);
        if (!raw) return;
        const state = storage.validateState(storage.migrate(raw));
        const ser = JSON.stringify(state);
        lastDocs = {};
        if (main.version !== undefined) for (const [p, c] of Object.entries(remote)) lastDocs[p] = canon(c);
        base = state;
        if (ser === lastSerialized) return;
        lastSerialized = ser;
        cacheLocal(state, ser);
        cb(state);
      } catch (e) {
        emit("error", `Ignored an invalid update from another device: ${errMsg(e)}`);
      }
    }
    const schedule = () => { if (active && !coalesce) coalesce = setTimeout(process, coalesceMs); };
    onRemoteChange = schedule;

    let liveDown = false;
    const onErr = (e) => {
      if (e) { if (!liveDown) { liveDown = true; emit("offline", `Can't reach the cloud right now (${errMsg(e)}). Your changes are safe on this device.`); } }
      else if (liveDown) { liveDown = false; emit("saved", "Synced"); } // a later poll succeeded
    };
    try {
      unsubs.push(db.doc(MAIN_PATH).onSnapshot((snap) => { remoteMain = snapData(snap); schedule(); }, onErr));
      if (histListen) {
        unsubs.push(db.collection(HISTORY_COLLECTION).onSnapshot((snap) => {
          const h = {};
          for (const d of (snap && snap.docs) || []) { const data = d.data(); if (data) h[d.id] = data; }
          remoteHist = h; schedule();
        }, onErr));
      }
    } catch (e) {
      emit("offline", `Live sync unavailable (${errMsg(e)})`);
    }
    return () => {
      active = false;
      subscribers.delete(cb);
      if (coalesce) { clearTimeout(coalesce); coalesce = null; }
      if (onRemoteChange === schedule) onRemoteChange = null;
      for (const u of unsubs) { try { if (typeof u === "function") u(); } catch { /* ignore */ } }
    };
  }

  const photoKey = (id) => PHOTO_PREFIX + id;

  // Photos taken while signed out live only in this phone's storage. Once signed in, copy them up so they are not lost.
  async function uploadLocalPhotos(state) {
    if (mode !== "cloud" || !ls) return;
    for (const id of photoIdsOf(state)) {
      try {
        const local = ls.getItem(photoKey(id));
        if (!local) continue;
        const have = snapData(await db.doc(`photos/${id}`).get());
        if (!have || typeof have.data !== "string") await db.doc(`photos/${id}`).set({ data: local, updatedAt: Number(now()) });
        ls.removeItem(photoKey(id));
      } catch { /* try again next time the app loads */ }
    }
  }

  async function putPhoto(id, dataUrl) {
    if (typeof id !== "string" || !id) throw new Error("Photo id is required.");
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) throw new Error("Photo data must be an image data URL.");
    if (mode === "cloud") {
      try { await db.doc(`photos/${id}`).set({ data: dataUrl, updatedAt: Number(now()) }); return; }
      catch (e) { throw new Error(`Could not upload the photo to cloud storage: ${errMsg(e)}`); }
    }
    if (!ls) throw new Error("No storage is available to keep photos.");
    try { ls.setItem(photoKey(id), dataUrl); }
    catch { throw new Error("This device's storage is full, so the photo could not be kept. Remove some photos and try again."); }
  }

  async function getPhoto(id) {
    try {
      if (mode === "cloud") {
        const d = snapData(await db.doc(`photos/${id}`).get());
        return d && typeof d.data === "string" ? d.data : null;
      }
      return ls ? ls.getItem(photoKey(id)) ?? null : null;
    } catch { return null; }
  }

  async function deletePhoto(id) {
    try {
      if (mode === "cloud") await db.doc(`photos/${id}`).delete();
      else if (ls) ls.removeItem(photoKey(id));
    } catch { /* best effort */ }
  }

  async function whoAmI() {
    const u = await useCap(claude, "user");
    if (!u) return { id: null, isOwner: false };
    let id = null, isOwner = false;
    try { const v = typeof u.id === "function" ? await u.id() : null; id = typeof v === "string" ? v : null; } catch { /* */ }
    try { isOwner = typeof u.isOwner === "function" ? !!(await u.isOwner()) : false; } catch { /* */ }
    return { id, isOwner };
  }

  async function names(ids) {
    const list = [...new Set((ids || []).filter((x) => typeof x === "string" && x))];
    const out = Object.fromEntries(list.map((id) => [id, "Someone"]));
    if (!list.length) return out;
    try {
      const u = await useCap(claude, "user");
      if (u && typeof u.profiles === "function") {
        const ps = (await u.profiles(list)) || {};
        for (const id of list) { const n = ps[id] && ps[id].name; if (typeof n === "string" && n.trim()) out[id] = n; }
      }
    } catch { /* keep fallbacks */ }
    return out;
  }

  async function saveFile(filename, text, mime) {
    void mime; // the downloads capability derives MIME from the extension
    try {
      const dl = await useCap(claude, "downloads");
      if (!dl || typeof dl.save !== "function") return false;
      try { await dl.save({ filename, data: text }); return true; }
      catch (e) {
        // Extensions like .ics aren't on the allowlist; offer it as .txt (user can rename).
        if (e && e.code === "rejected_extension") {
          try { await dl.save({ filename: `${filename}.txt`, data: text }); return true; } catch { return false; }
        }
        return false;
      }
    } catch { return false; }
  }

  return {
    get mode() { return mode; },
    get warning() { return warning; },
    get status() { return lastStatus; },
    load, save, flush, subscribe,
    onStatus(cb) { statusCbs.add(cb); return () => statusCbs.delete(cb); },
    putPhoto, getPhoto, deletePhoto, whoAmI, names, saveFile,
  };
}
