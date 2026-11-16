import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dueSummary, maybeNotify, registerSW, remindersOn } from "../src/pwa.js";

const task = (o) => ({ id: "t" + Math.random(), title: "x", kind: "interval", intervalDays: 30, lastDone: "2026-01-01", ...o });

test("manifest is installable: name, scope, standalone, 192 + 512 + maskable icons that exist", () => {
  const m = JSON.parse(fs.readFileSync("manifest.webmanifest", "utf8"));
  assert.equal(m.display, "standalone");
  assert.ok(m.name && m.start_url && m.scope);
  const sizes = m.icons.map((i) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));
  for (const i of m.icons) assert.ok(fs.existsSync(i.src), i.src);
  assert.ok(fs.existsSync("icons/apple-touch-icon.png"));
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /rel="manifest"/);
  assert.match(html, /apple-touch-icon/);
});

test("service worker precache lists only files that exist, and every path is relative", () => {
  const sw = fs.readFileSync("sw.js", "utf8");
  const list = sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  assert.ok(list.length > 20);
  for (const f of list) {
    assert.ok(!f.startsWith("/"), "absolute path breaks GitHub Pages subfolder: " + f);
    if (f !== "./") assert.ok(fs.existsSync(f), "missing: " + f);
  }
  // every module the app imports is cached, or offline start fails
  for (const f of fs.readdirSync("src")) if (f.endsWith(".js")) assert.ok(list.includes("src/" + f), "not precached: src/" + f);
  for (const f of fs.readdirSync("src/views")) assert.ok(list.includes("src/views/" + f), "not precached: src/views/" + f);
});

test("dueSummary counts overdue and due-today, ignores snoozed and future", () => {
  const today = "2026-06-10";
  const state = { tasks: [
    task({ lastDone: "2026-05-01", intervalDays: 30 }),            // due 5-31: overdue
    task({ lastDone: "2026-05-11", intervalDays: 30 }),            // due 6-10: today
    task({ lastDone: "2026-06-01", intervalDays: 30 }),            // future
    task({ lastDone: "2026-01-01", snoozedUntil: "2026-06-20" }),  // snoozed
  ], vehicles: [] };
  const s = dueSummary(state, today);
  assert.equal(s.overdue, 1); assert.equal(s.due, 1);
  assert.equal(s.message, "1 overdue and 1 due today");
  assert.equal(dueSummary({ tasks: [task({ lastDone: "2026-06-09" })], vehicles: [] }, today).message, null);
});

test("maybeNotify: once a day, only when on and something is due", async () => {
  const store = new Map();
  const ls = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  globalThis.Notification = { permission: "granted" };
  const shown = [];
  const reg = { showNotification: async (t, o) => shown.push([t, o.body]) };
  const state = { tasks: [task({ lastDone: "2026-01-01" })], vehicles: [] };
  assert.equal(await maybeNotify({ ls, state, today: "2026-06-10", reg }), false, "off by default");
  ls.setItem("motH.remind", "1");
  assert.equal(await maybeNotify({ ls, state, today: "2026-06-10", reg }), true);
  assert.equal(await maybeNotify({ ls, state, today: "2026-06-10", reg }), false, "not twice in a day");
  assert.equal(await maybeNotify({ ls, state, today: "2026-06-11", reg }), true, "again the next day");
  assert.equal(shown.length, 2);
  assert.equal(await maybeNotify({ ls, state: { tasks: [], vehicles: [] }, today: "2026-06-12", reg }), false, "nothing due");
  globalThis.Notification = { permission: "denied" };
  assert.equal(remindersOn(ls), false, "blocked permission turns it off");
  delete globalThis.Notification;
});

test("registerSW never throws when service workers are missing or blocked", async () => {
  assert.equal(await registerSW({}), null);
  assert.equal(await registerSW({ serviceWorker: { register: async () => { throw new Error("blocked"); } } }), null);
});
