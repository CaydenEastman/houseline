import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { freshState } from "../src/storage.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false });
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; };
const auth = (session = null) => ({ session: () => session, googleUrl: () => "https://x/auth", async signInWithEmail() {}, async signOut() {} });
async function open({ a, st, ls }) {
  const doc = makeDocument();
  doc.defaultView = { localStorage: ls || fakeLS({ "motH.tour": "1" }), motAuth: a, location: { origin: "https://x", pathname: "/", reload() {}, assign() {} } };
  await mount(doc, { store: store(), state: st });
  return doc;
}

test("first launch, cloud configured, signed out: sign-in comes first, with a way to continue without an account", async () => {
  const doc = await open({ a: auth(), st: freshState() });
  const w = doc.getElementById("wizard");
  assert.equal(w.hidden, false);
  assert.match(w.textContent, /Welcome to Houseline/);
  assert.match(w.textContent, /Email me a sign-in link/);
  const skip = w.querySelectorAll("button").find((b) => /without an account/i.test(b.textContent));
  assert.ok(skip);
  skip.click(); await sleep(10);
  assert.doesNotMatch(doc.getElementById("wizard").textContent, /Welcome to Houseline/);
  assert.match(doc.getElementById("wizard").textContent, /household|vehicle|setup/i);
});
test("signed in on first launch: no welcome screen (the account's data or the setup wizard shows)", async () => {
  const doc = await open({ a: auth({ user: { id: "u1", email: "a@b.co" } }), st: freshState() });
  assert.doesNotMatch(doc.getElementById("wizard").textContent, /Welcome to Houseline/);
});
test("no cloud project, or an existing set-up app: no welcome screen", async () => {
  let doc = await open({ a: undefined, st: freshState() });
  assert.doesNotMatch(doc.getElementById("wizard").textContent, /Welcome to Houseline/);
  doc = await open({ a: auth(), st: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  assert.equal(doc.getElementById("app").hidden, false);
});
test("choosing 'without an account' is remembered", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.welcomed": "1" });
  const doc = await open({ a: auth(), st: freshState(), ls });
  assert.doesNotMatch(doc.getElementById("wizard").textContent, /Welcome to Houseline/);
});

test("view-only member: banner shows and no change is saved", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.viewOnly": "1" });
  const saved = [];
  const st = { ...store(), save: async (s) => { saved.push(s); return true; } };
  const doc = makeDocument();
  doc.defaultView = { localStorage: ls, motAuth: auth({ user: { id: "u1", email: "v@b.co" } }), motHousehold: { info: async () => ({ can_edit: false, role: "member", members: [], invite: null, household_id: "h" }) }, location: { origin: "https://x", pathname: "/", reload() {}, assign() {} } };
  const state = mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] });
  await mount(doc, { store: st, state });
  await sleep(20);
  assert.match(doc.getElementById("today-strip").textContent, /View only/);
  const done = doc.getElementById("main").querySelectorAll("button").find((b) => /^Done$/i.test((b.textContent || "").trim()));
  if (done) { done.click(); await sleep(10); }
  assert.equal(saved.length, 0);
});
test("an editor who was view-only before is switched back when the server says so", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.viewOnly": "1" });
  const doc = makeDocument();
  doc.defaultView = { localStorage: ls, motAuth: auth({ user: { id: "u1", email: "v@b.co" } }), motHousehold: { info: async () => ({ can_edit: true, role: "member", members: [], invite: null, household_id: "h" }) }, location: { origin: "https://x", pathname: "/", reload() {}, assign() {} } };
  await mount(doc, { store: store(), state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  await sleep(20);
  assert.doesNotMatch(doc.getElementById("today-strip").textContent, /View only/);
  assert.equal(ls.getItem("motH.viewOnly"), "0");
});
