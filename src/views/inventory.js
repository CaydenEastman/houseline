// Inventory view: home items (appliances, HVAC, ...) with warranty badges, photos, linked tasks.
import { addItem, updateItem, deleteItem, dueInfo, statusOf, sortTasks, daysBetween } from "../logic.js";
import { fmtDate } from "../dom.js";

export const id = "inventory";
export const label = "Inventory";

const KINDS = [
  ["appliance", "Appliance"], ["hvac", "Heating and cooling"], ["plumbing", "Plumbing"],
  ["electrical", "Electrical"], ["paint", "Paint"], ["exterior", "Exterior"], ["other", "Other"],
];
const KIND_LABEL = Object.fromEntries(KINDS);
const MAX_PHOTOS = 3;
// UI state that survives re-renders (commit re-renders every view).
const S = { form: null, confirmDel: null, pending: null };

const rid = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

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

function emptyDraft(item) {
  return {
    id: item ? item.id : null,
    name: item ? item.name : "", kind: item ? item.kind : "appliance",
    location: item ? item.location || "" : "", model: item ? item.model || "" : "",
    filterSize: item ? item.filterSize || "" : "",
    purchaseDate: item ? item.purchaseDate || "" : "", warrantyExpires: item ? item.warrantyExpires || "" : "",
    notes: item ? item.notes || "" : "",
    photoIds: item ? [...(item.photoIds || [])] : [],
    added: [],   // photos uploaded during this edit (removed again on cancel)
    removed: [], // saved photos the user detached (deleted on save)
    error: "", busy: false,
  };
}

function dueText(task, state, today) {
  let info;
  try { info = dueInfo(task, state, today); } catch { return ""; }
  if (task.snoozedUntil && task.snoozedUntil > today) return `Snoozed until ${fmtDate(task.snoozedUntil)}`;
  if (info.basis === "miles" && info.milesLeft != null) {
    return info.milesLeft <= 0 ? `${Math.abs(info.milesLeft).toLocaleString()} mi overdue` : `~${info.milesLeft.toLocaleString()} mi left`;
  }
  const d = info.daysUntil;
  if (d == null) return "";
  if (d < 0) return `${plural(-d, "day")} overdue`;
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}

function warrantyBadge(ctx, item, today) {
  if (!item.warrantyExpires) return null;
  const left = daysBetween(today, item.warrantyExpires);
  let text, cls;
  if (left < 0) { text = `Warranty expired ${fmtDate(item.warrantyExpires)}`; cls = left >= -30 ? "v-badge-overdue" : "v-badge-muted"; }
  else if (left <= 60) { text = left === 0 ? "Warranty ends today" : `Warranty ends in ${plural(left, "day")}`; cls = "v-badge-soon"; }
  else { text = `Warranty until ${fmtDate(item.warrantyExpires)}`; cls = "v-badge-ok"; }
  return ctx.h("span", { class: `v-badge ${cls}`, text });
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const items = state.items || [];
  const grouped = KINDS.map(([k, lab]) => [k, lab, items.filter((i) => i.kind === k).sort((a, b) => a.name.localeCompare(b.name))]).filter((g) => g[2].length);
  const editingNew = S.form && !S.form.id;

  return h("section", { class: "v-view", "aria-labelledby": "v-inv-h" },
    h("div", { class: "v-head" },
      h("h2", { id: "v-inv-h", class: "v-h2", text: "Inventory" }),
      h("button", { type: "button", class: "btn v-primary", "data-fk": "v-inv-add", "aria-expanded": editingNew ? "true" : "false",
        onclick: () => { S.form = emptyDraft(null); S.pending = "v-item-name"; rerender(); }, text: "Add item" })),
    h("p", { class: "v-lede", text: "Keep model numbers, filter sizes and warranty dates for the things in your home, so you're not hunting for them when something breaks." }),
    editingNew ? itemForm(ctx, rerender) : null,
    items.length === 0 && !editingNew
      ? h("div", { class: "empty" },
          h("div", { class: "empty-art", "aria-hidden": "true", text: "\u{1F9F0}" }),
          h("h3", { text: "No items yet" }),
          h("p", { text: "Add your furnace, water heater, fridge or anything with a model number or a warranty. You can then attach maintenance tasks to it." }))
      : null,
    grouped.map(([k, lab, list]) =>
      h("section", { class: "v-group", "aria-label": lab },
        h("h3", { class: "v-h3", text: `${lab} (${list.length})` }),
        h("ul", { class: "v-cards" }, list.map((it) => itemCard(ctx, state, today, it, rerender))))));
}

function itemCard(ctx, state, today, item, rerender) {
  const { h } = ctx;
  if (S.form && S.form.id === item.id) return h("li", { class: "v-card" }, itemForm(ctx, rerender));
  const tasks = sortTasks((state.tasks || []).filter((t) => t.itemId === item.id), today, state);
  const facts = [
    item.location ? ["Where", item.location] : null,
    item.model ? ["Model", item.model] : null,
    item.filterSize ? ["Filter size", item.filterSize] : null,
    item.purchaseDate ? ["Purchased", fmtDate(item.purchaseDate)] : null,
  ].filter(Boolean);
  const photos = (item.photoIds || []).map((pid, i) => photoImg(ctx, pid, `${item.name}, photo ${i + 1}`));
  const confirming = S.confirmDel === item.id;
  return h("li", { class: "v-card" },
    h("div", { class: "v-card-top" },
      h("h4", { class: "v-card-title", text: item.name }),
      warrantyBadge(ctx, item, today)),
    facts.length ? h("dl", { class: "v-facts" }, facts.map(([k, v]) => h("div", { class: "v-fact" }, h("dt", { text: k }), h("dd", { text: v })))) : null,
    item.notes ? h("p", { class: "v-notes", text: item.notes }) : null,
    photos.length ? h("div", { class: "v-thumbs" }, photos) : null,
    h("div", { class: "v-linked" },
      h("h5", { class: "v-h5", text: "Maintenance tasks" }),
      tasks.length
        ? h("ul", { class: "v-mini" }, tasks.map((t) => {
            let st = "ok"; try { st = statusOf(t, today, state); } catch { /* ignore */ }
            return h("li", { class: `v-mini-row v-st-${st}` }, h("span", { class: "v-mini-title", text: t.title }), h("span", { class: "v-mini-due", text: dueText(t, state, today) }));
          }))
        : h("p", { class: "v-hint", text: "No tasks linked to this item yet." })),
    confirming
      ? h("div", { class: "v-confirm", role: "alertdialog", "aria-label": `Delete ${item.name}?` },
          h("p", { text: `Delete "${item.name}"? Its photos are removed. Linked tasks stay but lose the link.` }),
          h("div", { class: "v-actions" },
            h("button", { type: "button", class: "btn danger", "data-fk": `del-yes-${item.id}`, text: "Yes, delete",
              onclick: () => {
                try {
                  const next = deleteItem(state, item.id);
                  S.confirmDel = null; S.pending = "v-inv-add";
                  ctx.commit(next, `Deleted ${item.name}`);
                  (item.photoIds || []).forEach((p) => { try { Promise.resolve(ctx.photos.remove(p)).catch(() => {}); } catch { /* ignore */ } });
                } catch (e) { ctx.toast(e.message); }
              } }),
            h("button", { type: "button", class: "btn", text: "Cancel", "data-fk": `del-no-${item.id}`,
              onclick: () => { S.confirmDel = null; S.pending = `del-${item.id}`; rerender(); } })))
      : h("div", { class: "v-actions" },
          h("button", { type: "button", class: "btn", "data-fk": `task-${item.id}`, text: "Add maintenance task for this item",
            onclick: () => ctx.openTaskForm({ itemId: item.id }) }),
          h("button", { type: "button", class: "btn subtle", "data-fk": `edit-${item.id}`, "aria-label": `Edit ${item.name}`, text: "Edit",
            onclick: () => { S.form = emptyDraft(item); S.confirmDel = null; S.pending = "v-item-name"; rerender(); } }),
          h("button", { type: "button", class: "btn subtle danger", "data-fk": `del-${item.id}`, "aria-label": `Delete ${item.name}`, text: "Delete",
            onclick: () => { S.confirmDel = item.id; S.pending = `del-no-${item.id}`; rerender(); } })));
}

function photoImg(ctx, pid, alt, extra) {
  const { h } = ctx;
  const img = h("img", { class: "v-thumb-img", alt, width: "64", height: "64" });
  Promise.resolve(ctx.photos.url(pid)).then((u) => { if (u) img.setAttribute("src", u); }).catch(() => {});
  return extra ? h("span", { class: "v-thumb-wrap" }, img, extra) : h("span", { class: "v-thumb-plain" }, img);
}

function itemForm(ctx, rerender) {
  const { h } = ctx;
  const d = S.form;
  const isNew = !d.id;
  const bind = (key) => (e) => { d[key] = e.target.value; };
  const txt = (key, lab, o = {}) => {
    const fid = `v-item-${key}`;
    return h("div", { class: "field" },
      h("label", { for: fid, text: lab }),
      h("input", { id: fid, type: o.type || "text", value: d[key], maxlength: o.max || 200, autocomplete: "off",
        "data-fk": key === "name" ? "v-item-name" : fid, "aria-describedby": o.hint ? `${fid}-hint` : null,
        "aria-required": o.required ? "true" : null, oninput: bind(key), onchange: bind(key) }),
      o.hint ? h("p", { id: `${fid}-hint`, class: "v-hint", text: o.hint }) : null);
  };
  const cancel = () => {
    d.added.forEach((p) => { try { Promise.resolve(ctx.photos.remove(p)).catch(() => {}); } catch { /* ignore */ } });
    S.pending = isNew ? "v-inv-add" : `edit-${d.id}`; S.form = null; rerender();
  };
  const submit = (e) => {
    e.preventDefault();
    const name = d.name.trim();
    if (!name) { d.error = "Please give the item a name."; S.pending = "v-item-name"; return rerender(); }
    if (name.length > 120) { d.error = "The name must be 120 characters or fewer."; S.pending = "v-item-name"; return rerender(); }
    if (d.purchaseDate && d.warrantyExpires && d.warrantyExpires < d.purchaseDate) {
      d.error = "The warranty can't end before the purchase date."; S.pending = "v-item-warrantyExpires"; return rerender();
    }
    const data = {
      name, kind: d.kind, location: d.location.trim(), model: d.model.trim(), filterSize: d.filterSize.trim(),
      purchaseDate: d.purchaseDate || null, warrantyExpires: d.warrantyExpires || null,
      notes: d.notes.trim(), photoIds: d.photoIds.slice(0, MAX_PHOTOS),
    };
    try {
      const st = ctx.getState();
      const next = isNew ? addItem(st, data, rid) : updateItem(st, d.id, data);
      const removed = d.removed.slice();
      S.form = null; S.pending = isNew ? "v-inv-add" : `edit-${d.id}`;
      ctx.commit(next, isNew ? `Added ${name}` : `Saved ${name}`);
      removed.forEach((p) => { try { Promise.resolve(ctx.photos.remove(p)).catch(() => {}); } catch { /* ignore */ } });
    } catch (err) {
      d.error = err && err.message ? err.message : "Couldn't save this item."; S.pending = "v-item-name"; rerender();
    }
  };
  const onFiles = async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    d.error = ""; d.busy = true;
    for (const f of files) {
      if (d.photoIds.length >= MAX_PHOTOS) { d.error = `You can attach up to ${MAX_PHOTOS} photos.`; break; }
      try { const pid = await ctx.photos.add(f); d.photoIds.push(pid); d.added.push(pid); }
      catch (err) { d.error = err && err.message ? err.message : "That photo couldn't be added."; break; }
    }
    d.busy = false; S.pending = "v-item-photos"; rerender();
  };
  const removePhoto = (pid) => {
    d.photoIds = d.photoIds.filter((p) => p !== pid);
    if (d.added.includes(pid)) { d.added = d.added.filter((p) => p !== pid); try { Promise.resolve(ctx.photos.remove(pid)).catch(() => {}); } catch { /* ignore */ } }
    else d.removed.push(pid);
    S.pending = "v-item-photos"; rerender();
  };
  const title = isNew ? "Add an item" : `Edit ${d.name || "item"}`;
  return h("form", { class: "v-form", novalidate: true, onsubmit: submit, "aria-label": title },
    h("h3", { class: "v-h3", text: title }),
    txt("name", "Name (required)", { required: true, max: 120 }),
    h("div", { class: "field" },
      h("label", { for: "v-item-kind", text: "Type" }),
      h("select", { id: "v-item-kind", "data-fk": "v-item-kind", onchange: bind("kind") },
        KINDS.map(([k, l]) => h("option", { value: k, selected: d.kind === k, text: l })))),
    h("div", { class: "v-row2" }, txt("location", "Location (room or area)"), txt("model", "Model / serial")),
    txt("filterSize", "Filter size", { hint: "For example 16x25x1. Handy when you're at the store." }),
    h("div", { class: "v-row2" },
      txt("purchaseDate", "Purchase date", { type: "date" }),
      txt("warrantyExpires", "Warranty ends", { type: "date" })),
    h("div", { class: "field" },
      h("label", { for: "v-item-notes", text: "Notes" }),
      h("textarea", { id: "v-item-notes", rows: "3", maxlength: "2000", "data-fk": "v-item-notes", oninput: bind("notes"), onchange: bind("notes"), text: d.notes })),
    h("div", { class: "field" },
      h("label", { for: "v-item-photos", text: `Photos of the item, model plate, receipt or manual page (${d.photoIds.length} of ${MAX_PHOTOS})` }),
      d.photoIds.length < MAX_PHOTOS
        ? h("input", { id: "v-item-photos", type: "file", accept: "image/*", multiple: true, "data-fk": "v-item-photos", onchange: onFiles, disabled: d.busy ? true : null })
        : h("p", { id: "v-item-photos", class: "v-hint", tabindex: "-1", "data-fk": "v-item-photos", text: "Photo limit reached. Remove one to add another." }),
      d.busy ? h("p", { class: "v-hint", role: "status", text: "Adding photo…" }) : null,
      d.photoIds.length
        ? h("div", { class: "v-thumbs" }, d.photoIds.map((pid, i) =>
            photoImg(ctx, pid, `Photo ${i + 1}`, h("button", { type: "button", class: "btn v-thumb-x", "aria-label": `Remove photo ${i + 1}`, text: "Remove", onclick: () => removePhoto(pid) }))))
        : null),
    h("p", { class: "form-error", role: "alert", text: d.error }),
    h("div", { class: "v-actions" },
      h("button", { type: "submit", class: "btn v-primary", text: isNew ? "Add item" : "Save changes", disabled: d.busy ? true : null }),
      h("button", { type: "button", class: "btn", text: "Cancel", onclick: cancel })));
}

export default { id, label, render };
