// History view: completed/skipped log, filters, spend panel, photo viewer.
import { historyFor, spend } from "../logic.js";
import { fmtDate, fmtMoney } from "../dom.js";

export const id = "history";
export const label = "History";

const CAT = { car: "Car", house: "House", yard: "Yard", emergency: "Emergency" };
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const S = { category: "all", year: "all", kind: "all", limit: 50, viewer: null, pending: null };

function paint(container, build, doc) {
  let fk = null;
  try { const ae = doc.activeElement; fk = ae && container.contains(ae) && ae.getAttribute ? ae.getAttribute("data-fk") : null; } catch { /* focus restore is best-effort */ }
  const node = build();
  container.textContent = "";
  container.append(node);
  const want = S.pending || fk;
  S.pending = null;
  if (want) {
    try {
      const el = [...container.querySelectorAll("[data-fk]")].find((e) => e.getAttribute("data-fk") === want);
      if (el && el.focus) el.focus();
    } catch { /* best-effort */ }
  }
  const dlg = S.viewer && container.querySelector ? container.querySelector(".v-viewer") : null;
  if (dlg) {
    if (typeof dlg.showModal === "function") { try { dlg.showModal(); } catch { dlg.setAttribute("open", ""); } }
    else dlg.setAttribute("open", "");
  }
}

function whoName(c, ctx) {
  if (!c.by) return "";
  if (ctx.me && ctx.me.id && c.by === ctx.me.id) return "You";
  return (ctx.names && ctx.names[c.by]) || "Someone";
}

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const thisYear = Number(today.slice(0, 4));
  const all = state.completions || [];
  const years = [...new Set([thisYear, ...all.map((c) => Number(c.date.slice(0, 4)))])].sort((a, b) => b - a);
  if (S.year !== "all" && !years.includes(Number(S.year))) S.year = "all";

  const q = {};
  if (S.category !== "all") q.category = S.category;
  if (S.year !== "all") q.year = Number(S.year);
  if (S.kind !== "all") q.kind = S.kind;
  const rows = historyFor(state, q);
  const shown = rows.slice(0, S.limit);

  const select = (idv, lab, key, opts) =>
    h("div", { class: "field v-filter" },
      h("label", { for: idv, text: lab }),
      h("select", {
        id: idv, "data-fk": idv,
        onchange: (e) => { S[key] = e.target.value; S.limit = 50; rerender(); },
      }, opts.map(([v, t]) => h("option", { value: v, selected: String(S[key]) === String(v), text: t }))));

  const filters = h("form", { class: "v-filters", "aria-label": "Filter history", onsubmit: (e) => e.preventDefault() },
    select("v-hist-cat", "Category", "category", [["all", "All categories"], ...Object.entries(CAT)]),
    select("v-hist-year", "Year", "year", [["all", "All years"], ...years.map((y) => [String(y), String(y)])]),
    select("v-hist-kind", "Type", "kind", [["all", "Done and skipped"], ["done", "Done only"], ["skipped", "Skipped only"]]));

  return h("section", { class: "v-view", "aria-labelledby": "v-hist-h" },
    h("h2", { id: "v-hist-h", class: "v-h2", text: "History" }),
    h("p", { class: "v-lede", text: "Everything you've marked done or skipped. Skipped items moved the schedule forward but never count toward spending." }),
    spendPanel(ctx, state, S.year === "all" ? null : Number(S.year)),
    filters,
    h("p", { class: "v-count", role: "status", "aria-live": "polite",
      text: rows.length === 1 ? "1 entry" : `${rows.length} entries` }),
    rows.length === 0 ? empty(ctx, all.length === 0) : list(ctx, shown, rows.length, rerender),
    S.viewer ? viewer(ctx, rerender) : null);
}

function empty(ctx, none) {
  const { h } = ctx;
  return h("div", { class: "empty" },
    h("div", { class: "empty-art", "aria-hidden": "true", text: "\u{1F4D2}" }),
    h("h3", { text: none ? "Nothing in your history yet" : "No entries match those filters" }),
    h("p", { text: none
      ? "When you mark a task done (or skip it) it shows up here, with cost, notes and photos if you add them."
      : "Try a different category, year or type." }));
}

function spendPanel(ctx, state, year) {
  const { h } = ctx;
  const s = year == null ? spend(state) : spend(state, year);
  const yl = year == null ? "all years" : String(year);
  const cats = Object.keys(CAT);
  const maxCat = Math.max(1, ...cats.map((c) => s.byCategory[c] || 0));
  const maxMon = Math.max(1, ...s.byMonth);
  const bar = (value, max, cls) => {
    const el = h("span", { class: `v-bar-fill ${cls || ""}` });
    if (el.style) el.style.width = `${Math.round((value / max) * 100)}%`;
    return h("span", { class: "v-bar", "aria-hidden": "true" }, el);
  };
  return h("section", { class: "v-panel", "aria-labelledby": "v-spend-h" },
    h("h3", { id: "v-spend-h", class: "v-h3", text: year == null ? "Spending, all years" : `Spending in ${year}` }),
    h("p", { class: "v-total" }, h("span", { class: "v-total-num", text: fmtMoney(s.total) || "$0.00" }), " total, from tasks you marked done with a cost"),
    h("div", { class: "v-spend-grid" },
      h("div", {},
        h("h4", { class: "v-h4", text: "By category" }),
        h("ul", { class: "v-bars", "aria-label": `Spending by category, ${yl}` },
          cats.map((c) => h("li", { class: "v-bar-row" },
            h("span", { class: "v-bar-label", text: CAT[c] }),
            bar(s.byCategory[c] || 0, maxCat, `v-cat-${c}`),
            h("span", { class: "v-bar-val", text: fmtMoney(s.byCategory[c] || 0) }))))),
      h("div", {},
        h("h4", { class: "v-h4", text: year == null ? "By month (all years combined)" : "By month" }),
        h("ul", { class: "v-bars", "aria-label": `Spending by month, ${yl}` },
          s.byMonth.map((v, i) => h("li", { class: "v-bar-row" },
            h("span", { class: "v-bar-label", text: MON[i] }),
            bar(v, maxMon, "v-month"),
            h("span", { class: "v-bar-val", text: fmtMoney(v) })))))));
}

function list(ctx, shown, total, rerender) {
  const { h } = ctx;
  const groups = [];
  for (const c of shown) {
    const key = c.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = { key, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  return h("div", { class: "v-list" },
    groups.map((g) => h("section", { class: "v-month-group", "aria-label": `${MONTHS[Number(g.key.slice(5)) - 1]} ${g.key.slice(0, 4)}` },
      h("h3", { class: "v-month-h", text: `${MONTHS[Number(g.key.slice(5)) - 1]} ${g.key.slice(0, 4)}` }),
      h("ul", { class: "v-entries" }, g.items.map((c) => entry(ctx, c, rerender))))),
    total > shown.length
      ? h("button", { type: "button", class: "btn", "data-fk": "v-hist-more",
          onclick: () => { S.limit += 50; S.pending = "v-hist-more"; rerender(); },
          text: `Show more (${total - shown.length} older)` })
      : null);
}

function entry(ctx, c, rerender) {
  const { h } = ctx;
  const skipped = c.kind === "skipped";
  const who = whoName(c, ctx);
  const meta = [];
  if (!skipped && c.cost != null) meta.push(fmtMoney(c.cost));
  if (c.odometer != null) meta.push(`${Number(c.odometer).toLocaleString()} mi`);
  if (who) meta.push(`${skipped ? "Skipped" : "Done"} by ${who}`);
  const photos = (c.photoIds || []).map((pid, i) => {
    const img = h("img", { class: "v-thumb-img", alt: "", width: "64", height: "64" });
    Promise.resolve(ctx.photos.url(pid)).then((u) => { if (u) img.setAttribute("src", u); }).catch(() => {});
    return h("button", {
      type: "button", class: "v-thumb", "data-fk": `thumb-${pid}`,
      "aria-label": `Enlarge photo ${i + 1} of ${c.photoIds.length} for ${c.title}`,
      onclick: () => { S.viewer = { id: pid, title: c.title }; rerender(); },
    }, img);
  });
  return h("li", { class: `v-entry${skipped ? " v-skipped" : ""}` },
    h("div", { class: "v-entry-top" },
      h("span", { class: "v-date", text: fmtDate(c.date) }),
      h("span", { class: `badge cat-${c.category}`, text: CAT[c.category] || c.category }),
      skipped ? h("span", { class: "v-badge v-badge-skip", text: "Skipped" }) : null),
    h("p", { class: "v-entry-title", text: c.title }),
    meta.length ? h("p", { class: "v-meta", text: meta.join(" · ") }) : null,
    c.notes ? h("p", { class: "v-notes", text: c.notes }) : null,
    photos.length ? h("div", { class: "v-thumbs" }, photos) : null);
}

function viewer(ctx, rerender) {
  const { h } = ctx;
  const v = S.viewer;
  const close = () => { S.pending = `thumb-${v.id}`; S.viewer = null; rerender(); };
  const img = h("img", { class: "v-viewer-img", alt: `Photo for ${v.title}` });
  const msg = h("p", { class: "v-hint", text: "Loading photo…" });
  Promise.resolve(ctx.photos.url(v.id)).then((u) => {
    if (u) { img.setAttribute("src", u); msg.textContent = ""; } else msg.textContent = "This photo isn't available on this device.";
  }).catch(() => { msg.textContent = "This photo couldn't be loaded."; });
  const dlg = h("dialog", { class: "v-viewer", "aria-label": `Photo for ${v.title}` },
    h("h3", { class: "v-h3", text: v.title }), img, msg,
    h("div", { class: "dialog-actions" },
      h("button", { type: "button", class: "btn v-primary", text: "Close", onclick: close })));
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  return dlg;
}

export default { id, label, render };
