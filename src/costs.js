// Ballpark cost estimates. NOT quotes: rough US prices where the low end is doing it yourself and the high end
// is hiring it out. Once you've recorded real costs for a task, your own numbers replace the guess. Pure.
import { estimateMilesPerDay } from "./logic.js";

// lowercase title (without the " — vehicle" suffix) -> [low, high] dollars per time it's done
const EST = {
  "oil change": [40, 100], "rotate tires": [0, 50], "check tire pressure": [0, 0], "replace engine air filter": [20, 50],
  "replace cabin air filter": [20, 60], "replace wiper blades": [20, 50], "check brakes and brake fluid": [0, 150],
  "test battery and clean terminals": [0, 30], "check coolant and fluid levels": [0, 20], "renew registration and emissions": [40, 200],
  "replace coolant": [100, 200], "service transmission fluid": [120, 300], "inspect trailer tires and lug nuts": [0, 0],
  "grease trailer wheel bearings": [0, 80], "test trailer lights and brakes": [0, 0], "check trailer hitch and safety chains": [0, 0],
  "replace hvac filter": [10, 40], "test smoke and co detectors": [0, 0], "flush water heater": [0, 150], "test gfci outlets": [0, 0],
  "clean dryer vent": [0, 150], "check fire extinguishers": [0, 40], "clean refrigerator coils": [0, 0], "inspect roof and attic": [0, 300],
  "run garbage disposal and clean drains": [0, 0], "clean dishwasher filter": [0, 0], "test garage door auto-reverse": [0, 0],
  "replace smoke detector batteries (fall)": [8, 20], "replace smoke detector batteries (spring)": [8, 20],
  "furnace service": [80, 200], "ac service": [80, 200], "clean gutters (fall)": [0, 200], "clean gutters (spring)": [0, 200],
  "disconnect hoses and shut off hose bibs": [0, 0], "chimney and fireplace inspection": [100, 300], "check caulk and weatherstripping": [5, 40],
  "test main water shutoff valve": [0, 0], "inspect appliance hoses and under-sink plumbing": [0, 40], "review renter's or ho6 insurance": [0, 0],
  "vet checkup and vaccinations": [60, 300], "flea and tick prevention": [15, 60], "refresh pet emergency supplies": [20, 60],
  "mow lawn": [0, 5], "winterize sprinklers": [0, 100], "start up sprinklers": [0, 100], "fertilize lawn": [20, 60], "aerate lawn": [0, 120],
  "trim trees and shrubs": [0, 300], "service lawn mower": [30, 100], "weed beds and refresh mulch": [30, 150], "clean up leaves": [0, 10],
  "test pool water chemistry": [5, 15], "clean pool filter": [0, 50], "open pool for the season": [50, 300], "close pool for the season": [50, 200],
  "inspect pool equipment and safety gear": [0, 100],
  "rotate emergency water": [10, 30], "check food storage": [20, 100], "check flashlights and batteries": [10, 30], "restock first aid kit": [15, 40],
  "review family emergency plan": [0, 0], "check go-bags": [20, 60], "test generator or backup power": [5, 25], "practice fire escape drill": [0, 0],
  "check fire extinguisher readiness": [0, 40], "refresh vehicle emergency kit": [20, 60], "review building evacuation route": [0, 0],
};

const baseTitle = (t) => String(t || "").split(" — ")[0].trim().toLowerCase();
const r2 = (n) => Math.round(n * 100) / 100;

/** { low, high, source: "yours" | "typical" } per time done, or null when there is no basis for a guess. */
export function estimateFor(task, state) {
  const costs = (state.completions || [])
    .filter((c) => c.kind === "done" && typeof c.cost === "number" && c.cost >= 0 && (c.taskId === task.id || (!c.taskId && baseTitle(c.title) === baseTitle(task.title))))
    .sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 3).map((c) => c.cost);
  if (costs.length) {
    // $0 (done yourself) counts. With 3 entries, one far-above-the-rest repair doesn't set the whole range.
    let use = costs;
    if (costs.length >= 3) {
      const med = [...costs].sort((a, b) => a - b)[1];
      const trimmed = costs.filter((x) => x <= Math.max(med * 3, 1));
      if (trimmed.length) use = trimmed;
    }
    return { low: r2(Math.min(...use)), high: r2(Math.max(...use)), source: "yours" };
  }
  const e = EST[baseTitle(task.title)];
  return e ? { low: e[0], high: e[1], source: "typical" } : null;
}

/** How many times a year the task comes due (rough). */
export function runsPerYear(task, state, today) {
  const kind = task.kind || "interval";
  if (kind === "annual") return 1;
  const byDays = task.intervalDays ? 365 / task.intervalDays : 0;
  if (kind === "mileage") {
    const v = (state.vehicles || []).find((x) => x.id === task.vehicleId);
    const rate = v ? estimateMilesPerDay(v, today).rate : 33;
    const byMiles = task.intervalMiles ? (rate * 365) / task.intervalMiles : 0;
    return Math.max(byMiles, byDays);
  }
  return byDays;
}

const fmt = (n) => `$${Math.round(n).toLocaleString("en-US")}`;
export function rangeText(e) {
  if (!e || (e.low === 0 && e.high === 0)) return "";
  if (e.low === e.high) return fmt(e.low);
  return `${fmt(e.low)} to ${fmt(e.high)}`;
}

/** Yearly upkeep guess for everything with an estimate. */
export function yearlyBudget(state, today) {
  const items = [];
  let uncounted = 0;
  const byCategory = {};
  let low = 0, high = 0;
  for (const t of state.tasks || []) {
    const e = estimateFor(t, state);
    if (!e) { uncounted++; continue; }
    const runs = runsPerYear(t, state, today);
    const l = e.low * runs, h = e.high * runs;
    low += l; high += h;
    const c = (byCategory[t.category] = byCategory[t.category] || { low: 0, high: 0 });
    c.low += l; c.high += h;
    if (h > 0) items.push({ task: t, low: l, high: h, runs, per: e });
  }
  items.sort((a, b) => b.high - a.high);
  return { low: Math.round(low), high: Math.round(high), byCategory, items, uncounted };
}
