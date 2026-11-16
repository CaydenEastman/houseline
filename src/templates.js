// Task templates for "Man of the House". Pure data + seeding helpers.
// No clock reads: `today` is always a parameter.

export const CATEGORIES = ["car", "house", "yard", "emergency"];

const HOUSE = { homeType: ["house"] };
const YARD = { homeType: ["house"], hasYard: true };
const POOL = { homeType: ["house"], hasPool: true };
const CAR = { vehicle: true };
const MULTI = { homeType: ["condo", "apartment"] };

const tag = (...a) => a;

// interval
const iv = (category, title, intervalDays, notes, tags = [], requires) =>
  mk({ title, category, kind: "interval", intervalDays, notes, tags }, requires);
// annual (fixed calendar date; day 1..28)
const an = (category, title, month, day, notes, tags = [], requires) =>
  mk({ title, category, kind: "annual", month, day, notes, tags }, requires);
// mileage (+ optional time cap in days)
const mi = (title, intervalMiles, cap, notes, tags = [], requires = CAR) =>
  mk({ title, category: "car", kind: "mileage", intervalMiles, ...(cap ? { intervalDays: cap } : {}), notes, tags }, requires);

function mk(base, requires) {
  const o = { ...base };
  if (requires) o.requires = { ...requires };
  return o;
}

export const TEMPLATES = [
  // ---- Car (per vehicle) ----
  mi("Oil change", 5000, 180, "Or per your owner's manual (5,000-7,500 mi); at least every 6 months.", tag("oil", "engine")),
  mi("Rotate tires", 7500, null, "Helps tires wear evenly; check tread depth too.", tag("tires")),
  iv("car", "Check tire pressure", 30, "Check when cold; match the sticker inside the driver door.", tag("tires"), CAR),
  mi("Replace engine air filter", 15000, null, "Replace sooner if you drive in dusty conditions.", tag("filter")),
  mi("Replace cabin air filter", 15000, null, "Improves airflow and air quality inside the car.", tag("filter")),
  iv("car", "Replace wiper blades", 365, "Replace if streaking or chattering.", tag("wipers"), CAR),
  mi("Check brakes and brake fluid", 12000, null, "Listen for squealing; inspect pads and rotors.", tag("brakes")),
  an("car", "Test battery and clean terminals", 10, 1, "Have the battery load-tested before winter.", tag("battery"), CAR),
  iv("car", "Check coolant and fluid levels", 90, "Coolant, washer fluid, power steering, transmission.", tag("fluids"), CAR),
  an("car", "Renew registration and emissions", 1, 15, "Set to your actual renewal month/day; check inspection rules.", tag("registration"), CAR),
  mi("Replace coolant", 30000, null, "Flush and refill per your owner's manual.", tag("coolant", "fluids")),
  mi("Service transmission fluid", 60000, null, "Check your manual; some are sealed and have different intervals.", tag("transmission", "fluids")),

  // ---- Trailer ----
  iv("car", "Inspect trailer tires and lug nuts", 90, "Check pressure, cracks, and lug torque before long trips.", tag("trailer", "tires"), { hasTrailer: true }),
  an("car", "Grease trailer wheel bearings", 4, 1, "Repack or grease bearings; inspect seals.", tag("trailer"), { hasTrailer: true }),
  iv("car", "Test trailer lights and brakes", 180, "Check turn signals, brake lights, and brake controller.", tag("trailer"), { hasTrailer: true }),
  iv("car", "Check trailer hitch and safety chains", 180, "Inspect coupler, ball, chains, and breakaway cable.", tag("trailer"), { hasTrailer: true }),

  // ---- House ----
  iv("house", "Replace HVAC filter", 90, "Check monthly; replace when dirty.", tag("hvac", "filter")),
  iv("house", "Test smoke and CO detectors", 30, "Press the test button on every unit.", tag("safety", "smoke")),
  iv("house", "Flush water heater", 365, "Drain a few gallons to clear sediment.", tag("plumbing")),
  iv("house", "Test GFCI outlets", 90, "Press test and reset on each GFCI outlet.", tag("electrical", "safety")),
  iv("house", "Clean dryer vent", 365, "Reduces fire risk and improves drying time.", tag("laundry", "safety")),
  iv("house", "Check fire extinguishers", 365, "Confirm the gauge is in the green and the pin is intact.", tag("safety")),
  iv("house", "Clean refrigerator coils", 180, "Vacuum dust from coils to keep the fridge efficient.", tag("appliance")),
  iv("house", "Inspect roof and attic", 365, "Look for missing shingles, leaks, and pests.", tag("roof", "exterior"), HOUSE),
  iv("house", "Run garbage disposal and clean drains", 90, "Flush drains with hot water; avoid harsh chemicals.", tag("plumbing")),
  iv("house", "Clean dishwasher filter", 90, "Remove and rinse the filter; run a cleaning cycle.", tag("appliance")),
  iv("house", "Test garage door auto-reverse", 180, "Place a board in the path; the door must reverse.", tag("safety", "garage"), HOUSE),
  an("house", "Replace smoke detector batteries (fall)", 11, 1, "Swap batteries when the clocks change.", tag("safety", "smoke")),
  an("house", "Replace smoke detector batteries (spring)", 3, 10, "Swap batteries when the clocks change.", tag("safety", "smoke")),
  an("house", "Furnace service", 9, 15, "Annual inspection before heating season.", tag("hvac", "heating")),
  an("house", "AC service", 4, 15, "Annual tune-up before cooling season.", tag("hvac", "cooling")),
  an("house", "Clean gutters (fall)", 11, 1, "After leaves drop; check downspouts drain away from the house.", tag("gutters", "exterior"), HOUSE),
  an("house", "Clean gutters (spring)", 4, 15, "Clear debris; check for sagging or leaks.", tag("gutters", "exterior"), HOUSE),
  an("house", "Disconnect hoses and shut off hose bibs", 10, 20, "Drain outdoor faucets before the first freeze.", tag("plumbing", "winter"), HOUSE),
  an("house", "Chimney and fireplace inspection", 9, 1, "Sweep and inspect before the burning season.", tag("chimney", "heating"), HOUSE),
  an("house", "Check caulk and weatherstripping", 10, 1, "Seal gaps around windows and doors before winter.", tag("exterior", "winter"), HOUSE),
  an("house", "Test main water shutoff valve", 6, 1, "Turn it off and on so it doesn't seize.", tag("plumbing")),
  iv("house", "Inspect appliance hoses and under-sink plumbing", 180, "Look for drips, bulges, or corrosion at washer, dishwasher, and sinks.", tag("plumbing", "leaks"), MULTI),
  an("house", "Review renter's or HO6 insurance", 1, 15, "Confirm coverage and update your belongings list.", tag("insurance"), MULTI),

  // ---- Pets ----
  an("house", "Vet checkup and vaccinations", 5, 15, "Schedule the annual exam; keep records handy.", tag("pets"), { hasPets: true }),
  iv("house", "Flea and tick prevention", 30, "Give or apply preventive per your vet's advice.", tag("pets"), { hasPets: true }),
  iv("emergency", "Refresh pet emergency supplies", 180, "Food, water, meds, leash, carrier, and vet records.", tag("pets"), { hasPets: true }),

  // ---- Yard ----
  iv("yard", "Mow lawn", 7, "Weekly in growing season; never cut more than a third of the blade.", tag("lawn"), YARD),
  an("yard", "Winterize sprinklers", 10, 15, "Blow out lines before the first hard freeze.", tag("sprinklers", "winter"), YARD),
  an("yard", "Start up sprinklers", 4, 15, "Check heads, leaks, and timer settings.", tag("sprinklers"), YARD),
  iv("yard", "Fertilize lawn", 90, "Follow the schedule for your grass type.", tag("lawn"), YARD),
  an("yard", "Aerate lawn", 9, 15, "Best done in early fall for cool-season grass.", tag("lawn"), YARD),
  iv("yard", "Trim trees and shrubs", 180, "Remove dead branches and keep clear of the roof.", tag("trees"), YARD),
  iv("yard", "Service lawn mower", 365, "Sharpen blade, change oil, replace spark plug and air filter.", tag("mower"), YARD),
  iv("yard", "Weed beds and refresh mulch", 90, "Mulch 2-3 inches deep, away from trunks and foundation.", tag("garden"), YARD),
  iv("yard", "Clean up leaves", 14, "Rake or mulch leaves in fall to protect the lawn.", tag("lawn"), YARD),

  // ---- Pool ----
  iv("yard", "Test pool water chemistry", 7, "Check chlorine/pH/alkalinity and adjust.", tag("pool"), POOL),
  iv("yard", "Clean pool filter", 90, "Backwash or rinse cartridges per filter type.", tag("pool"), POOL),
  an("yard", "Open pool for the season", 5, 1, "Remove cover, balance water, start pump.", tag("pool"), POOL),
  an("yard", "Close pool for the season", 10, 1, "Balance water, lower level, winterize plumbing, cover.", tag("pool", "winter"), POOL),
  an("yard", "Inspect pool equipment and safety gear", 4, 20, "Pump, heater, fence gate latch, drain covers, life ring.", tag("pool", "safety"), POOL),

  // ---- Emergency ----
  iv("emergency", "Rotate emergency water", 365, "Store about 1 gallon per person per day; replace stored water.", tag("water")),
  iv("emergency", "Check food storage", 180, "Rotate by expiration date; use oldest first.", tag("food")),
  iv("emergency", "Check flashlights and batteries", 180, "Replace dead batteries; keep spares.", tag("power")),
  iv("emergency", "Restock first aid kit", 180, "Replace expired medications and used supplies.", tag("medical")),
  iv("emergency", "Review family emergency plan", 365, "Meeting places, contacts, evacuation routes.", tag("plan")),
  iv("emergency", "Check go-bags", 180, "Update clothing sizes, documents, cash, and medications.", tag("go-bag")),
  iv("emergency", "Test generator or backup power", 90, "Run under load; keep fuel fresh.", tag("power")),
  iv("emergency", "Practice fire escape drill", 180, "Rehearse two exits from every bedroom.", tag("safety", "plan")),
  iv("emergency", "Check fire extinguisher readiness", 365, "Keep one in the kitchen and one in the garage.", tag("safety")),
  iv("emergency", "Refresh vehicle emergency kit", 180, "Blanket, jumper cables, flares, water, snacks.", tag("car")),
  iv("emergency", "Review building evacuation route", 365, "Know both stairwells and the meeting point outside.", tag("plan", "safety"), MULTI),
];

export const SUPPLY_STARTERS = [
  { name: "Drinking water", key: "water", category: "water", unit: "gallons", notes: "1 gallon per person per day; rotate yearly." },
  { name: "Canned and shelf-stable food", key: "food", category: "food", unit: "meals", notes: "Rotate by expiration date." },
  { name: "Flashlights", key: "flashlights", category: "power", unit: "flashlights", notes: "" },
  { name: "Spare batteries", key: "batteries", category: "power", unit: "packs", notes: "Match your flashlights and radio." },
  { name: "First aid kit", key: "firstaid", category: "medical", unit: "kits", notes: "Check expiration dates." },
  { name: "Hand-crank or battery radio", key: "radio", category: "power", unit: "radios", notes: "" },
  { name: "Phone chargers / power bank", key: "powerbank", category: "power", unit: "power banks", notes: "Keep charged." },
  { name: "Prescription medications (7-day)", key: "medications", category: "medical", unit: "days' supply", notes: "Do not record account numbers here." },
  { name: "Emergency cash (small bills)", key: "cash", category: "docs", unit: "USD", notes: "" },
  { name: "Copies of important documents", key: "documents", category: "docs", unit: "sets", notes: "Do not store SSNs or account numbers in this app." },
  { name: "Whistle", key: "whistle", category: "tools", unit: "whistles", notes: "" },
  { name: "N95 masks", key: "masks", category: "medical", unit: "masks", notes: "" },
  { name: "Blankets or sleeping bags", key: "blankets", category: "other", unit: "blankets", notes: "" },
  { name: "Pet food and supplies", key: "pets", category: "other", unit: "days' supply", notes: "Food, water, meds, leash." },
  { name: "Fire extinguisher", key: null, category: "tools", unit: "each", notes: "Check the gauge yearly." },
];

const emptyTask = () => ({
  intervalDays: null, month: null, day: null, intervalMiles: null,
  lastDoneOdometer: null, vehicleId: null, lastDone: null, startDate: null,
  snoozedUntil: null, itemId: null, assignee: null,
});

function instantiate(tpl, id, extra = {}) {
  return {
    id,
    title: tpl.title,
    category: tpl.category,
    kind: tpl.kind,
    ...emptyTask(),
    ...(tpl.intervalDays != null ? { intervalDays: tpl.intervalDays } : {}),
    ...(tpl.month != null ? { month: tpl.month, day: tpl.day } : {}),
    ...(tpl.intervalMiles != null ? { intervalMiles: tpl.intervalMiles } : {}),
    links: [],
    tags: [...(tpl.tags || [])],
    notes: tpl.notes,
    custom: false,
    ...extra,
  };
}

/**
 * v1 behavior: one task per template (same order), ignoring `requires`.
 * NOTE: output for vehicle (mileage) templates has vehicleId null and is NOT state-valid;
 * use seedFromProfile for real seeding.
 */
export function seedTasks(idFn) {
  if (typeof idFn !== "function") throw new Error("seedTasks requires an id generator function");
  return TEMPLATES.map((tpl) => instantiate(tpl, String(idFn())));
}

function holds(tpl, p) {
  const r = tpl.requires;
  const homeType = p.homeType ?? "house";
  const hasYard = p.hasYard ?? true;
  if (tpl.category === "yard" && !hasYard) return false;
  if (!r) return true;
  if (r.homeType && !r.homeType.includes(homeType)) return false;
  if (r.hasYard != null && r.hasYard !== !!hasYard) return false;
  if (r.hasPool != null && r.hasPool !== !!p.hasPool) return false;
  if (r.hasTrailer != null && r.hasTrailer !== !!p.hasTrailer) return false;
  if (r.hasPets != null && r.hasPets !== !!p.hasPets) return false;
  return true; // `vehicle` requirement is resolved per vehicle by seedFromProfile
}

/** Templates applicable to a profile (vehicle templates are included; they are instantiated per vehicle). */
export function templatesFor(profile) {
  const p = profile && typeof profile === "object" ? profile : {};
  return TEMPLATES.filter((tpl) => holds(tpl, p));
}

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
function addDaysISO(iso, n) {
  const m = ISO_RE.exec(typeof iso === "string" ? iso : "");
  if (!m) throw new Error(`Invalid date "${iso}": expected YYYY-MM-DD`);
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
    throw new Error(`Invalid date "${iso}": no such calendar day`);
  }
  return new Date(ms + n * 86400000).toISOString().slice(0, 10);
}

/**
 * Build tasks for a profile. Vehicle templates are instantiated once per vehicle.
 * Non-annual tasks get a deterministic startDate spread over today..today+29.
 */
export function seedFromProfile(profile, { vehicles = [], idFn, today } = {}) {
  if (typeof idFn !== "function") throw new Error("seedFromProfile requires an id generator function");
  addDaysISO(today, 0);
  const out = [];
  const seen = new Set();
  let n = 0;
  for (const tpl of templatesFor(profile)) {
    const targets = tpl.requires?.vehicle ? vehicles : [null];
    for (const v of targets) {
      let title = tpl.title;
      if (v) {
        const suffix = ` — ${v.name}`;
        let head = tpl.title;
        const room = 120 - suffix.length;
        if (head.length > room) head = head.slice(0, Math.max(0, room - 1)).trimEnd() + "…";
        title = head + suffix;
      }
      const key = `${v ? v.id : ""}|${title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const extra = { title };
      if (v) extra.vehicleId = v.id;
      if (tpl.kind !== "annual") extra.startDate = addDaysISO(today, (n * 7) % 30);
      n++;
      out.push(instantiate(tpl, String(idFn()), extra));
    }
  }
  return out;
}

// ---- Extra tasks by home age (offered from Settings; not part of first-run setup) ----
export const HOME_AGES = ["new", "mid", "old"];
export const HOME_AGE_LABEL = { new: "Under 10 years", mid: "10 to 30 years", old: "Over 30 years" };
const AGE_TASKS = [
  { ages: ["new", "mid", "old"], title: "Check caulk and weatherstripping", category: "house", intervalDays: 365, notes: "Windows, doors, tubs and showers: reseal gaps and cracks." },
  { ages: ["new", "mid", "old"], title: "Inspect foundation and grading", category: "house", intervalDays: 365, notes: "Look for cracks and make sure the ground slopes away from the house." },
  { ages: ["mid", "old"], title: "Inspect water supply lines and shut-off valves", category: "house", intervalDays: 365, notes: "Replace braided hoses over 5-7 years old; exercise the shut-off valves." },
  { ages: ["mid", "old"], title: "Test sump pump", category: "house", intervalDays: 180, notes: "Pour a bucket of water in the pit and confirm it runs and drains." },
  { ages: ["mid", "old"], title: "Check attic insulation and ventilation", category: "house", intervalDays: 730, notes: "Look for gaps, moisture and pests." },
  { ages: ["mid", "old"], title: "Have the water heater inspected or consider replacing it", category: "house", intervalDays: 365, notes: "Most last 8-12 years. Check the date on the label." },
  { ages: ["old"], title: "Have the electrical panel and wiring inspected", category: "house", intervalDays: 1825, notes: "Older homes may have outdated panels or aluminum wiring." },
  { ages: ["old"], title: "Test for radon", category: "house", intervalDays: 730, notes: "Use a test kit in the lowest lived-in level." },
  { ages: ["old"], title: "Have the chimney and flue inspected", category: "house", intervalDays: 365, notes: "Do this before the heating season." },
  { ages: ["old"], title: "Inspect sewer line", category: "house", intervalDays: 1095, notes: "A camera inspection can catch roots and cracks early." },
  { ages: ["old"], title: "Check for lead paint and asbestos before any remodel", category: "house", intervalDays: 3650, notes: "Homes built before 1978 may contain lead paint." },
];

/** Suggested extra tasks for a home age, minus any whose title already exists. Returns task partials ready for addTask. */
export function ageTasks(homeAge, existingTitles, today) {
  if (!HOME_AGES.includes(homeAge)) return [];
  const have = new Set((existingTitles || []).map((t) => String(t).toLowerCase()));
  return AGE_TASKS.filter((t) => t.ages.includes(homeAge) && !have.has(t.title.toLowerCase()))
    .map((t, i) => ({ title: t.title, category: t.category, kind: "interval", intervalDays: t.intervalDays, notes: t.notes, tags: ["home-age"], startDate: addDaysISO(today, 7 + ((i * 11) % 30)), custom: false }));
}
