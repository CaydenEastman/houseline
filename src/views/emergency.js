// Emergency view: readiness score, supplies CRUD, emergency info form, printable sheet.
import { addSupply, updateSupply, deleteSupply, updateEmergency, daysBetween } from "../logic.js";
import { SUPPLY_STARTERS } from "../templates.js";
import { readiness, REQUIREMENTS, emergencySheetHTML, emergencySheetText } from "../readiness.js";
import { fmtDate, plural } from "../dom.js";

export const id = "emergency";
export const label = "Emergency";

const CATS = [["water", "Water"], ["food", "Food"], ["medical", "Medical"], ["power", "Power and light"], ["tools", "Tools"], ["docs", "Documents"], ["other", "Other"]];
const CAT_LABEL = Object.fromEntries(CATS);
const MAX_CONTACTS = 12;
// UI state that survives re-renders.
const S = { sup: null, confirmDel: null, info: null, infoDirty: false, infoMsg: "", infoErr: "", sheetMsg: "", pending: null };

const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

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

function infoFrom(em) {
  const e = em || {};
  const sh = e.shutoffs || {};
  return {
    contacts: (e.contacts || []).map((c) => ({ name: c.name || "", phone: c.phone || "", relation: c.relation || "" })),
    meetingPlace: e.meetingPlace || "", outOfAreaContact: e.outOfAreaContact || "",
    shutoffs: { water: sh.water || "", gas: sh.gas || "", electric: sh.electric || "" },
    notes: e.notes || "",
  };
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  if (!S.info || !S.infoDirty) S.info = infoFrom(state.emergency);
  let r;
  try { r = readiness(state, today); } catch { r = { score: 0, items: [], expiring: [], expired: [] }; }
  return h("section", { class: "v-view", "aria-labelledby": "v-em-h" },
    h("h2", { id: "v-em-h", class: "v-h2", text: "Emergency" }),
    h("p", { class: "v-lede", text: "A short plan and a stocked shelf beat a long plan nobody can find. Work top to bottom: check readiness, log your supplies, fill in the basics, then keep a copy of the sheet." }),
    readinessPanel(ctx, state, r, rerender),
    suppliesPanel(ctx, state, today, rerender),
    infoPanel(ctx, state, rerender),
    sheetPanel(ctx, state, today, rerender));
}

/* ---------- 1. readiness ---------- */
function readinessPanel(ctx, state, r, rerender) {
  const { h } = ctx;
  const startFor = (it) => {
    const s = (SUPPLY_STARTERS || []).find((x) => x.key === it.key);
    const req = (REQUIREMENTS || []).find((x) => x.key === it.key) || {};
    const cat = (s && s.category) || req.category;
    return { id: null, name: (s && s.name) || it.label, key: it.key, category: CAT_LABEL[cat] ? cat : "other",
      quantity: "", unit: (s && s.unit) || it.unit || "", expires: "", notes: (s && s.notes) || "", error: "", hint: `Needed for your household: ${num(it.needed)} ${it.unit || ""}`.trim() };
  };
  const label = r.score >= 80 ? "Well prepared" : r.score >= 40 ? "Getting there" : "Just starting";
  const fill = h("span", { class: "v-bar-fill v-score-fill" });
  if (fill.style) fill.style.width = `${r.score}%`;
  return h("section", { class: "v-panel", "aria-labelledby": "v-ready-h" },
    h("h3", { id: "v-ready-h", class: "v-h3", text: "1. Readiness" }),
    h("div", { class: "v-score" },
      h("p", { class: "v-score-num" }, h("span", { text: String(r.score) }), h("span", { class: "v-score-of", text: " / 100" })),
      h("div", { class: "v-score-body" },
        h("p", { class: "v-score-label", text: label }),
        h("div", { class: "v-bar v-bar-lg", role: "progressbar", "aria-label": "Readiness score", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(r.score) }, fill))),
    h("p", { class: "v-hint", text: "Based on a 3-day baseline sized for your household. It counts only supplies you've logged below that aren't expired." }),
    r.expired && r.expired.length ? h("p", { class: "v-warn", role: "status", text: `${plural(r.expired.length, "supply")} expired and not counted: ${r.expired.map((s) => s.name).join(", ")}.` }) : null,
    r.expiring && r.expiring.length ? h("p", { class: "v-warn", text: `Expiring within 60 days: ${r.expiring.map((e) => `${e.supply.name} (${e.daysLeft}d)`).join(", ")}.` }) : null,
    h("ul", { class: "v-checklist", "aria-label": "Readiness checklist" }, r.items.map((it) =>
      h("li", { class: `v-check v-check-${it.status}` },
        h("span", { class: `v-badge v-badge-${it.status === "ok" ? "ok" : it.status === "low" ? "soon" : "overdue"}`, text: it.status === "ok" ? "Have it" : it.status === "low" ? "Low" : "Missing" }),
        h("span", { class: "v-check-main" },
          h("span", { class: "v-check-label", text: it.label }),
          h("span", { class: "v-check-qty", text: `${num(it.have)} of ${num(it.needed)} ${it.unit || ""}`.trim() + (it.expiringSoon ? " · some expiring soon" : "") })),
        it.status !== "ok"
          ? h("button", { type: "button", class: "btn subtle v-small", "data-fk": `add-${it.key}`, "aria-label": `Add supply: ${it.label}`, text: "+ Add supply",
              onclick: () => { S.sup = startFor(it); S.confirmDel = null; S.pending = "v-sup-qty"; rerender(); } })
          : null))));
}

/* ---------- 2. supplies ---------- */
function expiryBadge(ctx, s, today) {
  if (!s.expires) return null;
  const left = daysBetween(today, s.expires);
  if (left < 0) return ctx.h("span", { class: "v-badge v-badge-overdue", text: `Expired ${fmtDate(s.expires)}` });
  if (left <= 60) return ctx.h("span", { class: "v-badge v-badge-soon", text: left === 0 ? "Expires today" : `Expires in ${plural(left, "day")}` });
  return ctx.h("span", { class: "v-badge v-badge-muted", text: `Expires ${fmtDate(s.expires)}` });
}

function suppliesPanel(ctx, state, today, rerender) {
  const { h } = ctx;
  const sups = (state.supplies || []).slice().sort((a, b) => (a.category + a.name).localeCompare(b.category + b.name));
  return h("section", { class: "v-panel", "aria-labelledby": "v-sup-h" },
    h("div", { class: "v-head" },
      h("h3", { id: "v-sup-h", class: "v-h3", text: "2. Supplies" }),
      h("button", { type: "button", class: "btn v-primary", "data-fk": "v-sup-add", "aria-expanded": S.sup && !S.sup.id ? "true" : "false",
        onclick: () => { S.sup = { id: null, name: "", key: "", category: "other", quantity: "", unit: "", expires: "", notes: "", error: "", hint: "" }; S.pending = "v-sup-name"; rerender(); }, text: "Add supply" })),
    S.sup && !S.sup.id ? supplyForm(ctx, rerender) : null,
    sups.length === 0 && !S.sup
      ? h("div", { class: "empty" }, h("div", { class: "empty-art", "aria-hidden": "true", text: "\u{1F9F0}" }),
          h("h3", { text: "No supplies logged" }),
          h("p", { text: "Use the + Add supply buttons in the checklist above, or Add supply to log water, food, batteries, a first-aid kit and more." }))
      : h("ul", { class: "v-cards" }, sups.map((s) => supplyCard(ctx, state, today, s, rerender))));
}

function supplyCard(ctx, state, today, s, rerender) {
  const { h } = ctx;
  if (S.sup && S.sup.id === s.id) return h("li", { class: "v-card" }, supplyForm(ctx, rerender));
  const confirming = S.confirmDel === s.id;
  const req = s.key ? (REQUIREMENTS || []).find((x) => x.key === s.key) : null;
  return h("li", { class: "v-card" },
    h("div", { class: "v-card-top" },
      h("h4", { class: "v-card-title", text: s.name }),
      expiryBadge(ctx, s, today)),
    h("p", { class: "v-meta", text: `${num(s.quantity)} ${s.unit || ""}`.trim() + ` · ${CAT_LABEL[s.category] || s.category}` + (req ? ` · counts toward "${req.label}"` : "") }),
    s.notes ? h("p", { class: "v-notes", text: s.notes }) : null,
    confirming
      ? h("div", { class: "v-confirm", role: "alertdialog", "aria-label": `Delete ${s.name}?` },
          h("p", { text: `Delete "${s.name}" from your supplies?` }),
          h("div", { class: "v-actions" },
            h("button", { type: "button", class: "btn danger", text: "Delete", "data-fk": `sd-yes-${s.id}`,
              onclick: () => { try { const next = deleteSupply(ctx.getState(), s.id); S.confirmDel = null; S.pending = "v-sup-add"; ctx.commit(next, `Deleted ${s.name}`); } catch (e) { ctx.toast(e.message || "Something went wrong.", { error: true }); } } }),
            h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": `sd-no-${s.id}`, onclick: () => { S.confirmDel = null; S.pending = `sd-${s.id}`; rerender(); } })))
      : h("div", { class: "v-actions" },
          h("button", { type: "button", class: "btn subtle", "data-fk": `se-${s.id}`, "aria-label": `Edit ${s.name}`, text: "Edit",
            onclick: () => { S.sup = { id: s.id, name: s.name, key: s.key || "", category: s.category, quantity: String(s.quantity), unit: s.unit || "", expires: s.expires || "", notes: s.notes || "", error: "", hint: "" }; S.confirmDel = null; S.pending = "v-sup-name"; rerender(); } }),
          h("button", { type: "button", class: "btn subtle danger", "data-fk": `sd-${s.id}`, "aria-label": `Delete ${s.name}`, text: "Delete",
            onclick: () => { S.confirmDel = s.id; S.pending = `sd-no-${s.id}`; rerender(); } })));
}

function supplyForm(ctx, rerender) {
  const { h } = ctx;
  const d = S.sup;
  const isNew = !d.id;
  const bind = (k) => (e) => { d[k] = e.target.value; };
  const submit = (e) => {
    e.preventDefault();
    const name = d.name.trim();
    const q = String(d.quantity).trim();
    const fail = (msg, fk) => { d.error = msg; S.pending = fk; rerender(); };
    if (!name) return fail("Please name the supply.", "v-sup-name");
    if (!/^\d+(\.\d+)?$/.test(q)) return fail("Enter how many you have as a number, like 6 or 2.5 (use 0 if none).", "v-sup-qty");
    const data = { name, key: d.key || null, category: d.category, quantity: Number(q), unit: d.unit.trim(), expires: d.expires || null, notes: d.notes.trim() };
    try {
      const st = ctx.getState();
      const next = isNew ? addSupply(st, data, rid) : updateSupply(st, d.id, data);
      S.sup = null; S.pending = isNew ? "v-sup-add" : `se-${d.id}`;
      ctx.commit(next, isNew ? `Added ${name}` : `Saved ${name}`);
    } catch (err) { fail(err.message || "Couldn't save this supply.", "v-sup-name"); }
  };
  const field = (key, lab, o = {}) => h("div", { class: "field" },
    h("label", { for: `v-sup-${key}`, text: lab }),
    h("input", { id: `v-sup-${key}`, "data-fk": `v-sup-${key}`, type: o.type || "text", value: d[key], maxlength: o.max || 120, autocomplete: "off",
      inputmode: o.inputmode || null, "aria-required": o.required ? "true" : null, oninput: bind(key), onchange: bind(key) }));
  return h("form", { class: "v-form", novalidate: true, onsubmit: submit, "aria-label": isNew ? "Add a supply" : `Edit ${d.name}` },
    h("h4", { class: "v-h3", text: isNew ? "Add a supply" : `Edit ${d.name}` }),
    isNew && (SUPPLY_STARTERS || []).length
      ? h("div", { class: "field" },
          h("label", { for: "v-sup-starter", text: "Start from a common item (optional)" }),
          h("select", { id: "v-sup-starter", "data-fk": "v-sup-starter",
            onchange: (e) => {
              const s = SUPPLY_STARTERS[Number(e.target.value)];
              if (!s) return;
              Object.assign(d, { name: s.name, key: s.key || "", category: CAT_LABEL[s.category] ? s.category : "other", unit: s.unit || "", notes: s.notes || "" });
              S.pending = "v-sup-qty"; rerender();
            } },
            h("option", { value: "", text: "Choose…" }),
            SUPPLY_STARTERS.map((s, i) => h("option", { value: String(i), text: s.name }))))
      : null,
    field("name", "Name (required)", { required: true }),
    h("div", { class: "v-row2" },
      field("quantity", "How many do you have? (required)", { inputmode: "decimal", max: 12, required: true }),
      field("unit", "Unit (gallons, cans, …)", { max: 40 })),
    d.hint ? h("p", { class: "v-hint", text: d.hint }) : null,
    h("div", { class: "v-row2" },
      h("div", { class: "field" }, h("label", { for: "v-sup-category", text: "Category" }),
        h("select", { id: "v-sup-category", "data-fk": "v-sup-category", onchange: bind("category") },
          CATS.map(([k, l]) => h("option", { value: k, selected: d.category === k, text: l })))),
      field("expires", "Expires (optional)", { type: "date" })),
    h("div", { class: "field" }, h("label", { for: "v-sup-key", text: "Counts toward readiness item (optional)" }),
      h("select", { id: "v-sup-key", "data-fk": "v-sup-key", onchange: bind("key") },
        h("option", { value: "", selected: !d.key, text: "None" }),
        (REQUIREMENTS || []).map((r) => h("option", { value: r.key, selected: d.key === r.key, text: r.label })))),
    h("div", { class: "field" }, h("label", { for: "v-sup-notes", text: "Notes" }),
      h("textarea", { id: "v-sup-notes", rows: "2", maxlength: "500", "data-fk": "v-sup-notes", oninput: bind("notes"), onchange: bind("notes"), text: d.notes })),
    h("p", { class: "form-error", role: "alert", text: d.error }),
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn v-primary", text: isNew ? "Add supply" : "Save changes" }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => { S.pending = isNew ? "v-sup-add" : `se-${d.id}`; S.sup = null; rerender(); } })));
}

/* ---------- 3. emergency info ---------- */
function infoPanel(ctx, state, rerender) {
  const { h } = ctx;
  const d = S.info;
  const dirty = () => { S.infoDirty = true; S.infoMsg = ""; };
  const bind = (obj, key) => (e) => { obj[key] = e.target.value; dirty(); };
  const txt = (obj, key, idv, lab, o = {}) => h("div", { class: "field" },
    h("label", { for: idv, text: lab }),
    h("input", { id: idv, "data-fk": idv, type: "text", value: obj[key], maxlength: "500", autocomplete: "off", "aria-describedby": o.hint ? `${idv}-hint` : null, oninput: bind(obj, key), onchange: bind(obj, key) }),
    o.hint ? h("p", { id: `${idv}-hint`, class: "v-hint", text: o.hint }) : null);
  const submit = (e) => {
    e.preventDefault();
    S.infoErr = "";
    const contacts = d.contacts.map((c) => ({ name: c.name.trim(), phone: c.phone.trim(), relation: c.relation.trim() }))
      .filter((c) => c.name || c.phone || c.relation);
    const bad = contacts.findIndex((c) => !c.name);
    if (bad >= 0) { S.infoErr = "Each contact needs a name. Remove the row or add one."; S.pending = "v-info-err"; return rerender(); }
    try {
      const next = updateEmergency(ctx.getState(), {
        contacts, meetingPlace: d.meetingPlace.trim(), outOfAreaContact: d.outOfAreaContact.trim(),
        shutoffs: { water: d.shutoffs.water.trim(), gas: d.shutoffs.gas.trim(), electric: d.shutoffs.electric.trim() },
        notes: d.notes.trim(),
      });
      S.infoDirty = false; S.infoMsg = "Saved."; S.info = null; S.pending = "v-info-save";
      ctx.commit(next, "Emergency info saved");
    } catch (err) { S.infoErr = err.message || "Couldn't save."; S.pending = "v-info-err"; rerender(); }
  };
  return h("section", { class: "v-panel", "aria-labelledby": "v-info-h" },
    h("h3", { id: "v-info-h", class: "v-h3", text: "3. Emergency info" }),
    h("p", { class: "v-warn v-warn-box", role: "note" },
      h("strong", { text: "Don't store sensitive numbers here. " }),
      "No Social Security numbers, bank or credit card numbers, or insurance policy and account numbers. This page isn't a vault. Write where those documents are kept instead."),
    h("form", { class: "v-form", novalidate: true, onsubmit: submit, "aria-label": "Emergency information" },
      h("h4", { class: "v-h4", text: "Contacts" }),
      d.contacts.length === 0 ? h("p", { class: "v-hint", text: "No contacts yet. Add family, neighbors, your doctor." }) : null,
      d.contacts.map((c, i) => h("fieldset", { class: "v-contact" },
        h("legend", { text: `Contact ${i + 1}` }),
        h("div", { class: "v-row3" },
          txt(c, "name", `v-c-name-${i}`, "Name"), txt(c, "phone", `v-c-phone-${i}`, "Phone"), txt(c, "relation", `v-c-rel-${i}`, "Relationship")),
        h("button", { type: "button", class: "btn subtle danger v-small", "data-fk": `v-c-rm-${i}`, "aria-label": `Remove contact ${i + 1}`, text: "Remove",
          onclick: () => { d.contacts.splice(i, 1); dirty(); S.pending = "v-c-add"; rerender(); } }))),
      d.contacts.length < MAX_CONTACTS
        ? h("button", { type: "button", class: "btn", "data-fk": "v-c-add", text: "+ Add contact",
            onclick: () => { d.contacts.push({ name: "", phone: "", relation: "" }); dirty(); S.pending = `v-c-name-${d.contacts.length - 1}`; rerender(); } })
        : h("p", { class: "v-hint", text: `That's the maximum of ${MAX_CONTACTS} contacts.` }),
      h("h4", { class: "v-h4", text: "Where to meet and who to call" }),
      txt(d, "meetingPlace", "v-meet", "Family meeting place", { hint: "Somewhere outside the home, and a second spot outside the neighborhood." }),
      txt(d, "outOfAreaContact", "v-ooa", "Out-of-area contact", { hint: "Someone far away everyone can call or text, when local lines are jammed." }),
      h("h4", { class: "v-h4", text: "Utility shutoffs" }),
      h("div", { class: "v-row3" },
        txt(d.shutoffs, "water", "v-sh-water", "Water main"), txt(d.shutoffs, "gas", "v-sh-gas", "Gas shutoff"), txt(d.shutoffs, "electric", "v-sh-elec", "Electric panel")),
      h("div", { class: "field" }, h("label", { for: "v-info-notes", text: "Other notes" }),
        h("textarea", { id: "v-info-notes", rows: "3", maxlength: "500", "data-fk": "v-info-notes", oninput: bind(d, "notes"), onchange: bind(d, "notes"), text: d.notes })),
      h("p", { id: "v-info-err", class: "form-error", role: "alert", tabindex: "-1", "data-fk": "v-info-err", text: S.infoErr }),
      h("div", { class: "v-actions" },
        h("button", { type: "submit", class: "btn v-primary", "data-fk": "v-info-save", text: "Save emergency info" }),
        h("span", { class: "v-hint", role: "status", text: S.infoDirty ? "Unsaved changes" : S.infoMsg }))));
}

/* ---------- 4. sheet ---------- */
function sheetPanel(ctx, state, today, rerender) {
  const { h } = ctx;
  let text = "";
  try { text = emergencySheetText(state, today); } catch (e) { text = `Couldn't build the sheet: ${e.message}`; }
  const say = (m, fk) => { S.sheetMsg = m; S.pending = fk; rerender(); };
  const copy = async () => {
    try {
      const nav = ctx.doc.defaultView && ctx.doc.defaultView.navigator;
      if (!nav || !nav.clipboard || !nav.clipboard.writeText) throw new Error("no clipboard");
      await nav.clipboard.writeText(text);
      say("Copied to your clipboard.", "v-sheet-copy");
    } catch { say("Copying was blocked here. Click in the text above, select it (Ctrl/Cmd+A) and copy it yourself.", "v-sheet-text"); }
  };
  const download = async () => {
    let ok = false;
    try { ok = await ctx.saveFile(`emergency-sheet-${today}.html`, emergencySheetHTML(state, today), "text/html"); } catch { ok = false; }
    say(ok ? "Downloaded. Open the file, then press Ctrl+P (Cmd+P on a Mac) to print or save as PDF."
      : "Downloading isn't available here, or was cancelled. Use Copy text instead.", "v-sheet-dl");
  };
  return h("section", { class: "v-panel", "aria-labelledby": "v-sheet-h" },
    h("h3", { id: "v-sheet-h", class: "v-h3", text: "4. Emergency sheet" }),
    h("p", { class: "v-lede", text: "One page with your contacts, shutoffs and readiness. Keep a paper copy on the fridge or in your go-bag, since phones die." }),
    h("p", { class: "v-hint", text: "This page has no print button. Download the sheet, open the file in your browser, then press Ctrl+P (Cmd+P on a Mac). People and pets from the Family screen are included. The sheet uses your saved info, so save the form above first." }),
    h("div", { class: "v-actions" },
      h("button", { type: "button", class: "btn v-primary", "data-fk": "v-sheet-dl", text: "Download .html", onclick: download }),
      h("button", { type: "button", class: "btn", "data-fk": "v-sheet-copy", text: "Copy text", onclick: copy })),
    h("p", { class: "v-hint", role: "status", text: S.sheetMsg }),
    h("details", { class: "v-details" },
      h("summary", { text: "Preview" }),
      h("pre", { class: "v-pre", tabindex: "0", id: "v-sheet-text", "data-fk": "v-sheet-text", "aria-label": "Emergency sheet text", text })));
}

export default { id, label, render };
