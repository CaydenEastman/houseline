// Practice drills, go-bag lists and the yearly "state of the house" review. Pure functions, no DOM.
import { dueInfo, statusOf, addTask, spend, daysBetween, addDays } from "./logic.js";
import { readiness } from "./readiness.js";
import { staleOdometers } from "./insights.js";

// ---------- drills ----------
// A drill is an ordinary recurring task (so it shows up on Today and in History), found by its tag or exact title.
export const DRILLS = [
  { title: "Practice fire escape drill", intervalDays: 180, notes: "Rehearse two exits from every bedroom and a meeting spot outside. Time it.", tags: ["safety", "plan", "drill"] },
  { title: "Test smoke and CO detectors", intervalDays: 30, notes: "Press the test button on every unit.", tags: ["safety", "smoke", "drill"], existingTitle: true },
  { title: "Practice shutting off water, gas and power", intervalDays: 365, notes: "Everyone who can should find and operate each shutoff. Check the wrench is where it should be.", tags: ["plan", "drill"] },
  { title: "Practice your shelter plan (storm or earthquake)", intervalDays: 365, notes: "Where does each person go? Drop, cover and hold on, or the safe room. Walk through it.", tags: ["plan", "drill"] },
  { title: "Drive your evacuation route", intervalDays: 365, notes: "Know two ways out of the neighborhood and where you would go. Keep the gas tank above half.", tags: ["plan", "drill"] },
  { title: "Run a family check-in call test", intervalDays: 180, notes: "Everyone calls or texts the out-of-area contact. Make sure they know the plan.", tags: ["plan", "drill"] },
];
const DRILL_TITLES = new Set(DRILLS.map((d) => d.title));

const isDrill = (t) => (t.tags || []).includes("drill") || DRILL_TITLES.has(t.title);

/** Each drill with its task (if you have one), when it was last practiced and how it stands. */
export function drillStatus(state, today) {
  const out = [];
  for (const d of DRILLS) {
    const task = (state.tasks || []).find((t) => t.title === d.title) || null;
    let last = null, status = null, days = null;
    if (task) {
      const done = (state.completions || []).filter((c) => c.taskId === task.id && c.kind === "done").map((c) => c.date).sort();
      last = done.length ? done[done.length - 1] : task.lastDone || null;
      try { status = statusOf(task, today, state); days = dueInfo(task, state, today).daysUntil; } catch { /* odd data: show without status */ }
    }
    out.push({ drill: d, task, last, status, days });
  }
  return out;
}

/** Adds any standard drill you don't have yet. Returns { state, added }. */
export function addMissingDrills(state, idFn) {
  let next = state, added = 0;
  const have = new Set((state.tasks || []).map((t) => t.title));
  for (const d of DRILLS) {
    if (have.has(d.title)) continue;
    next = addTask(next, { title: d.title, category: d.title.startsWith("Test smoke") ? "house" : "emergency", kind: "interval", intervalDays: d.intervalDays, notes: d.notes, tags: d.tags }, idFn);
    added++;
  }
  return { state: next, added };
}
export const drillCount = (state) => (state.tasks || []).filter(isDrill).length;

// ---------- go-bag lists ----------
export const BAG_PRESETS = {
  adult: ["Water (1 liter)", "Snacks or energy bars", "Phone charger and power bank", "Flashlight and batteries", "Cash in small bills", "Copies of ID and insurance papers", "Medications (3 days)", "Change of clothes and sturdy shoes", "Rain poncho or warm layer", "First-aid basics", "Whistle", "Dust mask"],
  child: ["Water", "Snacks", "Change of clothes and shoes", "Comfort item or small toy", "Medications (3 days)", "Family photo and contact card", "Diapers or wipes if needed", "Flashlight"],
  pet: ["Food (3 days)", "Water and a bowl", "Leash or carrier", "Medications", "Vaccine and vet records", "Waste bags", "Photo of you with your pet", "Familiar blanket or toy"],
};
export const bagFromPreset = (kind) => (BAG_PRESETS[kind] || BAG_PRESETS.adult).map((t) => ({ t, ok: false }));
export const bagProgress = (bag) => { const all = (bag || []).length; return { all, ok: (bag || []).filter((b) => b.ok).length }; };

// ---------- yearly review ----------
const LIFE = [
  [/water heater/i, "Water heater", 12], [/furnace|boiler/i, "Furnace", 18], [/air condition|\bA\/?C\b|heat pump/i, "Air conditioner", 14],
  [/roof/i, "Roof", 25], [/dishwasher/i, "Dishwasher", 10], [/refrigerator|fridge/i, "Refrigerator", 13], [/washer|dryer/i, "Washer or dryer", 12],
  [/smoke|co detector|carbon monoxide/i, "Detector", 10], [/garage door opener/i, "Garage door opener", 15], [/sump pump/i, "Sump pump", 10],
];
const yearsBetween = (aISO, bISO) => Math.floor(daysBetween(aISO, bISO) / 365.25);

/** What to look at once a year: { year, sections: [{ title, lines: [text] }] }. Empty sections are left out. */
export function houseReview(state, today) {
  const year = Number(today.slice(0, 4));
  const sections = [];
  const add = (title, lines) => { if (lines.length) sections.push({ title, lines }); };

  const overdue = [];
  for (const t of state.tasks || []) {
    try { if (statusOf(t, today, state) === "overdue") overdue.push({ t, d: dueInfo(t, state, today).daysUntil ?? 0 }); } catch { /* skip */ }
  }
  overdue.sort((a, b) => a.d - b.d);
  add("Overdue right now", overdue.length ? [`${overdue.length} overdue. Most behind: ${overdue.slice(0, 5).map((x) => x.t.title).join(", ")}.`] : []);

  const doneThis = (state.completions || []).filter((c) => c.kind === "done" && c.date.startsWith(String(year))).length;
  const sNow = spend(state, year), sPrev = spend(state, year - 1);
  const lines = [`${doneThis} ${doneThis === 1 ? "task" : "tasks"} finished so far in ${year}.`];
  if (sNow.total > 0 || sPrev.total > 0) lines.push(`Recorded spending: $${sNow.total.toFixed(2)} in ${year}, $${sPrev.total.toFixed(2)} in ${year - 1}.`);
  add("The year so far", lines);

  const aging = [];
  for (const it of state.items || []) {
    if (!it.purchaseDate) continue;
    const rule = LIFE.find(([re]) => re.test(it.name));
    if (!rule) continue;
    const age = yearsBetween(it.purchaseDate, today);
    if (age >= Math.round(rule[2] * 0.8)) aging.push(`${it.name}: about ${age} years old (these often last ${rule[2]} or so). Worth budgeting for a replacement.`);
  }
  add("Getting old", aging);

  const warr = [];
  for (const it of state.items || []) {
    if (!it.warrantyExpires) continue;
    const left = daysBetween(today, it.warrantyExpires);
    if (left >= 0 && left <= 120) warr.push(`${it.name}: warranty ends in ${left} days. Use it if something is wrong.`);
    else if (left < 0 && left >= -60) warr.push(`${it.name}: warranty ended recently.`);
  }
  add("Warranties", warr);

  const em = [];
  try {
    const r = readiness(state, today);
    em.push(`Readiness ${r.score} out of 100.`);
    if (r.expired && r.expired.length) em.push(`Expired supplies: ${r.expired.map((s) => s.name).join(", ")}.`);
    if (r.expiring && r.expiring.length) em.push(`Expiring soon: ${r.expiring.map((e) => e.supply.name).join(", ")}.`);
  } catch { /* skip */ }
  const stale = drillStatus(state, today).filter((x) => !x.last || daysBetween(x.last, today) > 365 || (x.drill.intervalDays <= 180 && daysBetween(x.last, today) > x.drill.intervalDays * 2));
  const missing = stale.filter((x) => x.task);
  if (missing.length) em.push(`Not practiced lately: ${missing.map((x) => x.drill.title.replace(/^(Practice|Run a|Drive|Test) /, "").toLowerCase()).join("; ")}.`);
  const nBags = (state.people || []).filter((p) => !(p.bag && p.bag.length)).length;
  if ((state.people || []).length && nBags) em.push(`${nBags} ${nBags === 1 ? "person has" : "people have"} no go-bag list yet.`);
  add("Family preparedness", em);

  let odo = [];
  try { odo = staleOdometers(state, today).map((x) => `${x.vehicle.name}: mileage last updated ${x.ageDays} days ago.`); } catch { /* skip */ }
  add("Cars", odo);

  if (!sections.length) sections.push({ title: "All clear", lines: ["Nothing needs a closer look right now."] });
  return { year, sections };
}

export function reviewText(state, today) {
  const r = houseReview(state, today);
  return [`STATE OF THE HOUSE, ${today}`, "", ...r.sections.flatMap((s) => [s.title.toUpperCase(), ...s.lines.map((l) => `- ${l}`), ""])].join("\n").trim() + "\n";
}
