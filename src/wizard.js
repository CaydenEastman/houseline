// First-run setup wizard (also used by Settings > Re-run setup).
// renderWizard is idempotent: step state lives in module scope, so a shell re-render keeps your place.
import { fmtNum } from "./dom.js";
import { seedFromProfile } from "./templates.js";
import { addVehicle } from "./logic.js";

const HOME_TYPES = [
  ["house", "House", "Yard, gutters, roof and all"],
  ["condo", "Condo / townhome", "Shared exterior, no gutters or yard tasks"],
  ["apartment", "Apartment", "Indoor tasks, safety and car"],
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
    },
    newVehicles: [],
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
    s = { ...s, profile: { ...s.profile, ...W.profile } };
    for (const v of W.newVehicles) s = addVehicle(s, { name: v.name, odometer: v.odometer }, newId, today);
  }
  s = { ...s, profile: { ...s.profile, setupDone: true } };
  return addMissingTasks(s, today);
}

export function renderWizard(container, ctx, opts = {}) {
  if (!W) resetWizard(ctx.getState(), opts.rerun);
  const { h } = ctx;
  const steps = ["Your home", "Vehicles", "Review"];

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

  function readStep0() {
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
    W.draft = { name: nameEl.value, odo: odoEl.value }; // kept so a validation error never empties the boxes
    if (!name && !odoRaw) { W.draft = null; return !required; }
    if (!name) { fail("Give the vehicle a name, like “Family minivan”.", "#w-vname"); return false; }
    const odometer = odoRaw === "" ? 0 : Number(odoRaw);
    if (!Number.isInteger(odometer) || odometer < 0 || odometer > 5000000) {
      fail("Odometer must be a whole number of miles, 0 or more.", "#w-vodo"); return false;
    }
    if (name.length > 80) { fail("Vehicle name is too long.", "#w-vname"); return false; }
    const dup = [...ctx.getState().vehicles, ...W.newVehicles].some((v) => v.name.toLowerCase() === name.toLowerCase());
    if (dup) { fail("You already have a vehicle with that name.", "#w-vname"); return false; }
    W.newVehicles.push({ name, odometer });
    W.draft = null;
    W.error = "";
    return true;
  }

  function stepHome() {
    const p = W.profile;
    const check = (key, label, hint) => h("label", { class: "check" },
      h("input", { type: "checkbox", checked: p[key], onchange: (e) => { p[key] = e.target.checked; } }),
      h("span", {}, h("strong", { text: label }), hint ? h("small", { text: hint }) : null));
    return h("div", {},
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "What kind of home?" }),
        HOME_TYPES.map(([val, label, hint]) => h("label", { class: "choice" },
          h("input", { type: "radio", name: "w-home", value: val, checked: p.homeType === val,
            onchange: () => { p.homeType = val; if (val !== "house") p.hasYard = false; else p.hasYard = true; draw(false); } }),
          h("span", {}, h("strong", { text: label }), h("small", { text: hint }))))),
      h("fieldset", { class: "choice-group" },
        h("legend", { text: "Which of these apply?" }),
        check("hasYard", "A yard or lawn", "Mowing, sprinklers, seasonal yard work"),
        check("hasPool", "A pool or hot tub", "Water testing, filters, covers"),
        check("hasTrailer", "A trailer, boat or RV", "Tires, bearings, lights, registration"),
        check("hasPets", "Pets", "Vet visits, vaccines, supplies")),
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
        h("button", { type: "submit", class: "btn", text: "+ Add this vehicle" })));
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
      W.rerun ? h("p", { class: "hint", text: "Re-running setup only adds missing tasks. Nothing you already have is changed or removed." }) : null,
      h("p", { class: "hint", text: "You can edit, snooze, skip or delete any task afterwards." }));
  }

  function draw(moveFocus) {
    const active = container.ownerDocument.activeElement;
    const keepId = !moveFocus && active && active.id && container.contains(active) ? active.id : null;
    const last = steps.length - 1;
    const body = W.step === 0 ? stepHome() : W.step === 1 ? stepVehicles() : stepReview();
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
            if (W.step === 0 || (W.step === 1 && !tryAddVehicle(false))) return; go(W.step - 1); } }) : null,
          W.step < last
            ? h("button", { type: "button", class: "btn primary solid", text: "Next", onclick: () => {
                if (W.step === 0 && !readStep0()) return;
                if (W.step === 1 && !tryAddVehicle(false)) return;
                go(W.step + 1); } })
            : h("button", { type: "button", class: "btn primary solid", text: W.rerun ? "Add missing tasks" : "Finish setup", onclick: () => finish(false) }),
          W.rerun
            ? h("button", { type: "button", class: "btn subtle", text: "Cancel", onclick: cancel })
            : h("button", { type: "button", class: "btn subtle", text: "Skip setup", onclick: () => finish(true) })),
        W.rerun ? null : h("p", { class: "hint", text: "Skipping loads a standard house and yard list (about 40 tasks, for a cold-climate home). You can re-run setup from Settings any time." })));
    if (moveFocus) { const hd = container.querySelector("#w-heading"); if (hd) hd.focus(); }
    else if (keepId) { const el = container.querySelector("#" + keepId); if (el) el.focus(); }
  }

  draw(false);
}
