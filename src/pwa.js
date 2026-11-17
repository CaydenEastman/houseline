// Installable-app support: service worker, "install" hint, and daily reminder notifications.
// Everything here is optional and degrades to nothing where the browser lacks the feature
// (the Claude-hosted preview, old browsers, private mode).
import { dueInfo } from "./logic.js";

const KEY_ON = "motH.remind";
const KEY_DAY = "motH.remindDay";

export function supported() {
  return typeof window !== "undefined" && "Notification" in window && "serviceWorker" in navigator;
}

export async function registerSW(nav = typeof navigator !== "undefined" ? navigator : null) {
  try {
    if (!nav || !nav.serviceWorker) return null;
    return await nav.serviceWorker.register("sw.js", { scope: "./" });
  } catch {
    return null; // sandboxed or blocked: the app works the same without it
  }
}

export function isStandalone() {
  try {
    return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  } catch { return false; }
}

/** { overdue, today, soon } counts of open tasks, plus a one-line message (or null when nothing is due). */
export function dueSummary(state, today) {
  let overdue = 0, due = 0, top = null, topDays = Infinity;
  for (const t of (state && state.tasks) || []) {
    if (t.snoozedUntil != null && t.snoozedUntil > today) continue;
    let d; try { d = dueInfo(t, state, today); } catch { continue; }
    if (d.daysUntil == null) continue;
    if (d.daysUntil < 0) overdue++;
    else if (d.daysUntil === 0) due++;
    if (d.daysUntil <= 0 && d.daysUntil < topDays) { topDays = d.daysUntil; top = t.title; }
  }
  const parts = [];
  if (overdue) parts.push(`${overdue} overdue`);
  if (due) parts.push(`${due} due today`);
  return { overdue, due, top, message: parts.length ? `${parts.join(" and ")}. Most urgent: ${top}` : null };
}

export function remindersOn(ls) {
  try { return ls.getItem(KEY_ON) === "1" && typeof Notification !== "undefined" && Notification.permission === "granted"; }
  catch { return false; }
}

/** Show at most one reminder per day, only if reminders are on and something needs doing. */
export async function maybeNotify({ ls, state, today, reg }) {
  try {
    if (!remindersOn(ls) || ls.getItem(KEY_DAY) === today) return false;
    const { message } = dueSummary(state, today);
    if (!message) return false;
    const r = reg || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
    if (!r || !r.showNotification) return false;
    await r.showNotification("Man of the House", { body: message, icon: "icons/icon-192.png", badge: "icons/favicon-32.png", tag: "moth-daily" });
    ls.setItem(KEY_DAY, today);
    return true;
  } catch { return false; }
}

export async function enableReminders(ls) {
  if (!supported()) return { ok: false, why: "unsupported" };
  const res = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (res !== "granted") return { ok: false, why: "denied" };
  ls.setItem(KEY_ON, "1");
  ls.removeItem(KEY_DAY);
  return { ok: true };
}

export function disableReminders(ls) {
  try { ls.setItem(KEY_ON, "0"); } catch { /* ignore */ }
}

export function initPwa({ ls, getState, getToday }) {
  registerSW().then((reg) => {
    const run = async () => { try { await maybeNotify({ ls, state: await getState(), today: getToday(), reg }); } catch { /* ignore */ } };
    run();
    try { if (typeof window !== "undefined" && window.motPush) window.motPush.refresh(); } catch { /* ignore */ }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") run(); });
  });
}
