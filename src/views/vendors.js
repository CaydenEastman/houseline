// Vendors view: plumber, HVAC, electrician... with phone/email and the items each one services.
import { addVendor, updateVendor, deleteVendor } from "../logic.js";
import { makePaint, plural } from "./shared.js";

export const id = "vendors";
export const label = "Contacts";
const S = { pending: null, form: null, confirmDel: null, q: "" };
const paint = makePaint(S);
const rid = () => "v-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const TRADES = ["Plumber", "HVAC", "Electrician", "Roofer", "Handyman", "Pest control", "Lawn / landscaping", "Auto repair", "Insurance", "Other"];

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}

const blank = (v) => ({ id: v ? v.id : null, name: v ? v.name : "", trade: v ? v.trade : "", phone: v ? v.phone : "", email: v ? v.email : "", notes: v ? v.notes : "", itemIds: v ? [...(v.itemIds || [])] : [], error: "" });

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const vendors = state.vendors || [];
  const items = state.items || [];
  const itemName = (i) => (items.find((x) => x.id === i) || {}).name;

  const save = () => {
    const f = S.form;
    try {
      const data = { name: f.name, trade: f.trade, phone: f.phone, email: f.email, notes: f.notes, itemIds: f.itemIds.filter((i) => items.some((x) => x.id === i)) };
      const next = f.id ? updateVendor(state, f.id, data) : addVendor(state, data, rid);
      S.form = null; S.pending = "v-vend-add";
      if (!ctx.commit(next, f.id ? `Saved ${data.name}` : `Added ${data.name}`)) rerender();
    } catch (e) { f.error = e && e.message ? e.message : "Couldn't save that."; S.pending = "v-vf-name"; rerender(); }
  };

  const field = (lbl, key, attrs = {}) => h("div", { class: "field" },
    h("label", { for: `v-vf-${key}`, text: lbl }),
    h("input", { id: `v-vf-${key}`, "data-fk": `v-vf-${key}`, value: S.form[key], maxlength: "120", ...attrs, oninput: (e) => { S.form[key] = e.target.value; } }));

  const form = S.form ? h("form", { class: "v-form", novalidate: true, "aria-label": S.form.id ? "Edit contact" : "Add contact", onsubmit: (e) => { e.preventDefault(); save(); } },
    h("h3", { class: "v-h3", text: S.form.id ? "Edit contact" : "Add contact" }),
    field("Name", "name", { required: true, autocomplete: "off" }),
    h("div", { class: "field" }, h("label", { for: "v-vf-trade", text: "Trade" }),
      h("input", { id: "v-vf-trade", "data-fk": "v-vf-trade", list: "v-trades", value: S.form.trade, maxlength: "100", oninput: (e) => { S.form.trade = e.target.value; } }),
      h("datalist", { id: "v-trades" }, TRADES.map((t) => h("option", { value: t })))),
    h("div", { class: "v-row2" }, field("Phone", "phone", { type: "tel", inputmode: "tel" }), field("Email", "email", { type: "email" })),
    items.length ? h("fieldset", { class: "v-contact" }, h("legend", { text: "Services these items" }),
      items.map((it) => h("div", { class: "v-check-opt" },
        h("input", { type: "checkbox", id: `v-vf-it-${it.id}`, checked: S.form.itemIds.includes(it.id) ? true : null,
          onchange: (e) => { S.form.itemIds = e.target.checked ? [...S.form.itemIds, it.id] : S.form.itemIds.filter((x) => x !== it.id); } }),
        h("label", { for: `v-vf-it-${it.id}`, text: it.name })))) : null,
    h("div", { class: "field" }, h("label", { for: "v-vf-notes", text: "Notes" }),
      h("textarea", { id: "v-vf-notes", rows: "2", maxlength: "2000", oninput: (e) => { S.form.notes = e.target.value; }, text: S.form.notes })),
    S.form.error ? h("p", { class: "form-error", role: "alert", text: S.form.error }) : null,
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn primary solid", text: "Save contact" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.form = null; S.pending = "v-vend-add"; rerender(); } }))) : null;

  const q = S.q.trim().toLowerCase();
  const shown = vendors.filter((v) => !q || [v.name, v.trade, v.notes, ...(v.itemIds || []).map(itemName)].filter(Boolean).join(" ").toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name));

  const card = (v) => h("li", { class: "v-card" },
    h("div", { class: "v-card-top" }, h("h3", { class: "v-card-title", text: v.name }), v.trade ? h("span", { class: "v-badge v-badge-muted", text: v.trade }) : null),
    v.phone ? h("p", {}, h("a", { href: `tel:${v.phone.replace(/[^\d+]/g, "")}`, text: v.phone })) : null,
    v.email ? h("p", {}, h("a", { href: `mailto:${v.email}`, text: v.email })) : null,
    (v.itemIds || []).length ? h("p", { class: "v-meta", text: `Services: ${v.itemIds.map(itemName).filter(Boolean).join(", ")}` }) : null,
    v.notes ? h("p", { class: "v-notes", text: v.notes }) : null,
    S.confirmDel === v.id
      ? h("div", { class: "v-confirm", role: "group", "aria-label": `Delete ${v.name}?` }, h("p", { text: `Delete ${v.name}?` }),
        h("div", { class: "v-actions" },
          h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.confirmDel = null; rerender(); } }),
          h("button", { type: "button", class: "btn danger", text: "Delete", onclick: () => { S.confirmDel = null; S.pending = "v-vend-add"; try { ctx.commit(deleteVendor(state, v.id), `Deleted ${v.name}`); } catch { rerender(); } } })))
      : h("div", { class: "v-actions" },
        h("button", { type: "button", class: "btn v-small", text: "Edit", "aria-label": `Edit ${v.name}`, onclick: () => { S.form = blank(v); S.pending = "v-vf-name"; rerender(); } }),
        h("button", { type: "button", class: "btn v-small", text: "Delete", "aria-label": `Delete ${v.name}`, onclick: () => { S.confirmDel = v.id; rerender(); } })));

  return h("section", { class: "v-view", "aria-labelledby": "v-vend-h" },
    h("div", { class: "v-head" }, h("h2", { id: "v-vend-h", class: "v-h2", text: "Contacts" }),
      h("button", { type: "button", class: "btn primary", id: "v-vend-add", "data-fk": "v-vend-add", text: "+ Add contact", onclick: () => { S.form = blank(null); S.pending = "v-vf-name"; rerender(); } })),
    h("p", { class: "v-lede", text: "Keep the people you call in one place, linked to the appliances and systems they service." }),
    form,
    vendors.length > 4 ? h("div", { class: "field" }, h("label", { for: "v-vend-q", text: "Search contacts" }),
      h("input", { id: "v-vend-q", type: "search", "data-fk": "v-vend-q", value: S.q, oninput: (e) => { S.q = e.target.value; S.pending = "v-vend-q"; rerender(); } })) : null,
    vendors.length === 0 && !S.form ? h("div", { class: "v-panel" }, h("h3", { class: "v-h3", text: "No contacts yet" }), h("p", { class: "v-hint", text: "Add your plumber, HVAC company or mechanic so the number is handy when something breaks." }))
      : h("ul", { class: "v-cards", "aria-label": plural(shown.length, "vendor") }, shown.map(card)));
}

export default { id, label, render };
