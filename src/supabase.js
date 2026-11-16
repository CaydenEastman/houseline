// A Supabase-backed implementation of the small "db" interface that sync.js already speaks
// (doc/collection get, set, delete, onSnapshot, acquire/release). Because it matches that interface,
// every piece of merging, sharding, caching and offline handling in sync.js is reused unchanged.
// Plain fetch only: no SDK, no build step.

const PHOTO_BUCKET = "photos";
const IMAGE_RE = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;

const enc = encodeURIComponent;

export function dataUrlToBlob(dataUrl) {
  const m = IMAGE_RE.exec(String(dataUrl));
  if (!m) throw new Error("Photos must be JPEG, PNG or WebP images.");
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export async function blobToDataUrl(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  const type = /^image\/(jpeg|png|webp)$/.test(blob.type) ? blob.type : "image/jpeg"; // Storage may answer application/octet-stream
  return `data:${type};base64,${btoa(bin)}`;
}

/**
 * Instant updates: Supabase Realtime over a WebSocket (Phoenix protocol v1), no SDK. It only says "something changed";
 * the pollers then re-read, so the store's merge logic stays the single place that decides what to do with changes.
 * Needs `alter publication supabase_realtime add table public.docs` (in schema.sql). Polling remains as the fallback.
 */
export function createRealtimeHub({ url, anonKey, auth, getHousehold, WebSocketImpl, heartbeatMs = 25_000, tokenMs = 20 * 60_000, maxBackoffMs = 30_000, backoffStartMs = 1000 }) {
  const WS = WebSocketImpl || (typeof WebSocket !== "undefined" ? WebSocket : null);
  const listeners = new Set();
  let ws = null, hb = null, tk = null, retry = null, backoff = backoffStartMs, ref = 0, connected = false, wanted = false, topic = "";
  const wsUrl = () => String(url).replace(/\/+$/, "").replace(/^http/, "ws") + `/realtime/v1/websocket?apikey=${encodeURIComponent(anonKey)}&vsn=1.0.0`;
  const send = (obj) => { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ ref: String(++ref), ...obj })); } catch { /* the close handler reconnects */ } };
  const ping = (why) => { for (const fn of [...listeners]) { try { fn(why); } catch { /* ignore listener bugs */ } } };

  async function open() {
    if (!WS || !wanted || ws) return;
    let hh, token;
    try { hh = await getHousehold(); token = await auth.accessToken(); } catch { return later(); }
    if (!token || !wanted || ws) return;
    topic = `realtime:docs-${hh}`;
    try { ws = new WS(wsUrl()); } catch { ws = null; return later(); }
    ws.onopen = () => {
      send({ topic, event: "phx_join", payload: { config: { broadcast: { self: false }, presence: { key: "" }, postgres_changes: [{ event: "*", schema: "public", table: "docs", filter: `household_id=eq.${hh}` }] }, access_token: token } });
      hb = setInterval(() => send({ topic: "phoenix", event: "heartbeat", payload: {} }), heartbeatMs);
      tk = setInterval(async () => { try { const t = await auth.accessToken(); if (t) send({ topic, event: "access_token", payload: { access_token: t } }); } catch { /* next time */ } }, tokenMs);
      for (const t of [hb, tk]) if (t && typeof t.unref === "function") t.unref();
    };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === "phx_reply" && m.payload && m.payload.status === "ok" && !connected) { connected = true; backoff = backoffStartMs; ping("joined"); } // re-read: we may have missed changes while disconnected
      else if (m.event === "postgres_changes") ping("change");
      else if (m.event === "phx_error" || m.event === "phx_close") { try { ws && ws.close(); } catch { /* ignore */ } }
    };
    const drop = () => { connected = false; clearInterval(hb); clearInterval(tk); ws = null; if (wanted) later(); };
    ws.onclose = drop;
    ws.onerror = () => { try { ws && ws.close(); } catch { /* ignore */ } };
  }
  function later() {
    if (retry || !wanted) return;
    retry = setTimeout(() => { retry = null; open(); }, backoff);
    if (retry && typeof retry.unref === "function") retry.unref();
    backoff = Math.min(backoff * 2, maxBackoffMs);
  }
  function close() {
    wanted = false; connected = false; clearInterval(hb); clearInterval(tk);
    if (retry) { clearTimeout(retry); retry = null; }
    const w = ws; ws = null; try { w && w.close(); } catch { /* ignore */ }
  }
  return {
    get connected() { return connected; },
    on(fn) { listeners.add(fn); if (!wanted) { wanted = true; open(); } return () => { listeners.delete(fn); if (!listeners.size) close(); }; },
  };
}

/**
 * Returns an object shaped like window.claude: { use(name) } so createStore can take it as-is.
 * `use("db")` resolves to null while signed out, which makes the store run in local mode.
 */
export function createSupabaseBackend({ url, anonKey, auth, fetchImpl, realtime = false, WebSocketImpl, realtimeBackoffMs, pollMs = 20_000, timeoutMs = 20_000, isVisible = () => (typeof document === "undefined" ? true : document.visibilityState !== "hidden") }) {
  const base = String(url || "").replace(/\/+$/, "");
  const f = fetchImpl || ((...a) => fetch(...a));
  let householdId = null;
  let householdFor = null; // user id the cached household belongs to

  async function http(path, { method = "GET", headers = {}, body, raw = false, retried = false } = {}) {
    const token = await auth.accessToken();
    if (!token) throw new Error("You are signed out. Sign in to sync.");
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res;
    try {
      res = await f(base + path, { method, signal: ctl ? ctl.signal : undefined, headers: { apikey: anonKey, Authorization: `Bearer ${token}`, ...headers }, body });
    } catch (e) {
      throw new Error(e && e.name === "AbortError" ? "The server took too long to answer." : "Could not reach the server.");
    } finally { if (timer) clearTimeout(timer); }
    if (res.status === 401 && !retried) { try { await auth.refresh(); } catch { /* fall through to the error below */ } return http(path, { method, headers, body, raw, retried: true }); }
    if (!res.ok) {
      let msg = "", body = null; try { body = await res.json(); msg = body.message || body.error || body.msg || ""; } catch { /* no body */ }
      const e = new Error(msg || `Server error (${res.status})`); e.status = res.status; e.code = body && body.statusCode ? String(body.statusCode) : undefined; throw e;
    }
    if (raw) return res;
    if (res.status === 204) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  const json = { "Content-Type": "application/json" };

  // Memoize the in-flight request too: on first sign-in many reads start at once and must share one lookup.
  let householdPending = null;
  async function household() {
    const uid = auth.userId();
    if (householdId && householdFor === uid) return householdId;
    if (!householdPending || householdPending.uid !== uid) {
      const p = (async () => {
        const id = await http("/rest/v1/rpc/ensure_household", { method: "POST", headers: json, body: "{}" });
        if (typeof id !== "string") throw new Error("Could not find your household.");
        householdId = id; householdFor = uid;
        return id;
      })();
      householdPending = { uid, p };
      p.catch(() => { if (householdPending && householdPending.p === p) householdPending = null; });
    }
    return householdPending.p;
  }

  const hub = realtime ? createRealtimeHub({ url, anonKey, auth, getHousehold: household, WebSocketImpl, ...(realtimeBackoffMs ? { backoffStartMs: realtimeBackoffMs } : {}) }) : null;

  const q = async (path) => `household_id=eq.${enc(await household())}&path=eq.${enc(path)}`;
  const snap = (row) => ({ exists: !!row, data: () => (row ? row.data : null), updated_at: row ? row.updated_at : 0 });

  async function getRow(path) {
    const rows = await http(`/rest/v1/docs?${await q(path)}&select=data,updated_at&limit=1`);
    return rows && rows[0] ? rows[0] : null;
  }

  // The main document is written conditionally: "replace it only if it is still the version I read". If another phone
  // saved in between, the server refuses (409) and the store re-reads and merges again, so no save can silently
  // overwrite a newer one. (Other documents are content-addressed history chunks, safe to upsert.)
  const seen = new Map(); // path -> updated_at we last read through doc.get(); 0 = we saw it missing
  const conflict = () => Object.assign(new Error("Changed on another device while saving; merging again."), { conflict: true, status: 409 });

  async function setRow(path, data) {
    const hh = await household();
    let updated_at = Number.isFinite(data && data.updatedAt) ? data.updatedAt : Date.now();
    if (path === "household/main" && seen.has(path)) {
      const was = seen.get(path);
      updated_at = Math.max(updated_at, was + 1);
      if (was === 0) { // we saw no document: create it, and fail if someone else created it first
        try { await http("/rest/v1/docs", { method: "POST", headers: { ...json, Prefer: "return=minimal" }, body: JSON.stringify({ household_id: hh, path, data, updated_at }) }); }
        catch (e) { if (e && (e.status === 409 || e.code === "23505")) throw conflict(); throw e; }
      } else {
        const rows = await http(`/rest/v1/docs?household_id=eq.${enc(hh)}&path=eq.${enc(path)}&updated_at=eq.${was}`, { method: "PATCH", headers: { ...json, Prefer: "return=representation" }, body: JSON.stringify({ data, updated_at }) });
        if (!rows || rows.length !== 1) throw conflict();
      }
      seen.set(path, updated_at);
      return;
    }
    await http("/rest/v1/docs?on_conflict=household_id,path", {
      method: "POST", headers: { ...json, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify({ household_id: hh, path, data, updated_at }),
    });
    if (path === "household/main") seen.set(path, updated_at);
  }

  async function deleteRow(path) {
    await http(`/rest/v1/docs?${await q(path)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
  }

  async function listRows(prefix) {
    const hh = await household();
    const rows = [];
    for (let from = 0; ; from += 500) { // PostgREST caps one response (1000 on Supabase): read in pages so nothing is cut off
      const page = await http(`/rest/v1/docs?household_id=eq.${enc(hh)}&path=like.${enc(prefix + "/*")}&select=path,data,updated_at&order=path.asc&limit=500&offset=${from}`);
      rows.push(...(page || []));
      if (!page || page.length < 500) break;
    }
    return rows.map((r) => ({ id: r.path.slice(prefix.length + 1), data: () => r.data, updated_at: r.updated_at }));
  }

  // Polling stand-in for live updates: re-reads at most every pollMs while the app is visible, and tells the
  // store only when something changed. (Realtime websockets can replace this later without touching sync.js.)
  function poll(read, signature, onData, onErr) {
    let stopped = false, last, timer = null, running = false, failing = false;
    const tick = async () => {
      if (stopped || running) return;
      running = true;
      try {
        const v = await read();
        if (failing) { failing = false; if (onErr) onErr(null); } // recovered: lets the store clear its "can't reach" notice
        const sig = signature(v);
        if (sig !== last) { last = sig; onData(v); }
      } catch (e) { if (!stopped && onErr && !failing) { failing = true; onErr(e); } }
      finally { running = false; }
    };
    // With the live connection up, polling only needs to be a slow safety net.
    const loop = () => { if (stopped) return; timer = setTimeout(async () => { if (isVisible()) await tick(); loop(); }, hub && hub.connected ? pollMs * 3 : pollMs); };
    const offHub = hub ? hub.on(() => { if (isVisible()) tick(); }) : null;
    const onVisible = () => { if (isVisible()) tick(); };
    if (typeof document !== "undefined" && document.addEventListener) document.addEventListener("visibilitychange", onVisible);
    tick().then(loop);
    return () => {
      stopped = true; if (timer) clearTimeout(timer); if (offHub) offHub();
      if (typeof document !== "undefined" && document.removeEventListener) document.removeEventListener("visibilitychange", onVisible);
    };
  }

  function photoDoc(id) {
    const path = async () => `/storage/v1/object/${PHOTO_BUCKET}/${await household()}/${enc(id)}`;
    return {
      async get() {
        try {
          const res = await http((await path()).replace("/object/", "/object/authenticated/"), { raw: true });
          return snap({ data: { data: await blobToDataUrl(await res.blob()) }, updated_at: 0 });
        } catch (e) { if (e && (e.status === 404 || e.code === "404")) return snap(null); throw e; } // Storage reports a missing file as 400 with statusCode 404
      },
      async set(obj) {
        const blob = dataUrlToBlob(obj && obj.data);
        if (blob.size > 2 * 1024 * 1024) throw new Error("That photo is too large (2 MB limit).");
        await http(await path(), { method: "POST", headers: { "Content-Type": blob.type, "x-upsert": "true", "cache-control": "max-age=3600" }, body: blob });
      },
      async delete() { await http(await path(), { method: "DELETE" }); },
    };
  }

  const db = {
    doc(path) {
      if (path.startsWith("photos/")) return photoDoc(path.slice("photos/".length));
      if (path === "household/lock") {
        return {
          async acquire({ holder, ttlMs }) { return { acquired: (await http("/rest/v1/rpc/acquire_lock", { method: "POST", headers: json, body: JSON.stringify({ holder, ttl_ms: ttlMs }) })) === true }; },
          async release({ holder }) { await http("/rest/v1/rpc/release_lock", { method: "POST", headers: json, body: JSON.stringify({ holder }) }); },
        };
      }
      return {
        async get() { const row = await getRow(path); if (path === "household/main") seen.set(path, row ? row.updated_at : 0); return snap(row); },
        async set(data) { await setRow(path, data); },
        async delete() { await deleteRow(path); seen.delete(path); },
        onSnapshot(cb, errCb) { return poll(async () => snap(await getRow(path)), (s) => `${s.exists}:${s.updated_at}`, cb, errCb); },
      };
    },
    collection(name) {
      return {
        async get() { return { docs: await listRows(name) }; },
        onSnapshot(cb, errCb) {
          return poll(async () => ({ docs: await listRows(name) }), (s) => s.docs.map((d) => `${d.id}:${d.updated_at}`).sort().join("|"), cb, errCb);
        },
      };
    },
  };

  const userCap = {
    async id() { return auth.userId(); },
    async isOwner() { return true; }, // one household per user for now; roles arrive with sharing
    async profiles() { return {}; },
  };

  return {
    async use(name) {
      if (name === "db") return auth.isSignedIn() ? db : null;
      if (name === "user") return auth.isSignedIn() ? userCap : null;
      return null;
    },
  };
}
