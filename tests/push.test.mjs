import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPush, urlBase64ToBytes, pushSupported } from "../src/push.js";

const fakeLS = () => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; };
const KEY = "BLis6SpvNyNithh5y7XjubP1LfK9oV1wkqAUKzJyJg8DwgFJFbyL6D7g3fp8ffonKDbDEBYf5wWQv361yt5SupI";

function rig({ signedIn = true, existingSub = false, regMissing = false, status = 201 } = {}) {
  const calls = []; const subscribed = []; let unsub = 0;
  let sub = existingSub ? mkSub() : null;
  function mkSub() { return { endpoint: "https://push.example/abc", toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "P", auth: "A" } }), unsubscribe: async () => { unsub++; sub = null; } }; }
  const pushManager = { getSubscription: async () => sub, subscribe: async (o) => { subscribed.push(o); sub = mkSub(); return sub; } };
  const nav = { serviceWorker: { getRegistration: async () => (regMissing ? undefined : { pushManager }) } };
  const auth = { accessToken: async () => (signedIn ? "tok" : null), isSignedIn: () => signedIn };
  const fetchImpl = async (u, o) => { calls.push([u, o]); return { ok: status < 400, status }; };
  const ls = fakeLS();
  const push = createPush({ url: "https://p.supabase.co", anonKey: "anon", auth, vapidKey: KEY, ls, nav, fetchImpl, tz: "America/Denver" });
  return { push, calls, subscribed, ls, get unsub() { return unsub; } };
}

test("VAPID key decodes to the 65-byte uncompressed P-256 point browsers require", () => {
  const b = urlBase64ToBytes(KEY);
  assert.equal(b.length, 65);
  assert.equal(b[0], 4);
});

test("enable: subscribes with the public key and stores endpoint, keys, time zone and hour under the user's token", async () => {
  const r = rig();
  assert.equal(r.push.hour(), null);
  await r.push.enable(7);
  assert.equal(r.subscribed.length, 1);
  assert.equal(r.subscribed[0].userVisibleOnly, true);
  const [url, opt] = r.calls[0];
  assert.ok(url.endsWith("/rest/v1/push_subscriptions?on_conflict=endpoint"));
  assert.equal(opt.headers.authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(opt.body), { endpoint: "https://push.example/abc", p256dh: "P", auth: "A", tz: "America/Denver", hour: 7, quiet_days: [] });
  assert.equal(r.push.hour(), 7);
});

test("changing the hour reuses the existing subscription instead of creating another", async () => {
  const r = rig({ existingSub: true });
  await r.push.enable(6);
  await r.push.enable(9);
  assert.equal(r.subscribed.length, 0);
  assert.equal(r.calls.length, 2);
  assert.equal(r.push.hour(), 9);
});

test("enable rejects bad hours, signed-out users and server errors without pretending it worked", async () => {
  await assert.rejects(() => rig().push.enable(24));
  await assert.rejects(() => rig().push.enable(NaN));
  const out = rig({ signedIn: false });
  await assert.rejects(() => out.push.enable(8), /Sign in/);
  assert.equal(out.push.hour(), null);
  const bad = rig({ status: 500 });
  await assert.rejects(() => bad.push.enable(8));
  assert.equal(bad.push.hour(), null);
  await assert.rejects(() => rig({ regMissing: true }).push.enable(8), /isn't available/);
});

test("disable unsubscribes the phone and deletes its server row", async () => {
  const r = rig({ existingSub: true });
  await r.push.enable(8);
  await r.push.disable();
  assert.equal(r.unsub, 1);
  assert.equal(r.push.hour(), null);
  const del = r.calls.find(([, o]) => o.method === "DELETE");
  assert.ok(del[0].includes("endpoint=eq.https%3A%2F%2Fpush.example%2Fabc"));
});

test("refresh re-saves the subscription (new time zone, rotated keys) and never throws; a vanished subscription turns the setting off", async () => {
  const r = rig({ existingSub: true });
  await r.push.enable(8);
  r.calls.length = 0;
  await r.push.refresh();
  assert.equal(r.calls.length, 1);
  const gone = rig(); // saved setting but the browser lost the subscription
  gone.ls.setItem("motH.push", JSON.stringify({ hour: 8 }));
  await gone.push.refresh();
  assert.equal(gone.push.hour(), null);
  const nosw = rig({ regMissing: true });
  nosw.ls.setItem("motH.push", JSON.stringify({ hour: 8 }));
  await nosw.push.refresh(); // must not throw
  assert.equal(nosw.push.hour(), 8);
});

test("pushSupported is false without the Push API", () => {
  assert.equal(pushSupported(null), false);
  assert.equal(pushSupported({ navigator: {} }), false);
  assert.equal(pushSupported({ PushManager: {}, Notification: {}, navigator: { serviceWorker: {} } }), true);
});

test("service worker shows a notification for a push, and the push file is precached", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.ok(sw.includes('addEventListener("push"'));
  assert.ok(sw.includes("showNotification"));
  assert.ok(sw.includes('"src/push.js"'));
});
