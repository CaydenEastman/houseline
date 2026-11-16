// Minimal Supabase Auth (GoTrue) client over fetch: session storage, silent refresh, email magic link, Google redirect.
// No SDK, no dependencies. A session is { access_token, refresh_token, expires_at (unix seconds), user: { id, email } }.
const KEY = "motH.auth";

export function createAuth({ url, anonKey, storage, fetchImpl, now = () => Date.now() }) {
  const f = fetchImpl || ((...a) => fetch(...a));
  const base = String(url || "").replace(/\/+$/, "");
  let refreshing = null;

  const read = () => { try { const s = JSON.parse(storage.getItem(KEY)); return s && s.access_token && s.refresh_token ? s : null; } catch { return null; } };
  const write = (s) => { try { s ? storage.setItem(KEY, JSON.stringify(s)) : storage.removeItem(KEY); } catch { /* private mode: lasts this visit only */ } };
  const headers = (token) => ({ apikey: anonKey, Authorization: `Bearer ${token || anonKey}`, "Content-Type": "application/json" });

  async function call(path, { method = "POST", body, token } = {}) {
    const res = await f(base + path, { method, headers: headers(token), body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await res.json(); } catch { /* empty body */ }
    if (!res.ok) { const e = new Error((json && (json.error_description || json.msg || json.message || json.error)) || `Sign-in service error (${res.status})`); e.status = res.status; throw e; }
    return json;
  }

  const fromTokenResponse = (j) => ({
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(now() / 1000) + (Number(j.expires_in) || 3600),
    user: j.user ? { id: j.user.id, email: j.user.email || null } : null,
  });

  async function refresh() {
    const s = read();
    if (!s) return null;
    if (!refreshing) {
      refreshing = (async () => {
        try {
          const j = await call("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: s.refresh_token } });
          const next = fromTokenResponse(j);
          if (!next.user) next.user = s.user;
          write(next);
          return next;
        } catch (e) {
          // A rejected refresh token means the session is over; a network error means try again later.
          if (e && (e.status === 400 || e.status === 401 || e.status === 403)) {
            // Another tab may have refreshed already (refresh tokens rotate). Only sign out if the stored one is still ours.
            const now = read();
            if (now && now.refresh_token !== s.refresh_token) return now;
            write(null);
          }
          throw e;
        } finally { refreshing = null; }
      })();
    }
    return refreshing;
  }

  return {
    session: read,
    isSignedIn: () => !!read(),
    userId: () => { const s = read(); return s && s.user ? s.user.id : null; },
    /** A valid access token, refreshing quietly if it is about to expire. Null when signed out. */
    async accessToken() {
      let s = read();
      if (!s) return null;
      if (s.expires_at - 60 <= Math.floor(now() / 1000)) s = await refresh();
      return s ? s.access_token : null;
    },
    refresh,
    /** Email a one-time sign-in link (also creates the account the first time). */
    async signInWithEmail(email, redirectTo) {
      const q = redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : "";
      await call("/auth/v1/otp" + q, { body: { email: String(email || "").trim(), create_user: true } });
    },
    googleUrl(redirectTo) {
      return `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo || "")}`;
    },
    /** Call once at startup: if the URL hash holds tokens from a sign-in redirect, keep them and return the session. */
    async consumeRedirect(hash) {
      const h = String(hash || "").replace(/^#/, "");
      if (!h.includes("access_token=")) return null;
      const p = new URLSearchParams(h);
      const access_token = p.get("access_token"), refresh_token = p.get("refresh_token");
      if (!access_token || !refresh_token) return null;
      const user = await call("/auth/v1/user", { method: "GET", token: access_token });
      const s = { access_token, refresh_token, expires_at: Math.floor(now() / 1000) + (Number(p.get("expires_in")) || 3600), user: { id: user.id, email: user.email || null } };
      write(s);
      return s;
    },
    async signOut() {
      const s = read();
      write(null);
      if (s) { try { await call("/auth/v1/logout", { token: s.access_token }); } catch { /* already signed out locally */ } }
    },
  };
}
