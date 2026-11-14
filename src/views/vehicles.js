// Vehicles view: CRUD, odometer updates, per-vehicle tasks, inline service history.
import { estimateMilesPerDay, addVehicle, updateVehicle, deleteVehicle, setOdometer, dueInfo, statusOf, sortTasks, daysBetween } from "../logic.js";
import { seedFromProfile } from "../templates.js";
import { fmtDate, fmtMoney } from "../dom.js";

export const id = "vehicles";
export const label = "Vehicles";

const DEFAULT_RATE = 33;
const S = { add: null, edit: null, odo: null, confirmDel: null, open: {}, pending: null };

const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const mi = (n) => `${Number(n).toLocaleString()} mi`;

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
}

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}

function rateOf(v, today) {
  const r = estimateMilesPerDay(v, today);
  return r.source === "log" ? r.rate : null;
}

function approxWeeks(days) {
  if (days <= 0) return "now";
  if (days < 14) return `${plural(days, "day")}`;
  if (days < 60) return `${plural(Math.round(days / 7), "week")}`;
  return `${plural(Math.round(days / 30), "month")}`;
}

function dueText(task, state, today) {
  if (task.snoozedUntil && task.snoozedUntil > today) return `Snoozed until ${fmtDate(task.snoozedUntil)}`;
  let info;
  try { info = dueInfo(task, state, today); } catch { return ""; }
  const d = info.daysUntil;
  if (task.kind === "mileage" && info.milesLeft != null && info.basis === "miles") {
    if (info.milesLeft <= 0) return `${mi(Math.abs(info.milesLeft))} past due`;
    return `~${mi(info.milesLeft)} left${d != null ? ` (≈ ${approxWeeks(d)})` : ""}`;
  }
  if (d == null) return "";
  if (d < 0) return `${plural(-d, "day")} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const vehicles = state.vehicles || [];
  return h("section", { class: "v-view", "aria-labelledby": "v-veh-h" },
    h("div", { class: "v-head" },
      h("h2", { id: "v-veh-h", class: "v-h2", text: "Vehicles" }),
      h("button", { type: "button", class: "btn v-primary", "data-fk": "v-veh-add", "aria-expanded": S.add ? "true" : "false",
        onclick: () => { S.add = { name: "", odometer: "", error: "" }; S.pending = "v-veh-name"; rerender(); }, text: "Add vehicle" })),
    h("p", { class: "v-lede", text: "Track mileage so oil changes, tire rotations and other mileage-based tasks know when they're due. Update the odometer whenever you fill up." }),
    S.add ? addForm(ctx, rerender) : null,
    vehicles.length === 0 && !S.add
      ? h("div", { class: "empty" },
          h("div", { class: "empty-art", "aria-hidden": "true", text: "\u{1F697}" }),
          h("h3", { text: "No vehicles yet" }),
          h("p", { text: "Add a car, truck or trailer's tow vehicle with its current odometer and we'll set up the usual service schedule." }))
      : null,
    h("ul", { class: "v-cards" }, vehicles.map((v) => vehicleCard(ctx, state, today, v, rerender))));
}

function addForm(ctx, rerender) {
  const { h } = ctx;
  const d = S.add;
  const submit = (e) => {
    e.preventDefault();
    const name = d.name.trim();
    const odoStr = String(d.odometer).trim();
    if (!name) { d.error = "Please name the vehicle, like \"2015 Equinox\"."; S.pending = "v-veh-name"; return rerender(); }
    if (!/^\d+$/.test(odoStr)) { d.error = "Enter the odometer as whole miles, like 84500."; S.pending = "v-veh-odo"; return rerender(); }
    try {
      const next = addVehicle(ctx.getState(), { name, odometer: Number(odoStr) }, rid, ctx.today());
      S.add = null; S.pending = "v-veh-add";
      ctx.commit(next, `Added ${name}`);
    } catch (err) { d.error = err.message || "Couldn't add this vehicle."; S.pending = "v-veh-name"; rerender(); }
  };
  return h("form", { class: "v-form", novalidate: true, onsubmit: submit, "aria-label": "Add a vehicle" },
    h("h3", { class: "v-h3", text: "Add a vehicle" }),
    h("div", { class: "v-row2" },
      h("div", { class: "field" }, h("label", { for: "v-veh-name", text: "Name (required)" }),
        h("input", { id: "v-veh-name", "data-fk": "v-veh-name", type: "text", maxlength: "120", value: d.name, autocomplete: "off", "aria-required": "true", oninput: (e) => { d.name = e.target.value; } })),
      h("div", { class: "field" }, h("label", { for: "v-veh-odo", text: "Current odometer (miles)" }),
        h("input", { id: "v-veh-odo", "data-fk": "v-veh-odo", type: "text", inputmode: "numeric", value: d.odometer, autocomplete: "off", oninput: (e) => { d.odometer = e.target.value; } }))),
    h("p", { class: "form-error", role: "alert", text: d.error }),
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn v-primary", text: "Add vehicle" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.add = null; S.pending = "v-veh-add"; rerender(); } })));
}

function vehicleCard(ctx, state, today, v, rerender) {
  const { h } = ctx;
  const tasks = sortTasks((state.tasks || []).filter((t) => t.vehicleId === v.id), today, state);
  const rate = rateOf(v, today);
  const editing = S.edit && S.edit.id === v.id;
  const odoOpen = S.odo && S.odo.id === v.id;
  const confirming = S.confirmDel === v.id;

  const missing = missingTemplates(ctx, state, v, today);

  return h("li", { class: "v-card" },
    editing ? editForm(ctx, v, rerender) : h("div", { class: "v-card-top" },
      h("h3", { class: "v-card-title", text: v.name }),
      h("p", { class: "v-odo" }, h("strong", { text: mi(v.odometer) }), h("span", { class: "v-hint", text: ` as of ${fmtDate(v.odometerDate)}` }))),
    h("p", { class: "v-meta", text: rate != null
      ? `About ${Math.round(rate)} miles a day, based on your recent odometer updates.`
      : `Not enough odometer updates yet for a personal estimate. Using about ${DEFAULT_RATE} miles a day until there are two updates at least two weeks apart.` }),
    odoOpen ? odoForm(ctx, v, rerender) : null,
    h("h4", { class: "v-h5", text: "Tasks for this vehicle" }),
    tasks.length
      ? h("ul", { class: "v-mini" }, tasks.map((t) => {
          let st = "ok"; try { st = statusOf(t, today, state); } catch { /* ignore */ }
          return h("li", { class: `v-mini-row v-st-${st}` }, h("span", { class: "v-mini-title", text: t.title }), h("span", { class: "v-mini-due", text: dueText(t, state, today) }));
        }))
      : h("p", { class: "v-hint", text: "No tasks yet for this vehicle." }),
    history(ctx, state, v, tasks, rerender),
    confirming
      ? h("div", { class: "v-confirm", role: "alertdialog", "aria-label": `Delete ${v.name}?` },
          h("p", { text: `Delete "${v.name}" and its ${plural(tasks.length, "task")}? Past history entries are kept.` }),
          h("div", { class: "v-actions" },
            h("button", { type: "button", class: "btn danger", text: "Yes, delete", "data-fk": `vd-yes-${v.id}`,
              onclick: () => {
                try { const next = deleteVehicle(ctx.getState(), v.id); S.confirmDel = null; S.pending = "v-veh-add"; ctx.commit(next, `Deleted ${v.name}`); }
                catch (e) { ctx.toast(e.message); }
              } }),
            h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": `vd-no-${v.id}`, onclick: () => { S.confirmDel = null; S.pending = `vd-${v.id}`; rerender(); } })))
      : h("div", { class: "v-actions" },
          h("button", { type: "button", class: "btn", "data-fk": `odo-${v.id}`, "aria-expanded": odoOpen ? "true" : "false", text: "Update odometer",
            onclick: () => { S.odo = { id: v.id, value: String(v.odometer), error: "" }; S.pending = `odo-in-${v.id}`; rerender(); } }),
          h("button", { type: "button", class: "btn", "data-fk": `addtasks-${v.id}`,
            "aria-describedby": `addtasks-note-${v.id}`, text: "Add vehicle tasks",
            onclick: () => addTasks(ctx, v, rerender) }),
          h("button", { type: "button", class: "btn subtle", "data-fk": `ve-${v.id}`, "aria-label": `Rename ${v.name}`, text: "Rename",
            onclick: () => { S.edit = { id: v.id, name: v.name, error: "" }; S.pending = `ve-in-${v.id}`; rerender(); } }),
          h("button", { type: "button", class: "btn subtle danger", "data-fk": `vd-${v.id}`, "aria-label": `Delete ${v.name}`, text: "Delete",
            onclick: () => { S.confirmDel = v.id; S.pending = `vd-no-${v.id}`; rerender(); } })),
    h("p", { id: `addtasks-note-${v.id}`, class: "v-hint",
      text: missing === 0 ? "All the standard vehicle tasks are already on your list." : `${plural(missing, "standard task")} not on your list yet. Adding never makes duplicates.` }));
}

function vehicleTemplateTasks(ctx, state, v, today) {
  const seeded = seedFromProfile(state.profile, { vehicles: [v], idFn: rid, today }) || [];
  const have = new Set((state.tasks || []).filter((t) => t.vehicleId === v.id).map((t) => t.title));
  return seeded.filter((t) => t.vehicleId === v.id && !have.has(t.title));
}

function missingTemplates(ctx, state, v, today) {
  try { return vehicleTemplateTasks(ctx, state, v, today).length; } catch { return 0; }
}

function addTasks(ctx, v, rerender) {
  try {
    const st = ctx.getState();
    const fresh = vehicleTemplateTasks(ctx, st, v, ctx.today());
    if (!fresh.length) { ctx.toast("Nothing to add. Every standard task for this vehicle is already there."); return; }
    S.pending = `addtasks-${v.id}`;
    ctx.commit({ ...st, tasks: [...st.tasks, ...fresh] }, `Added ${fresh.length} task${fresh.length === 1 ? "" : "s"} for ${v.name}`);
  } catch (e) { ctx.toast(e.message || "Couldn't add vehicle tasks."); }
}

function editForm(ctx, v, rerender) {
  const { h } = ctx;
  const d = S.edit;
  const submit = (e) => {
    e.preventDefault();
    const name = d.name.trim();
    if (!name) { d.error = "The vehicle needs a name."; S.pending = `ve-in-${v.id}`; return rerender(); }
    try {
      const next = updateVehicle(ctx.getState(), v.id, { name });
      S.edit = null; S.pending = `ve-${v.id}`;
      ctx.commit(next, "Vehicle renamed");
    } catch (err) { d.error = err.message; S.pending = `ve-in-${v.id}`; rerender(); }
  };
  return h("form", { class: "v-inline-form", novalidate: true, onsubmit: submit, "aria-label": `Rename ${v.name}` },
    h("div", { class: "field" }, h("label", { for: `ve-in-${v.id}`, text: "Vehicle name" }),
      h("input", { id: `ve-in-${v.id}`, "data-fk": `ve-in-${v.id}`, type: "text", maxlength: "120", value: d.name, oninput: (e) => { d.name = e.target.value; } })),
    h("p", { class: "form-error", role: "alert", text: d.error }),
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn v-primary", text: "Save name" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.edit = null; S.pending = `ve-${v.id}`; rerender(); } })));
}

function odoForm(ctx, v, rerender) {
  const { h } = ctx;
  const d = S.odo;
  const submit = (e) => {
    e.preventDefault();
    const s = String(d.value).trim();
    if (!/^\d+$/.test(s)) { d.error = "Enter whole miles, like 85120."; S.pending = `odo-in-${v.id}`; return rerender(); }
    const miles = Number(s);
    if (miles < v.odometer) { d.error = `That's lower than the current reading (${mi(v.odometer)}). Odometers only go up. Check for a typo.`; S.pending = `odo-in-${v.id}`; return rerender(); }
    try {
      const next = setOdometer(ctx.getState(), v.id, miles, ctx.today());
      S.odo = null; S.pending = `odo-${v.id}`;
      ctx.commit(next, `${v.name}: ${mi(miles)}`);
    } catch (err) { d.error = err.message; S.pending = `odo-in-${v.id}`; rerender(); }
  };
  return h("form", { class: "v-inline-form", novalidate: true, onsubmit: submit, "aria-label": `Update odometer for ${v.name}` },
    h("div", { class: "field" }, h("label", { for: `odo-in-${v.id}`, text: `New odometer reading (at least ${mi(v.odometer)})` }),
      h("input", { id: `odo-in-${v.id}`, "data-fk": `odo-in-${v.id}`, type: "text", inputmode: "numeric", value: d.value, autocomplete: "off", oninput: (e) => { d.value = e.target.value; } })),
    h("p", { class: "form-error", role: "alert", text: d.error }),
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn v-primary", text: "Save odometer" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.odo = null; S.pending = `odo-${v.id}`; rerender(); } })));
}

function history(ctx, state, v, tasks, rerender) {
  const { h } = ctx;
  const ids = new Set(tasks.map((t) => t.id));
  const suffix = ` — ${v.name}`;
  const rows = (state.completions || [])
    .filter((c) => (c.taskId && ids.has(c.taskId)) || (c.title && c.title.endsWith(suffix)))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const open = !!S.open[v.id];
  return h("details", { class: "v-details", open: open ? true : null,
    ontoggle: (e) => { S.open[v.id] = e.target.open; } },
    h("summary", { "data-fk": `hist-${v.id}`, text: `Service history (${rows.length})` }),
    rows.length
      ? h("ul", { class: "v-mini" }, rows.slice(0, 15).map((c) => {
          const bits = [fmtDate(c.date)];
          if (c.kind === "skipped") bits.push("skipped");
          if (c.odometer != null) bits.push(mi(c.odometer));
          if (c.kind !== "skipped" && c.cost != null) bits.push(fmtMoney(c.cost));
          return h("li", { class: "v-mini-row" }, h("span", { class: "v-mini-title", text: c.title }), h("span", { class: "v-mini-due", text: bits.join(" · ") }));
        }))
      : h("p", { class: "v-hint", text: "Nothing logged yet. Mark a vehicle task done and it appears here." }),
    rows.length > 15 ? h("p", { class: "v-hint", text: "Showing the 15 most recent. The History tab has everything, with photos." }) : null);
}

export default { id, label, render };
