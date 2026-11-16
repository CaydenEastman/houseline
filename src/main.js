import { createStore } from "./sync.js";
import { freshState } from "./storage.js";
import { mount, localToday } from "./ui.js";
import { initPwa } from "./pwa.js";

/** localStorage if usable, otherwise an in-memory stand-in (private mode, blocked storage). */
function getLocalStorage() {
  try {
    const s = window.localStorage;
    const k = "motH.probe";
    s.setItem(k, "1");
    s.removeItem(k);
    return { localStorage: s, persistent: true };
  } catch {
    const mem = new Map();
    return {
      localStorage: {
        getItem: (k) => (mem.has(k) ? mem.get(k) : null),
        setItem: (k, v) => void mem.set(k, String(v)),
        removeItem: (k) => void mem.delete(k),
      },
      persistent: false,
    };
  }
}

/** Cloud storage for hosting outside Claude: only when config.js has a Supabase project AND this device is signed in. */
async function supabaseBackend(localStorage) {
  const none = { use: async () => null };
  try {
    const cfg = await import("../config.js");
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) return none;
    const { createAuth } = await import("./auth.js");
    const { createSupabaseBackend } = await import("./supabase.js");
    const auth = createAuth({ url: cfg.SUPABASE_URL, anonKey: cfg.SUPABASE_ANON_KEY, storage: localStorage });
    try { await auth.consumeRedirect(location.hash); } // returning from a sign-in link or Google: keep the tokens
    catch { /* bad or expired link: stay signed out */ }
    finally { if (String(location.hash).includes("access_token=")) history.replaceState(null, "", location.pathname + location.search); } // never leave tokens in the address bar
    window.motAuth = auth; // the sign-in screen (next step) uses this
    if (cfg.VAPID_PUBLIC_KEY) {
      const { createPush, pushSupported } = await import("./push.js");
      if (pushSupported(window)) {
        window.motPush = createPush({ url: cfg.SUPABASE_URL, anonKey: cfg.SUPABASE_ANON_KEY, auth, vapidKey: cfg.VAPID_PUBLIC_KEY, ls: localStorage });
      }
    }
    return createSupabaseBackend({ url: cfg.SUPABASE_URL, anonKey: cfg.SUPABASE_ANON_KEY, auth, realtime: true });
  } catch { return none; }
}

async function start() {
  const { localStorage, persistent } = getLocalStorage();
  // window.claude may be absent (plain static hosting); sync.js degrades to local mode.
  const claude = window.claude && typeof window.claude.use === "function"
    ? window.claude
    : await supabaseBackend(localStorage);
  let store = null;
  let state = null;
  let loadError = null;
  try {
    store = await createStore({ localStorage, claude, mergeUnownedLocal: !!window.motAuth, now: () => Date.now() });
    state = await store.load();
  } catch (e) {
    loadError = e;
  }
  if (!store || !state) {
    // Last resort so the page still opens: an in-memory store around a fresh state.
    state = freshState();
    store = {
      mode: "local", load: async () => state, save: async () => {}, flush: async () => {},
      onStatus: () => () => {}, subscribe: () => () => {},
      putPhoto: async () => { throw new Error("Photos are unavailable right now."); },
      getPhoto: async () => null, deletePhoto: async () => {},
      whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}),
      saveFile: async () => false,
    };
  }
  await mount(document, { store, state, persistent, loadError });
  const flush = () => { try { const p = store && store.flush && store.flush(); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } };
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
  window.addEventListener("pagehide", flush);
  initPwa({ ls: localStorage, getState: () => store.load(), getToday: localToday });
}

start().catch((e) => {
  const p = document.createElement("p");
  p.className = "wrap";
  p.setAttribute("role", "alert");
  p.textContent = "Sorry, the app could not start: " + (e && e.message ? e.message : "unknown error");
  document.body.append(p);
});
