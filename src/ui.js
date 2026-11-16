// App shell: header, Today banner, navigation, Tasks view, task/complete/settings dialogs, toasts, sync.
import { h as hBase, localToday, isoToLocalDate, fmtDate, safeUrl } from "./dom.js";
import { CATEGORIES } from "./templates.js";
import {
  statusOf, dueInfo, sortTasks, summary, markDone, skipTask, snoozeTask, unsnoozeTask,
  addTask, updateTask, deleteTask, searchTasks, warrantyAlerts, addDays, updateProfile, HOME_AGE_TYPES,
} from "./logic.js";
import { validateState, exportJSON, importJSON } from "./storage.js";
import { readiness } from "./readiness.js";
import { ageTasks, HOME_AGE_LABEL } from "./templates.js";
import { importTasksCSV } from "./importcsv.js";
import { estimateFor, rangeText } from "./costs.js";
import { downscaleImage, newPhotoId } from "./photos.js";
import { renderWizard, resetWizard } from "./wizard.js";
import * as historyView from "./views/history.js";
import * as inventoryView from "./views/inventory.js";
import * as vehiclesView from "./views/vehicles.js";
import * as emergencyView from "./views/emergency.js";
import * as calendarView from "./views/calendar.js";
import * as todayView from "./views/today.js";
import * as insightsView from "./views/insights.js";
import * as vendorsView from "./views/vendors.js";
import { homeView, youView } from "./views/hubs.js";
import { quickForm } from "./quickform.js";
import * as pwa from "./pwa.js";

export { localToday };

const CAT_LABEL = { car: "Car", house: "House", yard: "Yard", emergency: "Emergency" };
const CAT_ICON = { car: "\u{1F697}", house: "\u{1F3E0}", yard: "\u{1F33F}", emergency: "\u{1F6DF}" };
const STATUS_LABEL = { overdue: "Overdue", "due-soon": "Due soon", ok: "On track", snoozed: "Snoozed" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TABS = [
  { id: "today", label: "Today", icon: "\u{1F3E1}", view: todayView },
  { id: "tasks", label: "Tasks", icon: "✅" },
  { id: "history", label: historyView.label || "History", icon: "\u{1F4D6}", view: historyView },
  { id: "inventory", label: inventoryView.label || "Inventory", icon: "\u{1F4E6}", view: inventoryView },
  { id: "vehicles", label: vehiclesView.label || "Vehicles", icon: "\u{1F697}", view: vehiclesView },
  { id: "vendors", label: vendorsView.label || "Vendors", icon: "\u{1F4DE}", view: vendorsView },
  { id: "emergency", label: emergencyView.label || "Emergency", icon: "\u{1F6DF}", view: emergencyView },
  { id: "calendar", label: calendarView.label || "Calendar", icon: "\u{1F4C5}", view: calendarView },
  { id: "insights", label: insightsView.label || "Insights", icon: "\u{1F4CA}", view: insightsView },
  { id: "home", label: "Home", icon: "\u{1F3E0}", view: homeView },
  { id: "you", label: "You", icon: "\u{1F464}", view: youView },
];
// Screens reached from the Home and You tiles. The bottom bar keeps the parent lit and a back bar leads home.
const PARENT = { tasks: "home", inventory: "home", vehicles: "home", vendors: "home", emergency: "home", history: "you", insights: "you" };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const fmtN = (n) => Number(n).toLocaleString();
const newId = () => "t-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const errMsg = (e, fallback = "Something went wrong.") => (e && e.message ? e.message : fallback);

function weeksText(days) {
  if (days == null || days <= 0) return null;
  if (days < 14) return plural(days, "day");
  if (days < 60) return plural(Math.round(days / 7), "week");
  return plural(Math.round(days / 30), "month");
}

export async function mount(doc, { store, state: initial, persistent = true, loadError = null }) {
  const $ = (id) => doc.getElementById(id);
  const h = (tag, attrs, ...kids) => hBase(doc, tag, attrs, ...kids);
  const els = {
    app: $("app"), wizard: $("wizard"), strip: $("today-strip"), nav: $("nav"), main: $("main"),
    status: $("status"), headerActions: $("header-actions"),
    task: $("task-dialog"), complete: $("complete-dialog"), settings: $("settings-dialog"), confirm: $("confirm-dialog"),
  };

  let state = initial;
  let today = localToday();
  let active = "today";
  let rerunning = false;
  let undo = null; // { state }
  let undoToast = null;
  let sync = { kind: store.mode === "cloud" ? "saved" : "local", message: "" };
  let lastSyncKind = null;
  const me = { id: null, isOwner: false };
  const names = {};
  const requestedNames = new Set();
  const photoCache = new Map();
  const tv = { q: "", status: "all", cat: "all", assignee: "all", deleteId: null, snoozeId: null };
  const panels = {};

  const safe = (fn, fallback) => { try { return fn(); } catch { return fallback; } };

  // ---------- focus helpers ----------
  function describeFocus(el) {
    if (!el || el === doc.body || !el.getAttribute) return null;
    const row = el.closest ? el.closest("[data-id]") : null;
    return { el, id: el.id || null, rowId: row ? row.getAttribute("data-id") : null, act: el.getAttribute("data-act") };
  }
  function restoreFocus(d) {
    if (!d) return;
    if (d.el && d.el.isConnected) { d.el.focus(); return; }
    let t = d.id ? doc.getElementById(d.id) : null;
    if (!t && d.rowId) {
      const rows = Array.from(els.main.querySelectorAll("[data-id]")).filter((r) => r.getAttribute("data-id") === d.rowId);
      const row = rows[0];
      if (row) {
        t = d.act ? Array.from(row.querySelectorAll("[data-act]")).find((b) => b.getAttribute("data-act") === d.act) : null;
        if (!t) { row.setAttribute("tabindex", "-1"); t = row; }
      }
    }
    if (!t) t = els.main;
    if (t && t.focus) t.focus();
  }

  // ---------- toasts / live region ----------
  function toast(message, { error = false, undoBtn = false, ms } = {}) {
    const item = h("div", { class: "toast" + (error ? " error" : ""), role: error ? "alert" : null }, h("span", { text: message }));
    let timer = null;
    const remove = () => { clearTimeout(timer); if (item.parentNode) item.remove(); if (undoToast === item) undoToast = null; };
    if (undoBtn) {
      item.append(h("button", {
        type: "button", class: "link-btn", text: "Undo",
        onclick: () => {
          if (!undo) return;
          const back = undo.state; undo = null; remove();
          commit(back, "Undone.", { undoable: false });
        },
      }));
      if (undoToast) undoToast.remove();
      undoToast = item;
    }
    els.status.append(item);
    while (els.status.children.length > 3) {
      const first = Array.from(els.status.children).find((c) => c !== undoToast);
      if (!first) break;
      first.remove();
    }
    // Undo stays available for at least 15 s (20 s here); plain messages are shorter.
    timer = setTimeout(remove, ms || (undoBtn ? 20000 : error ? 8000 : 4500));
    item._remove = remove;
    return item;
  }

  // ---------- state ----------
  // ---------- change log + restore points (this device only) ----------
  const LOG_KEY = "motH.log", SNAP_KEY = "motH.snaps";
  const SNAP_MAX = 5, SNAP_BYTES = 120_000, LOG_MAX = 40;
  const lsGet = (k) => { try { return JSON.parse(doc.defaultView.localStorage.getItem(k)) || []; } catch { return []; } };
  const lsSet = (k, v) => { try { doc.defaultView.localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  function recordChange(message, prev) {
    try {
      const at = Date.now();
      const entry = { at, msg: String(message).slice(0, 140) };
      lsSet(LOG_KEY, [entry, ...lsGet(LOG_KEY)].slice(0, LOG_MAX));
      const json = JSON.stringify(prev);
      if (json.length <= SNAP_BYTES) {
        let snaps = [{ at, msg: entry.msg, json }, ...lsGet(SNAP_KEY)].slice(0, SNAP_MAX);
        while (snaps.length && !lsSet(SNAP_KEY, snaps)) snaps = snaps.slice(0, -1); // storage full: keep fewer
      }
    } catch { /* logging is best-effort */ }
  }

  function commit(next, message, { undoable = true } = {}) {
    try { validateState(next); } catch (e) { toast("Couldn't save that change: " + errMsg(e), { error: true }); return false; }
    const prev = state;
    state = next;
    try { const p = store.save(state); if (p && p.catch) p.catch(() => {}); } catch (e) { toast("Couldn't save: " + errMsg(e), { error: true }); }
    if (message) recordChange(message, prev);
    if (undoable) undo = { state: prev };
    else { undo = null; if (undoToast) undoToast._remove(); }
    render();
    if (message) toast(message, { undoBtn: undoable });
    return true;
  }
  const guard = (fn) => { try { return fn(); } catch (e) { toast(errMsg(e), { error: true }); return null; } };

  // ---------- photos ----------
  const photos = {
    async add(file) {
      const url = await downscaleImage(file, { doc });
      const id = newPhotoId();
      await store.putPhoto(id, url);
      photoCache.set(id, url);
      return id;
    },
    async url(id) {
      if (photoCache.has(id)) return photoCache.get(id);
      let u = null;
      try { u = await store.getPhoto(id); } catch { u = null; }
      if (u) photoCache.set(id, u);
      return u;
    },
    // Deferred: Undo may bring back references, so delete only after 30 s and only if nothing in the CURRENT state uses it.
    async remove(id) {
      setTimeout(async () => {
        const st = state;
        const used = (st.items || []).some((i) => (i.photoIds || []).includes(id)) || (st.completions || []).some((c) => (c.photoIds || []).includes(id));
        if (used) return;
        photoCache.delete(id);
        try { await store.deletePhoto(id); } catch { /* best effort */ }
      }, 30000);
    },
  };

  async function saveFile(filename, text, mime) {
    try { return !!(await store.saveFile(filename, text, mime)); } catch { return false; }
  }

  const ctx = {
    doc, h, getState: () => state, commit, today: () => today, store, me, names,
    openTaskForm: (t) => openTaskForm(t || null), toast: (m) => void toast(m), photos, saveFile,
    newId,
    openSettings: (trigger) => openSettings(trigger || null),
    account: () => { const a = authOf(); if (!a) return null; const s = a.session(); return { signedIn: !!s, email: s && s.user ? s.user.email : null }; },
    markManyDone: (ids) => {
      let next = state, n = 0;
      for (const id of ids) {
        try { next = markDone(next, id, today, { by: me.id || null }); n++; } catch { /* skip tasks that vanished */ }
      }
      if (!n) { toast("Nothing to mark.", { error: true }); return false; }
      return commit(next, `Marked ${plural(n, "task")} done`);
    },
    personName: (id) => personName(id),
    setView: (id, focus) => setView(id, !!focus),
    // Opens the same "Complete task" dialog as the Done button on the Tasks tab; unknown ids are ignored.
    completeTask: (taskId) => {
      const task = state.tasks.find((t) => t.id === taskId);
      if (task) openComplete(task, doc.activeElement);
    },
  };

  // ---------- dialogs ----------
  function afterClose(dlg) {
    const cb = dlg._onClose; dlg._onClose = null;
    const ret = dlg._ret; dlg._ret = null;
    if (cb) cb();
    restoreFocus(ret);
  }
  function bindDialog(dlg) {
    if (dlg._bound) return;
    dlg._bound = true;
    let pressed = false;
    // Backdrop click closes only if the press AND release both landed on the backdrop.
    dlg.addEventListener("mousedown", (e) => { pressed = e.target === dlg; });
    dlg.addEventListener("click", (e) => { if (e.target === dlg && pressed) closeDialog(dlg); pressed = false; });
    dlg.addEventListener("close", () => afterClose(dlg));
  }
  function openDialog(dlg, content, { trigger, onClose, focus } = {}) {
    bindDialog(dlg);
    if (dlg.open) closeDialog(dlg);
    dlg._ret = describeFocus(trigger || doc.activeElement);
    dlg._onClose = onClose || null;
    dlg.replaceChildren(h("div", { class: "dialog-body" }, content));
    if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
    const f = focus ? dlg.querySelector(focus) : null;
    if (f) f.focus();
  }
  function closeDialog(dlg) {
    if (typeof dlg.close === "function") { try { dlg.close(); } catch { /* already closed */ } }
    else { dlg.removeAttribute("open"); afterClose(dlg); }
  }

  function confirmDialog({ title, message, confirmLabel = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      let result = false;
      openDialog(els.confirm, [
        h("h2", { id: "confirm-dialog-title", text: title }),
        h("p", { class: "dialog-msg", text: message }),
        h("div", { class: "dialog-actions" },
          h("button", { type: "button", class: "btn", id: "confirm-cancel", text: "Cancel", onclick: () => closeDialog(els.confirm) }),
          h("button", { type: "button", class: "btn primary solid" + (danger ? " danger-solid" : ""), text: confirmLabel,
            onclick: () => { result = true; closeDialog(els.confirm); } })),
      ], { onClose: () => resolve(result), focus: "#confirm-cancel" });
    });
  }

  // ---------- due text ----------
  function infoFor(task) { return safe(() => dueInfo(task, state, today), { dueDate: null, daysUntil: 0, milesLeft: null, basis: "never" }); }
  function statusFor(task) { return safe(() => statusOf(task, today, state), "ok"); }

  function dueText(task, info, status) {
    if (status === "snoozed") return `Snoozed until ${fmtDate(task.snoozedUntil)}`;
    const d = info.daysUntil == null ? 0 : info.daysUntil;
    if (task.kind === "mileage" && info.milesLeft != null && info.basis === "miles") {
      const m = info.milesLeft;
      if (m <= 0) return m === 0 ? "Due now (mileage reached)" : `Due now: ${fmtN(-m)} mi past due`;
      const w = weeksText(d);
      return `~${fmtN(m)} mi left` + (w ? ` (≈ ${w})` : "");
    }
    if (d < 0) return `${plural(-d, "day")} overdue`;
    if (d === 0) return info.basis === "never" || (!task.lastDone && task.kind !== "annual") ? "Due now (never done)" : "Due today";
    if (d === 1) return "Due tomorrow";
    return `Due in ${d} days`;
  }
  function intervalText(n) {
    if (n % 365 === 0) return n === 365 ? "every year" : `every ${n / 365} years`;
    if (n === 7) return "every week";
    if (n === 14) return "every 2 weeks";
    if (n === 30 || n === 31) return "every month";
    if (n % 7 === 0 && n < 60) return `every ${n / 7} weeks`;
    return `every ${n} days`;
  }
  function vehicleName(id) { const v = state.vehicles.find((x) => x.id === id); return v ? v.name : null; }
  function itemName(id) { const v = state.items.find((x) => x.id === id); return v ? v.name : null; }
  function scheduleText(task) {
    if (task.kind === "annual") return `Every year on ${MONTHS[task.month - 1]} ${task.day}`;
    if (task.kind === "mileage") {
      return `Every ${fmtN(task.intervalMiles)} mi` + (task.intervalDays ? ` or ${intervalText(task.intervalDays)}` : "");
    }
    return `Repeats ${intervalText(task.intervalDays)}`;
  }
  function personName(id) {
    if (!id) return null;
    if (me.id && id === me.id) return "Me";
    return names[id] || "Someone";
  }

  // ---------- Top banner (removed) ----------
  const SYNC_LABEL = { saved: "Saved", saving: "Saving…", error: "Not saved", offline: "Offline", local: "Local only" };
  function renderStrip() {
    // No banner or header indicator any more: a sync problem shows up as a message at the bottom (see onStatus).
    els.strip.hidden = true; els.strip.replaceChildren();
  }

  // ---------- navigation ----------
  // Bottom bar: Today, Calendar, + (add anything), Home, You.
  const NAV = ["today", "calendar", "add", "home", "you"];
  function renderNav() {
    const here = PARENT[active] || active;
    const items = NAV.map((id) => {
      if (id === "add") {
        return h("li", { class: "nav-add-li" }, h("button", {
          type: "button", class: "nav-btn nav-add", id: "nav-add", "aria-haspopup": "dialog", "aria-label": "Add something",
          onclick: (e) => openAddSheet(e.currentTarget),
        }, h("span", { class: "nav-icon", "aria-hidden": "true", text: "+" }), h("span", { class: "nav-label", text: "Add" })));
      }
      const t = TABS.find((x) => x.id === id);
      return h("li", {}, h("button", {
        type: "button", class: "nav-btn", id: `nav-${t.id}`, "aria-current": here === t.id ? "page" : null,
        onclick: () => { setView(t.id, false); const b = doc.getElementById(`nav-${t.id}`); if (b) b.focus(); },
      }, h("span", { class: "nav-icon", "aria-hidden": "true", text: t.icon }), h("span", { class: "nav-label", text: t.label })));
    });
    els.nav.replaceChildren(h("ul", { class: "nav-list" }, items));
  }

  // Shown above screens opened from Home or You: a clear way back.
  function renderBack() {
    const parent = PARENT[active];
    if (!parent) { els.back.hidden = true; els.back.replaceChildren(); return; }
    const pt = TABS.find((t) => t.id === parent), me2 = TABS.find((t) => t.id === active);
    els.back.hidden = false;
    els.back.replaceChildren(h("button", { type: "button", class: "back-btn", id: "back-btn", onclick: () => setView(parent, true), "aria-label": `Back to ${pt.label}` },
      h("span", { "aria-hidden": "true", text: "‹ " }), pt.label), h("span", { class: "back-title", "aria-hidden": "true", text: me2.label }));
  }

  // The + sheet: type a task in plain words, or jump straight to adding something else.
  function openAddSheet(trigger) {
    const go2 = (id, then) => () => { closeDialog(els.confirm); setView(id, true); if (then) then(); };
    const row = (icon, label, sub, onclick, fk) => h("li", {}, h("button", { type: "button", class: "hub-tile", "data-fk": fk, onclick },
      h("span", { class: "hub-icon", "aria-hidden": "true", text: icon }), h("span", { class: "hub-text" }, h("strong", { text: label }), h("small", { text: sub })),
      h("span", { class: "hub-chev", "aria-hidden": "true", text: "›" })));
    openDialog(els.confirm, [
      h("h2", { id: "confirm-dialog-title", text: "Add" }),
      quickForm(ctx, { onAdded: () => closeDialog(els.confirm) }),
      h("ul", { class: "hub-grid add-grid" },
        row("\u{1F4DD}", "Task with details", "Pick dates, notes, links and who does it", () => { closeDialog(els.confirm); openTaskForm(null); }, "add-task"),
        row("\u{1F697}", "Log mileage", "Update a vehicle's odometer", go2("vehicles"), "add-miles"),
        row("\u{1F6DF}", "Emergency supply", "Water, food, batteries and more", go2("emergency"), "add-supply"),
        row("\u{1F4E6}", "Home item", "Appliance, warranty or manual", go2("inventory"), "add-item")),
      h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn", id: "add-close", text: "Close", onclick: () => closeDialog(els.confirm) })),
    ], { trigger, focus: "#v-quick-input" });
  }

  function setView(id, focusPanel) {
    if (!TABS.some((t) => t.id === id)) return;
    active = id;
    render();
    if (focusPanel && panels[id]) { panels[id].root.setAttribute("tabindex", "-1"); panels[id].root.focus(); }
  }

  // ---------- Tasks view ----------
  function buildTasksPanel(body) {
    const refs = {};
    refs.cards = h("div", { class: "cards" });
    refs.search = h("input", {
      type: "search", id: "t-search", class: "search-input", placeholder: "Search tasks, notes, tags, items…",
      autocomplete: "off", maxlength: "100",
      oninput: (e) => { tv.q = e.target.value; renderTasks(); },
    });
    refs.assignee = h("select", { id: "t-assignee", onchange: (e) => { tv.assignee = e.target.value; renderTasks(); } });
    refs.assigneeWrap = h("div", { class: "field inline-field", hidden: true },
      h("label", { for: "t-assignee", text: "Assigned to" }), refs.assignee);
    refs.statusChips = h("div", { class: "chips", role: "group", "aria-label": "Filter by status" });
    refs.catChips = h("div", { class: "chips", role: "group", "aria-label": "Filter by category" });
    refs.count = h("p", { class: "sr-only", role: "status", "aria-live": "polite" });
    refs.list = h("div", { id: "list" });
    body.replaceChildren(
      refs.cards,
      h("div", { class: "toolbar" },
        h("div", { class: "searchbox" }, h("label", { for: "t-search", class: "sr-only", text: "Search tasks" }), refs.search),
        refs.assigneeWrap),
      refs.statusChips, refs.catChips, refs.count, refs.list);
    return refs;
  }

  function taskMatchesAssignee(t) {
    if (tv.assignee === "all") return true;
    if (tv.assignee === "me") return !!me.id && t.assignee === me.id;
    if (tv.assignee === "none") return !t.assignee;
    return t.assignee === tv.assignee;
  }

  function renderTasks() {
    const refs = panels.tasks.refs;
    const sum = safe(() => summary(state, today), { overdue: 0, dueSoon: 0, ok: 0, snoozed: 0, byCategory: {} });
    const card = (key, n, label, hint) => h("div", { class: `card ${key}` },
      h("span", { class: "card-num", text: String(n) }), h("span", { class: "card-label", text: label }),
      h("span", { class: "card-hint", text: hint }));
    refs.cards.replaceChildren(
      card("overdue", sum.overdue, "Overdue", sum.overdue ? "Start here" : "Nothing late"),
      card("due-soon", sum.dueSoon, "Due soon", "Coming up shortly"),
      card("ok", sum.ok, "On track", "Handled for now"));

    // assignee filter (cloud / shared households only)
    const cloud = store.mode === "cloud";
    refs.assigneeWrap.hidden = !cloud;
    if (cloud) {
      const ids = [...new Set(state.tasks.map((t) => t.assignee).filter(Boolean))].filter((i) => i !== me.id);
      const opts = [["all", "Everyone"], ["me", "Me"], ["none", "Unassigned"], ...ids.map((i) => [i, personName(i)])];
      if (!opts.some((o) => o[0] === tv.assignee)) tv.assignee = "all";
      refs.assignee.replaceChildren(...opts.map(([v, l]) => h("option", { value: v, text: l, selected: tv.assignee === v })));
      refs.assignee.value = tv.assignee;
    }

    // search + base filters
    const q = tv.q.trim();
    let base = q ? safe(() => searchTasks(state, q, today), []) : state.tasks.slice();
    base = base.filter(taskMatchesAssignee);
    const inCat = (t) => tv.cat === "all" || t.category === tv.cat;
    const statusMap = new Map(base.map((t) => [t.id, statusFor(t)]));
    const forStatus = base.filter(inCat);
    const cnt = { all: forStatus.length, overdue: 0, "due-soon": 0, snoozed: 0 };
    for (const t of forStatus) { const s = statusMap.get(t.id); if (cnt[s] != null) cnt[s]++; }
    const forCat = base.filter((t) => tv.status === "all" || statusMap.get(t.id) === tv.status);
    const catCnt = { all: forCat.length };
    for (const c of CATEGORIES) catCnt[c] = forCat.filter((t) => t.category === c).length;

    const chip = (group, key, label, n, cls = "") => h("button", {
      type: "button", class: `chip ${cls}`, id: `chip-${group}-${key}`, "aria-pressed": String((group === "s" ? tv.status : tv.cat) === key),
      onclick: () => { if (group === "s") tv.status = key; else tv.cat = key; renderTasks(); },
    }, h("span", { text: label }), h("span", { class: "count", text: String(n), "aria-label": `${n} tasks` }));
    const focusSnap = describeFocus(doc.activeElement);
    refs.statusChips.replaceChildren(
      chip("s", "all", "All", cnt.all), chip("s", "overdue", "Overdue", cnt.overdue, cnt.overdue ? "alert" : ""),
      chip("s", "due-soon", "Due soon", cnt["due-soon"]), chip("s", "snoozed", "Snoozed", cnt.snoozed));
    refs.catChips.replaceChildren(
      chip("c", "all", "All areas", catCnt.all),
      ...CATEGORIES.map((c) => chip("c", c, `${CAT_ICON[c] || ""} ${CAT_LABEL[c] || c}`.trim(), catCnt[c])));

    const visible = forCat.filter(inCat);
    const sorted = safe(() => sortTasks(visible, today, state), visible);
    refs.count.textContent = `${plural(sorted.length, "task")} shown`;
    if (sorted.length === 0) refs.list.replaceChildren(emptyState());
    else refs.list.replaceChildren(h("ul", { class: "tasks" }, sorted.map((t) => taskRow(t))));
    // The lists are rebuilt, so put keyboard focus back where the user was.
    if (focusSnap && !(doc.activeElement && doc.activeElement !== doc.body && els.main.contains(doc.activeElement))) restoreFocus(focusSnap);
  }

  function emptyState() {
    const everything = state.tasks.length === 0;
    const filtered = tv.q.trim() || tv.status !== "all" || tv.cat !== "all" || tv.assignee !== "all";
    return h("div", { class: "empty" },
      h("div", { class: "empty-art", "aria-hidden": "true", text: everything ? "\u{1F6E0}️" : "✅" }),
      h("h3", { text: everything ? "No tasks yet" : filtered ? "No tasks match" : "Nothing here" }),
      h("p", { text: everything
        ? "Add your first maintenance task, re-run setup from Settings, or import a backup file."
        : filtered ? "Try a different search or clear the filters." : "Add a task to keep this area covered." }),
      filtered && !everything
        ? h("button", { type: "button", class: "btn", text: "Clear filters", onclick: () => { tv.q = ""; tv.status = "all"; tv.cat = "all"; tv.assignee = "all"; panels.tasks.refs.search.value = ""; renderTasks(); } })
        : h("button", { type: "button", class: "btn primary solid", text: "+ Add a task", onclick: () => openTaskForm(null) }));
  }

  function taskRow(task) {
    const status = statusFor(task);
    const info = infoFor(task);
    const metaBits = [
      task.lastDone ? `Last done ${fmtDate(task.lastDone)}` : "Never done",
      scheduleText(task),
      task.kind === "mileage" && info.basis !== "miles" && info.milesLeft != null ? `~${fmtN(Math.max(0, info.milesLeft))} mi left` : null,
      info.dueDate && status !== "snoozed" ? `Next: ${fmtDate(info.dueDate)}${task.kind === "mileage" && info.basis === "miles" ? " (estimated)" : ""}` : null,
      task.kind === "mileage" && vehicleName(task.vehicleId) ? vehicleName(task.vehicleId) : null,
      task.itemId && itemName(task.itemId) ? `Item: ${itemName(task.itemId)}` : null,
    ].filter(Boolean);
    const links = (task.links || []).map((l) => {
      const u = safeUrl(l.url);
      return u ? h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: l.label || u }))
        : h("li", {}, h("span", { text: l.label || l.url }));
    });
    const row = h("li", { class: `task ${status}`, "data-id": task.id },
      h("div", { class: "task-main" },
        h("div", { class: "task-top" },
          h("h3", { class: "task-title", text: task.title }),
          h("span", { class: `badge cat-${task.category}`, text: CAT_LABEL[task.category] || task.category }),
          task.assignee ? h("span", { class: "assignee-chip", text: `\u{1F464} ${personName(task.assignee)}` }) : null),
        h("p", { class: `due ${status}` },
          h("span", { class: "dot", "aria-hidden": "true" }),
          h("strong", { text: dueText(task, info, status) }),
          h("span", { class: "sr-only", text: ` (${STATUS_LABEL[status]})` })),
        h("p", { class: "meta", text: metaBits.join(" · ") }),
        task.notes ? h("p", { class: "notes", text: task.notes }) : null,
        links.length ? h("ul", { class: "task-links", "aria-label": "Links" }, links) : null,
        (task.tags && task.tags.length) ? h("p", { class: "tags", "aria-label": "Tags" }, task.tags.map((g) => h("span", { class: "tag", text: `#${g}` }))) : null),
      rowActions(task, status));
    if (tv.deleteId === task.id) row.append(deletePanel(task));
    else if (tv.snoozeId === task.id) row.append(snoozePanel(task, status));
    return row;
  }

  function rowActions(task, status) {
    const btn = (act, text, cls, onclick, extra = {}) => h("button", {
      type: "button", class: `btn ${cls}`, text, "data-act": act, "aria-label": `${text}: ${task.title}`, onclick, ...extra });
    return h("div", { class: "task-actions" },
      btn("done", "Done", "done", (e) => openComplete(task, e.currentTarget)),
      h("div", { class: "task-more" },
        btn("skip", "Skip", "subtle", () => onSkip(task)),
        btn("snooze", status === "snoozed" ? "Snoozed" : "Snooze", "subtle", () => { tv.snoozeId = tv.snoozeId === task.id ? null : task.id; tv.deleteId = null; renderTasks(); focusAct(task.id, "snooze"); },
          { "aria-expanded": String(tv.snoozeId === task.id) }),
        btn("edit", "Edit", "subtle", (e) => openTaskForm(task, e.currentTarget)),
        btn("delete", "Delete", "subtle danger", () => { tv.deleteId = task.id; tv.snoozeId = null; renderTasks(); focusAct(task.id, "delete-no"); })));
  }

  function focusAct(id, act) {
    restoreFocus({ el: null, id: null, rowId: id, act });
  }

  function deletePanel(task) {
    return h("div", { class: "row-panel danger-panel", role: "group", "aria-label": `Delete ${task.title}?` },
      h("p", { text: "Delete this task? Its history is kept." }),
      h("div", { class: "row-panel-actions" },
        h("button", { type: "button", class: "btn", "data-act": "delete-no", text: "Keep it", onclick: () => { tv.deleteId = null; renderTasks(); focusAct(task.id, "delete"); } }),
        h("button", { type: "button", class: "btn primary solid danger-solid", "data-act": "delete-yes", text: "Delete task", onclick: () => {
          tv.deleteId = null;
          const next = guard(() => deleteTask(state, task.id));
          if (next) commit(next, `Deleted: ${task.title}`);
          else renderTasks();
        } })));
  }

  function snoozePanel(task, status) {
    const apply = (iso) => {
      const next = guard(() => snoozeTask(state, task.id, iso, today));
      if (next) { tv.snoozeId = null; commit(next, `Snoozed until ${fmtDate(iso)}: ${task.title}`); }
    };
    const dateIn = h("input", { type: "date", id: `snz-${task.id}`, min: addDays(today, 1), max: addDays(today, 365), "data-act": "snooze-date" });
    return h("div", { class: "row-panel", role: "group", "aria-label": `Snooze ${task.title}` },
      h("p", { text: "Hide this until…" }),
      h("div", { class: "row-panel-actions wrap-actions" },
        h("button", { type: "button", class: "btn", "data-act": "snooze-1w", text: "1 week", onclick: () => apply(addDays(today, 7)) }),
        h("button", { type: "button", class: "btn", "data-act": "snooze-2w", text: "2 weeks", onclick: () => apply(addDays(today, 14)) }),
        h("button", { type: "button", class: "btn", "data-act": "snooze-1m", text: "1 month", onclick: () => apply(addDays(today, 30)) })),
      h("div", { class: "row-panel-actions wrap-actions" },
        h("label", { class: "sr-only", for: `snz-${task.id}`, text: "Snooze until a specific date" }), dateIn,
        h("button", { type: "button", class: "btn", text: "Snooze to date", "data-act": "snooze-go", onclick: () => {
          if (!dateIn.value) { toast("Pick a date first.", { error: true }); dateIn.focus(); return; }
          apply(dateIn.value);
        } }),
        status === "snoozed" ? h("button", { type: "button", class: "btn", text: "Wake now", "data-act": "snooze-wake", onclick: () => {
          const next = guard(() => unsnoozeTask(state, task.id));
          if (next) { tv.snoozeId = null; commit(next, `Back on the list: ${task.title}`); }
        } }) : null,
        h("button", { type: "button", class: "btn subtle", text: "Cancel", "data-act": "snooze-cancel", onclick: () => { tv.snoozeId = null; renderTasks(); focusAct(task.id, "snooze"); } })));
  }

  function onSkip(task) {
    const next = guard(() => skipTask(state, task.id, today, me.id));
    if (next) commit(next, `Skipped this time: ${task.title}`);
  }

  // ---------- Complete dialog ----------
  function openComplete(task, trigger) {
    const added = [];
    let saved = false;
    const vehicle = task.kind === "mileage" ? state.vehicles.find((v) => v.id === task.vehicleId) : null;
    const est = safe(() => estimateFor(task, state), null);
    const estText = est ? rangeText(est) : "";
    const cost = h("input", { id: "c-cost", type: "number", inputmode: "decimal", min: "0", step: "0.01", placeholder: estText ? `${est.source === "yours" ? "You paid" : "Typical"}: ${estText}` : "Optional" });
    const odo = vehicle ? h("input", { id: "c-odo", type: "number", inputmode: "numeric", min: "0", step: "1", value: String(vehicle.odometer) }) : null;
    const notes = h("textarea", { id: "c-notes", rows: "2", maxlength: "2000", placeholder: "Optional" });
    const err = h("p", { class: "form-error", role: "alert" });
    const strip = h("div", { class: "photo-strip" });
    const fileIn = h("input", { type: "file", accept: "image/*", id: "c-file", hidden: true, multiple: true });
    const addBtn = h("button", { type: "button", class: "btn", id: "c-addphoto", text: "Add photo", onclick: () => fileIn.click() });
    const note = h("p", { class: "hint" });

    function drawPhotos() {
      strip.replaceChildren(...added.map((id, i) => {
        const img = h("img", { alt: `Attached photo ${i + 1}`, class: "thumb" });
        photos.url(id).then((u) => { if (u) img.setAttribute("src", u); });
        return h("div", { class: "photo-item" }, img,
          h("button", { type: "button", class: "btn subtle danger", text: "Remove", "aria-label": `Remove photo ${i + 1}`,
            onclick: () => { added.splice(i, 1); photos.remove(id); drawPhotos(); addBtn.focus(); } }));
      }));
      addBtn.disabled = added.length >= 3;
      note.textContent = added.length >= 3 ? "3 photos attached (the maximum)." : "Up to 3 photos, shrunk to save space.";
    }
    fileIn.addEventListener("change", async () => {
      const files = Array.from(fileIn.files || []).slice(0, 3 - added.length);
      fileIn.value = "";
      err.textContent = "";
      for (const f of files) {
        try { added.push(await photos.add(f)); } catch (e) { err.textContent = errMsg(e, "Couldn't add that photo."); }
      }
      drawPhotos();
    });

    const form = h("form", { novalidate: true, onsubmit: (e) => {
      e.preventDefault();
      const opts = { by: me.id || undefined };
      if (cost.value.trim() !== "") {
        const c = Number(cost.value);
        if (!Number.isFinite(c) || c < 0) { err.textContent = "Cost must be a number, 0 or more."; cost.focus(); return; }
        opts.cost = Math.round(c * 100) / 100;
      }
      if (odo) {
        const o = Number(odo.value);
        if (odo.value.trim() === "" || !Number.isInteger(o) || o < 0) { err.textContent = "Odometer must be a whole number of miles."; odo.focus(); return; }
        opts.odometer = o;
      }
      if (notes.value.trim()) opts.notes = notes.value.trim();
      if (added.length) opts.photoIds = added.slice();
      if (opts.by === undefined) delete opts.by;
      let next;
      try { next = markDone(state, task.id, today, opts); } catch (ex) { err.textContent = errMsg(ex); return; }
      saved = true;
      closeDialog(els.complete);
      commit(next, `Marked done: ${task.title}`);
    } },
      h("h2", { id: "complete-dialog-title", text: "Complete task" }),
      h("p", { class: "dialog-sub", text: task.title }),
      h("div", { class: "field" }, h("label", { for: "c-cost", text: "Cost ($)" }), cost),
      odo ? h("div", { class: "field" }, h("label", { for: "c-odo", text: `Odometer now (${vehicle.name})` }), odo) : null,
      h("div", { class: "field" }, h("label", { for: "c-notes", text: "Notes" }), notes),
      h("div", { class: "field" }, h("span", { class: "label-like", text: "Photos" }), strip, addBtn, fileIn, note),
      err,
      h("p", { class: "hint", text: "Press Enter to finish quickly — cost, notes and photos are all optional." }),
      h("div", { class: "dialog-actions" },
        h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => closeDialog(els.complete) }),
        h("button", { type: "submit", class: "btn primary solid", text: "Mark done" })));
    drawPhotos();
    openDialog(els.complete, form, {
      trigger,
      focus: "#c-cost",
      onClose: () => { if (!saved) for (const id of added) photos.remove(id); },
    });
  }

  // ---------- Task form ----------
  function openTaskForm(task, trigger) {
    const editing = !!(task && task.id);
    const seed = task || {};
    const kind0 = seed.kind || "interval";
    const f = {};
    const field = (label, input, hint, id) => h("div", { class: "field" }, h("label", { for: id, text: label }), input, hint ? h("p", { class: "hint", text: hint }) : null);
    f.title = h("input", { id: "f-title", type: "text", required: true, maxlength: "120", autocomplete: "off", value: seed.title || "" });
    f.category = h("select", { id: "f-category" }, CATEGORIES.map((c) => h("option", { value: c, text: CAT_LABEL[c] || c, selected: (seed.category || (CATEGORIES.includes(tv.cat) ? tv.cat : "house")) === c })));
    f.kind = h("select", { id: "f-kind", onchange: () => syncKind() },
      [["interval", "Every N days"], ["annual", "Yearly on a date"], ["mileage", "Every N miles (a vehicle)"]].map(([v, l]) => h("option", { value: v, text: l, selected: kind0 === v })));
    f.intervalLabel = h("label", { for: "f-interval", text: "Repeat every (days)" });
    f.interval = h("input", { id: "f-interval", type: "number", inputmode: "numeric", min: "1", max: "36500", step: "1", value: seed.intervalDays ? String(seed.intervalDays) : (editing ? "" : "30") });
    f.intervalHint = h("p", { class: "hint" });
    f.month = h("select", { id: "f-month" }, MONTHS.map((m, i) => h("option", { value: String(i + 1), text: m, selected: (seed.month || 1) === i + 1 })));
    f.day = h("input", { id: "f-day", type: "number", inputmode: "numeric", min: "1", max: "28", step: "1", value: String(seed.day || 1) });
    f.vehicle = h("select", { id: "f-vehicle" },
      h("option", { value: "", text: state.vehicles.length ? "Choose a vehicle…" : "No vehicles yet" }),
      state.vehicles.map((v) => h("option", { value: v.id, text: v.name, selected: seed.vehicleId === v.id })));
    f.miles = h("input", { id: "f-miles", type: "number", inputmode: "numeric", min: "1", max: "1000000", step: "1", value: seed.intervalMiles ? String(seed.intervalMiles) : "" });
    f.lastDone = h("input", { id: "f-last", type: "date", max: today, value: seed.lastDone || "" });
    f.odo = h("input", { id: "f-odo", type: "number", inputmode: "numeric", min: "0", step: "1", value: seed.lastDoneOdometer != null ? String(seed.lastDoneOdometer) : "" });
    f.start = h("input", { id: "f-start", type: "date", value: seed.startDate || "" });
    f.item = h("select", { id: "f-item" }, h("option", { value: "", text: "None" }),
      state.items.map((i) => h("option", { value: i.id, text: i.name, selected: seed.itemId === i.id })));
    f.assignee = h("select", { id: "f-assignee" },
      h("option", { value: "", text: "Unassigned" }),
      me.id ? h("option", { value: me.id, text: "Me", selected: seed.assignee === me.id }) : null,
      seed.assignee && seed.assignee !== me.id ? h("option", { value: seed.assignee, text: personName(seed.assignee), selected: true }) : null);
    f.tags = h("input", { id: "f-tags", type: "text", maxlength: "200", autocomplete: "off", placeholder: "e.g. spring, garage", value: (seed.tags || []).join(", ") });
    f.notes = h("textarea", { id: "f-notes", rows: "3", maxlength: "2000" });
    f.notes.value = seed.notes || "";
    f.err = h("p", { class: "form-error", role: "alert" });

    const linkRows = (seed.links || []).map((l) => ({ label: l.label || "", url: l.url || "" }));
    const linkBox = h("div", { class: "links-edit" });
    function drawLinks() {
      linkBox.replaceChildren(...linkRows.map((l, i) => h("div", { class: "link-row" },
        h("div", { class: "field" }, h("label", { for: `lk-l-${i}`, text: `Link ${i + 1} label` }),
          h("input", { id: `lk-l-${i}`, type: "text", maxlength: "80", value: l.label, oninput: (e) => { l.label = e.target.value; } })),
        h("div", { class: "field" }, h("label", { for: `lk-u-${i}`, text: `Link ${i + 1} web address` }),
          h("input", { id: `lk-u-${i}`, type: "url", inputmode: "url", maxlength: "500", placeholder: "https://", value: l.url, oninput: (e) => { l.url = e.target.value; } })),
        h("button", { type: "button", class: "btn subtle danger", text: "Remove", "aria-label": `Remove link ${i + 1}`, onclick: () => { linkRows.splice(i, 1); drawLinks(); addLink.focus(); } }))));
      addLink.disabled = linkRows.length >= 5;
    }
    const addLink = h("button", { type: "button", class: "btn", text: "+ Add a link", onclick: () => { linkRows.push({ label: "", url: "" }); drawLinks(); const el = linkBox.querySelector(`#lk-l-${linkRows.length - 1}`); if (el) el.focus(); } });

    const secInterval = h("div", {}, h("div", { class: "field" }, f.intervalLabel, f.interval, f.intervalHint));
    const secAnnual = h("div", { class: "row2" }, field("Month", f.month, null, "f-month"), field("Day (1–28)", f.day, null, "f-day"));
    const secMiles = h("div", {}, h("div", { class: "row2" }, field("Vehicle", f.vehicle, null, "f-vehicle"), field("Every (miles)", f.miles, null, "f-miles")),
      field("Odometer at last service (optional)", f.odo, "Leave blank if unknown.", "f-odo"));
    const secStart = h("div", { class: "field" }, h("label", { for: "f-start", text: "First due date (if not done yet)" }), f.start,
      h("p", { class: "hint", text: "Leave blank to be due right away." }));

    function syncKind() {
      const k = f.kind.value;
      secInterval.hidden = k === "annual";
      secAnnual.hidden = k !== "annual";
      secMiles.hidden = k !== "mileage";
      secStart.hidden = k === "annual";
      f.intervalLabel.textContent = k === "mileage" ? "Also due at least every (days) — optional" : "Repeat every (days)";
      f.intervalHint.textContent = k === "mileage" ? "A time limit, e.g. 180 days for oil changes. Leave blank to go by miles only." : "";
    }

    const submit = async (e) => {
      e.preventDefault();
      const fail = (msg, el) => { f.err.textContent = msg; if (el) el.focus(); };
      const title = f.title.value.trim();
      if (!title) return fail("Please enter a title.", f.title);
      const kind = f.kind.value;
      const out = {
        title, category: f.category.value, kind, notes: f.notes.value.trim(),
        itemId: f.item.value || null, assignee: f.assignee.value || null,
        lastDone: f.lastDone.value || null, startDate: kind === "annual" ? null : (f.start.value || null),
        tags: f.tags.value.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean).slice(0, 10),
        intervalDays: null, month: null, day: null, intervalMiles: null, vehicleId: null,
      };
      if (kind === "interval") {
        const n = Number(f.interval.value);
        if (!Number.isInteger(n) || n < 1 || n > 36500) return fail("Repeat interval must be a whole number of days, 1 or more.", f.interval);
        out.intervalDays = n;
      } else if (kind === "annual") {
        const d = Number(f.day.value);
        if (!Number.isInteger(d) || d < 1 || d > 28) return fail("Day must be a whole number from 1 to 28.", f.day);
        out.month = Number(f.month.value); out.day = d;
      } else {
        const m = Number(f.miles.value);
        if (!Number.isInteger(m) || m < 1) return fail("Miles must be a whole number, 1 or more.", f.miles);
        if (!f.vehicle.value) return fail("Choose a vehicle. Add one on the Vehicles tab if you have none.", f.vehicle);
        out.intervalMiles = m; out.vehicleId = f.vehicle.value;
        if (f.odo.value.trim() !== "") {
          const o = Number(f.odo.value);
          if (!Number.isInteger(o) || o < 0) return fail("Odometer at last service must be a whole number of miles, 0 or more.", f.odo);
          out.lastDoneOdometer = o;
        } else out.lastDoneOdometer = null;
        if (f.interval.value.trim() !== "") {
          const n = Number(f.interval.value);
          if (!Number.isInteger(n) || n < 1 || n > 36500) return fail("The time limit must be a whole number of days, 1 or more.", f.interval);
          out.intervalDays = n;
        }
      }
      const links = [];
      for (let i = 0; i < linkRows.length; i++) {
        const l = linkRows[i];
        if (!l.label.trim() && !l.url.trim()) continue;
        const u = safeUrl(l.url);
        if (!u) return fail(`Link ${i + 1} needs a web address starting with http:// or https://.`, linkBox.querySelector(`#lk-u-${i}`));
        let host = u; try { host = new URL(u).hostname; } catch { /* keep */ }
        links.push({ label: l.label.trim() || host, url: u });
      }
      out.links = links;
      let next;
      try {
        next = editing ? updateTask(state, task.id, out) : addTask(state, { ...out, custom: true }, newId);
      } catch (ex) { return fail(errMsg(ex, "Couldn't save task."), f.title); }
      closeDialog(els.task);
      commit(next, `${editing ? "Saved" : "Added"}: ${title}`);
    };

    const form = h("form", { novalidate: true, onsubmit: submit },
      h("h2", { id: "task-dialog-title", text: editing ? "Edit task" : "Add task" }),
      field("Title", f.title, null, "f-title"),
      h("div", { class: "row2" }, field("Category", f.category, null, "f-category"), field("Schedule type", f.kind, null, "f-kind")),
      secInterval, secAnnual, secMiles,
      h("div", { class: "row2" },
        field("Last done (optional)", f.lastDone, null, "f-last"), secStart),
      h("div", { class: "row2" }, field("Linked item", f.item, null, "f-item"),
        store.mode === "cloud" || seed.assignee ? field("Assigned to", f.assignee, null, "f-assignee") : null),
      field("Tags (comma separated)", f.tags, null, "f-tags"),
      h("fieldset", { class: "plain-fieldset" }, h("legend", { text: "Links (manuals, how-to videos)" }), linkBox, addLink),
      field("Notes", f.notes, null, "f-notes"),
      f.err,
      h("div", { class: "dialog-actions" },
        h("button", { type: "button", class: "btn", text: "Cancel", onclick: () => closeDialog(els.task) }),
        h("button", { type: "submit", class: "btn primary solid", text: editing ? "Save task" : "Add task" })));
    syncKind(); drawLinks();
    openDialog(els.task, form, { trigger, focus: "#f-title" });
  }

  // ---------- look and feel (per-device) ----------
  const LOOK_KEY = "motH.look";
  const look = { theme: "auto", text: "normal" };
  function readLook() {
    try {
      const raw = doc.defaultView && doc.defaultView.localStorage && doc.defaultView.localStorage.getItem(LOOK_KEY);
      const o = raw ? JSON.parse(raw) : null;
      if (o && ["auto", "light", "dark"].includes(o.theme)) look.theme = o.theme;
      if (o && ["normal", "large", "xl"].includes(o.text)) look.text = o.text;
    } catch { /* keep defaults */ }
  }
  function applyLook() {
    const root = doc.documentElement;
    if (!root || !root.setAttribute) return;
    if (look.theme === "auto") root.removeAttribute("data-theme"); else root.setAttribute("data-theme", look.theme);
    if (look.text === "normal") root.removeAttribute("data-text"); else root.setAttribute("data-text", look.text);
  }
  function setLook(patch) {
    Object.assign(look, patch);
    applyLook();
    try { doc.defaultView.localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* not saved; still applied */ }
  }
  readLook(); applyLook();

  // ---------- first-run tour (once per device) ----------
  const TOUR_KEY = "motH.tour";
  const tourSeen = () => {
    try { const ls = doc.defaultView && doc.defaultView.localStorage; return !ls || ls.getItem(TOUR_KEY) === "1"; } catch { return true; }
  };
  const markTourSeen = () => { try { doc.defaultView.localStorage.setItem(TOUR_KEY, "1"); } catch { /* shown again next visit */ } };
  const TOUR = [
    { icon: "\u{1F3E1}", title: "Today is your home base", lines: [
      "The top line says what needs doing. Tap an area to filter, and Done when you've finished a task.",
      "Tap the home score to see how ready the house, cars and emergency supplies are.",
      "Home holds your tasks, inventory, vehicles, vendors and emergency plans. You holds history, insights and settings."] },
    { icon: "⚡", title: "Add things in seconds", lines: [
      "Tap + and type, like “clean gutters every 6 months” or “renew registration every January 15”.",
      "Need dates, notes or a person assigned? Pick “Task with details” in the same sheet. You can also import a spreadsheet from Settings."] },
    { icon: "\u{1F4C5}", title: "See it on the calendar", lines: [
      "The Calendar tab shows which days tasks, expiring supplies and warranties land on. Tap a day for details.",
      "Need more time? Move a task to a later day from that day's list.",
      "Everyone in your household sees the same tasks. Use Assign on a task to split the work."] },
  ];
  function openTour(trigger) {
    let i = 0;
    const draw = () => {
      const t = TOUR[i];
      const last = i === TOUR.length - 1;
      const finish = () => { markTourSeen(); closeDialog(els.confirm); };
      openDialog(els.confirm, [
        h("p", { class: "eyebrow", text: `Quick tour · ${i + 1} of ${TOUR.length}` }),
        h("h2", { id: "confirm-dialog-title" }, h("span", { "aria-hidden": "true", text: `${t.icon} ` }), t.title),
        h("ul", { class: "tour-list" }, t.lines.map((l) => h("li", { text: l }))),
        h("div", { class: "dialog-actions" },
          last ? null : h("button", { type: "button", class: "btn", id: "tour-skip", text: "Skip tour", onclick: finish }),
          i > 0 ? h("button", { type: "button", class: "btn", id: "tour-back", text: "Back", onclick: () => { i--; draw(); } }) : null,
          last ? h("button", { type: "button", class: "btn primary solid", id: "tour-next", text: "Got it", onclick: finish })
            : h("button", { type: "button", class: "btn primary solid", id: "tour-next", text: "Next", onclick: () => { i++; draw(); } })),
      ], { trigger, onClose: markTourSeen, focus: "#tour-next" });
    };
    draw();
  }

  // ---------- Settings ----------
  function openSettings(trigger) {
    const out = h("div", { class: "settings-out" });
    const paste = h("textarea", { id: "s-paste", rows: "3", placeholder: "Paste backup text here" });
    const fileIn = h("input", { type: "file", id: "s-file", accept: "application/json,.json", hidden: true });

    async function doImport(text, label) {
      let next;
      try { next = importJSON(text); } catch (e) { toast("Import failed: " + errMsg(e, "invalid file."), { error: true }); return; }
      const ok = await confirmDialog({
        title: "Replace your data?",
        message: `This replaces your current ${plural(state.tasks.length, "task")} with ${plural(next.tasks.length, "task")} from ${label}. Photos are not part of backups. You can undo right after.`,
        confirmLabel: "Replace", danger: true,
      });
      if (!ok) return;
      closeDialog(els.settings);
      commit(next, `Imported ${plural(next.tasks.length, "task")}.`);
    }
    fileIn.addEventListener("change", async () => {
      const file = fileIn.files && fileIn.files[0];
      fileIn.value = "";
      if (!file) return;
      let text;
      try { text = await file.text(); } catch { toast("Couldn't read that file.", { error: true }); return; }
      doImport(text, `“${file.name}”`);
    });

    const exportNow = async () => {
      const text = guard(() => exportJSON(state));
      if (text == null) return;
      const ok = await saveFile(`man-of-the-house-${today}.json`, text, "application/json");
      if (ok) { toast("Exported a backup file."); return; }
      const area = h("textarea", { id: "s-export", rows: "4", readonly: true });
      area.value = text;
      out.replaceChildren(
        h("p", { class: "hint", text: "Downloads are unavailable here. Copy this text and save it somewhere safe." }),
        area,
        h("button", { type: "button", class: "btn", text: "Copy backup text", onclick: async () => {
          try { await globalThis.navigator.clipboard.writeText(text); toast("Copied."); }
          catch { area.focus(); area.select(); toast("Select the text and copy it manually.", { error: true }); }
        } }));
      area.focus();
    };

    const csvBox = h("textarea", { id: "s-csv", rows: "3", placeholder: "Paste CSV text, or choose a file" });
    const csvOut = h("div", { class: "settings-out", role: "status" });
    const csvFile = h("input", { type: "file", id: "s-csv-file", accept: ".csv,text/csv,text/plain", hidden: true });
    function doCSV(text) {
      if (!String(text || "").trim()) { toast("Paste some CSV text first.", { error: true }); return; }
      let r;
      try { r = importTasksCSV(state, text, newId, today); } catch (e) { csvOut.replaceChildren(h("p", { class: "form-error", role: "alert", text: errMsg(e, "Couldn't read that.") })); return; }
      const skipText = r.skipped.slice(0, 6).map((x) => `row ${x.row}: ${x.reason}`).join("; ") + (r.skipped.length > 6 ? `; and ${r.skipped.length - 6} more` : "");
      if (!r.added) { csvOut.replaceChildren(h("p", { class: "form-error", role: "alert", text: `Nothing was imported. ${skipText}` })); return; }
      closeDialog(els.settings);
      commit(r.state, `Imported ${plural(r.added, "task")}${r.skipped.length ? `; skipped ${r.skipped.length}` : ""}${r.warnings && r.warnings.length ? `. Note: ${r.warnings.join("; ")}` : ""}.`);
    }
    csvFile.addEventListener("change", async () => {
      const f = csvFile.files && csvFile.files[0]; csvFile.value = "";
      if (!f) return;
      try { doCSV(await f.text()); } catch { toast("Couldn't read that file.", { error: true }); }
    });
    function changeLog() {
      const log = lsGet(LOG_KEY), snaps = lsGet(SNAP_KEY);
      if (!log.length) return h("p", { class: "hint", text: "Nothing yet." });
      return h("ul", { class: "v-log" }, log.slice(0, 10).map((e) => {
        const snap = snaps.find((x) => x.at === e.at);
        const when = new Date(e.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
        return h("li", {}, h("span", { text: `${when}: ${e.msg}` }),
          snap ? h("button", { type: "button", class: "btn v-small", text: "Restore", "aria-label": `Restore to just before: ${e.msg}`, onclick: async () => {
            let restored;
            try { restored = JSON.parse(snap.json); validateState(restored); } catch { toast("That restore point is damaged.", { error: true }); return; }
            const ok = await confirmDialog({ title: "Restore this point?", message: `Your data goes back to just before “${e.msg}”. Later changes are replaced, and you can undo right after. If you share this household, the restore reaches the other phone too and can replace their newer edits.`, confirmLabel: "Restore", danger: true });
            if (!ok) return;
            closeDialog(els.settings);
            commit(restored, "Restored an earlier version.");
          } }) : null);
      }));
    }

    const modeText = store.mode === "cloud"
      ? "Your data is saved to your account and syncs across your devices."
      : "Your data is saved on this device only." + (persistent ? "" : " Storage looks blocked, so changes may be lost when you close the page.");

    openDialog(els.settings, [
      h("h2", { id: "settings-dialog-title", text: "Settings" }),
      h("section", { class: "set-sec" },
        h("h3", { text: "Help" }),
        h("button", { type: "button", class: "btn", id: "s-tour", text: "Show the quick tour", onclick: () => { closeDialog(els.settings); openTour(null); } })),
      h("section", { class: "set-sec" },
        h("h3", { text: "Look" }),
        h("div", { class: "field" }, h("label", { for: "s-theme", text: "Theme" }),
          h("select", { id: "s-theme", onchange: (e) => setLook({ theme: e.target.value }) },
            [["auto", "Match my device"], ["light", "Light"], ["dark", "Dark"]].map(([v, t]) => h("option", { value: v, text: t, selected: look.theme === v })))),
        h("div", { class: "field" }, h("label", { for: "s-text", text: "Text size" }),
          h("select", { id: "s-text", onchange: (e) => setLook({ text: e.target.value }) },
            [["normal", "Normal"], ["large", "Large"], ["xl", "Extra large"]].map(([v, t]) => h("option", { value: v, text: t, selected: look.text === v })))),
        h("p", { class: "hint", text: "Theme and text size are saved on this device only." }),
        h("div", { class: "field" }, h("label", { for: "s-climate", text: "Climate (for seasonal reminders)" }),
          h("select", { id: "s-climate", onchange: (e) => { const next = guard(() => updateProfile(state, { climate: e.target.value })); if (next) commit(next, "Climate saved.", { undoable: false }); } },
            [["cold", "Cold winters"], ["mild", "Mild year-round"], ["hot", "Hot summers"]].map(([v, t]) => h("option", { value: v, text: t, selected: ((state.profile && state.profile.climate) || "cold") === v }))))),
      h("section", { class: "set-sec" },
        h("h3", { text: "Home age and extra tasks" }),
        h("div", { class: "field" }, h("label", { for: "s-age", text: "How old is your home?" }),
          h("select", { id: "s-age", onchange: (e) => { const next = guard(() => updateProfile(state, { homeAge: e.target.value })); if (next) commit(next, null, { undoable: false }); } },
            h("option", { value: "", text: "Not set", disabled: true, selected: !(state.profile && state.profile.homeAge) }),
            HOME_AGE_TYPES.map((v) => h("option", { value: v, text: HOME_AGE_LABEL[v], selected: (state.profile && state.profile.homeAge) === v })))),
        h("button", { type: "button", class: "btn", id: "s-age-add", text: "Add suggested tasks for my home's age", onclick: () => {
          const age = state.profile && state.profile.homeAge;
          if (!age) { toast("Pick your home's age first.", { error: true }); return; }
          const list = ageTasks(age, state.tasks.map((t) => t.title), today);
          if (!list.length) { toast("You already have all the suggested tasks."); return; }
          let next = state;
          for (const t of list) { const r = guard(() => addTask(next, t, newId)); if (r) next = r; }
          closeDialog(els.settings);
          commit(next, `Added ${plural(list.length, "suggested task")}.`);
        } })),
      h("section", { class: "set-sec" },
        h("h3", { text: "Import tasks from a spreadsheet" }),
        h("p", { class: "hint", text: "Save your sheet as CSV. Needs a header row with title and either every_days (a number) or every (like \"3 months\"). Optional: category, last_done (YYYY-MM-DD), notes." }),
        csvBox,
        h("div", { class: "row-panel-actions wrap-actions" },
          h("button", { type: "button", class: "btn", text: "Choose CSV file", onclick: () => csvFile.click() }), csvFile,
          h("button", { type: "button", class: "btn", id: "s-csv-go", text: "Import pasted CSV", onclick: () => doCSV(csvBox.value) })),
        csvOut),
      ...(authOf() ? [h("section", { class: "set-sec" }, h("h3", { text: "Account" }), accountPanel())] : []),
      h("section", { class: "set-sec" },
        h("h3", { text: "Reminders" }),
        remindersPanel(),
      ),
      h("section", { class: "set-sec" },
        h("h3", { text: "Recent changes" }),
        h("p", { class: "hint", text: "Kept on this device. Restoring puts your data back the way it was just before that change, and you can undo the restore." }),
        changeLog()),
      h("section", { class: "set-sec" },
        h("h3", { text: "Setup" }),
        h("p", { class: "hint", text: "Re-run setup after changing your home, adding a pool or buying a car. It only adds missing tasks; nothing is changed or removed." }),
        h("button", { type: "button", class: "btn", id: "s-rerun", text: "Re-run setup", onclick: () => { closeDialog(els.settings); startRerun(); } })),
      h("section", { class: "set-sec" },
        h("h3", { text: "Backup" }),
        h("p", { class: "hint", text: modeText }),
        h("div", { class: "row-panel-actions wrap-actions" },
          h("button", { type: "button", class: "btn", text: "Export backup", onclick: exportNow }),
          h("button", { type: "button", class: "btn", text: "Import backup", onclick: () => fileIn.click() }), fileIn),
        out,
        h("div", { class: "field" }, h("label", { for: "s-paste", text: "Or paste backup text" }), paste,
          h("button", { type: "button", class: "btn", text: "Import pasted text", onclick: () => { if (!paste.value.trim()) { toast("Paste some backup text first.", { error: true }); paste.focus(); return; } doImport(paste.value, "pasted text"); } }))),
      h("div", { class: "dialog-actions" }, h("button", { type: "button", class: "btn primary solid", text: "Close", onclick: () => closeDialog(els.settings) })),
    ], { trigger, focus: "#s-rerun" });
  }

  function remindersPanel() {
    const ls = doc.defaultView && doc.defaultView.localStorage;
    const wrap = h("div", { class: "reminders" });
    const hourLabel = (n) => `${((n + 11) % 12) + 1}:00 ${n < 12 ? "AM" : "PM"}`;
    const paint = () => {
      const push = doc.defaultView && doc.defaultView.motPush;
      const auth = authOf();
      const canPush = !!push && !!auth && !!auth.session();
      const pushHour = canPush ? push.hour() : null;
      const on = !!ls && pwa.remindersOn(ls);
      if (canPush && pwa.supported()) {
        const sel = h("select", { id: "s-remind-hour", "aria-label": "Reminder time" },
          ...Array.from({ length: 24 }, (_, n) => h("option", { value: String(n), text: hourLabel(n), selected: n === (pushHour == null ? 8 : pushHour) })));
        const btn = h("button", { type: "button", class: "btn", id: "s-remind", text: pushHour != null ? "Turn off reminders" : "Turn on reminders" });
        const busy = (b) => { btn.disabled = b; sel.disabled = b; };
        btn.addEventListener("click", async () => {
          busy(true);
          try {
            if (pushHour != null) { await push.disable(); pwa.disableReminders(ls); toast("Reminders turned off."); }
            else {
              const r = await pwa.enableReminders(ls);
              if (!r.ok) { toast(r.why === "denied" ? "Notifications are blocked. Allow them in your browser settings, then try again." : "Reminders aren't available here.", { error: true }); return; }
              await push.enable(Number(sel.value));
              toast(`Reminders on. You'll get one each morning at ${hourLabel(Number(sel.value))}.`);
            }
          } catch (e) { toast(e && e.message ? e.message : "Couldn't change reminders.", { error: true }); }
          finally { paint(); }
        });
        sel.addEventListener("change", async () => {
          if (pushHour == null) return;
          busy(true);
          try { await push.enable(Number(sel.value)); toast(`Reminder time set to ${hourLabel(Number(sel.value))}.`); }
          catch (e) { toast(e && e.message ? e.message : "Couldn't change the time.", { error: true }); }
          finally { paint(); }
        });
        const kids = [
          h("p", { class: "hint", text: pushHour != null
            ? `On. You'll get one notification each morning at ${hourLabel(pushHour)} when something is overdue or due, even if the app is closed.`
            : "Get a notification each morning when something is overdue or due, even if the app is closed." }),
          h("div", { class: "field" }, h("label", { for: "s-remind-hour", text: "Time" }), sel), btn];
        if (!pwa.isStandalone()) kids.push(h("p", { class: "hint", text: "On iPhone, reminders only work after you add the app to your Home Screen (Share, then Add to Home Screen) and open it from there." }));
        wrap.replaceChildren(...kids);
        return;
      }
      const msg = !pwa.supported()
        ? "Phone reminders aren't available in this browser. Add the app to your Home Screen from a regular browser to use them."
        : on ? "On. You'll get one notification a day when something is overdue or due, the next time you open the app."
        : "Get a notification when something is overdue or due. It's sent when you open the app, at most once a day." + (push && auth && !auth.session() ? " Sign in (Account, above) to get it every morning even when the app is closed." : "");
      const btn = h("button", { type: "button", class: "btn", id: "s-remind", text: on ? "Turn off reminders" : "Turn on reminders", disabled: !pwa.supported() });
      btn.addEventListener("click", async () => {
        if (on) { pwa.disableReminders(ls); toast("Reminders turned off."); paint(); return; }
        const r = await pwa.enableReminders(ls);
        if (r.ok) toast("Reminders turned on.");
        else toast(r.why === "denied" ? "Notifications are blocked. Allow them in your browser settings, then try again." : "Reminders aren't available here.", { error: true });
        paint();
      });
      const kids = [h("p", { class: "hint", text: msg }), btn];
      if (!pwa.isStandalone()) kids.push(h("p", { class: "hint", text: "Tip: in your browser menu choose \"Add to Home Screen\" (or \"Install app\") so it opens like a normal app." }));
      wrap.replaceChildren(...kids);
    };
    paint();
    return wrap;
  }

  // ---------- Account (only when a cloud project is configured; see config.js) ----------
  const authOf = () => (doc.defaultView && doc.defaultView.motAuth) || null;

  function accountPanel() {
    const auth = authOf();
    const wrap = h("div", { class: "account" });
    const here = () => { const l = doc.defaultView.location; return l.origin + l.pathname; };
    const paint = () => {
      const s = auth.session();
      if (s) {
        const out = h("button", { type: "button", class: "btn", id: "s-signout", text: "Sign out" });
        out.addEventListener("click", async () => {
          const ok = await confirmDialog({ title: "Sign out?", message: "Your data stays safe in your account. This phone keeps its own copy until you sign in again, and nothing is shared with the next person who signs in here.", confirmLabel: "Sign out" });
          if (!ok) return;
          await auth.signOut();
          doc.defaultView.location.reload();
        });
        wrap.replaceChildren(
          h("p", { class: "hint", text: `Signed in${s.user && s.user.email ? " as " + s.user.email : ""}. Your data syncs to your account, so it survives a lost phone and appears on your other phones.` }), out);
        return;
      }
      const email = h("input", { type: "email", id: "s-email", autocomplete: "email", inputmode: "email", placeholder: "you@example.com", "aria-label": "Email address" });
      const note = h("p", { class: "hint", id: "s-signin-note", role: "status", text: "" });
      const mail = h("button", { type: "button", class: "btn primary", id: "s-email-go", text: "Email me a sign-in link" });
      mail.addEventListener("click", async () => {
        const v = email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) { note.textContent = "Enter a valid email address."; email.focus(); return; }
        mail.disabled = true; note.textContent = "Sending…";
        try {
          await auth.signInWithEmail(v, here());
          note.textContent = `Check ${v} for a link from us and open it on this phone. It may take a minute; look in spam too.`;
        } catch (e) { note.textContent = "Couldn't send the link: " + errMsg(e, "try again in a moment."); }
        finally { mail.disabled = false; }
      });
      const google = h("button", { type: "button", class: "btn", id: "s-google", text: "Continue with Google" });
      google.addEventListener("click", () => { doc.defaultView.location.assign(auth.googleUrl(here())); });
      wrap.replaceChildren(
        h("p", { class: "hint", text: "Sign in to keep your data safe in the cloud and use it on more than one phone. Your tasks on this phone are kept and merged in." }),
        h("div", { class: "field" }, h("label", { for: "s-email", text: "Email" }), email),
        h("div", { class: "row-panel-actions wrap-actions" }, mail, google), note);
    };
    paint();
    return wrap;
  }

  function startRerun() {
    resetWizard(state, true);
    rerunning = true;
    render();
  }

  // ---------- render ----------
  function renderView(tab) {
    const p = panels[tab.id];
    if (tab.id === "tasks") { safeRender(p, () => renderTasks()); return; }
    safeRender(p, () => tab.view.render(p.body, ctx));
  }
  function safeRender(p, fn) {
    try { fn(); } catch (e) {
      p.body.replaceChildren(h("div", { class: "view-error", role: "alert" },
        h("strong", { text: "This tab ran into a problem." }), h("p", { text: errMsg(e, "Unknown error.") }),
        h("button", { type: "button", class: "btn", text: "Try again", onclick: () => render() })));
    }
  }

  function render() {
    today = localToday();
    const snap = describeFocus(doc.activeElement);
    const inShell = snap && (els.app.contains(snap.el) || els.wizard.contains(snap.el));
    const needsWizard = !state.profile || state.profile.setupDone === false || rerunning;
    els.headerActions.hidden = needsWizard;
    if (needsWizard) {
      els.app.hidden = true; els.wizard.hidden = false;
      renderWizard(els.wizard, ctx, { rerun: rerunning, onClose: () => {
        const firstRun = !rerunning;
        rerunning = false; render(); const t = els.main; t.setAttribute("tabindex", "-1"); t.focus();
        if (firstRun && !tourSeen() && state.profile && state.profile.setupDone) openTour(null); // new users get the tour right after setup
      } });
    } else {
      els.wizard.hidden = true; els.app.hidden = false;
      renderStrip(); renderNav(); renderBack();
      for (const t of TABS) {
        panels[t.id].root.hidden = t.id !== active;
        if (t.id === active) renderView(t);
      }
      refreshNames();
    }
    if (inShell && (!doc.activeElement || doc.activeElement === doc.body)) restoreFocus(snap);
  }

  function refreshNames() {
    const ids = new Set();
    for (const t of state.tasks) if (t.assignee) ids.add(t.assignee);
    for (const c of state.completions) if (c.by) ids.add(c.by);
    const need = [...ids].filter((i) => !(i in names) && !requestedNames.has(i) && i !== me.id);
    if (!need.length) return;
    need.forEach((i) => requestedNames.add(i));
    Promise.resolve().then(() => store.names(need)).then((m) => {
      if (m && Object.keys(m).length) { Object.assign(names, m); render(); }
    }).catch(() => {});
  }

  // ---------- init ----------
  els.back = h("div", { class: "backbar", id: "backbar", hidden: true });
  els.main.append(els.back);
  for (const t of TABS) {
    const root = h("section", { class: "view", id: `view-${t.id}`, "aria-labelledby": `h-${t.id}`, hidden: t.id !== active },
      h("h2", { class: "sr-only", id: `h-${t.id}`, text: t.label }));
    const body = h("div", { class: "view-body" });
    root.append(body);
    els.main.append(root);
    panels[t.id] = { root, body };
  }
  panels.tasks.refs = buildTasksPanel(panels.tasks.body);

  doc.getElementById("add-btn").addEventListener("click", (e) => { setView("tasks", false); openTaskForm(null, e.currentTarget); });
  doc.getElementById("settings-btn").addEventListener("click", (e) => openSettings(e.currentTarget));

  try { const who = await store.whoAmI(); if (who) { me.id = who.id || null; me.isOwner = !!who.isOwner; } } catch { /* anonymous */ }
  try {
    store.onStatus((st) => {
      if (!st) return;
      sync = { kind: st.kind || "saved", message: st.message || "" };
      if (els.app.hidden === false) renderStrip();
      if (st.kind === "error") toast(st.message || "Couldn't save your changes.", { error: true });
      else if (st.kind === "offline" && lastSyncKind !== "offline") toast(st.message || "You're offline. Changes are saved on this device and will sync later.", { error: true, ms: 9000 });
      lastSyncKind = st.kind;
    });
  } catch { /* optional */ }
  try {
    store.subscribe((remote) => {
      state = remote; undo = null;
      if (undoToast) undoToast._remove();
      render();
      toast("Updated from another device");
    });
  } catch { /* optional */ }

  render();
  if (!tourSeen() && state.profile && state.profile.setupDone && !loadError) openTour(null);
  if (loadError) toast("Couldn't load your saved data, so a fresh start was opened. " + errMsg(loadError), { error: true, ms: 12000 });
  else if (store.warning) toast(String(store.warning), { error: true, ms: 10000 });
  else if (!persistent && store.mode === "local") toast("Storage is unavailable; changes will not be kept after you close this page.", { error: true, ms: 10000 });

  // Roll over at midnight if left open.
  let lastDay = today;
  const tick = () => { const d = localToday(); if (d !== lastDay) { lastDay = d; render(); } };
  setInterval(tick, 60000);
  doc.addEventListener("visibilitychange", () => { if (!doc.hidden) tick(); });
  return { render, ctx, getState: () => state };
}
