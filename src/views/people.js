// People view: the people (and pets) in the home, with the few things someone would need in an emergency.
// Everything here is visible to everyone who shares the household, and the screen says so.
import { addPerson, updatePerson, deletePerson, PEOPLE_MAX, PERSON_KINDS, PERSON_KIND_LABEL, BLOOD_TYPES } from "../logic.js";
import { makePaint } from "./shared.js";

export const id = "people";
export const label = "Family";
const S = { pending: null, form: null, confirmDel: null };
const paint = makePaint(S);
const rid = () => "p-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}
export function resetPeopleView() { S.pending = null; S.form = null; S.confirmDel = null; }

const blank = (p) => ({ id: p ? p.id : null, name: p ? p.name : "", kind: p ? p.kind : "adult", phone: p ? p.phone : "", bloodType: p ? p.bloodType : "",
  allergies: p ? p.allergies : "", medical: p ? p.medical : "", doctor: p ? p.doctor : "", things: p ? p.things : "", needs: p ? p.needs : "", error: "" });
const hasDetails = (f) => !!(f.phone || f.bloodType || f.allergies || f.medical || f.doctor || f.things || f.needs);

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const people = state.people || [];

  const save = () => {
    const f = S.form;
    try {
      const data = { name: f.name, kind: f.kind, phone: f.phone, bloodType: f.bloodType, allergies: f.allergies, medical: f.medical, doctor: f.doctor, things: f.things, needs: f.needs };
      const next = f.id ? updatePerson(state, f.id, data) : addPerson(state, data, rid);
      S.form = null; S.pending = "v-ppl-add";
      if (!ctx.commit(next, f.id ? `Saved ${data.name}` : `Added ${data.name}`)) rerender();
    } catch (e) { f.error = e && e.message ? e.message : "Couldn't save that."; S.pending = "v-pf-name"; rerender(); }
  };

  const text = (lbl, key, attrs = {}, hint) => h("div", { class: "field" },
    h("label", { for: `v-pf-${key}`, text: lbl }),
    h("input", { id: `v-pf-${key}`, "data-fk": `v-pf-${key}`, value: S.form[key], maxlength: "300", autocomplete: "off", ...attrs, oninput: (e) => { S.form[key] = e.target.value; } }),
    hint ? h("p", { class: "hint", text: hint }) : null);
  const area = (lbl, key, hint) => h("div", { class: "field" },
    h("label", { for: `v-pf-${key}`, text: lbl }),
    h("textarea", { id: `v-pf-${key}`, "data-fk": `v-pf-${key}`, rows: "2", maxlength: "500", oninput: (e) => { S.form[key] = e.target.value; }, text: S.form[key] }),
    hint ? h("p", { class: "hint", text: hint }) : null);

  const pet = S.form && S.form.kind === "pet";
  const form = S.form ? h("form", { class: "v-form", "aria-label": S.form.id ? "Edit person" : "Add person", onsubmit: (e) => { e.preventDefault(); save(); } },
    h("h3", { class: "v-h3", text: S.form.id ? "Edit" : "Add someone" }),
    text("Name", "name", { required: true }),
    h("div", { class: "field" }, h("label", { for: "v-pf-kind", text: "Who is this?" }),
      h("select", { id: "v-pf-kind", "data-fk": "v-pf-kind", onchange: (e) => { S.form.kind = e.target.value; S.pending = "v-pf-kind"; rerender(); } },
        PERSON_KINDS.map((k) => h("option", { value: k, text: PERSON_KIND_LABEL[k], selected: S.form.kind === k })))),
    h("details", { class: "v-more", open: S.form.id && hasDetails(S.form) ? true : null },
      h("summary", { text: "Emergency details (optional)" }),
      h("p", { class: "hint", text: "Everyone who shares this household can see and edit this. Don't enter Social Security, insurance or policy numbers." }),
      pet ? null : text("Phone", "phone", { type: "tel", inputmode: "tel", maxlength: "60" }),
      text("Allergies", "allergies", {}, "Food, medicine, stings. Leave blank if none or not sure."),
      pet ? null : h("div", { class: "field" }, h("label", { for: "v-pf-bloodType", text: "Blood type" }),
        h("select", { id: "v-pf-bloodType", "data-fk": "v-pf-bloodType", onchange: (e) => { S.form.bloodType = e.target.value; } },
          BLOOD_TYPES.map((b) => h("option", { value: b, text: b || "Not sure", selected: S.form.bloodType === b })))),
      area(pet ? "Medicine or health notes" : "Medicines and health conditions", "medical", "Only what a helper would need to know."),
      text(pet ? "Vet and phone" : "Doctor and phone", "doctor"),
      text("Needs in an emergency", "needs", {}, pet ? "For example food, leash, carrier" : "For example insulin, glasses, formula"),
      area("Good to know", "things", "For example afraid of the dark, needs help walking, microchip number")),
    S.form.error ? h("p", { class: "form-error", role: "alert", text: S.form.error }) : null,
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn primary solid", text: "Save" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.form = null; S.pending = "v-ppl-add"; rerender(); } }))) : null;

  const line = (lbl, v) => (v ? h("p", { class: "v-meta" }, h("strong", { text: `${lbl}: ` }), v) : null);
  const card = (p) => h("li", { class: "v-card" },
    h("div", { class: "v-card-top" }, h("h3", { class: "v-card-title", text: p.name }), h("span", { class: "v-badge v-badge-muted", text: PERSON_KIND_LABEL[p.kind] })),
    p.phone ? h("p", {}, h("a", { href: `tel:${p.phone.replace(/[^\d+]/g, "")}`, text: p.phone })) : null,
    line("Allergies", p.allergies), line("Blood type", p.bloodType), line("Health", p.medical), line(p.kind === "pet" ? "Vet" : "Doctor", p.doctor),
    line("Needs", p.needs), line("Good to know", p.things),
    S.confirmDel === p.id
      ? h("div", { class: "v-confirm", role: "group", "aria-label": `Delete ${p.name}?` }, h("p", { text: `Remove ${p.name}'s details?` }),
        h("div", { class: "v-actions" },
          h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.confirmDel = null; rerender(); } }),
          h("button", { type: "button", class: "btn danger", text: "Remove", onclick: () => { S.confirmDel = null; try { ctx.commit(deletePerson(state, p.id), `Removed ${p.name}`); } catch { rerender(); } } })))
      : h("div", { class: "v-actions" },
        h("button", { type: "button", class: "btn v-small", text: "Edit", "aria-label": `Edit ${p.name}`, onclick: () => { S.form = blank(p); S.pending = "v-pf-name"; rerender(); } }),
        h("button", { type: "button", class: "btn v-small", text: "Remove", "aria-label": `Remove ${p.name}`, onclick: () => { S.confirmDel = p.id; rerender(); } })));

  const addBtn = people.length >= PEOPLE_MAX ? null
    : h("button", { type: "button", class: "btn primary", id: "v-ppl-add", "data-fk": "v-ppl-add", text: "+ Add someone", onclick: () => { S.form = blank(null); S.pending = "v-pf-name"; rerender(); } });

  return h("section", { class: "v-view", "aria-labelledby": "v-ppl-h" },
    h("div", { class: "v-head" }, h("h2", { id: "v-ppl-h", class: "v-h2", text: "Family" }), addBtn),
    h("p", { class: "v-lede", text: "Who lives here, and what a helper would need to know about each person or pet. These details go on your printable emergency sheet." }),
    h("p", { class: "invited-note", role: "note", text: "Everyone who shares this household can see and edit this page. It's saved on the app's server and is included in backups. Keep it to what helps in an emergency." }),
    form,
    people.length === 0 && !S.form
      ? h("div", { class: "v-panel" }, h("h3", { class: "v-h3", text: "No one added yet" }),
        h("p", { class: "v-hint", text: "Add the people and pets in your home so your emergency sheet knows who needs what. Only a name is required." }))
      : h("ul", { class: "v-cards", "aria-label": `${people.length} ${people.length === 1 ? "entry" : "entries"}` }, people.map(card)));
}

export default { id, label, render };
