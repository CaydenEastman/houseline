// First-run setup wizard (also used by Settings > Re-run setup).
// renderWizard is idempotent: step state lives in module scope, so a shell re-render keeps your place.
import { fmtNum } from "./dom.js";
import { seedFromProfile, ageTasks, HOME_AGE_LABEL } from "./templates.js";
import { addVehicle, addTask, addDays, HOME_AGE_TYPES, SYSTEM_TYPES } from "./logic.js";

const HOME_TYPES = [
  ["house", "House", "Yard, gutters, roof and all"],
  ["condo", "Condo / townhome", "Shared exterior, no gutters or yard tasks"],
  ["apartment", "Apartment", "Indoor tasks, safety and car"],
];
const OWN = [
  ["own", "I own it", "Includes roof, heating, water heater and exterior upkeep"],
  ["rent", "I rent it", "Skips what a landlord handles; adds renter's insurance and a photo record"],
];
const CLIMATES = [["cold", "Cold winters"], ["mild", "Mild year-round"], ["hot", "Hot summers"]];
const SYSTEM_LABEL = {
  fireplace: ["Fireplace or wood stove", "Annual chimney inspection"],
  garage: ["Garage door opener", "Auto-reverse test and lubrication"],
  basement: ["Basement or crawlspace", "Moisture checks"],
  sump: ["Sump pump", "Twice-a-year test"],
  septic: ["Septic system", "Pumping and drain field checks"],
  well: ["Private well", "Water testing and pressure tank"],
  solar: ["Solar panels", "Panel and inverter check"],
  ev: ["EV charger", "Cable and connector inspection"],
  generator: ["Backup generator", "Run tests and yearly service"],
};
// "When did you last do this?" shortcut on the Review step. Not sure keeps the normal spread-out first due date.
export const LAST_CHOICES = [
  ["", "Not sure"],
  ["recent", "In the past month"],
  ["months", "A few months ago"],
  ["year", "A year or more ago"],
];
const LAST_DAYS = { recent: 20, months: 120, year: 400 };
export const LAST_TITLES = [
  "Replace HVAC filter", "Test smoke and CO detectors", "Flush water heater", "Clean dryer vent",
  "Test GFCI outlets", "Check fire extinguishers", "Clean refrigerator coils", "Inspect roof and attic",
];
const CAT_LABEL = { car: "Car", house: "House", yard: "Yard", emergency: "Emergency" };

let W = null;

const newId = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const taskKey = (t) => `${t.title}|${t.vehicleId || ""}`;

export function resetWizard(state, rerun = false) {
  const p = state.profile || {};
  W = {
    step: 0,
    rerun: !!rerun,
    profile: {
      homeType: p.homeType || "house",
      hasYard: p.hasYard !== false,
      hasPool: !!p.hasPool,
      hasTrailer: !!p.hasTrailer,
      hasPets: !!p.hasPets,
      householdSize: Number.isInteger(p.householdSize) ? p.householdSize : 2,
      rents: !!p.rents,
      climate: ["cold", "mild", "hot"].includes(p.climate) ? p.climate : "cold",
      homeAge: HOME_AGE_TYPES.includes(p.homeAge) ? p.homeAge : null,
      systems: Array.isArray(p.systems) ? p.systems.filter((x) => SYSTEM_TYPES.includes(x)) : [],
    },
    newVehicles: [],
    last: {},
    error: "",
  };
  return W;
}

/** Returns { state, added } where added = tasks that were missing (matched on title + vehicleId). Never deletes. */
export function addMissingTasks(state, today, idFn = newId) {
  const seeds = seedFromProfile(state.profile, { vehicles: state.vehicles, idFn, today });
  const have = new Set(state.tasks.map(taskKey));
  const added = [];
  for (const t of seeds) {
    const k = taskKey(t);
    if (!have.has(k)) { have.add(k); added.push(t); }
  }
  return { state: { ...state, tasks: [...state.tasks, ...added] }, added };
}

/** Build the state that Finish would produce (without committing). */
function buildResult(ctx, { skip = false } = {}) {
  const today = ctx.today();
  let s = ctx.getState();
  if (!skip) {
    const { homeAge, ...rest } = W.profile;
    s = { ...s, profile: { ...s.profile, ...rest, ...(homeAge ? { homeAge } : {}) } };
    for (const v of W.newVehicles) s = addVehicle(s, { name: v.name, odometer: v.odometer }, newId, today);
  }
  s = { ...s, profile: { ...s.profile, setupDone: true } };
  const res = addMissingTasks(s, today);
  if (!skip && !W.rerun && s.profile.homeAge && !s.profile.rents) {
    // Older homes get a few extra inspections, same as Settings > "Add suggested tasks for my home's age".
    for (const t of ageTasks(s.profile.homeAge, res.state.tasks.map((x) => x.title), today)) {
      const before = res.state.tasks.length;
      const next = addTask(res.state, t, newId);
      if (next.tasks.length > before) { res.added.push(next.tasks[next.tasks.length - 1]); res.state = next; }
    }
  }
  if (!skip) {
    // Known history: counting from the date they did it means a task they skipped for a year starts overdue, which is accurate.
    const mark = (t) => {
      const days = LAST_DAYS[W.last[t.title]];
      return days && (t.kind || "interval") === "interval" ? { ...t, lastDone: addDays(today, -days) } : t;
    };
    const added = res.added.map(mark);
    const byId = new Map(added.map((t) => [t.id, t]));
    res.state = { ...res.state, tasks: res.state.tasks.map((t) => byId.get(t.id) || t) };
    res.added = added;
  }
  if (skip || !W.newVehicles.length) return res;
  // A car added here has no service history yet. Count each mileage reminder from the last oil change if they know it,
  // otherwise from today's odometer, so a brand-new car does not open with "oil change overdue".
  const byName = new Map(W.newVehicles.map((v) => [v.name.toLowerCase(), v]));
  const baseline = new Map(res.state.vehicles.filter((v) => byName.has(v.name.toLowerCase())).map((v) => [v.id, byName.get(v.name.toLowerCase())]));
  const fix = (t) => {
    const nv = t.vehicleId && baseline.get(t.vehicleId);
    if (!nv || (t.kind || "interval") !== "mileage" || t.lastDoneOdometer != null) return t;
    const oil = /\boil\b/i.test(t.title) && nv.lastOil != null;
    return { ...t, lastDoneOdometer: oil ? nv.lastOil : nv.odometer };
  };
  const added = res.added.map(fix);
  const byId = new Map(added.map((t) => [t.id, t]));
  return { state: { ...res.state, tasks: res.state.tasks.map((t) => byId.get(t.id) || t) }, added };
}

export function renderWizard(container, ctx, opts = {}) {
  if (!W) resetWizard(ctx.getState(), opts.rerun);
  const { h } = ctx;
  const steps = ["Your home", "What\u2019s in it", "Vehicles", "Review"];

  const go = (n) => { W.step = n; W.error = ""; W.draft = null; draw(true); };
  const fail = (msg, field) => { W.error = msg; draw(false); if (field) { const el = container.querySelector(field); if (el) el.focus(); } };

  function finish(skip) {
    let res;
    try { res = buildResult(ctx, { skip }); } catch (e) { fail(e.message || "Couldn't finish setup."); return; }
    const n = res.added.length;
    const msg = skip ? `Loaded ${n} starter tasks.` : `All set. ${n} ${n === 1 ? "task" : "tasks"} added.`;
    const ok = ctx.commit(res.state, msg, { undoable: false });
    if (ok === false) { W.error = "Couldn't save your setup. Please try again."; draw(false); return; }
    W = null;
    if (opts.onClose) opts.onClose();
  }

  function cancel() { W = null; if (opts.onClose) opts.onClose(); }

  function readStep1() {
    const size = Number(container.querySelector("#w-size").value);
    if (!Number.isInteger(size) || size < 1 || size > 20) {
      fail("Household size must be a whole number from 1 to 20.", "#w-size"); return false;
    }
    W.profile.householdSize = size;
    return true;
  }

  function tryAddVehicle(required) {
    const nameEl = container.querySelector("#w-vname");
    const odoEl = container.querySelector("#w-vodo");
    if (!nameEl) return true;
    const name = nameEl.value.trim();
    const odoRaw = odoEl.value.trim();
    const oilEl = container.querySelector("#w-voil");
    const oilRaw = oilEl ? oilEl.value.trim() : "";
    W.draft = { name: nameEl.value, odo: odoEl.value, oil: oilEl ? oilEl.value : "" }; // kept so a validation error never empties the boxes
    if (!name && !odoRaw) { W.draft = null; if (required) { fail("Type a name (like “Family minivan”) and the odometer first, then add the vehicle.", "#w-vname"); return false; } return true; }
    if (!name) { fail("Give the vehicle a name, like “Family minivan”.", "#w-vname"); return false; }
    const odometer = odoRaw === "" ? 0 : Number(odoRaw);
    if (!Number.isInteger(odometer) || odometer < 0 || odometer > 5000000) {
      fail("Odometer must be a whole number of miles, 0 or more.", "#w-vodo"); return false;
    }
    let lastOil = null;
    if (oilRaw !== "") {
      lastOil = Number(oilRaw);
      if (!Number.isInteger(lastOil) || lastOil < 0) { fail("Miles at the last oil change must be a whole number.", "#w-voil"); return false; }
      if (lastOil > odometer) { fail("The last oil change can't be at a higher mileage than the odometer now.", "#w-voil"); return false; }
    }
    if (name.length > 80) { fail("Vehicle name is too long.", "#w-vname"); return false; }
    const dup = [...ctx.getState().vehicles, ...W.newVehicles].some((v) => v.name.toLowerCase() === name.toLowerCase());
    if (dup) { fail("You already have a vehicle with that name.", "#w-vname"); return false; }
    W.newVehicles.push({ name, odometer, lastOil });
    W.draft = null;
    W.error = "";
    return true;
  }

  function stepHome() {
    const p = W.profile;
    const ownVal = p.rents ? "rent" : "own";
    return h("div", {},
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "What kind of home?" }),
        HOME_TYPES.map(([val, label, hint]) => h("label", { class: "choice" },
          h("input", { type: "radio", name: "w-home", value: val, checked: p.homeType === val,
            onchange: () => { p.homeType = val; p.hasYard = val === "house"; draw(false); } }),
          h("span", {}, h("strong", { text: label }), h("small", { text: hint }))))),
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "Do you own or rent?" }),
        OWN.map(([val, label, hint]) => h("label", { class: "choice" },
          h("input", { type: "radio", name: "w-own", value: val, checked: ownVal === val,
            onchange: () => { p.rents = val === "rent"; draw(false); } }),
          h("span", {}, h("strong", { text: label }), h("small", { text: hint }))))),
      h("div", { class: "field" },
        h("label", { for: "w-climate", text: "Climate (for seasonal reminders)" }),
        h("select", { id: "w-climate", onchange: (e) => { p.climate = e.target.value; } },
          CLIMATES.map(([v, t]) => h("option", { value: v, text: t, selected: p.climate === v })))),
      p.rents ? null : h("div", { class: "field" },
        h("label", { for: "w-age", text: "How old is your home?" }),
        h("select", { id: "w-age", onchange: (e) => { p.homeAge = e.target.value || null; } },
          h("option", { value: "", text: "Not sure / skip", selected: !p.homeAge }),
          HOME_AGE_TYPES.map((v) => h("option", { value: v, text: HOME_AGE_LABEL[v], selected: p.homeAge === v }))),
        h("p", { class: "hint", text: "Older homes get a few extra inspections, like wiring, sewer line and radon." })));
  }

  function stepFeatures() {
    const p = W.profile;
    const check = (checked, onchange, label, hint) => h("label", { class: "check" },
      h("input", { type: "checkbox", checked, onchange: (e) => onchange(e.target.checked) }),
      h("span", {}, h("strong", { text: label }), hint ? h("small", { text: hint }) : null));
    const flag = (key, label, hint) => check(p[key], (v) => { p[key] = v; }, label, hint);
    return h("div", {},
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "Which of these apply?" }),
        p.homeType === "house" ? flag("hasYard", "A yard or lawn", "Mowing, sprinklers, seasonal yard work") : null,
        flag("hasPool", "A pool or hot tub", "Water testing, filters, covers"),
        flag("hasTrailer", "A trailer, boat or RV", "Tires, bearings, lights, registration"),
        flag("hasPets", "Pets", "Vet visits, vaccines, supplies")),
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "Does your home have any of these?" }),
        SYSTEM_TYPES.filter((k) => p.homeType === "house" || !["septic", "well"].includes(k)).map((k) =>
          check(p.systems.includes(k), (v) => { p.systems = SYSTEM_TYPES.filter((x) => (x === k ? v : p.systems.includes(x))); }, SYSTEM_LABEL[k][0], SYSTEM_LABEL[k][1]))),
      h("div", { class: "field narrow" },
        h("label", { for: "w-size", text: "People in your household" }),
        h("input", { id: "w-size", type: "number", inputmode: "numeric", min: "1", max: "20", step: "1", value: String(p.householdSize), oninput: (e) => { const n = Number(e.target.value); if (Number.isInteger(n) && n >= 1 && n <= 20) p.householdSize = n; } }),
        h("p", { class: "hint", text: "Used to size your emergency water and food needs." })));
  }

  function stepVehicles() {
    const existing = ctx.getState().vehicles;
    return h("div", {},
      h("p", { class: "lead", text: "Add each vehicle you maintain. We’ll create mileage-based reminders (oil, tires, brakes) for each one. You can skip this and add vehicles later." }),
      existing.length ? h("ul", { class: "plain-list" }, existing.map((v) =>
        h("li", {}, h("strong", { text: v.name }), ` · ${fmtNum(v.odometer)} mi (already added)`))) : null,
      W.newVehicles.length ? h("ul", { class: "plain-list", "aria-label": "Vehicles to add" }, W.newVehicles.map((v, i) =>
        h("li", { class: "li-row" },
          h("span", {}, h("strong", { text: v.name }), ` · ${fmtNum(v.odometer)} mi`),
          h("button", { type: "button", class: "btn subtle danger", text: "Remove", "aria-label": `Remove ${v.name}`,
            onclick: () => { W.newVehicles.splice(i, 1); draw(false); } })))) : null,
      h("form", { class: "inline-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); if (tryAddVehicle(true)) draw(false); setTimeout(() => { const n = container.querySelector("#w-vname"); if (n && !W.error) n.focus(); }, 0); } },
        h("div", { class: "row2" },
          h("div", { class: "field" },
            h("label", { for: "w-vname", text: "Vehicle name" }),
            h("input", { id: "w-vname", type: "text", maxlength: "80", autocomplete: "off", placeholder: "e.g. Family minivan", value: W.draft ? W.draft.name : "" })),
          h("div", { class: "field" },
            h("label", { for: "w-vodo", text: "Current odometer (miles)" }),
            h("input", { id: "w-vodo", type: "number", inputmode: "numeric", min: "0", step: "1", placeholder: "e.g. 84500", value: W.draft ? W.draft.odo : "" }))),
        h("div", { class: "field" },
          h("label", { for: "w-voil", text: "Odometer at the last oil change (optional)" }),
          h("input", { id: "w-voil", type: "number", inputmode: "numeric", min: "0", step: "1", placeholder: "e.g. 82000", value: W.draft ? W.draft.oil : "" }),
          h("p", { class: "hint", text: "Not sure? Leave it blank and the mileage reminders start counting from today, so nothing shows as overdue on day one." })),
        h("button", { type: "submit", class: "btn", text: "+ Add this vehicle" })));
  }

  function lastDonePanel(res) {
    const rows = LAST_TITLES.map((t) => res.added.find((a) => a.title === t)).filter(Boolean);
    if (!rows.length) return null;
    return h("details", { class: "w-last", open: Object.keys(W.last).length > 0 },
      h("summary", { text: "Optional: when did you last do these?" }),
      h("p", { class: "hint", text: "Pick what you remember. Anything you’re not sure about keeps a due date in the next month. If it’s been a year, it will show as overdue, which is the honest answer." }),
      rows.map((t, i) => h("div", { class: "field" },
        h("label", { for: `w-last-${i}`, text: t.title }),
        h("select", { id: `w-last-${i}`, onchange: (e) => { if (e.target.value) W.last[t.title] = e.target.value; else delete W.last[t.title]; } },
          LAST_CHOICES.map(([v, label]) => h("option", { value: v, text: label, selected: (W.last[t.title] || "") === v }))))));
  }

  function stepReview() {
    let res = null, err = "";
    try { res = buildResult(ctx); } catch (e) { err = e.message || "Couldn't prepare your tasks."; }
    if (!res) return h("p", { class: "form-error", role: "alert", text: err });
    const counts = {};
    for (const t of res.added) counts[t.category] = (counts[t.category] || 0) + 1;
    const n = res.added.length;
    return h("div", {},
      h("p", { class: "lead" }, h("strong", { text: `${n} ${n === 1 ? "task" : "tasks"}` }),
        n ? " will be added. First due dates are spread over the next month so you’re not buried on day one." : " would be added. You already have everything that fits your home."),
      n ? h("ul", { class: "plain-list" }, Object.keys(counts).map((c) =>
        h("li", {}, `${CAT_LABEL[c] || c}: ${counts[c]}`))) : null,
      lastDonePanel(res),
      W.rerun ? h("p", { class: "hint", text: "Re-running setup only adds missing tasks. Nothing you already have is changed or removed." }) : null,
      h("p", { class: "hint", text: "You can edit, snooze, skip or delete any task afterwards." }));
  }

  function draw(moveFocus) {
    const active = container.ownerDocument.activeElement;
    const keepId = !moveFocus && active && active.id && container.contains(active) ? active.id : null;
    const last = steps.length - 1;
    const body = W.step === 0 ? stepHome() : W.step === 1 ? stepFeatures() : W.step === 2 ? stepVehicles() : stepReview();
    const heading = h("h2", { id: "w-heading", tabindex: "-1", text: W.rerun ? `Re-run setup: ${steps[W.step]}` : steps[W.step] });
    container.replaceChildren(
      h("div", { class: "wizard" },
        h("div", { class: "wizard-head" },
          h("p", { class: "eyebrow", text: W.rerun ? "Update your setup" : "Welcome — let’s set things up" }),
          h("ol", { class: "stepper", "aria-label": "Setup progress" }, steps.map((s, i) =>
            h("li", { class: i === W.step ? "current" : i < W.step ? "done" : "", "aria-current": i === W.step ? "step" : null },
              h("span", { class: "step-n", "aria-hidden": "true", text: String(i + 1) }), h("span", { text: s })))),
          heading),
        body,
        h("p", { class: "form-error", id: "w-error", role: "alert", text: W.error }),
        h("div", { class: "wizard-actions" },
          W.step > 0 ? h("button", { type: "button", class: "btn", text: "Back", onclick: () => {
            if (W.step === 0) return; if (W.step === 2) { tryAddVehicle(false); W.error = ""; } go(W.step - 1); } }) : null,
          W.step < last
            ? h("button", { type: "button", class: "btn primary solid", text: "Next", onclick: () => {
                if (W.step === 1 && !readStep1()) return;
                if (W.step === 2 && !tryAddVehicle(false)) return;
                go(W.step + 1); } })
            : h("button", { type: "button", class: "btn primary solid", text: W.rerun ? "Add missing tasks" : "Finish setup", onclick: () => finish(false) }),
          W.rerun ? h("button", { type: "button", class: "btn subtle", text: "Cancel", onclick: cancel }) : null),
        W.rerun ? null : h("p", { class: "hint" },
          "Short on time? ",
          h("button", { type: "button", class: "linklike", text: "Skip setup", onclick: () => finish(true) }),
          " to load a standard house and yard list (about 40 tasks, for a cold-climate home). You can re-run setup from Settings any time.")));
    if (moveFocus) { const hd = container.querySelector("#w-heading"); if (hd) hd.focus(); }
    else if (keepId) { const el = container.querySelector("#" + keepId); if (el) el.focus(); }
  }

  draw(false);
}
