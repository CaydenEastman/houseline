// Insights view: who's doing what, spending trends, cost per item, home binder and weekly digest export.
import { workload, spendTrend, costByItem, binderHTML, binderText, digestText, CAT_LABEL } from "../insights.js";
import { previousMonth, currentMonth, monthlyRecap, recapText } from "../recap.js";
import { yearlyBudget, rangeText } from "../costs.js";
import { spend } from "../logic.js";
import { makePaint, plural, money } from "./shared.js";

export const id = "insights";
export const label = "Insights";
const S = { pending: null, showText: null, msg: "" };
const paint = makePaint(S);

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const nameOf = (pid) => (typeof ctx.personName === "function" ? ctx.personName(pid) : null) || "Someone";

  // ----- workload -----
  let wl = [];
  try { wl = workload(state, today, nameOf); } catch { /* bad dates in old data must not blank the whole view */ }
  const wlCard = h("section", { class: "v-panel", "aria-labelledby": "v-wl-h" },
    h("h3", { id: "v-wl-h", class: "v-h3", text: "Who has what" }),
    wl.length === 0 ? h("p", { class: "v-hint", text: "Add tasks to see the workload." })
      : h("table", { class: "v-table" },
        h("thead", {}, h("tr", {}, ["Person", "Open", "Overdue", "Due soon", "Done, last 90 days"].map((t) => h("th", { scope: "col", text: t })))),
        h("tbody", {}, wl.map((r) => h("tr", {},
          h("th", { scope: "row", text: r.name }),
          h("td", { text: String(r.open) }),
          h("td", { class: r.overdue ? "v-bad" : "", text: String(r.overdue) }),
          h("td", { text: String(r.dueSoon) }),
          h("td", { text: String(r.done90) }))))),
    state.tasks.some((t) => t.assignee) ? null : h("p", { class: "v-hint", text: "Assign tasks to people from the task form to split the load." }));

  // ----- spending -----
  const tr = spendTrend(state);
  const max = Math.max(1, ...tr.map((r) => r.total));
  const spendCard = h("section", { class: "v-panel", "aria-labelledby": "v-tr-h" },
    h("h3", { id: "v-tr-h", class: "v-h3", text: "Spending by year" }),
    tr.length === 0 ? h("p", { class: "v-hint", text: "Add a cost when you mark a task done and the trend shows up here." })
      : h("ul", { class: "v-bars", "aria-label": "Total spending per year" }, tr.map((r) => h("li", {},
        h("span", { class: "v-bar-label", text: r.year }),
        h("span", { class: "v-bar-track", "aria-hidden": "true" }, h("span", { class: "v-bar-fill", style: `width:${Math.round((r.total / max) * 100)}%` })),
        h("span", { class: "v-bar-val", text: `${money(r.total)}${r.change == null ? "" : ` (${r.change > 0 ? "+" : ""}${r.change}%)`}` })))),
    tr.length ? h("p", { class: "v-hint", text: "Percent change is compared with the year before." }) : null);
  const latest = tr[tr.length - 1];
  const catCard = latest ? h("section", { class: "v-panel", "aria-labelledby": "v-cat-h" },
    h("h3", { id: "v-cat-h", class: "v-h3", text: `${latest.year} by area` }),
    h("ul", { class: "v-plain" }, Object.entries(latest.byCategory).filter(([, v]) => v > 0).map(([k, v]) => h("li", { text: `${CAT_LABEL[k] || k}: ${money(v)}` })))) : null;

  const ci = costByItem(state);
  const itemCard = h("section", { class: "v-panel", "aria-labelledby": "v-ci-h" },
    h("h3", { id: "v-ci-h", class: "v-h3", text: "What costs the most to keep up" }),
    ci.length === 0 ? h("p", { class: "v-hint", text: "Link tasks to inventory items and record costs to see which appliances cost the most." })
      : h("ul", { class: "v-plain" }, ci.slice(0, 8).map((c) => h("li", {},
        h("strong", { text: c.item.name }), ` · ${money(c.total)} over ${plural(c.count, "job")}`,
        c.hint ? h("span", { class: "v-warn", text: ` ${c.hint}` }) : null))));

  // ----- estimated yearly upkeep -----
  const bud = yearlyBudget(state, today);
  const thisYear = today.slice(0, 4);
  const soFar = spend(state, thisYear).total;
  const rng = (l, hi) => (Math.round(l) === Math.round(hi) ? `$${Math.round(l).toLocaleString("en-US")}` : `$${Math.round(l).toLocaleString("en-US")} to $${Math.round(hi).toLocaleString("en-US")}`);
  const budCard = h("section", { class: "v-panel", "aria-labelledby": "v-bud-h" },
    h("h3", { id: "v-bud-h", class: "v-h3", text: "Estimated yearly upkeep" }),
    bud.items.length === 0 ? h("p", { class: "v-hint", text: "Add tasks to see a ballpark of what upkeep costs per year." }) : h("div", {},
      h("p", {}, h("span", { class: "v-total-num", text: rng(bud.low, bud.high) }), h("span", { class: "v-total", text: " per year" })),
      h("p", { class: "v-meta", text: `You've recorded ${money(soFar)} so far in ${thisYear}.` }),
      h("ul", { class: "v-plain" }, Object.entries(bud.byCategory).filter(([, v]) => v.high > 0).map(([k, v]) => h("li", { text: `${CAT_LABEL[k] || k}: ${rng(v.low, v.high)}` }))),
      h("h4", { class: "v-h5", text: "Biggest yearly costs" }),
      h("ul", { class: "v-plain" }, bud.items.slice(0, 5).map((x) => h("li", {},
        h("strong", { text: x.task.title.split(" — ")[0] }),
        ` · ${rng(x.low, x.high)} a year (${rangeText(x.per)} each, ${x.per.source === "yours" ? "from your own costs" : "typical price"})`)))),
    h("p", { class: "v-hint", text: `Ballpark only. Typical US prices: the low end is doing it yourself, the high end is hiring it out. Once you record real costs for a task, your own numbers replace the guess.${bud.uncounted ? ` ${plural(bud.uncounted, "task")} ${bud.uncounted === 1 ? "has" : "have"} no estimate and ${bud.uncounted === 1 ? "isn't" : "aren't"} counted.` : ""}` }));

  // ----- recap -----
  const prev = monthlyRecap(state, previousMonth(today), today);
  const cur = monthlyRecap(state, currentMonth(today), today);
  const recapBlock = (r, fk) => h("div", {},
    h("h4", { class: "v-h4", text: r.label }),
    h("p", { class: "v-recap", text: recapText(r) }),
    h("button", { type: "button", class: "btn v-small", "data-fk": fk, text: `Copy ${r.label} recap`, onclick: () => copy(recapText(r), `Copied the ${r.label} recap.`, fk) }));
  const recapCard = h("section", { class: "v-panel", "aria-labelledby": "v-recap-h" },
    h("h3", { id: "v-recap-h", class: "v-h3", text: "Monthly recap" }),
    cur.streak >= 2 ? h("p", { class: "v-score-band", text: `${cur.streak}-week streak` }) : null,
    recapBlock(cur, "v-recap-cur"), recapBlock(prev, "v-recap-prev"));

  // ----- exports -----
  const say = (m, fk) => { S.msg = m; S.pending = fk; rerender(); };
  const copy = async (text, ok, fk) => {
    try { await ctx.doc.defaultView.navigator.clipboard.writeText(text); say(ok, fk); }
    catch { S.showText = text; say("Copy isn't available here. Select the text below and copy it.", fk); }
  };
  const download = async (name, text, mime, fk) => {
    let ok = false;
    try { ok = await ctx.saveFile(name, text, mime); } catch { ok = false; }
    if (ok) say(`Saved ${name}.`, fk);
    else { S.showText = text; say("Downloads are blocked here. Copy the text below instead.", fk); }
  };
  const btn = (text, fk, fn) => h("button", { type: "button", class: "btn", text, "data-fk": fk, onclick: fn });
  const exportCard = h("section", { class: "v-panel", "aria-labelledby": "v-ex-h" },
    h("h3", { id: "v-ex-h", class: "v-h3", text: "Home binder and weekly digest" }),
    h("p", { class: "v-hint", text: "The binder gathers appliances, warranties, emergency info, contacts, vehicles and history in one printable page. Open the saved file and use your browser's Print to make a PDF." }),
    h("div", { class: "v-actions" },
      btn("Download home binder (.html)", "v-ex-binder", () => download(`home-binder-${today}.html`, binderHTML(state, today), "text/html", "v-ex-binder")),
      btn("Copy binder as text", "v-ex-btext", () => copy(binderText(state, today), "Copied the binder text.", "v-ex-btext"))),
    h("div", { class: "v-actions" },
      btn("Copy this week's digest", "v-ex-digest", () => copy(digestText(state, today, nameOf), "Copied the digest. Paste it into an email or text.", "v-ex-digest"))),
    h("p", { class: "v-hint", text: "The page can't send reminders on its own. To get the digest by email each week, ask Claude to set up a scheduled digest." }),
    S.msg ? h("p", { class: "v-hint", role: "status", text: S.msg }) : null,
    S.showText ? h("div", { class: "field" }, h("label", { for: "v-ex-area", text: "Text to copy" }),
      h("textarea", { id: "v-ex-area", rows: "8", readonly: true, "data-fk": "v-ex-area", text: S.showText })) : null);

  return h("section", { class: "v-view", "aria-labelledby": "v-ins-h" },
    h("h2", { id: "v-ins-h", class: "v-h2", text: "Insights" }), recapCard, budCard, wlCard, spendCard, catCard, itemCard, exportCard);
}

export default { id, label, render };
