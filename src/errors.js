// Tells us when the app breaks on someone's phone. Reports go to our own database (table client_errors), only from
// signed-in people, with the error message, a trimmed stack trace, the page path, the browser and the app version.
// Never any of the person's tasks or notes. Reporting can never break the app: every failure here is swallowed.
const MAX_PER_SESSION = 5;
const IGNORE = /ResizeObserver loop|^Script error\.?$|Load failed|NetworkError|Failed to fetch|AbortError/i;

export function installErrorReporting({ url, anonKey, auth, version, win, fetchImpl }) {
  if (!win || typeof win.addEventListener !== "function") return () => {};
  const f = fetchImpl || ((...a) => fetch(...a));
  const seen = new Set();
  let sent = 0;

  async function report(message, stack) {
    try {
      const msg = String(message || "").slice(0, 500);
      if (!msg || IGNORE.test(msg) || seen.has(msg) || sent >= MAX_PER_SESSION) return;
      if (!auth || !auth.isSignedIn || !auth.isSignedIn()) return;
      seen.add(msg); sent++;
      const token = await auth.accessToken();
      if (!token) return;
      const nav = win.navigator || {};
      await f(`${url}/rest/v1/client_errors`, {
        method: "POST",
        headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({
          message: msg,
          stack: stack ? String(stack).slice(0, 3000) : null,
          page: String((win.location && win.location.pathname) || "").slice(0, 200),
          agent: String(nav.userAgent || "").slice(0, 250),
          version: String(version || "").slice(0, 40),
        }),
        keepalive: true,
      });
    } catch { /* never let reporting cause a problem */ }
  }

  const onError = (e) => { report((e && (e.message || (e.error && e.error.message))) || "Unknown error", e && e.error && e.error.stack); };
  const onRejection = (e) => {
    const r = e && e.reason;
    report((r && (r.message || String(r))) || "Unhandled promise rejection", r && r.stack);
  };
  win.addEventListener("error", onError);
  win.addEventListener("unhandledrejection", onRejection);
  return () => { win.removeEventListener("error", onError); win.removeEventListener("unhandledrejection", onRejection); };
}
