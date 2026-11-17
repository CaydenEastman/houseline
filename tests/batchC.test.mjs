import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";
import { createHousehold, joinImpact, householdError, formatCode } from "../src/household.js";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i], _m: m }; };

// ---------- the household API ----------
function api({ results = {}, members = 1, fail = {} } = {}) {
  const calls = [];
  const fetchImpl = async (u, o) => {
    const path = u.replace("https://p.supabase.co", "");
    calls.push(path);
    if (fail.on && path.includes(fail.on)) return { ok: false, status: 400, json: async () => ({ message: fail.message }) };
    if (path.endsWith("/household_info")) return { ok: true, status: 200, json: async () => ({ household_id: "hh1", role: "owner", invite: null, members: Array.from({ length: members }, (_, i) => ({ user_id: "u" + i, email: "x@x.com", role: "owner", me: i === 0 })) }) };
    if (path.includes("/storage/v1/object/list/")) return { ok: true, status: 200, json: async () => [] };
    if (path.endsWith("/accept_invite_v2")) return { ok: true, status: 200, json: async () => results.accept ?? { household_id: "hh9" } };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  return { h: createHousehold({ url: "https://p.supabase.co", anonKey: "a", auth: { accessToken: async () => "tok" }, fetchImpl }), calls };
}

test("joining calls the counted version, and a refused code becomes a clear message with a reason", async () => {
  const ok = api();
  assert.equal(await ok.h.accept("abcd 2345"), "hh9");
  assert.ok(ok.calls[0].endsWith("/accept_invite_v2"));
  for (const [code, msg] of [["used", "That code was already used. Ask for a new one."], ["expired", "That code has expired. Ask for a new one."], ["invalid", "That code does not match. Check it for typos, or ask for a new one."]]) {
    const bad = api({ results: { accept: { error: code, message: msg } } });
    await assert.rejects(() => bad.h.accept("x"), (e) => e.message === msg && e.code === code);
  }
});

test("deleting an account: if it fails after the photos were removed, the error says so", async () => {
  const a = api({ members: 1, fail: { on: "delete_my_account", message: "boom" } });
  await assert.rejects(() => a.h.deleteAccount(), (e) => e.photosRemoved === true);
  const shared = api({ members: 2, fail: { on: "delete_my_account", message: "boom" } });
  await assert.rejects(() => shared.h.deleteAccount(), (e) => e.photosRemoved === false);
});

test("what joining costs: a fresh account loses nothing; real data is counted in plain words", () => {
  const starters = mkState({ tasks: [mkTask({ id: "a" }), mkTask({ id: "b" })] });
  assert.equal(joinImpact(starters).untouched, true);
  const used = mkState({ tasks: [mkTask({ id: "a" })], vehicles: [{ id: "v1", name: "Van", odometer: 1, odometerLog: [] }],
    completions: [{ id: "c1", taskId: "a", title: "x", category: "house", date: "2026-11-01", kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: [] }] });
  const i = joinImpact(used);
  assert.equal(i.untouched, false);
  assert.match(i.summary, /1 task, 1 vehicle, 1 finished task in your history/);
});

test("error wording: offline, expired sign-in, and passing real messages through", () => {
  assert.match(householdError(new TypeError("Failed to fetch")), /offline/i);
  assert.match(householdError(new Error("Load failed")), /offline/i);
  assert.match(householdError(new Error("JWT expired")), /sign in again/i);
  assert.equal(householdError(new Error("That household is full.")), "That household is full.");
  assert.equal(householdError(null, "fallback"), "fallback");
});

test("the code box shows capitals and a space as someone types, and ignores junk", () => {
  assert.equal(formatCode("k7m2"), "K7M2");
  assert.equal(formatCode("k7m29qxr"), "K7M2 9QXR");
  assert.equal(formatCode(" k7m2 - 9qxr extra"), "K7M2 9QXR");
  assert.equal(formatCode(""), "");
});

// ---------- the screens ----------
const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => true });
const aloneInfo = { household_id: "h", role: "owner", invite: null, members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }] };
const completion = { id: "c1", taskId: "a", title: "A", category: "house", date: "2026-11-01", kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: [] };

async function start({ info = aloneInfo, state, ls, accept, push } = {}) {
  const log = []; const reloads = []; const extra = {};
  const doc = makeDocument();
  const auth = { session: () => ({ user: { id: "u0", email: "me@x.com" } }), async signOut() { extra.signedOut = true; log.push("signOut"); }, googleUrl: () => "", signInWithEmail: async () => {} };
  const api = { info: async () => info, accept: accept || (async (c) => { log.push(["accept", c]); }), snapshots: async () => [], invite: async () => {}, cancelInvite: async () => {}, leave: async () => {}, remove: async () => {}, makeOwner: async () => {}, deleteAccount: async () => {} };
  doc.defaultView = { localStorage: ls || fakeLS({ "motH.tour": "1", "motH.v1": "old" }), motAuth: auth, motHousehold: api, motPush: push, location: { origin: "https://x", pathname: "/", reload: () => reloads.push(1), assign() {} } };
  await mount(doc, { store: store(), state: state || mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  await sleep(450);
  return { doc, log, reloads, dlg: doc.getElementById("settings-dialog"), confirm: doc.getElementById("confirm-dialog") };
}
const clickBtn = async (root, text) => { const b = root.querySelectorAll("button").find((x) => x.textContent === text); assert.ok(b, `button "${text}"`); b.click(); await sleep(40); };
const goAccount = async (doc) => {
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(40);
};

test("first sign-in with nothing of your own: asks 'Were you given a code?' once; joining shows 'nothing is lost' and is not red", async () => {
  const { doc, dlg, log, confirm, reloads } = await start();
  assert.ok(dlg.textContent.includes("Were you given a code?"));
  const box = dlg.querySelector("#j-code");
  box.value = "k7m29qxr"; box.dispatchEvent({ type: "input", target: box });
  dlg.querySelector("form").dispatchEvent({ type: "submit", preventDefault() {} }); await sleep(40);
  assert.ok(confirm.textContent.includes("nothing important is lost"));
  assert.ok(!confirm.querySelector("button.danger-solid"), "no scary red button when there is nothing to lose");
  await clickBtn(confirm, "Join");
  assert.equal(log[0][0], "accept");
  assert.equal(doc.defaultView.localStorage.getItem("motH.v1"), null);
  await sleep(700);
  assert.equal(reloads.length, 1);
});

test("'No, start my own' closes the question and it is not asked again on the next visit", async () => {
  const ls = fakeLS({ "motH.tour": "1" });
  const first = await start({ ls });
  assert.ok(first.dlg.textContent.includes("Were you given a code?"));
  await clickBtn(first.dlg, "No, start my own");
  const second = await start({ ls });
  assert.ok(!second.dlg.textContent.includes("Were you given a code?"));
});

test("not asked when already in a shared household or when there is history", async () => {
  const shared = await start({ info: { ...aloneInfo, members: [...aloneInfo.members, { user_id: "u1", email: "m@x.com", role: "member", me: false }] } });
  assert.ok(!shared.dlg.textContent.includes("Were you given a code?"));
  const used = await start({ state: mkState({ tasks: [mkTask({ id: "a", title: "A" })], completions: [completion] }) });
  assert.ok(!used.dlg.textContent.includes("Were you given a code?"));
});

test("joining with data of your own: says how much will be replaced and the button is 'Join anyway'", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1", "motH.v1": "old" });
  const state = mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })], completions: [completion] });
  const { doc, dlg, confirm, log } = await start({ ls, state });
  await goAccount(doc);
  dlg.querySelector("#s-join-code").value = "K7M2 9QXR";
  dlg.querySelector("#s-join").click(); await sleep(40);
  assert.ok(confirm.textContent.includes("1 task, 1 finished task in your history"));
  assert.ok(confirm.querySelector("button.danger-solid"));
  assert.ok(confirm.querySelectorAll("button").some((b) => b.textContent === "Join anyway"));
  await clickBtn(confirm, "Cancel");
  assert.equal(log.length, 0, "nothing joined");
});

test("a refused code shows the reason, offline shows 'You're offline', and nothing is cleared", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1", "motH.v1": "old" });
  let n = 0;
  const accept = async () => { n++; throw n === 1 ? Object.assign(new Error("That code was already used. Ask for a new one."), { code: "used" }) : new TypeError("Failed to fetch"); };
  const { doc, dlg, confirm } = await start({ ls, accept });
  await goAccount(doc);
  const toasts = () => doc.getElementById("status").textContent;
  dlg.querySelector("#s-join-code").value = "K7M2 9QXR";
  dlg.querySelector("#s-join").click(); await sleep(40); await clickBtn(confirm, "Join");
  assert.ok(toasts().includes("already used"));
  dlg.querySelector("#s-join").click(); await sleep(40); await clickBtn(confirm, "Join");
  assert.ok(toasts().includes("offline"));
  assert.equal(ls.getItem("motH.v1"), "old");
});

test("the invite text gives one path, and the code box explains itself", async () => {
  const info = { ...aloneInfo, invite: { code: "ABCD2345", expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }, members: [...aloneInfo.members, { user_id: "u1", email: "m@x.com", role: "member", me: false }] };
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" });
  const { doc, dlg } = await start({ ls, info });
  await goAccount(doc);
  assert.ok(dlg.textContent.includes("the app asks for this code"));
  assert.ok(!dlg.textContent.includes("Settings, Account"));
  const alone = await start({ ls: fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" }) });
  await goAccount(alone.doc);
  assert.match(alone.dlg.querySelector("#s-join-code").getAttribute("placeholder"), /8-letter code/);
  assert.ok(alone.dlg.textContent.includes("works once and lasts 7 days"));
});

test("signing out turns reminders off for this phone first", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" });
  const push = { hour: () => 8, disable: async () => { push.log.push("push off"); }, refresh() {}, log: [] };
  const { doc, dlg, confirm, log } = await start({ ls, push });
  await goAccount(doc);
  dlg.querySelector("#s-signout").click(); await sleep(40);
  await clickBtn(confirm, "Sign out");
  assert.deepEqual(push.log, ["push off"]);
  assert.deepEqual(log, ["signOut"]);
});

// ---------- the database files ----------
test("schema.sql carries the join, crash-report and permission fixes, and the database checks are kept in the repo", () => {
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.ok(sql.includes("accept_invite_v2"), "counted join");
  assert.match(sql, /new\.at := now\(\)/, "crash reports cannot be back-dated");
  assert.match(sql, /revoke insert, update, delete, truncate, references, trigger on public\.households, public\.household_members from authenticated/);
  assert.ok(existsSync(new URL("../supabase/tests/join_and_limits.test.sql", import.meta.url)), "rolled-back database checks");
});
