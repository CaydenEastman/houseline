// "Home" and "You": two simple screens of big tiles that lead to the rest of the app.
// Tiles that need attention carry a small badge, so you can see what's waiting without opening each one.
import { plural } from "./shared.js";
import { summary, warrantyAlerts } from "../logic.js";
import { readiness } from "../readiness.js";
import { mileageFlags } from "../insights.js";

const attempt = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

function tiles(container, ctx, title, intro, list) {
  const { h } = ctx;
  container.replaceChildren(h("section", { class: "v-view hub", "aria-labelledby": "hub-h" },
    h("h2", { id: "hub-h", class: "v-h2", text: title }),
    intro ? h("p", { class: "v-hint", text: intro }) : null,
    h("ul", { class: "hub-grid" }, list.map((t) => h("li", {},
      h("button", { type: "button", class: "hub-tile", "data-fk": `hub-${t.id}`, "aria-label": t.badge ? `${t.label}, ${t.badge.text}` : null, onclick: t.onclick },
        h("span", { class: "hub-icon", "aria-hidden": "true", text: t.icon }),
        h("span", { class: "hub-text" }, h("strong", { text: t.label }), h("small", { text: t.sub })),
        t.badge ? h("span", { class: `hub-badge hub-badge-${t.badge.kind}`, "aria-hidden": "true", text: t.badge.n > 99 ? "99+" : String(t.badge.n) }) : null,
        h("span", { class: "hub-chev", "aria-hidden": "true", text: "›" })))))));
}

const go = (ctx, id) => () => ctx.setView(id, true);
const badge = (n, kind, text) => (n > 0 ? { n, kind, text } : null);

export const homeView = {
  id: "home", label: "Home",
  render(container, ctx) {
    const s = ctx.getState();
    const today = ctx.today();
    const sum = attempt(() => summary(s, today), { overdue: 0, dueSoon: 0 });
    const warr = attempt(() => warrantyAlerts(s, today), []).length;
    const ready = attempt(() => readiness(s, today), null);
    const supplyIssues = ready ? ready.expired.length + ready.expiring.length : 0;
    const milesDue = attempt(() => mileageFlags(s, today), []).filter((f) => f.milesLeft <= 0).length;
    const open = (s.supplies || []).length;
    tiles(container, ctx, "Home", "Everything you keep track of.", [
      { id: "tasks", icon: "✅", label: "All tasks", sub: plural((s.tasks || []).length, "task"), onclick: go(ctx, "tasks"), badge: badge(sum.overdue, "overdue", `${sum.overdue} overdue`) },
      { id: "inventory", icon: "\u{1F4E6}", label: "Inventory", sub: `${plural((s.items || []).length, "item")}, warranties and manuals`, onclick: go(ctx, "inventory"), badge: badge(warr, "soon", `${warr} warranty alerts`) },
      { id: "vehicles", icon: "\u{1F697}", label: "Vehicles", sub: `${plural((s.vehicles || []).length, "vehicle")} and mileage`, onclick: go(ctx, "vehicles"), badge: badge(milesDue, "overdue", `${milesDue} past due by mileage`) },
      { id: "vendors", icon: "\u{1F4DE}", label: "Vendors", sub: `${plural((s.vendors || []).length, "contact")}: plumber, electrician and more`, onclick: go(ctx, "vendors") },
      { id: "emergency", icon: "\u{1F6DF}", label: "Emergency", sub: `${open ? plural(open, "supply item") + " and " : ""}plans and contacts`, onclick: go(ctx, "emergency"), badge: badge(supplyIssues, "soon", `${supplyIssues} supply items expired or expiring`) },
    ]);
  },
};

export const youView = {
  id: "you", label: "You",
  render(container, ctx) {
    const s = ctx.getState();
    const n = (s.completions || []).length;
    const acct = ctx.account ? ctx.account() : null;
    tiles(container, ctx, "You", "Your history, numbers and settings.", [
      ...(acct ? [{ id: "account", icon: "\u{1F512}", label: "Account", sub: acct.signedIn ? `Signed in${acct.email ? " as " + acct.email : ""}` : "Sign in to back up and sync your phones", onclick: (e) => ctx.openSettings(e && e.currentTarget) }] : []),
      { id: "history", icon: "\u{1F4D6}", label: "History", sub: `${n === 1 ? "1 entry" : `${n} entries`} of what you've done`, onclick: go(ctx, "history") },
      { id: "insights", icon: "\u{1F4CA}", label: "Insights", sub: "Spending, yearly upkeep and your home binder", onclick: go(ctx, "insights") },
      { id: "settings", icon: "⚙️", label: "Settings", sub: "Theme, text size, backup, import and help", onclick: (e) => ctx.openSettings(e && e.currentTarget) },
    ]);
  },
};
