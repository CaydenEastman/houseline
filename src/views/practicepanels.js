// Two panels for the Emergency screen: practice drills, and house info (spare keys, codes) that stays off the printed sheet.
import { drillStatus, addMissingDrills, DRILLS } from "../practice.js";
import { updateEmergency, HOUSE_INFO_MAX } from "../logic.js";
import { fmtDate } from "../dom.js";

const P = { info: null, shown: new Set(), error: "" };
const SUGGEST = ["Spare key location", "Garage door code", "Gate code", "Alarm code", "Wi-Fi password", "Where the safe is"];
export function resetPracticePanels() { P.info = null; P.shown = new Set(); P.error = ""; }

export function drillsPanel(ctx, state, today, rerender, setPending) {
  const { h } = ctx;
  const rows = drillStatus(state, today);
  const missing = rows.filter((r) => !r.task).length;
  const label = (r) => {
    if (!r.task) return "Not set up yet";
    if (!r.last) return "Never practiced";
    return `Last practiced ${fmtDate(r.last)}`;
  };
  return h("section", { class: "v-panel", "aria-labelledby": "v-drill-h" },
    h("h3", { id: "v-drill-h", class: "v-h3", text: "Practice drills" }),
    h("p", { class: "v-hint", text: "A plan only works if everyone has tried it. Do each drill, then tap Log it and note anything that went wrong. Each one comes back on Today when it is time." }),
    h("ul", { class: "v-plain v-drills" }, rows.map((r) => h("li", { class: "v-drill" },
      h("div", { class: "v-drill-main" },
        h("strong", { text: r.drill.title }),
        h("span", { class: `v-badge ${r.status === "overdue" ? "v-badge-overdue" : r.status === "due-soon" ? "v-badge-soon" : "v-badge-muted"}`, text: r.status === "overdue" ? "Overdue" : r.status === "due-soon" ? "Due soon" : r.task ? "On track" : "Off" }),
        h("span", { class: "v-meta", text: label(r) })),
      r.task && typeof ctx.completeTask === "function"
        ? h("button", { type: "button", class: "btn v-small", "data-fk": `drill-${r.task.id}`, "aria-label": `Log it: ${r.drill.title}`, text: "Log it", onclick: () => ctx.completeTask(r.task.id) }) : null))),
    missing && typeof ctx.commit === "function"
      ? h("button", { type: "button", class: "btn", "data-fk": "drill-add", text: `Add the ${missing === DRILLS.length ? "standard" : "missing"} drills (${missing})`,
          onclick: () => { try { const r = addMissingDrills(ctx.getState(), ctx.newId); setPending("drill-add"); ctx.commit(r.state, `Added ${r.added} ${r.added === 1 ? "drill" : "drills"}.`); } catch (e) { P.error = e.message; rerender(); } } })
      : null,
    P.error ? h("p", { class: "form-error", role: "alert", text: P.error }) : null);
}

export function houseInfoPanel(ctx, state, rerender, setPending) {
  const { h } = ctx;
  const list = ((state.emergency && state.emergency.houseInfo) || []);
  const save = (next, msg, fk) => {
    try { const s = updateEmergency(ctx.getState(), { houseInfo: next }); P.error = ""; setPending(fk); if (!ctx.commit(s, msg)) rerender(); }
    catch (e) { P.error = e.message || "Couldn't save that."; rerender(); }
  };
  const lab = h("input", { id: "hi-label", type: "text", maxlength: "60", placeholder: "For example: Spare key", autocomplete: "off", "data-fk": "hi-label" });
  const val = h("input", { id: "hi-value", type: "text", maxlength: "200", placeholder: "For example: under the blue pot by the back door", autocomplete: "off" });
  const form = h("form", { class: "v-form", novalidate: true, "aria-label": "Add house info", onsubmit: (e) => {
    e.preventDefault();
    if (!lab.value.trim()) { P.error = "Give it a name first, like “Spare key”."; rerender(); return; }
    save([...list, { label: lab.value.trim(), value: val.value.trim() }], "Saved.", "hi-label");
  } },
    h("div", { class: "field" }, h("label", { for: "hi-label", text: "What is it?" }), lab),
    h("div", { class: "chips" }, SUGGEST.filter((x) => !list.some((l) => l.label === x)).slice(0, 4).map((x) => h("button", { type: "button", class: "chip", text: x, onclick: () => { lab.value = x; val.focus(); } }))),
    h("div", { class: "field" }, h("label", { for: "hi-value", text: "Where or what" }), val),
    h("div", { class: "v-actions" }, h("button", { type: "submit", class: "btn primary solid", text: "Add" })));
  return h("section", { class: "v-panel", "aria-labelledby": "v-hi-h" },
    h("h3", { id: "v-hi-h", class: "v-h3", text: "House info: keys and codes" }),
    h("p", { class: "v-hint", text: "Spare key spots, door and gate codes, where the safe is. Everyone in your household can see these. They are hidden until you tap Show, and they are left off the printed emergency sheet. Please don't put bank or card numbers here." }),
    list.length ? h("ul", { class: "v-plain v-hi-list" }, list.map((it, i) => {
      const open = P.shown.has(i);
      return h("li", { class: "v-hi" },
        h("strong", { text: it.label }), " ",
        h("span", { class: "v-hi-val", text: open ? (it.value || "(blank)") : "••••••" }), " ",
        h("button", { type: "button", class: "btn subtle v-small", "aria-pressed": String(open), "aria-label": `${open ? "Hide" : "Show"} ${it.label}`, "data-fk": `hi-show-${i}`, text: open ? "Hide" : "Show",
          onclick: () => { if (open) P.shown.delete(i); else P.shown.add(i); setPending(`hi-show-${i}`); rerender(); } }), " ",
        h("button", { type: "button", class: "btn subtle v-small", "aria-label": `Remove ${it.label}`, text: "Remove",
          onclick: () => { P.shown = new Set(); save(list.filter((_, j) => j !== i), `Removed ${it.label}.`, "hi-label"); } }));
    })) : h("p", { class: "v-hint", text: "Nothing saved yet." }),
    list.length < HOUSE_INFO_MAX ? form : h("p", { class: "v-hint", text: `That's the most (${HOUSE_INFO_MAX}). Remove one to add another.` }),
    P.error ? h("p", { class: "form-error", role: "alert", text: P.error }) : null);
}
