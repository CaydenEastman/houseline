// Invite links: https://.../?join=K7M29QXR. Opening one remembers the code on this phone (it has to survive the
// sign-in redirect), then the app asks "Join this household?" once the person is signed in.
import { formatCode } from "./household.js";

const KEY = "motH.join";
const KEEP_MS = 7 * 86400000; // an invite code lives 7 days, so does the memory of it

/** The link the owner shares. `base` is the app's own address without any query. */
export function inviteLink(base, code) {
  const clean = String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${String(base).split(/[?#]/)[0]}?join=${clean}`;
}

/** The invite code in an address (?join=...), formatted for display, or null. */
export function joinFromSearch(search) {
  try {
    const raw = new URLSearchParams(String(search || "")).get("join");
    const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    return c.length === 8 ? formatCode(c) : null;
  } catch { return null; }
}

export function rememberJoin(ls, code, now = Date.now()) {
  try { if (ls && code) ls.setItem(KEY, JSON.stringify({ code, at: now })); } catch { /* optional */ }
}

export function pendingJoin(ls, now = Date.now()) {
  try {
    const v = ls && JSON.parse(ls.getItem(KEY) || "null");
    return v && typeof v.code === "string" && now - Number(v.at) < KEEP_MS ? v.code : null;
  } catch { return null; }
}

export function clearJoin(ls) { try { if (ls) ls.removeItem(KEY); } catch { /* optional */ } }

/** What to call a member in a notice: the part of their email before the @. */
export function memberLabel(m) {
  const e = m && typeof m.email === "string" ? m.email : "";
  return (e.split("@")[0] || "Someone").slice(0, 40);
}

/**
 * Who joined since this phone last looked? `seen` is the saved list of member ids (null the first time, when nothing is
 * announced and the current members simply become the baseline). The person's own entry is never announced.
 */
export function newMembers(seen, members) {
  const list = Array.isArray(members) ? members : [];
  if (!Array.isArray(seen)) return [];
  const known = new Set(seen);
  return list.filter((m) => m && m.user_id && !m.me && !known.has(m.user_id));
}

/** Compare, remember, and return the members to announce. Storage failures just mean no announcement. */
export function checkMembers(ls, uid, members) {
  const key = `motH.members.${uid}`;
  let seen = null;
  try { const raw = ls.getItem(key); seen = raw ? JSON.parse(raw) : null; } catch { seen = null; }
  const fresh = newMembers(seen, members);
  try { ls.setItem(key, JSON.stringify((members || []).map((m) => m.user_id).filter(Boolean))); } catch { /* ignore */ }
  return fresh;
}
