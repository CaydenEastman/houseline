import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false });
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; };
const state = () => mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] });

function fakeAuth({ session = null } = {}) {
  const calls = [];
  const a = { calls, _s: session, session() { return this._s; }, googleUrl: (r) => `https://p.supabase.co/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(r)}`,
    async signInWithEmail(email, redirect) { calls.push(["email", email, redirect]); }, async signOut() { calls.push(["signout"]); this._s = null; } };
  return a;
}
async function open(auth) {
  const reloads = []; const assigns = [];
  const doc = makeDocument();
  doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }), motAuth: auth, location: { origin: "https://me.github.io", pathname: "/man-of-the-house/", reload: () => reloads.push(1), assign: (u) => assigns.push(u) } };
  await mount(doc, { store: store(), state: state() });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  return { doc, reloads, assigns };
}
const tile = (doc, fk) => doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === fk);

test("no cloud project configured: no Account tile and no Account section (app stays local, no dead buttons)", async () => {
  const { doc } = await open(undefined);
  assert.equal(tile(doc, "hub-account"), undefined);
  tile(doc, "hub-settings").click(); await sleep(5);
  assert.equal(doc.getElementById("settings-dialog").textContent.includes("Email me a sign-in link"), false);
});

test("signed out: Account tile invites sign-in; Settings shows email + Google; bad email is rejected before any request", async () => {
  const auth = fakeAuth();
  const { doc, assigns } = await open(auth);
  const t = tile(doc, "hub-account");
  assert.ok(t.textContent.includes("Sign in"));
  t.click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  const input = dlg.querySelector("#s-email");
  input.value = "not-an-email";
  dlg.querySelector("#s-email-go").click(); await sleep(5);
  assert.equal(auth.calls.length, 0);
  assert.ok(dlg.querySelector("#s-signin-note").textContent.includes("valid email"));
  input.value = "  me@example.com ";
  dlg.querySelector("#s-email-go").click(); await sleep(10);
  assert.deepEqual(auth.calls[0], ["email", "me@example.com", "https://me.github.io/man-of-the-house/"]);
  assert.ok(dlg.querySelector("#s-signin-note").textContent.includes("Check me@example.com"));
  dlg.querySelector("#s-google").click();
  assert.match(assigns[0], /provider=google/);
  assert.ok(assigns[0].includes(encodeURIComponent("https://me.github.io/man-of-the-house/")), "returns to the app's own address");
});

test("a failed email send tells the person plainly and lets them retry", async () => {
  const auth = fakeAuth(); auth.signInWithEmail = async () => { throw new Error("Email rate limit exceeded"); };
  const { doc } = await open(auth);
  tile(doc, "hub-account").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  dlg.querySelector("#s-email").value = "me@example.com";
  dlg.querySelector("#s-email-go").click(); await sleep(10);
  assert.ok(dlg.querySelector("#s-signin-note").textContent.includes("Couldn't send the link: Email rate limit exceeded"));
  assert.equal(dlg.querySelector("#s-email-go").disabled, false);
});

test("signed in: shows the email, and Sign out asks first, then signs out and reloads", async () => {
  const auth = fakeAuth({ session: { user: { id: "u1", email: "me@example.com" } } });
  const { doc, reloads } = await open(auth);
  assert.ok(tile(doc, "hub-account").textContent.includes("me@example.com"));
  tile(doc, "hub-account").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  assert.ok(dlg.textContent.includes("Signed in as me@example.com"));
  assert.equal(dlg.querySelector("#s-email"), null);
  dlg.querySelector("#s-signout").click(); await sleep(10);
  const confirm = doc.getElementById("confirm-dialog");
  assert.ok(confirm.textContent.includes("Sign out?"));
  assert.equal(auth.calls.length, 0, "nothing happens until confirmed");
  const btn = confirm.querySelectorAll("button").find((b) => b.textContent === "Sign out");
  btn.click(); await sleep(20);
  assert.deepEqual(auth.calls, [["signout"]]);
  assert.equal(reloads.length, 1);
});

test("signed in with push available: Settings offers a morning time and turns server reminders on and off", async () => {
  const auth = fakeAuth({ session: { user: { email: "me@example.com" } } });
  const calls = [];
  const motPush = { _h: null, hour() { return this._h; }, quietDays() { return this._q || []; }, async enable(h, q) { calls.push(["on", h]); this._h = h; if (q) this._q = q; }, async disable() { calls.push(["off"]); this._h = null; } };
  const reloads = [];
  const doc = makeDocument();
  doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }), motAuth: auth, motPush, location: { origin: "https://me.github.io", pathname: "/x/", reload: () => reloads.push(1), assign() {} } };
  globalThis.Notification = { permission: "granted", requestPermission: async () => "granted" };
  Object.defineProperty(globalThis, "navigator", { value: { serviceWorker: {} }, configurable: true });
  const hadWindow = "window" in globalThis; const prevWindow = globalThis.window;
  globalThis.window = { Notification: globalThis.Notification, matchMedia: () => ({ matches: false }) };
  await mount(doc, { store: store(), state: state() });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  tile(doc, "hub-settings").click(); await sleep(5);
  const dlg = doc.getElementById("settings-dialog");
  assert.ok(dlg.querySelector("#s-remind-hour"), "time picker shown");
  dlg.querySelector("#s-remind").click(); await sleep(20);
  assert.deepEqual(calls, [["on", 8]], "defaults to 8 AM");
  assert.ok(dlg.querySelector("#s-remind").textContent.includes("Turn off"));
  dlg.querySelector("#s-remind").click(); await sleep(20);
  assert.deepEqual(calls[1], ["off"]);
  delete globalThis.Notification;
  if (hadWindow) globalThis.window = prevWindow; else delete globalThis.window;
});

test("Account and Settings are different screens: sign-in lives only in Account, backup and import only in Settings", async () => {
  const { doc } = await open(fakeAuth());
  tile(doc, "hub-account").click(); await sleep(5);
  let dlg = doc.getElementById("settings-dialog");
  assert.ok(dlg.textContent.includes("Email me a sign-in link"));
  assert.equal(dlg.textContent.includes("Export backup"), false);
  assert.equal(dlg.textContent.includes("Re-run setup"), false);
  dlg.querySelector(".dialog-actions button").click(); await sleep(5);
  tile(doc, "hub-settings").click(); await sleep(5);
  dlg = doc.getElementById("settings-dialog");
  assert.ok(dlg.textContent.includes("Export backup"));
  assert.ok(dlg.textContent.includes("Reminders"));
  assert.equal(dlg.textContent.includes("Email me a sign-in link"), false);
  assert.equal(dlg.textContent.includes("Continue with Google"), false);
});
