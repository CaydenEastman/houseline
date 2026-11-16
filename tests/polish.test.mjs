import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH } from "../src/dom.js";
import { mount } from "../src/ui.js";
import today, { resetTodayView } from "../src/views/today.js";
import { installErrorReporting } from "../src/errors.js";
import { APP_VERSION } from "../src/version.js";
import { createHousehold } from "../src/household.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, get length() { return Object.keys(m).length; }, key: (i) => Object.keys(m)[i], _m: m }; };

// ---------- error reporting ----------
function rig({ signedIn = true } = {}) {
  const handlers = {}; const posts = [];
  const win = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; }, location: { pathname: "/man-of-the-house/", search: "?secret=1", hash: "#token" }, navigator: { userAgent: "UA/1.0" } };
  const auth = { isSignedIn: () => signedIn, accessToken: async () => "tok" };
  const fetchImpl = async (u, o) => { posts.push([u, o]); return { ok: true }; };
  const stop = installErrorReporting({ url: "https://p.supabase.co", anonKey: "anon", auth, version: APP_VERSION, win, fetchImpl });
  return { handlers, posts, stop };
}

test("a crash is reported with message, trimmed stack, page path (no query or hash), browser and version; never anything else", async () => {
  const r = rig();
  r.handlers.error({ message: "x is not a function", error: { stack: "Error\n at a ".repeat(1000) } });
  await sleep(10);
  assert.equal(r.posts.length, 1);
  const [url, opt] = r.posts[0];
  assert.equal(url, "https://p.supabase.co/rest/v1/client_errors");
  assert.equal(opt.headers.authorization, "Bearer tok");
  const body = JSON.parse(opt.body);
  assert.deepEqual(Object.keys(body).sort(), ["agent", "message", "page", "stack", "version"]);
  assert.equal(body.page, "/man-of-the-house/");
  assert.equal(body.version, APP_VERSION);
  assert.ok(body.stack.length <= 3000);
});

test("duplicate messages, noise, signed-out visitors and floods are not reported", async () => {
  const r = rig();
  for (let i = 0; i < 3; i++) r.handlers.error({ message: "same" });
  r.handlers.error({ message: "ResizeObserver loop limit exceeded" });
  r.handlers.error({ message: "Script error." });
  r.handlers.unhandledrejection({ reason: new Error("a promise failed") });
  for (let i = 0; i < 20; i++) r.handlers.error({ message: "flood " + i });
  await sleep(20);
  assert.equal(r.posts.length, 5, "capped at 5 per session");
  assert.equal(r.posts.filter(([, o]) => JSON.parse(o.body).message === "same").length, 1);
  const out = rig({ signedIn: false });
  out.handlers.error({ message: "boom" }); await sleep(10);
  assert.equal(out.posts.length, 0);
});

test("a failing report never throws into the app, and stop() unhooks the listeners", async () => {
  const handlers = {};
  const win = { addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; }, location: { pathname: "/" } };
  const stop = installErrorReporting({ url: "u", anonKey: "k", auth: { isSignedIn: () => true, accessToken: async () => { throw new Error("network"); } }, version: "v", win, fetchImpl: async () => { throw new Error("down"); } });
  handlers.error({ message: "boom" }); await sleep(10);
  stop();
  assert.deepEqual(Object.keys(handlers), []);
});

test("the app version matches the service worker version, and every new file is precached", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes(`const VERSION = "${APP_VERSION}"`), "bump APP_VERSION and sw.js VERSION together");
  for (const f of ["src/errors.js", "src/version.js"]) assert.ok(sw.includes(`"${f}"`));
});

// ---------- Today feed length ----------
function setup(state) {
  const doc = makeDocument(); const container = doc.createElement("div");
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => state, today: () => "2026-11-16", completeTask() {}, openTaskForm() {}, saveFile: async () => false, toast() {}, markManyDone() {}, commit() { return true; }, setView() {}, personName: (i) => i };
  today.render(container, ctx);
  return { container, rerender: () => today.render(container, ctx) };
}
const many = (n) => mkState({ tasks: Array.from({ length: n }, (_, i) => mkTask({ id: "t" + i, title: "Task " + i, lastDone: "2025-01-01", intervalDays: 30 })) });
const cards = (c) => c.querySelectorAll(".tf-card").length;
const btn = (c, text) => [...c.querySelectorAll("button")].find((b) => b.textContent.startsWith(text));

test("a long Today feed shows the most urgent 10 first, 'Show more' reveals the rest, 'Show fewer' goes back", () => {
  resetTodayView();
  const { container, rerender } = setup(many(25));
  assert.equal(cards(container), 10);
  assert.ok(btn(container, "Show 15 more"));
  btn(container, "Show 15 more").click(); rerender();
  assert.equal(cards(container), 25);
  btn(container, "Show fewer").click(); rerender();
  assert.equal(cards(container), 10);
});

test("a feed only slightly over the limit is not hidden, and 'Select all' only covers what is on screen", () => {
  resetTodayView();
  const small = setup(many(12));
  assert.equal(cards(small.container), 12);
  assert.equal(btn(small.container, "Show"), undefined);
  resetTodayView();
  const big = setup(many(25));
  btn(big.container, "Mark several done").click(); big.rerender();
  btn(big.container, "Select all").click(); big.rerender();
  assert.ok(big.container.textContent.includes("Mark 10 done today"), "hidden tasks are never marked done by accident");
  resetTodayView();
});

// ---------- backups screen ----------
async function openAccount(api) {
  const reloads = [];
  const doc = makeDocument();
  const auth = { session: () => ({ user: { email: "me@x.com" } }), async signOut() {}, googleUrl: () => "", signInWithEmail: async () => {} };
  const store = { mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => true };
  doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1", "motH.v1": "old" }), motAuth: auth, motHousehold: api, location: { origin: "https://x", pathname: "/", reload: () => reloads.push(1), assign() {} } };
  await mount(doc, { store, state: mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] }) });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-account").click(); await sleep(40);
  return { doc, reloads, dlg: doc.getElementById("settings-dialog") };
}
const apiFor = (role, log) => ({
  info: async () => ({ household_id: "h", role, invite: null, members: [{ user_id: "u0", email: "me@x.com", role, me: true }] }),
  snapshots: async () => [{ day: "2026-11-16", tasks: 67 }, { day: "2026-11-15", tasks: 66 }],
  restoreSnapshot: async (d) => { log.push(["restore", d]); },
});

test("owner sees the last backups and can restore one after confirming; the phone drops its old copy and reloads", async () => {
  const log = [];
  const { doc, dlg, reloads } = await openAccount(apiFor("owner", log));
  assert.ok(dlg.textContent.includes("Daily backups"));
  assert.ok(dlg.textContent.includes("66 tasks"));
  const restores = dlg.querySelectorAll("button").filter((b) => b.textContent === "Restore");
  assert.equal(restores.length, 2);
  restores[1].click(); await sleep(30);
  assert.deepEqual(log, [], "nothing restored until confirmed");
  doc.getElementById("confirm-dialog").querySelectorAll("button").find((b) => b.textContent === "Restore").click(); await sleep(40);
  assert.deepEqual(log, [["restore", "2026-11-15"]]);
  assert.equal(doc.defaultView.localStorage.getItem("motH.v1"), null);
  await sleep(700);
  assert.equal(reloads.length, 1);
});

test("a regular member can see the backups but not restore them", async () => {
  const { dlg } = await openAccount(apiFor("member", []));
  assert.ok(dlg.textContent.includes("Daily backups"));
  assert.equal(dlg.querySelectorAll("button").filter((b) => b.textContent === "Restore").length, 0);
  assert.ok(dlg.textContent.includes("Only the owner can restore"));
});

test("the household API calls the backup functions as the signed-in user", async () => {
  const calls = [];
  const h = createHousehold({ url: "https://p.supabase.co", anonKey: "a", auth: { accessToken: async () => "tok" }, fetchImpl: async (u, o) => { calls.push([u.replace("https://p.supabase.co", ""), JSON.parse(o.body)]); return { ok: true, status: 200, json: async () => [] }; } });
  await h.snapshots(); await h.restoreSnapshot("2026-11-15");
  assert.deepEqual(calls, [["/rest/v1/rpc/list_snapshots", {}], ["/rest/v1/rpc/restore_snapshot", { day: "2026-11-15" }]]);
});
