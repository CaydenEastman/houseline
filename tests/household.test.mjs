import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";
import { createHousehold, photoIdsOf, exportEverything, clearLocalCache } from "../src/household.js";
import { exportJSON } from "../src/storage.js";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i], _m: m }; };

function api({ members = 1, role = "owner", failWith = null, listPages = [[{ name: "p1" }, { name: "p2" }], []] } = {}) {
  const calls = [];
  const pages = [...listPages];
  const fetchImpl = async (u, o) => {
    const path = u.replace("https://p.supabase.co", "");
    calls.push([o.method, path, o.body ? JSON.parse(o.body) : null, o.headers.authorization]);
    if (failWith && path.includes(failWith.on)) return { ok: false, status: 400, json: async () => ({ message: failWith.message }) };
    if (path.endsWith("/household_info")) return { ok: true, status: 200, json: async () => ({ household_id: "hh1", role, invite: null, members: Array.from({ length: members }, (_, i) => ({ user_id: "u" + i, email: `u${i}@x.com`, role: i === 0 ? "owner" : "member", me: i === 0 })) }) };
    if (path.includes("/storage/v1/object/list/")) return { ok: true, status: 200, json: async () => pages.shift() || [] };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  const h = createHousehold({ url: "https://p.supabase.co", anonKey: "anon", auth: { accessToken: async () => "tok" }, fetchImpl });
  return { h, calls };
}

test("every call is made as the signed-in user, and server error text reaches the person", async () => {
  const { h, calls } = api();
  await h.accept("abcd-2345");
  assert.deepEqual(calls[0].slice(0, 3), ["POST", "/rest/v1/rpc/accept_invite_v2", { invite_code: "abcd-2345" }]);
  assert.equal(calls[0][3], "Bearer tok");
  const bad = api({ failWith: { on: "accept_invite", message: "That code is not valid or has expired." } });
  await assert.rejects(() => bad.h.accept("x"), /not valid or has expired/);
  const signedOut = createHousehold({ url: "u", anonKey: "k", auth: { accessToken: async () => null }, fetchImpl: async () => { throw new Error("no network call expected"); } });
  await assert.rejects(() => signedOut.info(), /Sign in/);
});

test("delete account when alone: photo files are removed first (paged), then the account", async () => {
  const { h, calls } = api({ members: 1 });
  await h.deleteAccount();
  const order = calls.map(([m, p]) => `${m} ${p}`);
  assert.deepEqual(order, [
    "POST /rest/v1/rpc/household_info",
    "POST /storage/v1/object/list/photos",
    "DELETE /storage/v1/object/photos",
    "POST /storage/v1/object/list/photos",
    "POST /rest/v1/rpc/delete_my_account"]);
  assert.deepEqual(calls[2][2], { prefixes: ["hh1/p1", "hh1/p2"] });
});

test("delete account when others share the household: their photos are NOT touched", async () => {
  const { h, calls } = api({ members: 2 });
  await h.deleteAccount();
  assert.equal(calls.some(([, p]) => p.includes("/storage/")), false);
  assert.equal(calls.at(-1)[1], "/rest/v1/rpc/delete_my_account");
});

test("a failed photo cleanup stops the deletion (nothing is half-deleted by surprise)", async () => {
  const { h, calls } = api({ members: 1, failWith: { on: "/storage/", message: "boom" } });
  await assert.rejects(() => h.deleteAccount(), /boom/);
  assert.equal(calls.some(([, p]) => p.includes("delete_my_account")), false);
});

test("download-everything includes the backup plus every photo once; missing photos are skipped", async () => {
  const state = mkState({ tasks: [mkTask({ id: "a" })], items: [{ id: "i", name: "x", kind: "other", location: "", model: "", filterSize: "", purchaseDate: null, warrantyExpires: null, notes: "", photoIds: ["p1", "p2"] }], completions: [{ id: "c", taskId: "a", title: "t", category: "house", date: "2026-01-01", kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: ["p1", "p3"] }] });
  assert.deepEqual(photoIdsOf(state).sort(), ["p1", "p2", "p3"]);
  const text = await exportEverything(state, async (id) => (id === "p2" ? null : `data:image/jpeg;base64,${id}`), exportJSON);
  const o = JSON.parse(text);
  assert.deepEqual(Object.keys(o.photos).sort(), ["p1", "p3"]);
  assert.equal(o.tasks.length, state.tasks.length);
});

test("clearLocalCache forgets state, pending edits and cached photos; with everything:true wipes all app keys", () => {
  const ls = fakeLS({ "motH.v1": "s", "motH.dirty": "1", "motH.base": "b", "motH.owner": "me", "motH.photo.p1": "d", "motH.tour": "1", other: "keep" });
  clearLocalCache(ls, "motH.v1");
  assert.deepEqual(Object.keys(ls._m).sort(), ["motH.owner", "motH.tour", "other"]);
  clearLocalCache(ls, "motH.v1", { everything: true });
  assert.deepEqual(Object.keys(ls._m), ["other"]);
});

// ---------- the Settings screen ----------
const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => true });
async function open(motHousehold, extra = {}) {
  const reloads = [];
  const doc = makeDocument();
  const auth = { session: () => ({ user: { email: "me@x.com" } }), async signOut() { extra.signedOut = true; }, googleUrl: () => "", signInWithEmail: async () => {} };
  doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1", "motH.v1": "old" }), motAuth: auth, motHousehold, location: { origin: "https://x", pathname: "/", reload: () => reloads.push(1), assign() {} } };
  await mount(doc, { store: store(), state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(30);
  return { doc, reloads, dlg: doc.getElementById("settings-dialog") };
}
const fakeApi = (info, log = []) => ({ info: async () => info, invite: async () => { log.push("invite"); }, cancelInvite: async () => { log.push("cancel"); }, accept: async (c) => { log.push(["accept", c]); }, leave: async () => { log.push("leave"); }, remove: async (u) => { log.push(["remove", u]); }, makeOwner: async (u) => { log.push(["owner", u]); }, deleteAccount: async () => { log.push("delete"); } });
const clickConfirm = async (doc) => { const b = doc.getElementById("confirm-dialog").querySelectorAll("button").find((x) => x.textContent !== "Cancel"); b.click(); await sleep(30); };

test("alone: owner can invite and can join someone else's household; joining asks first, clears the old cache and reloads", async () => {
  const log = [];
  const { doc, dlg, reloads } = await open(fakeApi({ household_id: "h", role: "owner", invite: null, members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }] }, log));
  assert.ok(dlg.querySelector("#s-invite"));
  dlg.querySelector("#s-invite").click(); await sleep(30);
  assert.deepEqual(log, ["invite"]);
  dlg.querySelector("#s-join-code").value = "abcd2345";
  dlg.querySelector("#s-join").click(); await sleep(30);
  assert.equal(log.length, 1, "nothing joined until confirmed");
  await clickConfirm(doc);
  assert.deepEqual(log[1], ["accept", "abcd2345"]);
  assert.equal(doc.defaultView.localStorage.getItem("motH.v1"), null, "old cached data dropped so the shared data wins");
  await sleep(700);
  assert.equal(reloads.length, 1);
});

test("owner of a shared household sees the invite code, members, and Remove; no Leave/Join", async () => {
  const log = [];
  const info = { household_id: "h", role: "owner", invite: { code: "ABCD2345", expires_at: new Date(Date.now() + 3 * 86400000).toISOString() },
    members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }, { user_id: "u1", email: "mal@x.com", role: "member", me: false }] };
  const { doc, dlg } = await open(fakeApi(info, log));
  assert.equal(dlg.querySelector("#s-invite-code").textContent, "ABCD2345");
  assert.equal(dlg.querySelector("#s-leave"), null);
  assert.equal(dlg.querySelector("#s-join"), null);
  const remove = dlg.querySelectorAll("button").find((b) => b.textContent === "Remove");
  remove.click(); await sleep(30);
  assert.equal(log.length, 0, "removal needs confirmation");
  await clickConfirm(doc);
  assert.deepEqual(log, [["remove", "u1"]]);
});

test("a regular member can leave (after confirming) but cannot invite", async () => {
  const log = [];
  const info = { household_id: "h", role: "member", invite: null, members: [{ user_id: "u1", email: "o@x.com", role: "owner", me: false }, { user_id: "u0", email: "me@x.com", role: "member", me: true }] };
  const { doc, dlg } = await open(fakeApi(info, log));
  assert.equal(dlg.querySelector("#s-invite"), null);
  dlg.querySelector("#s-leave").click(); await sleep(30);
  await clickConfirm(doc);
  assert.deepEqual(log, ["leave"]);
});

test("delete account needs two confirmations, then signs out, wipes the phone and reloads", async () => {
  const log = []; const extra = {};
  const info = { household_id: "h", role: "owner", invite: null, members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }] };
  const { doc, dlg, reloads } = await open(fakeApi(info, log), extra);
  dlg.querySelector("#s-delete-account").click(); await sleep(30);
  await clickConfirm(doc);           // first confirmation
  assert.deepEqual(log, [], "still not deleted after the first confirmation");
  await clickConfirm(doc);           // second confirmation
  assert.deepEqual(log, ["delete"]);
  assert.equal(extra.signedOut, true);
  assert.equal(doc.defaultView.localStorage.getItem("motH.v1"), null);
  await sleep(900);
  assert.equal(reloads.length, 1);
});

test("declining either confirmation deletes nothing", async () => {
  const log = [];
  const info = { household_id: "h", role: "owner", invite: null, members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }] };
  const { doc, dlg } = await open(fakeApi(info, log));
  dlg.querySelector("#s-delete-account").click(); await sleep(30);
  doc.getElementById("confirm-dialog").querySelector("#confirm-cancel").click(); await sleep(30);
  assert.deepEqual(log, []);
});
