// Pure "insight" calculations for the Today, Insights and binder views. Every function takes `today`
// ("YYYY-MM-DD", local) explicitly and never mutates its input.
import { dueInfo, statusOf, sortTasks, addDays, daysBetween, summary, warrantyAlerts, spend } from "./logic.js";
import { readiness } from "./readiness.js";
import { money, fmtNum } from "./dom.js";

const CATS = ["car", "house", "yard", "emergency"];
export const CAT_LABEL = { car: "Car", house: "House", yard: "Yard", emergency: "Emergency" };

/** Tasks that need attention now: overdue first, then due within `withinDays` (default 7). Snoozed tasks are left out. */
export function agenda(state, today, withinDays = 7) {
  const tasks = Array.isArray(state.tasks) ? state.tasks : [];
  const rows = [];
  for (const t of sortTasks(tasks, today, state)) {
    const status = statusOf(t, today, state);
    if (status === "snoozed") continue;
    const info = dueInfo(t, state, today);
    const days = info.daysUntil ?? 0;
    if (status === "overdue") rows.push({ task: t, status, info, days, bucket: "overdue" });
    else if (days <= withinDays) rows.push({ task: t, status, info, days, bucket: days === 0 ? "today" : "week" });
  }
  return {
    overdue: rows.filter((r) => r.bucket === "overdue"),
    today: rows.filter((r) => r.bucket === "today"),
    week: rows.filter((r) => r.bucket === "week"),
  };
}

const emergencyInfoFilled = (state) => {
  const e = state.emergency || {};
  const sh = e.shutoffs || {};
  const parts = [(e.contacts || []).length > 0, !!e.meetingPlace, !!e.outOfAreaContact, !!sh.water, !!sh.gas, !!sh.electric];
  return parts.filter(Boolean).length / parts.length;
};

/**
 * One 0-100 number for the whole home: 50% maintenance, 30% emergency supplies, 20% emergency info sheet.
 * `fixes` lists up to three concrete next steps, most valuable first: { text, tab }.
 */
export function homeScore(state, today) {
  const s = summary(state, today);
  const live = s.overdue + s.dueSoon + s.ok;
  const taskPct = live === 0 ? 100 : Math.max(0, Math.round(100 * (1 - (s.overdue + 0.35 * s.dueSoon) / live)));
  const r = readiness(state, today);
  const infoPct = Math.round(100 * emergencyInfoFilled(state));
  const score = Math.round(0.5 * taskPct + 0.3 * r.score + 0.2 * infoPct);

  const fixes = [];
  if (s.overdue > 0) fixes.push({ weight: 50 * s.overdue / Math.max(1, live), text: `Catch up on ${s.overdue} overdue ${s.overdue === 1 ? "task" : "tasks"}`, tab: "tasks" });
  const missing = r.items.filter((i) => i.status === "missing");
  if (missing.length) fixes.push({ weight: 30 * missing.length / Math.max(1, r.items.length), text: `Stock ${missing.length} missing emergency ${missing.length === 1 ? "supply" : "supplies"}, starting with ${missing[0].label.split(" (")[0].toLowerCase()}`, tab: "emergency" });
  if (r.expired.length) fixes.push({ weight: 12, text: `Replace ${r.expired.length} expired ${r.expired.length === 1 ? "supply" : "supplies"}`, tab: "emergency" });
  if (infoPct < 100) fixes.push({ weight: 20 * (100 - infoPct) / 100, text: "Finish the emergency info sheet (contacts, meeting place, shut-offs)", tab: "emergency" });
  if (s.dueSoon > 0) fixes.push({ weight: 17 * s.dueSoon / Math.max(1, live), text: `${s.dueSoon} ${s.dueSoon === 1 ? "task is" : "tasks are"} due soon`, tab: "tasks" });
  const w = warrantyAlerts(state, today, 60).filter((x) => x.daysLeft >= 0);
  if (w.length) fixes.push({ weight: 4, text: `${w[0].item.name} warranty expires in ${w[0].daysLeft} ${w[0].daysLeft === 1 ? "day" : "days"}, so check it over now`, tab: "inventory" });
  fixes.sort((a, b) => b.weight - a.weight);

  const band = score >= 85 ? "great" : score >= 65 ? "ok" : "needs-work";
  return { score, band, parts: { maintenance: taskPct, supplies: r.score, info: infoPct }, fixes: fixes.slice(0, 3).map(({ text, tab }) => ({ text, tab })) };
}

// ---------- seasonal nudges ----------
export const CLIMATES = ["cold", "mild", "hot"];
// month 1-12 -> list of {climate: "cold"|"mild"|"hot"|"all", text, category}
const SEASON = {
  1: [["cold", "Check pipes in unheated spaces during hard freezes", "house"], ["all", "Test smoke and CO alarms", "house"]],
  2: [["cold", "Clear snow and ice from roof edges and vents", "house"], ["all", "Plan spring yard and garden work", "yard"]],
  3: [["cold", "Spring thaw: check the basement and crawl space for water", "house"], ["all", "Service the lawn mower before the season", "yard"], ["hot", "Get the A/C tuned before the heat arrives", "house"]],
  4: [["all", "Clean gutters and check the roof after winter", "house"], ["cold", "Turn outdoor faucets and sprinklers back on", "yard"], ["all", "Check tire tread and pressure for road-trip season", "car"]],
  5: [["hot", "Change A/C filters and clear around the outdoor unit", "house"], ["all", "Inspect deck and fence, then reseal if needed", "yard"]],
  6: [["hot", "Check the car battery and coolant before peak heat", "car"], ["all", "Check emergency supplies for summer storms", "emergency"]],
  7: [["hot", "Keep water stored and check supplies for heat waves", "emergency"], ["all", "Water the lawn deeply and early in the morning", "yard"]],
  8: [["all", "Check for wasps and pests around the house", "house"], ["all", "Back-to-school: refresh the family emergency plan", "emergency"]],
  9: [["cold", "Schedule the furnace tune-up", "house"], ["all", "Clean gutters before leaves pile up", "house"], ["cold", "Test the generator or backup power", "emergency"]],
  10: [["cold", "Winterize sprinklers and outdoor faucets before the first freeze", "yard"], ["cold", "Swap to winter tires and test the car battery", "car"], ["all", "Replace smoke alarm batteries when clocks change", "house"]],
  11: [["cold", "Put winter kit in the car: blanket, scraper, jumper cables", "car"], ["cold", "Stock ice melt and check the snow shovel", "yard"], ["all", "Reverse ceiling fans and seal drafts", "house"]],
  12: [["cold", "Check pipes and insulation before the hard freezes", "house"], ["all", "Review your emergency supplies before the holidays", "emergency"], ["all", "Check holiday lights and outlets for safe loads", "house"]],
};

/** Up to `max` reminders for this month. `climate` is profile.climate ("cold" default). Items already covered by a task title are skipped. */
export function seasonNudges(state, today, max = 4) {
  const month = +today.slice(5, 7);
  const climate = CLIMATES.includes(state.profile && state.profile.climate) ? state.profile.climate : "cold";
  const titles = (state.tasks || []).map((t) => String(t.title).toLowerCase());
  const covered = (text) => {
    const words = text.toLowerCase().match(/[a-z]{5,}/g) || [];
    return titles.some((t) => words.filter((w) => t.includes(w)).length >= 2);
  };
  return (SEASON[month] || [])
    .filter(([c]) => c === "all" || c === climate)
    .map(([, text, category]) => ({ text, category }))
    .filter((n) => !covered(n.text))
    .slice(0, max);
}

// ---------- mileage flags ----------
/** Mileage tasks that will be due soon by miles: [{task, vehicle, milesLeft, days}] sorted by miles left. */
export function mileageFlags(state, today, { miles = 500, days = 21 } = {}) {
  const out = [];
  for (const t of state.tasks || []) {
    if (t.kind !== "mileage" || (t.snoozedUntil && t.snoozedUntil > today)) continue;
    const info = dueInfo(t, state, today);
    if (info.milesLeft == null) continue;
    const near = info.milesLeft <= miles || (info.daysUntil != null && info.daysUntil <= days);
    if (!near) continue;
    const vehicle = (state.vehicles || []).find((v) => v.id === t.vehicleId) || null;
    out.push({ task: t, vehicle, milesLeft: info.milesLeft, days: info.daysUntil, dueDate: info.dueDate });
  }
  return out.sort((a, b) => a.milesLeft - b.milesLeft);
}

/** Vehicles with mileage reminders whose odometer reading is older than `days`, so those reminders are going stale. */
export function staleOdometers(state, today, days = 30) {
  const withMileage = new Set((state.tasks || []).filter((t) => t.kind === "mileage").map((t) => t.vehicleId));
  const out = [];
  for (const v of state.vehicles || []) {
    if (!withMileage.has(v.id)) continue;
    const age = v.odometerDate ? daysBetween(v.odometerDate, today) : 9999;
    if (age >= days) out.push({ vehicle: v, ageDays: age });
  }
  return out;
}

// ---------- workload ----------
/** Per person: how many open, overdue, due-soon tasks. `nameOf(id)` turns an assignee id into a display name. */
export function workload(state, today, nameOf = (id) => id) {
  const map = new Map();
  const row = (key) => {
    if (!map.has(key)) map.set(key, { id: key, name: key === null ? "Unassigned" : nameOf(key), open: 0, overdue: 0, dueSoon: 0, done90: 0, tasks: [] });
    return map.get(key);
  };
  for (const t of state.tasks || []) {
    const status = statusOf(t, today, state);
    if (status === "snoozed") continue;
    const r = row(t.assignee || null);
    r.open++;
    if (status === "overdue") r.overdue++;
    if (status === "due-soon") r.dueSoon++;
    if (status === "overdue" || status === "due-soon") r.tasks.push(t);
  }
  const since = addDays(today, -90);
  for (const c of state.completions || []) {
    if (c.kind !== "done" || c.date < since || c.date > today) continue;
    const key = c.by || null;
    if (map.has(key) || c.by) row(key).done90++;
  }
  return [...map.values()].sort((a, b) => (b.overdue - a.overdue) || (b.open - a.open) || a.name.localeCompare(b.name));
}

// ---------- spending ----------
/** Years that have cost data, newest first. */
export function spendYears(state) {
  const ys = new Set();
  for (const c of state.completions || []) if (c.kind === "done" && typeof c.cost === "number" && c.cost > 0) ys.add(String(c.date).slice(0, 4));
  return [...ys].sort().reverse();
}

/** [{year, total, byCategory}] oldest to newest, plus % change vs the previous year when both exist. */
export function spendTrend(state) {
  const years = spendYears(state).slice().reverse();
  return years.map((y, i) => {
    const s = spend(state, y);
    const prev = i > 0 ? spend(state, years[i - 1]).total : null;
    return { year: y, total: s.total, byCategory: s.byCategory, change: prev && prev > 0 ? Math.round(((s.total - prev) / prev) * 100) : null };
  });
}

/** Cost per linked item (via the task's itemId), highest first, with a replace-or-repair hint when an item has cost a lot. */
export function costByItem(state, { hintAt = 300 } = {}) {
  const taskItem = new Map((state.tasks || []).filter((t) => t.itemId).map((t) => [t.id, t.itemId]));
  const totals = new Map();
  for (const c of state.completions || []) {
    if (c.kind !== "done" || typeof c.cost !== "number" || !(c.cost > 0)) continue;
    const id = taskItem.get(c.taskId);
    if (!id) continue;
    const r = totals.get(id) || { total: 0, count: 0 };
    r.total += c.cost; r.count++;
    totals.set(id, r);
  }
  const items = new Map((state.items || []).map((i) => [i.id, i]));
  return [...totals.entries()]
    .filter(([id]) => items.has(id))
    .map(([id, r]) => ({ item: items.get(id), total: Math.round(r.total * 100) / 100, count: r.count, hint: r.total >= hintAt ? "Costly to keep up. If it's old, compare with replacing it." : null }))
    .sort((a, b) => b.total - a.total);
}

/** Cost per vehicle (via the task's vehicleId): all time and for `year`, highest first. */
export function costByVehicle(state, year) {
  const taskVeh = new Map((state.tasks || []).filter((t) => t.vehicleId).map((t) => [t.id, t.vehicleId]));
  const totals = new Map();
  for (const c of state.completions || []) {
    if (c.kind !== "done" || typeof c.cost !== "number" || !(c.cost > 0)) continue;
    const id = taskVeh.get(c.taskId);
    if (!id) continue;
    const r = totals.get(id) || { total: 0, thisYear: 0, count: 0 };
    r.total += c.cost; r.count++;
    if (year && String(c.date).startsWith(String(year))) r.thisYear += c.cost;
    totals.set(id, r);
  }
  const vs = new Map((state.vehicles || []).map((v) => [v.id, v]));
  const r2 = (n) => Math.round(n * 100) / 100;
  return [...totals.entries()].filter(([id]) => vs.has(id))
    .map(([id, r]) => ({ vehicle: vs.get(id), total: r2(r.total), thisYear: r2(r.thisYear), count: r.count }))
    .sort((a, b) => b.total - a.total);
}

// ---------- reminder digest ----------
/** Plain-text weekly digest: what's overdue, due this week, expiring, season tip. Used by the copy/email button and scheduled digests. */
export function digestText(state, today, nameOf = (id) => id) {
  const a = agenda(state, today, 7);
  const lines = [`Man of the House: week of ${today}`, ""];
  const fmt = (r) => `- ${r.task.title}${r.task.assignee ? ` (${nameOf(r.task.assignee)})` : ""}: ${r.bucket === "overdue" ? `${-r.days} day${-r.days === 1 ? "" : "s"} overdue` : r.days === 0 ? "due today" : `due in ${r.days} day${r.days === 1 ? "" : "s"}`}`;
  if (a.overdue.length) lines.push("OVERDUE", ...a.overdue.map(fmt), "");
  if (a.today.length || a.week.length) lines.push("DUE THIS WEEK", ...[...a.today, ...a.week].map(fmt), "");
  if (!a.overdue.length && !a.today.length && !a.week.length) lines.push("Nothing is overdue or due this week.", "");
  const r = readiness(state, today);
  if (r.expired.length || r.expiring.length) {
    lines.push("SUPPLIES");
    for (const s of r.expired) lines.push(`- ${s.name}: expired ${s.expires}`);
    for (const e of r.expiring) lines.push(`- ${e.supply.name}: expires in ${e.daysLeft} ${e.daysLeft === 1 ? "day" : "days"}`);
    lines.push("");
  }
  const w = warrantyAlerts(state, today, 30).filter((x) => x.daysLeft >= 0);
  if (w.length) lines.push("WARRANTIES", ...w.map((x) => `- ${x.item.name}: warranty expires in ${x.daysLeft} ${x.daysLeft === 1 ? "day" : "days"}`), "");
  const n = seasonNudges(state, today, 2);
  if (n.length) lines.push("THIS MONTH", ...n.map((x) => `- ${x.text}`), "");
  const hs = homeScore(state, today);
  lines.push(`Home score: ${hs.score}/100`);
  return lines.join("\n");
}

// ---------- home binder ----------
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function binderModel(state, today) {
  const items = (state.items || []).map((it) => {
    const tasks = (state.tasks || []).filter((t) => t.itemId === it.id);
    const vendors = (state.vendors || []).filter((v) => (v.itemIds || []).includes(it.id));
    const cost = costByItem(state).find((c) => c.item.id === it.id);
    return { it, tasks, vendors, spent: cost ? cost.total : 0 };
  });
  const done = (state.completions || []).filter((c) => c.kind === "done").slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  return { items, done, vendors: state.vendors || [], vehicles: state.vehicles || [], supplies: state.supplies || [], e: state.emergency || {}, total: spend(state).total, today };
}

/** Printable "home binder" as a standalone HTML page (inline CSS, no scripts). Safe to save as .html and print to PDF. */
export function binderHTML(state, today) {
  const m = binderModel(state, today);
  const sh = m.e.shutoffs || {};
  const row = (cells) => `<tr>${cells.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`;
  const table = (head, rows) => rows.length
    ? `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map(row).join("")}</tbody></table>`
    : "<p class=\"none\">None recorded.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Home binder ${esc(today)}</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:14px/1.45 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#222}h1{font-size:1.6rem}h2{font-size:1.1rem;border-bottom:2px solid #2f5d3a;padding-bottom:.2rem;margin-top:1.6rem}table{border-collapse:collapse;width:100%;margin:.4rem 0}th,td{border:1px solid #bbb;padding:.3rem .5rem;text-align:left;vertical-align:top}th{background:#eee}.none{color:#666}@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body>
<h1>Home binder</h1><p>Prepared ${esc(today)}. Keep a copy for insurance, a sale, or an emergency.</p>
<h2>Emergency information</h2>
${table(["Water shut-off", "Gas shut-off", "Electric shut-off", "Meeting place", "Out-of-area contact"], [[sh.water || "-", sh.gas || "-", sh.electric || "-", m.e.meetingPlace || "-", m.e.outOfAreaContact || "-"]])}
${table(["Contact", "Phone", "Relationship"], (m.e.contacts || []).map((c) => [c.name, c.phone, c.relation]))}
<h2>Appliances and home systems</h2>
${table(["Item", "Type", "Location", "Model", "Purchased", "Warranty ends", "Spent on upkeep", "Service contacts"], m.items.map(({ it, vendors, spent }) => [it.name, it.kind, it.location, it.model, it.purchaseDate || "-", it.warrantyExpires || "-", spent ? money(spent) : "-", vendors.map((v) => `${v.name}${v.phone ? " " + v.phone : ""}`).join("; ") || "-"]))}
<h2>Vehicles</h2>
${table(["Vehicle", "Odometer", "As of"], m.vehicles.map((v) => [v.name, fmtNum(v.odometer) + " mi", v.odometerDate]))}
<h2>Vendors and contractors</h2>
${table(["Name", "Trade", "Phone", "Email", "Notes"], m.vendors.map((v) => [v.name, v.trade, v.phone, v.email, v.notes]))}
<h2>Emergency supplies</h2>
${table(["Supply", "Quantity", "Expires"], m.supplies.map((s) => [s.name, `${s.quantity} ${s.unit || ""}`.trim(), s.expires || "-"]))}
<h2>Maintenance history (most recent 60)</h2>
${table(["Date", "Task", "Area", "Cost", "Notes"], m.done.slice(0, 60).map((c) => [c.date, c.title, CAT_LABEL[c.category] || c.category, typeof c.cost === "number" ? money(c.cost) : "-", c.notes]))}
<p>Total recorded spending: ${esc(money(m.total))}</p>
</body></html>`;
}

/** Same content as plain text (for copy/paste). */
export function binderText(state, today) {
  const m = binderModel(state, today);
  const sh = m.e.shutoffs || {};
  const L = [`HOME BINDER, ${today}`, "", "EMERGENCY", `Water shut-off: ${sh.water || "-"}`, `Gas shut-off: ${sh.gas || "-"}`, `Electric shut-off: ${sh.electric || "-"}`, `Meeting place: ${m.e.meetingPlace || "-"}`, `Out-of-area contact: ${m.e.outOfAreaContact || "-"}`];
  for (const c of m.e.contacts || []) L.push(`- ${c.name} ${c.phone} (${c.relation})`);
  L.push("", "APPLIANCES AND SYSTEMS");
  for (const { it, vendors, spent } of m.items) L.push(`- ${it.name} [${it.kind}] ${it.location} model ${it.model || "-"}; warranty ends ${it.warrantyExpires || "-"}; spent ${spent ? money(spent) : "-"}${vendors.length ? "; service: " + vendors.map((v) => v.name).join(", ") : ""}`);
  L.push("", "VEHICLES");
  for (const v of m.vehicles) L.push(`- ${v.name}: ${fmtNum(v.odometer)} mi as of ${v.odometerDate}`);
  L.push("", "VENDORS");
  for (const v of m.vendors) L.push(`- ${v.name} (${v.trade}) ${v.phone} ${v.email}`.trimEnd());
  L.push("", `Total recorded spending: ${money(m.total)}`);
  return L.join("\n");
}

