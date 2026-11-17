import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => ({ mode: "cloud", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: "u1", isOwner: true }), names: async () => ({}), saveFile: async () => false });
const fakeLS = () => { const m = { "motH.tour": "1" }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, length: 0, key: () => null }; };
const tile = (doc, fk) => doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === fk);

async function open({ signedIn = true, fail = null, noAuth = false } = {}) {
  const sent = [];
  const auth = noAuth ? undefined : { session: () => (signedIn ? { user: { id: "u1", email: "me@example.com" } } : null), googleUrl: () => "", async signInWithEmail() {}, async signOut() {} };
  const hh = { feedback: async (a) => { if (fail) throw new Error(fail); sent.push(a); }, info: async () => ({}) };
  const doc = makeDocument();
  doc.defaultView = { localStorage: fakeLS(), motAuth: auth, motHousehold: noAuth ? undefined : hh, location: { origin: "https://me.github.io", pathname: "/houseline/", reload() {}, assign() {} } };
  await mount(doc, { store: store(), state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  return { doc, sent };
}

test("no account feature (local-only app): no feedback tile", async () => {
  const { doc } = await open({ noAuth: true });
  assert.equal(tile(doc, "hub-feedback"), undefined);
});

test("signed out: feedback asks you to sign in first", async () => {
  const { doc } = await open({ signedIn: false });
  tile(doc, "hub-feedback").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  assert.ok(dlg.textContent.includes("sign in first"));
  assert.equal(dlg.querySelector("#fb-msg"), null);
});

test("signed in: an empty message is refused, then a message is sent with version and device and no email by default", async () => {
  const { doc, sent } = await open();
  tile(doc, "hub-feedback").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  dlg.querySelector("#fb-send").click(); await sleep(10);
  assert.ok(dlg.querySelector("#fb-status").textContent.includes("Write a message"));
  assert.equal(sent.length, 0);
  dlg.querySelector("#fb-kind").value = "idea";
  dlg.querySelector("#fb-msg").value = "  Add a dark mode toggle to the widget  ";
  dlg.querySelector("#fb-send").click(); await sleep(20);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].kind, "idea");
  assert.equal(sent[0].message, "Add a dark mode toggle to the widget");
  assert.equal(sent[0].contact, false);
  assert.match(sent[0].version, /^v\d+/);
  assert.ok(dlg.textContent.includes("Thank you"));
});

test("a failed send shows the reason and lets you try again", async () => {
  const { doc, sent } = await open({ fail: "You have sent a lot of feedback today. Please try again tomorrow." });
  tile(doc, "hub-feedback").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  dlg.querySelector("#fb-msg").value = "Hello";
  dlg.querySelector("#fb-send").click(); await sleep(20);
  assert.ok(dlg.querySelector("#fb-status").textContent.includes("try again tomorrow"));
  assert.equal(dlg.querySelector("#fb-send").disabled, false);
  assert.equal(sent.length, 0);
});
