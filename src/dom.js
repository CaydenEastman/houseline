// Tiny shared DOM helpers. Text is ALWAYS set via textContent / text nodes, never innerHTML.

/** h(tag, attrs, ...children) -> element. attrs: class, text, on*, data-*, aria-*, boolean attrs, anything else via setAttribute. */
export function h(doc, tag, attrs = {}, ...children) {
  const el = doc.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(typeof c === "string" || typeof c === "number" ? doc.createTextNode(String(c)) : c);
  }
  return el;
}

/** Local calendar date as YYYY-MM-DD (NOT UTC). */
export function localToday(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** YYYY-MM-DD -> Date at local midnight (for display only). */
export function isoToLocalDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function fmtDate(iso, opts = { month: "short", day: "numeric", year: "numeric" }) {
  return iso ? isoToLocalDate(iso).toLocaleDateString(undefined, opts) : "";
}

export function fmtMoney(n) {
  return n == null ? "" : new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
}

/** Only http(s) URLs may become links. Returns the normalized URL or null. */
export function safeUrl(u) {
  try {
    const url = new URL(String(u).trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}
