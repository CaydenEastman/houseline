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
