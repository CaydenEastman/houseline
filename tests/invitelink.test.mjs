import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";
import { inviteLink, joinFromSearch, rememberJoin, pendingJoin, clearJoin } from "../src/invite.js";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i], _m: m }; };

test("invite links: built from the app address and the code, read back from ?join=, ignoring junk", () => {
  assert.equal(inviteLink("https://x.github.io/app/?old=1#h", "K7M2 9QXR"), "https://x.github.io/app/?join=K7M29QXR");
  assert.equal(joinFromSearch("?join=k7m29qxr"), "K7M2 9QXR");
  assert.equal(joinFromSearch("?join=k7m2-9qxr&x=1"), "K7M2 9QXR");
  assert.equal(joinFromSearch("?join=short"), null);
  assert.equal(joinFromSearch("?other=1"), null);
  assert.equal(joinFromSearch(""), null);
});

test("a remembered invite survives, expires after 7 days, and can be cleared", () => {
  const ls = fakeLS();
  assert.equal(pendingJoin(ls), null);
  rememberJoin(ls, "K7M2 9QXR", 1000);
  assert.equal(pendingJoin(ls, 2000), "K7M2 9QXR");
  assert.equal(pendingJoin(ls, 1000 + 8 * 86400000), null);
  clearJoin(ls);
  assert.equal(pendingJoin(ls, 2000), null);
});

const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => true });
const alone = { household_id: "h", role: "owner", invite: null, members: [{ user_id: "u0", email: "me@x.com", role: "owner", me: true }] };
async function start({ ls, signedIn = true, info = alone, extra = {} }) {
  const doc = makeDocument(); const log = [];
  const auth = { session: () => (signedIn ? { user: { id: "u0", email: "me@x.com" } } : null), async signOut() {}, googleUrl: () => "https://g", signInWithEmail: async () => {} };
  const api = { info: async () => info, accept: async (c) => { log.push(["accept", c]); }, snapshots: async () => [], invite: async () => {}, cancelInvite: async () => {}, leave: async () => {}, remove: async () => {}, makeOwner: async () => {}, deleteAccount: async () => {} };
  doc.defaultView = { localStorage: ls, motAuth: auth, motHousehold: api, location: { origin: "https://x.github.io", pathname: "/app/", reload() {}, assign() {} }, ...extra };
  await mount(doc, { store: store(), state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  await sleep(450);
  return { doc, log, dlg: doc.getElementById("settings-dialog"), confirm: doc.getElementById("confirm-dialog") };
}
const press = async (root, text) => { const b = root.querySelectorAll("button").find((x) => x.textContent === text); assert.ok(b, `button ${text}`); b.click(); await sleep(40); };

test("signed in and opened from an invite link: 'You were invited' with the code already filled in, even if asked before", async () => {
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" });
  rememberJoin(ls, "K7M2 9QXR");
  const { dlg, confirm, log } = await start({ ls });
  assert.ok(dlg.textContent.includes("You were invited"));
  assert.equal(dlg.querySelector("#j-code").value, "K7M2 9QXR");
  dlg.querySelector("form").dispatchEvent({ type: "submit", preventDefault() {} }); await sleep(40);
  await press(confirm, "Join");
  assert.deepEqual(log, [["accept", "K7M2 9QXR"]]);
  assert.equal(pendingJoin(ls), null, "the link is used up");
});

test("opened an invite link while signed out: the sign-in screen opens with a note about the invitation", async () => {
  const ls = fakeLS({ "motH.tour": "1" });
  rememberJoin(ls, "K7M2 9QXR");
  const { dlg } = await start({ ls, signedIn: false });
  assert.ok(dlg.querySelector("#s-invited"), "invited note");
  assert.ok(dlg.querySelector("#s-google"));
});

test("choosing 'No, start my own' forgets the link; already in a shared household also forgets it", async () => {
  const ls = fakeLS({ "motH.tour": "1" });
  rememberJoin(ls, "K7M2 9QXR");
  const a = await start({ ls });
  await press(a.dlg, "No, start my own");
  assert.equal(pendingJoin(ls), null);
  const ls2 = fakeLS({ "motH.tour": "1" });
  rememberJoin(ls2, "K7M2 9QXR");
  const shared = { ...alone, members: [...alone.members, { user_id: "u1", email: "m@x.com", role: "member", me: false }] };
  const b = await start({ ls: ls2, info: shared });
  assert.ok(!b.dlg.textContent.includes("You were invited"));
  assert.equal(pendingJoin(ls2), null);
});

test("the owner can share an invite link (share sheet, or copy as a fallback)", async () => {
  const info = { ...alone, invite: { code: "ABCD2345", expires_at: new Date(Date.now() + 3 * 86400000).toISOString() }, members: [...alone.members, { user_id: "u1", email: "m@x.com", role: "member", me: false }] };
  const shared = []; const copied = [];
  const ls = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" });
  const { doc, dlg } = await start({ ls, info, extra: { navigator: { share: async (d) => { shared.push(d.url); }, clipboard: { writeText: async (t) => { copied.push(t); } } } } });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(40);
  dlg.querySelector("#s-invite-link").click(); await sleep(30);
  assert.deepEqual(shared, ["https://x.github.io/app/?join=ABCD2345"]);
  // no share sheet: the link is copied instead
  const ls2 = fakeLS({ "motH.tour": "1", "motH.joinAsked.u0": "1" });
  const b = await start({ ls: ls2, info, extra: { navigator: { clipboard: { writeText: async (t) => { copied.push(t); } } } } });
  b.doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  b.doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(40);
  b.dlg.querySelector("#s-invite-link").click(); await sleep(30);
  assert.deepEqual(copied, ["https://x.github.io/app/?join=ABCD2345"]);
});
