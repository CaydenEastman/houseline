import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => ({ mode: "cloud", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: "u1", isOwner: true }), names: async () => ({}), saveFile: async () => false });
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; },
  get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i] ?? null, _m: m }; };

async function open(ls) {
  const calls = []; const reloads = [];
  const auth = { _s: { user: { id: "u1", email: "me@example.com" } }, session() { return this._s; }, googleUrl: () => "", async signInWithEmail() {}, async signOut() { calls.push("signout"); this._s = null; } };
  const doc = makeDocument();
  doc.defaultView = { localStorage: ls, motAuth: auth, location: { origin: "https://me.github.io", pathname: "/houseline/", reload: () => reloads.push(1), assign() {} } };
  await mount(doc, { store: store(), state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(5);
  doc.getElementById("settings-dialog").querySelector("#s-signout").click(); await sleep(10);
  return { doc, calls, reloads };
}
const press = async (doc, label) => { doc.getElementById("confirm-dialog").querySelectorAll("button").find((b) => b.textContent === label).click(); await sleep(20); };
const data = () => ({ "motH.v1": "{\"x\":1}", "motH.snaps": "[1]", "motH.log": "[1]", "motH.owner": "u1", "motH.photo.p1": "abc", "motH.welcomed": "1", "motH.tour": "1", "motH.look": "{\"theme\":\"dark\"}" });

test("signing out erases this phone's copy of the data but keeps the theme", async () => {
  const ls = fakeLS(data());
  const { doc, calls, reloads } = await open(ls);
  await press(doc, "Sign out");
  assert.deepEqual(calls, ["signout"]);
  for (const k of ["motH.v1", "motH.snaps", "motH.log", "motH.owner", "motH.photo.p1", "motH.welcomed"]) assert.equal(ls.getItem(k), null, k);
  assert.equal(ls.getItem("motH.look"), "{\"theme\":\"dark\"}");
  assert.equal(ls.getItem("motH.tour"), "1");
  assert.equal(reloads.length, 1);
});

test("unsynced changes: a second warning appears, and declining keeps everything signed in", async () => {
  const ls = fakeLS({ ...data(), "motH.dirty": "1" });
  const { doc, calls, reloads } = await open(ls);
  await press(doc, "Sign out");
  const warn = doc.getElementById("confirm-dialog");
  assert.ok(warn.textContent.includes("haven't synced"));
  assert.deepEqual(calls, []);
  await press(doc, "Cancel");
  assert.deepEqual(calls, []);
  assert.equal(ls.getItem("motH.v1"), "{\"x\":1}");
  assert.equal(reloads.length, 0);
});

test("unsynced changes: confirming signs out and erases", async () => {
  const ls = fakeLS({ ...data(), "motH.dirty": "1" });
  const { doc, calls } = await open(ls);
  await press(doc, "Sign out");
  await press(doc, "Sign out and erase");
  assert.deepEqual(calls, ["signout"]);
  assert.equal(ls.getItem("motH.v1"), null);
});
