// Persistence layer: cloud (claude `db` capability) with localStorage cache/fallback.
// Everything degrades gracefully; nothing here throws into the UI except put/getPhoto contracts noted below.
import * as storage from "./storage.js";

const DOC_STATE = "household/main";
const PHOTO_PREFIX = "motH.photo.";
const SENTINEL_TIMEOUT = Symbol("timeout");

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


const ID_ARRAYS = ["tasks", "vehicles", "items", "supplies", "completions"];
const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const same = (a, b) => canon(a) === canon(b);
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Per-value rule: only one side changed vs base -> that side; both changed -> mine. */
function pick(b, m, t) {
  if (same(m, b)) return t;
  if (same(t, b)) return m;
  return m;
}

function mergeById(b, m, t) {
  const idx = (arr) => { const map = new Map(); for (const x of Array.isArray(arr) ? arr : []) if (x && x.id != null) map.set(x.id, x); return map; };
  const B = idx(b), M = idx(m), T = idx(t);
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(t) ? t : []) {
    if (!x || x.id == null) continue;
    const id = x.id;
    seen.add(id);
    const inM = M.has(id), inB = B.has(id);
    if (inM) out.push(inB ? pick(B.get(id), M.get(id), x) : M.get(id)); // both added same id -> mine
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
    if (ID_ARRAYS.includes(k)) v = mergeById(b[k], m[k], t[k]);
    else if (isPlain(m[k]) && isPlain(t[k]) && (b[k] === undefined || isPlain(b[k]))) v = mergeObjects(b[k], m[k], t[k]);
    else v = pick(b[k], m[k], t[k]);
    if (v !== undefined) out[k] = v;
  }
  out.version = m.version ?? t.version ?? b.version;
  return clone(out);
}

export async function createStore({ localStorage, claude, now = () => Date.now(), loadTimeoutMs = 10_000, debounceMs = 600, coalesceMs = 50, lockRetryMs = 150 } = {}) {
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
      for (let i = 0; i < 5; i++) {
        const r = await ref.acquire({ holder: clientId, ttlMs: 8000 });
        if (r && r.acquired) return;
        await new Promise((res) => setTimeout(res, lockRetryMs * (0.5 + Math.random())));
      }
    } catch { /* lock is best-effort: proceed without it */ }
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

  async function load() {
    if (mode === "cloud") {
      try {
        const res = await withTimeout(Promise.all([db.doc(MAIN_PATH).get(), fetchHistory()]), loadTimeoutMs);
        if (res === SENTINEL_TIMEOUT) throw new Error("Cloud storage did not answer in time");
        const main = snapData(res[0]);
        const hist = res[1];
        const raw = assembleState(main, hist);
        if (raw) {
          const state = storage.validateState(storage.migrate(raw));
          lastDocs = {};
          if (main && main.version !== undefined) for (const [p, c] of Object.entries(contentMap(main, hist))) lastDocs[p] = canon(c);
          lastSerialized = JSON.stringify(state);
          base = state;
          cacheLocal(state, lastSerialized);
          emit("saved", "Synced");
          return state;
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
          cacheLocal(state, lastSerialized);
          emit("saved", "Saved");
        } catch (e) {
          lastSerialized = null; // force a retry on the next save
          emit(e && e.tooLarge ? "error" : "offline", e && e.tooLarge ? errMsg(e) : `Could not upload to cloud yet: ${errMsg(e)}`);
        } finally { writing = false; }
        return state;
      } catch (e) {
        mode = "local";
        warning = `Cloud storage unavailable (${errMsg(e)}). Using data on this device only.`;
        emit("offline", warning);
      }
    }
    const { state } = readLocal();
    lastSerialized = JSON.stringify(state);
    return state;
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
              const remote = await readRemote();
              const unchanged = !remote.state
                || (Object.keys(remote.contents).length === Object.keys(lastDocs).length
                  && Object.entries(remote.contents).every(([p, c]) => lastDocs[p] === c));
              if (!unchanged) {
                lastDocs = { ...remote.contents }; // diff the write against what the cloud really holds
                try {
                  toWrite = storage.validateState(mergeStates(base || remote.state, state, remote.state));
                } catch (e) {
                  toWrite = state;
                  emit("saving", `Could not merge with changes from another device (${errMsg(e)}); keeping this device's version.`);
                }
              }
              await writeShards(toWrite, JSON.stringify(toWrite));
              base = toWrite;
              lastSerialized = JSON.stringify(toWrite);
              if (!same(toWrite, state)) {
                let deliver = toWrite;
                if (pending) { // newer local edits queued meanwhile: carry the remote changes into them
                  try { deliver = storage.validateState(mergeStates(state, pending, toWrite)); pending = deliver; } catch { deliver = toWrite; }
                }
                for (const cb of [...subscribers]) { try { cb(deliver); } catch { /* ignore listener bugs */ } }
              }
              emit("saved", "Saved");
            } catch (e) {
              result = false;
              if (e && e.tooLarge) emit("error", errMsg(e));
              else emit("offline", `Saved on this device; cloud sync failed (${errMsg(e)}). Will retry on the next change.`);
            } finally { writing = false; }
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
    if (mode !== "cloud" || !db) return () => {};
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

    const onErr = (e) => emit("offline", `Live sync stopped (${errMsg(e)}). Reload to reconnect.`);
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
