// Morning push reminders that arrive even when the app is closed.
// The phone registers a push subscription with its browser's push service and stores it in the user's own
// Supabase row (row-level security: only they can see it). A server job sends the notification each morning.
const KEY = "motH.push"; // JSON { hour } while this device is subscribed

export function urlBase64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const bytesToB64Url = (buf) => {
  let s = "";
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function pushSupported(win = typeof window !== "undefined" ? window : null) {
  return !!win && "PushManager" in win && "Notification" in win && !!win.navigator && "serviceWorker" in win.navigator;
}

export function createPush({ url, anonKey, auth, vapidKey, ls, nav = typeof navigator !== "undefined" ? navigator : null, fetchImpl, tz }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const zone = () => tz || (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; } catch { return "UTC"; } })();
  const saved = () => { try { return JSON.parse(ls.getItem(KEY) || "null"); } catch { return null; } };

  async function registration() {
    const reg = nav && nav.serviceWorker && (await nav.serviceWorker.getRegistration());
    if (!reg || !reg.pushManager) throw new Error("Push isn't available here. Install the app from your browser's menu first.");
    return reg;
  }

  async function send(sub, hour, quietDays = []) {
    const token = await auth.accessToken();
    if (!token) throw new Error("Sign in first.");
    const j = sub.toJSON ? sub.toJSON() : sub;
    const row = { endpoint: j.endpoint, p256dh: j.keys && j.keys.p256dh, auth: j.keys && j.keys.auth, tz: zone(), hour, quiet_days: quietDays };
    if (!row.p256dh || !row.auth) { row.p256dh = bytesToB64Url(sub.getKey("p256dh")); row.auth = bytesToB64Url(sub.getKey("auth")); }
    const res = await f(`${url}/rest/v1/push_subscriptions?on_conflict=endpoint`, {
      method: "POST",
      headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(res.status === 400 ? "Couldn't save this device for reminders (too many devices?)." : `Couldn't save reminders (${res.status}).`);
  }

  return {
    /** The hour (0-23) reminders are set for on this device, or null when off. */
    hour() { const s = saved(); return s && Number.isInteger(s.hour) ? s.hour : null; },
    /** Days of the week (0 = Sunday ... 6 = Saturday) with no reminders. */
    quietDays() { const s = saved(); return s && Array.isArray(s.quiet) ? s.quiet.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : []; },
    async enable(hour, quietDays) {
      if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error("Pick an hour of the day.");
      const reg = await registration();
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(vapidKey) });
      const quiet = quietDays === undefined ? this.quietDays() : [...new Set(quietDays)].filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
      await send(sub, hour, quiet);
      ls.setItem(KEY, JSON.stringify({ hour, quiet }));
      return true;
    },
    async disable() {
      let endpoint = null;
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (sub) { endpoint = sub.endpoint; await sub.unsubscribe(); }
      } catch { /* nothing to unsubscribe */ }
      ls.removeItem(KEY);
      try {
        const token = await auth.accessToken();
        if (token && endpoint) await f(`${url}/rest/v1/push_subscriptions?endpoint=eq.${encodeURIComponent(endpoint)}`, { method: "DELETE", headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
      } catch { /* the server also drops dead subscriptions on its own */ }
      return true;
    },
    /** Keep the server's copy fresh (time zone changes, browser rotated the subscription). Never throws. */
    async refresh() {
      const s = saved();
      if (!s || !auth.isSignedIn()) return;
      try {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (!sub) { ls.removeItem(KEY); return; } // permission revoked or subscription gone
        await send(sub, s.hour, Array.isArray(s.quiet) ? s.quiet : []);
      } catch { /* try again next time the app opens */ }
    },
  };
}
