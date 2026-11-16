// An in-memory stand-in for the parts of Supabase the app uses (Auth, PostgREST, Storage), enforcing the same
// row-level rules as supabase/schema.sql: a signed-in user only reaches their own household's rows and photos.
export function fakeSupabase({ now = () => Date.now() } = {}) {
  const url = "https://fake.supabase.co";
  const users = new Map();       // token -> { id, email, refresh }
  const refreshTokens = new Map(); // refresh -> uid
  const memberOf = new Map();    // uid -> household id
  const docs = new Map();        // `${hh}|${path}` -> { data, updated_at }
  const locks = new Map();       // hh -> { holder, expires }
  const blobs = new Map();       // `${hh}/${id}` -> { type, bytes }
  const log = [];
  const watchers = new Set(); // fake realtime sockets
  const changed = (hh) => { for (const w of watchers) w.notify(hh); };
  let down = false;
  let n = 0;

  const json = (obj, status = 200) => new Response(obj === undefined ? "" : JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
  const err = (status, message) => json({ message }, status);

  function addUser(email) {
    const id = `u${++n}`;
    const s = session(id, email);
    return { id, ...s };
  }
  function session(id, email, expiresInSec = 3600) {
    const access_token = `tok-${id}-${++n}`;
    const refresh_token = `ref-${id}-${++n}`;
    users.set(access_token, { id, email });
    refreshTokens.set(refresh_token, { id, email });
    return { access_token, refresh_token, expires_in: expiresInSec, expires_at: Math.floor(now() / 1000) + expiresInSec, user: { id, email } };
  }
  const householdOf = (uid) => { if (!memberOf.has(uid)) memberOf.set(uid, `hh-${uid}`); return memberOf.get(uid); };

  async function fetchImpl(input, init = {}) {
    if (down) throw new TypeError("network down");
    const u = new URL(input);
    const method = (init.method || "GET").toUpperCase();
    const h = Object.fromEntries(Object.entries(init.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
    log.push(`${method} ${u.pathname}`);
    if (!h.apikey) return err(401, "No API key");
    const p = u.pathname;

    if (p === "/auth/v1/token") {
      const body = JSON.parse(init.body);
      const r = refreshTokens.get(body.refresh_token);
      if (!r) return json({ error: "invalid_grant", error_description: "Invalid Refresh Token" }, 400);
      if (u.searchParams.get("grant_type") !== "refresh_token") return json({ error: "unsupported_grant_type" }, 400);
      refreshTokens.delete(body.refresh_token);
      return json(session(r.id, r.email));
    }
    if (p === "/auth/v1/otp") return json({});
    if (p === "/auth/v1/logout") return json({});

    const bearer = (h.authorization || "").replace(/^Bearer /, "");
    const me = users.get(bearer);
    if (p === "/auth/v1/user") return me ? json({ id: me.id, email: me.email }) : err(401, "invalid JWT");
    if (!me) return err(401, "JWT expired");
    const hh = householdOf(me.id);

    if (p === "/rest/v1/rpc/ensure_household") return json(hh);
    if (p === "/rest/v1/rpc/acquire_lock") {
      const { holder, ttl_ms } = JSON.parse(init.body);
      const cur = locks.get(hh);
      if (!cur || cur.holder === holder || cur.expires < now()) { locks.set(hh, { holder, expires: now() + ttl_ms }); return json(true); }
      return json(false);
    }
    if (p === "/rest/v1/rpc/release_lock") {
      const { holder } = JSON.parse(init.body);
      const cur = locks.get(hh); if (cur && cur.holder === holder) locks.delete(hh);
      return new Response(null, { status: 204 });
    }
    if (p === "/rest/v1/docs") {
      const want = (k) => { const v = u.searchParams.get(k); return v ? v.replace(/^(eq|like)\./, "") : null; };
      if (method === "POST") {
        const row = JSON.parse(init.body);
        if (row.household_id !== hh) return err(403, "new row violates row-level security policy for table \"docs\"");
        const upsert = u.searchParams.get("on_conflict") === "household_id,path" && /merge-duplicates/.test(h.prefer || "");
        if (!upsert && docs.has(`${hh}|${row.path}`)) return json({ code: "23505", message: "duplicate key value violates unique constraint" }, 409); // real PostgREST only upserts when asked to
        docs.set(`${hh}|${row.path}`, { data: row.data, updated_at: row.updated_at }); changed(hh);
        return new Response(null, { status: 201 });
      }
      const hq = want("household_id"); if (hq !== hh) return method === "GET" ? json([]) : new Response(null, { status: 204 }); // RLS hides other households
      const pq = u.searchParams.get("path") || ""; const lim = Number(u.searchParams.get("limit")) || 1e9, off = Number(u.searchParams.get("offset")) || 0;
      const match = (path) => (pq.startsWith("eq.") ? path === pq.slice(3) : pq.startsWith("like.") ? path.startsWith(pq.slice(5).replace(/\*$/, "")) : true);
      const mine = [...docs.entries()].filter(([k]) => k.startsWith(`${hh}|`)).map(([k, v]) => ({ path: k.slice(hh.length + 1), ...v })).filter((r) => match(r.path));
      if (method === "PATCH") {
        const wantAt = u.searchParams.get("updated_at");
        const hit = mine.filter((r) => wantAt == null || String(r.updated_at) === wantAt.replace(/^eq\./, ""));
        const body = JSON.parse(init.body);
        for (const r of hit) { docs.set(`${hh}|${r.path}`, { data: body.data, updated_at: body.updated_at ?? r.updated_at }); changed(hh); }
        return json(hit.map((r) => ({ path: r.path, ...docs.get(`${hh}|${r.path}`) })));
      }
      if (method === "DELETE") { for (const r of mine) docs.delete(`${hh}|${r.path}`); changed(hh); return new Response(null, { status: 204 }); }
      return json(mine.sort((a, b) => a.path.localeCompare(b.path)).slice(off, off + lim));
    }
    const sm = /^\/storage\/v1\/object\/(authenticated\/)?photos\/([^/]+)\/(.+)$/.exec(p);
    if (sm) {
      const [, , folder, id] = sm;
      if (folder !== hh) return err(403, "new row violates row-level security policy");
      const key = `${folder}/${decodeURIComponent(id)}`;
      if (method === "POST") { const b = init.body; blobs.set(key, { type: b.type, bytes: new Uint8Array(await b.arrayBuffer()) }); return json({ Key: key }); }
      if (method === "DELETE") { blobs.delete(key); return json({}); }
      const b = blobs.get(key); if (!b) return json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400); // real Storage answers 400 + statusCode 404
      return new Response(b.bytes, { status: 200, headers: { "content-type": b.type } });
    }
    return err(404, `unhandled ${method} ${p}`);
  }

  // A fake WebSocket speaking just enough Phoenix/Realtime: join -> ok reply, then "postgres_changes" pushes for the joined household.
  class FakeWebSocket {
    constructor(u) {
      this.url = u; this.readyState = 0; this.sent = [];
      FakeWebSocket.instances.push(this);
      queueMicrotask(() => { if (down) { this.readyState = 3; this.onerror && this.onerror(); this.onclose && this.onclose(); return; } this.readyState = 1; this.onopen && this.onopen(); });
    }
    send(raw) {
      const m = JSON.parse(raw); this.sent.push(m);
      if (m.event === "phx_join") {
        const tok = users.get(m.payload.access_token);
        if (!tok) { this.#push({ topic: m.topic, event: "phx_reply", payload: { status: "error", response: { reason: "bad token" } }, ref: m.ref }); return; }
        this.topic = m.topic; this.hh = householdOf(tok.id);
        watchers.add(this);
        queueMicrotask(() => this.#push({ topic: m.topic, event: "phx_reply", payload: { status: "ok", response: {} }, ref: m.ref }));
      }
    }
    notify(hh) { if (this.readyState === 1 && this.hh === hh) this.#push({ topic: this.topic, event: "postgres_changes", payload: { data: { type: "UPDATE" } } }); }
    #push(obj) { queueMicrotask(() => this.onmessage && this.onmessage({ data: JSON.stringify(obj) })); }
    close() { if (this.readyState === 3) return; this.readyState = 3; watchers.delete(this); queueMicrotask(() => this.onclose && this.onclose()); }
    drop() { this.close(); }
  }
  FakeWebSocket.instances = [];

  return {
    url, fetchImpl, FakeWebSocket, addUser, session, docs, blobs, locks, log, householdOf,
    setDown(v) { down = v; },
    expireAccessTokens() { users.clear(); },
    holdLock(uid, holder, ms = 8000) { locks.set(householdOf(uid), { holder, expires: now() + ms }); },
  };
}
