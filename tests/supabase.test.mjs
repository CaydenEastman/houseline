import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../src/sync.js";
import { createAuth } from "../src/auth.js";
import { createSupabaseBackend } from "../src/supabase.js";
import * as storage from "../src/storage.js";
import { fakeSupabase } from "./fakesupa.mjs";
import { memStorage, mkState, mkTask, v1Fixture } from "./helpers.mjs";

const KEY = "motH.auth";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One "phone": its own localStorage, signed in as `user`, talking to the shared fake server. */
function phone(srv, user, { pollMs = 15, now, realtime = false, fetchImpl } = {}) {
  const ls = memStorage();
  ls.setItem(KEY, JSON.stringify({ access_token: user.access_token, refresh_token: user.refresh_token, expires_at: user.expires_at, user: user.user }));
  const auth = createAuth({ url: srv.url, anonKey: "anon", storage: ls, fetchImpl: srv.fetchImpl, now });
  const backend = createSupabaseBackend({ url: srv.url, anonKey: "anon", auth, fetchImpl: fetchImpl || srv.fetchImpl, pollMs, isVisible: () => true, realtime, WebSocketImpl: srv.FakeWebSocket, realtimeBackoffMs: 20 });
  return { ls, auth, backend, open: (o = {}) => createStore({ localStorage: ls, claude: backend, debounceMs: 5, coalesceMs: 5, lockRetryMs: 5, ...o }) };
}
const withTasks = (...titles) => mkState({ tasks: titles.map((t, i) => mkTask({ id: `t-${t}`, title: t })) });

test("auth: sign-in redirect is consumed, signed-out backend stays local", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const ls = memStorage();
  const auth = createAuth({ url: srv.url, anonKey: "anon", storage: ls, fetchImpl: srv.fetchImpl });
  const backend = createSupabaseBackend({ url: srv.url, anonKey: "anon", auth, fetchImpl: srv.fetchImpl });
  assert.equal(await backend.use("db"), null, "signed out => no cloud, store runs locally");
  const s = await auth.consumeRedirect(`#access_token=${u.access_token}&refresh_token=${u.refresh_token}&expires_in=3600&token_type=bearer`);
  assert.equal(s.user.id, u.id);
  assert.ok(await backend.use("db"));
  assert.equal(await auth.consumeRedirect("#something=else"), null);
  await auth.signOut();
  assert.equal(await backend.use("db"), null);
});

test("auth: expired access token refreshes silently; a rejected refresh token signs the user out", async () => {
  let t = 1_000_000_000_000;
  const srv = fakeSupabase({ now: () => t });
  const u = srv.addUser("a@x.com");
  const p = phone(srv, u, { now: () => t });
  assert.equal(await p.auth.accessToken(), u.access_token);
  t += 3 * 3600 * 1000; // three hours later
  const fresh = await p.auth.accessToken();
  assert.notEqual(fresh, u.access_token);
  assert.equal(p.auth.userId(), u.id);
  // refresh token is single-use on the server; replaying the old one is rejected and ends the session
  p.ls.setItem(KEY, JSON.stringify({ access_token: "x", refresh_token: u.refresh_token, expires_at: 1, user: u.user }));
  await assert.rejects(() => p.auth.accessToken());
  assert.equal(p.auth.isSignedIn(), false);
});

test("a 401 mid-session refreshes the token and retries the request", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const p = phone(srv, u);
  const store = await p.open();
  await store.load();
  srv.expireAccessTokens(); // server forgets the access token; the refresh token still works
  await store.save(withTasks("A")); await store.flush();
  assert.ok([...srv.docs.keys()].some((k) => k.endsWith("household/main")), "write succeeded after refresh");
});

test("first load adopts this phone's data and publishes it; a second phone sees it", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const local = withTasks("Furnace filter", "Gutters");
  a.ls.setItem(storage.STORAGE_KEY, JSON.stringify(local));
  const sa = await a.open();
  assert.equal(sa.mode, "cloud");
  const got = await sa.load();
  assert.deepEqual(got.tasks.map((t) => t.title).sort(), ["Furnace filter", "Gutters"]);
  assert.ok([...srv.docs.keys()].some((k) => k.endsWith("|household/main")));
  const b = phone(srv, u); // brand-new phone, empty local storage
  const sb = await b.open();
  const seen = await sb.load();
  assert.deepEqual(seen.tasks.map((t) => t.title).sort(), ["Furnace filter", "Gutters"]);
});

test("two phones edit different things at the same time and both edits survive (3-way merge)", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u), b = phone(srv, u);
  a.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Shared")));
  const sa = await a.open(), sb = await b.open();
  const base = await sa.load();
  await sb.load();
  await Promise.all([
    sa.save({ ...base, tasks: [...base.tasks, mkTask({ id: "t-from-a", title: "Added on A" })] }),
    sb.save({ ...base, tasks: [...base.tasks, mkTask({ id: "t-from-b", title: "Added on B" })] }),
  ]);
  await Promise.all([sa.flush(), sb.flush()]);
  const c = phone(srv, u);
  const sc = await c.open();
  const final = await sc.load();
  assert.deepEqual(final.tasks.map((t) => t.id).sort(), ["t-Shared", "t-from-a", "t-from-b"]);
});

test("household isolation: another account cannot read or write this household's data", async () => {
  const srv = fakeSupabase();
  const u1 = srv.addUser("a@x.com"), u2 = srv.addUser("b@x.com");
  const a = phone(srv, u1);
  a.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Private")));
  await (await a.open()).load();
  const b = phone(srv, u2);
  const seen = await (await b.open()).load();
  assert.equal(seen.tasks.length, 0, "user 2 starts empty and does not see user 1's tasks");
  // and a forged write aimed at user 1's household is refused
  const res = await srv.fetchImpl(`${srv.url}/rest/v1/docs?on_conflict=household_id,path`, { method: "POST", headers: { apikey: "anon", Prefer: "resolution=merge-duplicates", Authorization: `Bearer ${u2.access_token}` }, body: JSON.stringify({ household_id: srv.householdOf(u1.id), path: "household/main", data: {}, updated_at: 1 }) });
  assert.equal(res.status, 403);
  const res2 = await srv.fetchImpl(`${srv.url}/storage/v1/object/authenticated/photos/${srv.householdOf(u1.id)}/x`, { headers: { apikey: "anon", Authorization: `Bearer ${u2.access_token}` } });
  assert.equal(res2.status, 403);
});

test("photos live in storage, not in the database, and round-trip", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const s = await a.open(); await s.load();
  const png = "data:image/png;base64,iVBORw0KGgo=";
  await s.putPhoto("p1", png);
  assert.equal(await s.getPhoto("p1"), png);
  assert.equal(srv.blobs.size, 1);
  assert.ok(![...srv.docs.keys()].some((k) => k.includes("photos/")), "no photo bytes in the docs table");
  await assert.rejects(() => s.putPhoto("p2", "data:text/html;base64,PGI+"), /image/i);
  await assert.rejects(() => s.putPhoto("p3", "data:image/svg+xml;base64,PHN2Zz4="), /JPEG, PNG or WebP/);
  await s.deletePhoto("p1");
  assert.equal(await s.getPhoto("p1"), null);
});

test("offline: edits stay on the phone, then upload automatically when the network returns", async () => {
  const handlers = {};
  const saved = globalThis.addEventListener;
  globalThis.addEventListener = (ev, fn) => { handlers[ev] = fn; };
  try {
    const srv = fakeSupabase();
    const u = srv.addUser("a@x.com");
    const a = phone(srv, u);
    const s = await a.open();
    const base = await s.load();
    srv.setDown(true);
    const kinds = []; s.onStatus((x) => kinds.push(x.kind));
    await s.save({ ...base, tasks: [mkTask({ id: "t-offline", title: "Made offline" })] });
    assert.ok(kinds.includes("offline"));
    assert.equal(storage.loadState(a.ls).tasks[0].id, "t-offline", "kept on the device");
    assert.equal([...srv.docs.values()].some((d) => JSON.stringify(d).includes("Made offline")), false);
    srv.setDown(false);
    handlers.online(); // the browser tells us the network is back
    for (let i = 0; i < 60 && ![...srv.docs.values()].some((d) => JSON.stringify(d).includes("Made offline")); i++) await sleep(20);
    assert.ok([...srv.docs.values()].some((d) => JSON.stringify(d).includes("Made offline")), "uploaded after reconnect");
    assert.equal(kinds.at(-1), "saved");
  } finally { globalThis.addEventListener = saved; }
});

test("schema versioning: data from a newer app is never overwritten or half-read", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  srv.docs.set(`${srv.householdOf(u.id)}|household/main`, { data: { ...mkState(), version: 3, futureField: true, updatedAt: 1 }, updated_at: 1 });
  const s = await a.open();
  const st = await s.load();
  assert.equal(s.mode, "local");
  assert.match(s.warning, /newer version of the app/);
  assert.equal(st.version, 2);
  await s.save({ ...st, tasks: [mkTask({ id: "x", title: "local only" })] }); await s.flush();
  const stored = srv.docs.get(`${srv.householdOf(u.id)}|household/main`).data;
  assert.equal(stored.version, 3, "cloud copy untouched");
  assert.equal(stored.futureField, true);
});

test("v1 data in the cloud is migrated on read", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  srv.docs.set(`${srv.householdOf(u.id)}|household/main`, { data: { ...v1Fixture(), updatedAt: 1 }, updated_at: 1 });
  const st = await (await a.open()).load();
  assert.equal(st.version, 2);
  assert.ok(st.tasks.some((t) => t.id === "seed-1"));
  assert.equal(a.backend && (await a.open()).mode, "cloud");
});

test("lock: a second writer cannot take a held lock until it is released", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const db = await a.backend.use("db");
  assert.deepEqual(await db.doc("household/lock").acquire({ holder: "A", ttlMs: 8000 }), { acquired: true });
  assert.deepEqual(await db.doc("household/lock").acquire({ holder: "B", ttlMs: 8000 }), { acquired: false });
  assert.deepEqual(await db.doc("household/lock").acquire({ holder: "A", ttlMs: 8000 }), { acquired: true }, "holder can re-take it");
  await db.doc("household/lock").release({ holder: "A" });
  assert.deepEqual(await db.doc("household/lock").acquire({ holder: "B", ttlMs: 8000 }), { acquired: true });
});

test("live updates: a change from another phone reaches this one without a reload", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u), b = phone(srv, u);
  const sa = await a.open(), sb = await b.open();
  const base = await sa.load(); await sb.load();
  const got = [];
  const stop = sb.subscribe((st) => got.push(st));
  await sleep(40);
  await sa.save({ ...base, tasks: [mkTask({ id: "live", title: "Live one" })] }); await sa.flush();
  for (let i = 0; i < 60 && !got.length; i++) await sleep(20);
  stop();
  assert.ok(got.some((s) => s.tasks.some((t) => t.id === "live")), "subscriber was handed the new state");
});

test("a failing server never crashes the app: load falls back to the phone's own data", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  a.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Mine")));
  srv.setDown(true);
  const s = await a.open();
  const st = await s.load();
  assert.equal(st.tasks[0].title, "Mine");
  assert.equal(s.mode, "local");
});

test("many history chunks are read in pages, none are dropped", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const hh = srv.householdOf(u.id);
  for (let i = 0; i < 1203; i++) srv.docs.set(`${hh}|history/h${String(i).padStart(4, "0")}`, { data: { completions: [] }, updated_at: i });
  const db = await a.backend.use("db");
  const snap = await db.collection("history").get();
  assert.equal(snap.docs.length, 1203);
});

test("first sign-in: parallel requests share one household lookup", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const db = await a.backend.use("db");
  await Promise.all([db.doc("household/main").get(), db.doc("a/b").get(), db.collection("history").get(), db.doc("household/main").get()]);
  assert.equal(srv.log.filter((l) => l.endsWith("rpc/ensure_household")).length, 1);
});

const hasText = (srv, text) => [...srv.docs.values()].some((d) => JSON.stringify(d).includes(text));
async function until(fn, tries = 80) { for (let i = 0; i < tries && !(await fn()); i++) await sleep(20); return fn(); }

test("offline COLD START: edits made while the cloud is unreachable are merged, not overwritten, when it returns", async () => {
  const online = []; const saved = globalThis.addEventListener; // every open store listens; the browser tells all of them
  globalThis.addEventListener = (ev, fn) => { if (ev === "online") online.push(fn); };
  try {
    const srv = fakeSupabase();
    const u = srv.addUser("a@x.com");
    const first = phone(srv, u);
    first.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Synced")));
    await (await first.open()).load();                         // cloud and this phone now agree
    srv.setDown(true);                                          // phone starts with no signal
    const s = await first.open();
    const st = await s.load();
    assert.equal(s.mode, "local");
    await s.save({ ...st, tasks: [...st.tasks, mkTask({ id: "t-offline", title: "Typed in the basement" })] }); await s.flush();
    // meanwhile another phone adds its own task
    const other = phone(srv, u); srv.setDown(false);
    const so = await other.open(); const ost = await so.load();
    await so.save({ ...ost, tasks: [...ost.tasks, mkTask({ id: "t-other", title: "From the other phone" })] }); await so.flush();
    online.forEach((fn) => fn());                               // signal returns
    assert.ok(await until(() => hasText(srv, "Typed in the basement")), "offline edit reached the cloud");
    assert.ok(hasText(srv, "From the other phone"), "other phone's edit still there");
    const check = await (await phone(srv, u).open()).load();
    assert.deepEqual(check.tasks.map((t) => t.id).sort(), ["t-Synced", "t-offline", "t-other"]);
  } finally { globalThis.addEventListener = saved; }
});

test("restart while edits are unsynced: the next launch merges them instead of overwriting from the cloud", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  a.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Base")));
  const s1 = await a.open(); const st = await s1.load();
  srv.setDown(true);
  await s1.save({ ...st, tasks: [...st.tasks, mkTask({ id: "t-unsent", title: "Unsent edit" })] }); await s1.flush();
  srv.setDown(false);                                           // app is closed and reopened; no 'online' event needed
  const s2 = await a.open();
  const st2 = await s2.load();
  assert.ok(st2.tasks.some((t) => t.id === "t-unsent"), "edit survived the restart");
  assert.ok(await until(() => hasText(srv, "Unsent edit")), "and was uploaded");
});

test("live poll does not overwrite unsent local edits with another phone's change", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u, { pollMs: 15 }), b = phone(srv, u);
  const sa = await a.open(), sb = await b.open();
  const base = await sa.load(); await sb.load();
  const seen = []; const stopSub = sa.subscribe((x) => seen.push(x));
  srv.setDown(true);
  await sa.save({ ...base, tasks: [mkTask({ id: "t-mine", title: "Mine, unsent" })] }); await sa.flush();
  srv.setDown(false);
  await sb.save({ ...base, tasks: [mkTask({ id: "t-theirs", title: "Theirs" })] }); await sb.flush();
  assert.ok(await until(() => hasText(srv, "Mine, unsent"), 150), "my edit reached the cloud");
  assert.ok(hasText(srv, "Theirs"));
  const final = await (await phone(srv, u).open()).load();
  assert.deepEqual(final.tasks.map((t) => t.id).sort(), ["t-mine", "t-theirs"]);
  stopSub();
});

test("another account on the same phone never inherits the previous account's cached data", async () => {
  const srv = fakeSupabase();
  const a = srv.addUser("a@x.com"), b = srv.addUser("b@x.com");
  const p = phone(srv, a);
  p.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Alice private")));
  await (await p.open()).load();
  // sign out Alice, sign in Bob on the same browser storage
  p.ls.setItem(KEY, JSON.stringify({ access_token: b.access_token, refresh_token: b.refresh_token, expires_at: b.expires_at, user: b.user }));
  const auth = createAuth({ url: srv.url, anonKey: "anon", storage: p.ls, fetchImpl: srv.fetchImpl });
  const backend = createSupabaseBackend({ url: srv.url, anonKey: "anon", auth, fetchImpl: srv.fetchImpl, pollMs: 15, isVisible: () => true });
  const st = await (await createStore({ localStorage: p.ls, claude: backend, debounceMs: 5 })).load();
  assert.equal(st.tasks.length, 0);
  assert.equal(hasText(srv, "Alice private") && [...srv.docs.keys()].some((k) => k.startsWith(`${srv.householdOf(b.id)}|`) && JSON.stringify(srv.docs.get(k)).includes("Alice private")), false);
});

test("local data from before first sign-in is merged into an existing account, not discarded", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const old = phone(srv, u);
  old.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Already in cloud")));
  await (await old.open()).load();
  const fresh = phone(srv, u);                                    // a phone that was used signed-out first
  fresh.ls.setItem(storage.STORAGE_KEY, JSON.stringify(withTasks("Made before sign-in")));
  const st = await (await fresh.open({ mergeUnownedLocal: true })).load();
  assert.deepEqual(st.tasks.map((t) => t.title).sort(), ["Already in cloud", "Made before sign-in"]);
  assert.ok(await until(() => hasText(srv, "Made before sign-in")));
});

test("two tabs refreshing at once do not sign each other out", async () => {
  let t = 1_000_000_000_000;
  const srv = fakeSupabase({ now: () => t });
  const u = srv.addUser("a@x.com");
  const ls = memStorage();
  ls.setItem(KEY, JSON.stringify({ access_token: u.access_token, refresh_token: u.refresh_token, expires_at: u.expires_at, user: u.user }));
  const tab1 = createAuth({ url: srv.url, anonKey: "anon", storage: ls, fetchImpl: srv.fetchImpl, now: () => t });
  const tab2 = createAuth({ url: srv.url, anonKey: "anon", storage: ls, fetchImpl: srv.fetchImpl, now: () => t });
  t += 3 * 3600 * 1000;
  const [r1, r2] = await Promise.allSettled([tab1.accessToken(), tab2.accessToken()]);
  assert.ok(tab1.isSignedIn(), "still signed in after the race");
  assert.ok([r1, r2].some((r) => r.status === "fulfilled"));
});

test("a refused write (403) is not retried forever", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u);
  const s = await a.open(); const base = await s.load();
  const real = srv.fetchImpl;
  let attempts = 0;
  const backend = createSupabaseBackend({ url: srv.url, anonKey: "anon", auth: a.auth, pollMs: 10_000, isVisible: () => true, fetchImpl: async (u2, init) => { if (String(u2).includes("/rest/v1/docs") && init && init.method === "POST") { attempts++; return new Response(JSON.stringify({ message: "denied" }), { status: 403 }); } return real(u2, init); } });
  const s2 = await createStore({ localStorage: a.ls, claude: backend, debounceMs: 5 });
  await s2.load();
  await s2.save({ ...base, tasks: [mkTask({ id: "z", title: "z" })] }); await s2.flush();
  const after = attempts;
  await sleep(100);
  assert.equal(attempts, after, "no automatic retry scheduled after a 403");
});

test("conditional write: a stale save is refused by the server instead of overwriting a newer one", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u), b = phone(srv, u);
  const da = await a.backend.use("db"), dbb = await b.backend.use("db");
  await da.doc("household/main").set({ ...mkState(), updatedAt: 10 });         // first save creates the document
  await da.doc("household/main").get();                                          // A reads version 10
  await dbb.doc("household/main").get();
  await dbb.doc("household/main").set({ ...mkState(), tasks: [mkTask({ id: "b" })], updatedAt: 20 }); // B saves version 20
  await assert.rejects(() => da.doc("household/main").set({ ...mkState(), tasks: [mkTask({ id: "a" })], updatedAt: 30 }), (e) => e.conflict === true);
  assert.equal(srv.docs.get(`${srv.householdOf(u.id)}|household/main`).data.tasks[0].id, "b", "B's save was not overwritten");
  // a document two phones create at the same instant: the second creator is refused
  const srv2 = fakeSupabase(); const u2 = srv2.addUser("c@x.com");
  const p1 = phone(srv2, u2), p2 = phone(srv2, u2);
  const d1 = await p1.backend.use("db"), d2 = await p2.backend.use("db");
  await d1.doc("household/main").get(); await d2.doc("household/main").get();   // both see "nothing yet"
  await d1.doc("household/main").set({ ...mkState(), updatedAt: 1 });
  await assert.rejects(() => d2.doc("household/main").set({ ...mkState(), updatedAt: 2 }), (e) => e.conflict === true);
});

test("a save that loses the race re-reads, re-merges and still keeps both phones' edits", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const b = phone(srv, u);
  const sb = await b.open(); const base = await sb.load();
  let injected = false;
  const sneaky = async (url, init = {}) => { // right before A's conditional write lands, B sneaks a save in
    if (!injected && init.method === "PATCH") {
      injected = true;
      await sb.save({ ...base, tasks: [...base.tasks, mkTask({ id: "t-b", title: "B got there first" })] }); await sb.flush();
    }
    return srv.fetchImpl(url, init);
  };
  const a = phone(srv, u, { fetchImpl: sneaky });
  const sa = await a.open(); const st = await sa.load();
  await sa.save({ ...st, tasks: [...st.tasks, mkTask({ id: "t-a", title: "A's edit" })] }); await sa.flush();
  assert.ok(injected, "the race really happened");
  const final = await (await phone(srv, u).open()).load();
  assert.deepEqual(final.tasks.map((t) => t.id).sort(), ["t-a", "t-b"]);
});

test("instant updates: a change arrives over the live connection without waiting for a poll", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u, { realtime: true, pollMs: 60_000 }), b = phone(srv, u);
  const sa = await a.open(), sb = await b.open();
  const base = await sa.load(); await sb.load();
  const got = []; const stop = sa.subscribe((x) => got.push(x));
  assert.ok(await until(() => srv.FakeWebSocket.instances.length > 0), "socket opened");
  await sleep(30);
  await sb.save({ ...base, tasks: [mkTask({ id: "now", title: "Instant" })] }); await sb.flush();
  assert.ok(await until(() => got.some((s) => s.tasks.some((t) => t.id === "now")), 40), "delivered within ~0.8 s, long before the 60 s poll");
  stop();
});

test("instant updates: after the connection drops it reconnects and catches up on what it missed", async () => {
  const srv = fakeSupabase();
  const u = srv.addUser("a@x.com");
  const a = phone(srv, u, { realtime: true, pollMs: 60_000 }), b = phone(srv, u);
  const sa = await a.open(), sb = await b.open();
  const base = await sa.load(); await sb.load();
  const got = []; const stop = sa.subscribe((x) => got.push(x));
  assert.ok(await until(() => srv.FakeWebSocket.instances.length > 0)); await sleep(30);
  const before = srv.FakeWebSocket.instances.length;
  srv.FakeWebSocket.instances[0].drop();                                       // connection lost
  await sb.save({ ...base, tasks: [mkTask({ id: "missed", title: "Missed while disconnected" })] }); await sb.flush();
  assert.ok(await until(() => srv.FakeWebSocket.instances.length > before, 60), "reconnected");
  assert.ok(await until(() => got.some((s) => s.tasks.some((t) => t.id === "missed")), 60), "caught up after rejoining");
  stop();
});
