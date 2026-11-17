// Calendar view: a month grid of what falls on which day, plus a one-time .csv/.ics export.
// Plain about what the export can't do (no live feed, no email/push).
import * as ICS from "../ics.js";
import * as CAL from "../calendar.js";
import { addDays, snoozeTask, dueInfo } from "../logic.js";
import { isoToLocalDate, plural, fmtDate } from "../dom.js";

export const id = "calendar";
export const label = "Calendar";

const HORIZONS = [[90, "3 months"], [180, "6 months"], [400, "13 months (default)"], [730, "2 years"]];
const S = { horizon: 400, supplies: true, warranties: true, msg: "", showText: null, pending: null };

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

function filtered(state) {
  return {
    ...state,
    supplies: S.supplies ? state.supplies || [] : [],
    items: (state.items || []).map((i) => (S.warranties ? i : { ...i, warrantyExpires: null })),
  };
}

function buildExport(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const st = filtered(state);
  const say = (m, fk) => { S.msg = m; S.pending = fk; rerender(); };

  const make = {
    ics: () => ICS.buildICS(st, today, { horizonDays: S.horizon, calName: "Man of the House" }),
    csv: () => {
      if (typeof ICS.buildCalendarCSV !== "function") throw new Error("The Google Calendar export isn't available in this build.");
      return ICS.buildCalendarCSV(state, today, { horizonDays: S.horizon, includeSupplies: S.supplies, includeWarranties: S.warranties });
    },
  };
  const names = { ics: () => ICS.icsFilename(today), csv: () => (typeof ICS.csvFilename === "function" ? ICS.csvFilename(today) : `man-of-the-house-${today}.csv`) };
  const out = {};
  for (const k of ["csv", "ics"]) {
    try { out[k] = { text: make[k]() }; }
    catch (e) { out[k] = { text: "", err: e && e.message ? e.message : "Couldn't build this file." }; }
  }
  out.ics.n = out.ics.text ? (out.ics.text.match(/BEGIN:VEVENT/g) || []).length : 0;
  out.csv.n = out.csv.text ? Math.max(0, out.csv.text.split(/\r?\n/).filter((l) => l.trim()).length - 1) : 0;

  const download = (k) => async () => {
    let ok = false;
    try { ok = await ctx.saveFile(names[k](), out[k].text, k === "csv" ? "text/csv" : "text/calendar"); } catch { ok = false; }
    if (ok) say(k === "ics"
      ? `Saved. The file will most likely be named ${names[k]()}.txt. Rename it to end in .ics before importing.`
      : `Saved ${names[k]()}. Now import it into Google Calendar (steps below).`, `v-cal-dl-${k}`);
    else { S.showText = k; say("Downloading isn't available here, or was cancelled. Copy the text below and save it in a plain-text file yourself.", `v-cal-dl-${k}`); }
  };
  const copy = (k) => async () => {
    try {
      const nav = ctx.doc.defaultView && ctx.doc.defaultView.navigator;
      if (!nav || !nav.clipboard || !nav.clipboard.writeText) throw new Error("no clipboard");
      await nav.clipboard.writeText(out[k].text);
      say(`Copied. Paste it into a plain-text file and save it with the ending .${k}.`, `v-cal-copy-${k}`);
    } catch { S.showText = k; say("Copying was blocked. Select the text below (click it, then Ctrl/Cmd+A) and copy it yourself.", "v-cal-text"); }
  };
  const check = (key, lab, hint) => h("div", { class: "v-check-opt" },
    h("input", { type: "checkbox", id: `v-cal-${key}`, "data-fk": `v-cal-${key}`, checked: S[key] ? true : null, onchange: (e) => { S[key] = e.target.checked; S.msg = ""; S.pending = `v-cal-${key}`; rerender(); } }),
    h("label", { for: `v-cal-${key}` }, lab, h("span", { class: "v-hint", text: ` ${hint}` })));

  const exportPanel = (k, title, who, detail) => {
    const o = out[k];
    const none = !o.text || o.n === 0;
    return h("section", { class: "v-panel", "aria-labelledby": `v-cal-${k}-h` },
      h("h3", { id: `v-cal-${k}-h`, class: "v-h3", text: title }),
      h("p", { text: who }),
      h("p", { class: "v-hint", text: detail }),
      o.err ? h("p", { class: "form-error", role: "alert", text: o.err })
        : h("p", { class: "v-count", role: "status", "aria-live": "polite", text: none ? "Nothing to export yet. Add some tasks first." : `${o.n === 1 ? "1 event" : `${o.n} events`} in this file.` }),
      h("div", { class: "v-actions" },
        h("button", { type: "button", class: "btn v-primary", "data-fk": `v-cal-dl-${k}`, text: k === "csv" ? "Download Google Calendar file (.csv)" : "Download calendar file (.ics)", disabled: none ? true : null, onclick: download(k) }),
        h("button", { type: "button", class: "btn", "data-fk": `v-cal-copy-${k}`, text: `Copy .${k} text`, disabled: none ? true : null, onclick: copy(k) })));
  };

  return h("section", { class: "v-export", "aria-labelledby": "v-cal-export-h" },
    h("h3", { id: "v-cal-export-h", class: "v-h2", text: "Export to your calendar" }),
    h("div", { class: "v-note", role: "note" },
      h("p", {}, h("strong", { text: "This is a one-time export, not a live feed. " }),
        "You download a file and import it into your calendar app. After that, the calendar doesn't update by itself. When you add or change a lot of tasks, export again."),
      h("p", { text: "This page can't send email or push notifications. Your reminders come from your calendar app's own alerts, which you may need to set up there." })),
    h("form", { class: "v-form", "aria-label": "Calendar export options", onsubmit: (e) => e.preventDefault() },
      h("h3", { class: "v-h3", text: "What to include" }),
      h("div", { class: "field" },
        h("label", { for: "v-cal-horizon", text: "How far ahead" }),
        h("select", { id: "v-cal-horizon", "data-fk": "v-cal-horizon", onchange: (e) => { S.horizon = Number(e.target.value); S.msg = ""; rerender(); } },
          HORIZONS.map(([d, t]) => h("option", { value: String(d), selected: S.horizon === d, text: t })))),
      check("supplies", "Emergency supply expiry dates", "(one event per supply that expires)"),
      check("warranties", "Warranty end dates", "(one event per item with a warranty)")),
    exportPanel("csv", "Google Calendar (.csv), recommended for Google Calendar",
      "Repeating tasks are written out as separate dated events (up to 26 per task), so they import cleanly into Google Calendar.",
      "Google Calendar on a computer: Settings, then Import & export, then Import. Choose this file and the calendar to add it to. The phone app can't import files."),
    exportPanel("ics", "Calendar file (.ics), for Apple Calendar and Outlook",
      "Keeps true repeating events: one recurring event per repeating task. Mileage tasks are a single estimated date. Events include a 1-day-before alert (7 days before for supply and warranty events), if your calendar app honors it.",
      "Heads up: downloads here can't be saved with an .ics ending, so the file is saved as name.ics.txt. Rename it to end in .ics before you import it."),
    p_msg(h),
    S.showText && out[S.showText].text
      ? h("div", { class: "field" },
          h("label", { for: "v-cal-text", text: `.${S.showText} text (read-only)` }),
          h("textarea", { id: "v-cal-text", "data-fk": "v-cal-text", class: "v-pre", rows: "8", readonly: true, text: out[S.showText].text }))
      : null,
    h("section", { class: "v-panel", "aria-labelledby": "v-cal-how" },
      h("h3", { id: "v-cal-how", class: "v-h3", text: "Importing the .ics file" }),
      h("ul", { class: "v-howto" },
        h("li", {}, h("strong", { text: "Apple Calendar: " }), "rename the file to end in .ics, then open it, or use File, then Import. Consider a new calendar so it's easy to remove later."),
        h("li", {}, h("strong", { text: "Outlook: " }), "rename to .ics, then File, Open & Export, Import/Export (desktop) or Add calendar, Upload from file (web)."),
        h("li", { text: "Importing a second time may create duplicates in some apps. If so, delete the first import's calendar and import the new file." }))));
}

function p_msg(h) { return h("p", { class: "v-hint", role: "status", text: S.msg }); }

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

const G = { year: null, month: null, selected: null, focus: null, types: { task: true, supply: true, done: true }, cat: "all" };
const GROUP = { task: "task", supply: "supply", warranty: "supply", done: "done", skipped: "done" };
const MAX_CHIPS = 3;
/** Forget the month/selection the user last looked at (used by tests). */
export function resetCalendarView() { G.year = null; G.month = null; G.selected = null; G.focus = null; G.types = { task: true, supply: true, done: true }; G.cat = "all"; }
const CATS = [["all", "All areas"], ["car", "Car"], ["house", "House"], ["yard", "Yard"], ["emergency", "Emergency"]];
const CAT_LABEL = { car: "Car", house: "House", yard: "Yard", emergency: "Emergency" };
const WEEK_START = 0; // Sunday

// A shape or letter for every status/type so color is never the only cue.
function symbolOf(e) {
  if (e.type === "supply") return e.status === "expired" ? "!" : "▲";
  if (e.type === "warranty") return e.status === "expired" ? "!" : "■";
  if (e.type === "done") return "✓";
  if (e.type === "skipped") return "–";
  return { overdue: "!", "due-soon": "◐", snoozed: "z", ok: "○" }[e.status] || "○";
}
function statusWord(e) {
  if (e.type === "done") return "done";
  if (e.type === "skipped") return "skipped";
  const w = { overdue: "overdue", "due-soon": "due soon", snoozed: "snoozed", ok: "on track", expired: "expired" }[e.status] || "";
  return e.projected ? `${w ? w + ", " : ""}projected` : w;
}
const typeWord = (e) => ({ task: "Task", supply: "Supply", warranty: "Warranty", done: "Done", skipped: "Skipped" }[e.type] || "");
const longDay = (iso) => isoToLocalDate(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const weekdayOf = (iso) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();

function matches(e) {
  if (!G.types[GROUP[e.type]]) return false;
  return G.cat === "all" || e.category === G.cat;
}

function buildGrid(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  if (G.year == null) { G.year = +today.slice(0, 4); G.month = +today.slice(5, 7); }
  if (G.selected == null) G.selected = today;

  const grid = CAL.monthGrid(G.year, G.month, WEEK_START);
  const range = CAL.gridRange(G.year, G.month, WEEK_START);
  let events = [];
  let loadError = "";
  try { events = CAL.eventsInRange(state, range.from, range.to, today); }
  catch (e) { loadError = e && e.message ? e.message : "Couldn't read the schedule."; }
  const shown = events.filter(matches);
  const byDate = CAL.eventsByDate(shown);

  const monthKey = `${String(G.year).padStart(4, "0")}-${String(G.month).padStart(2, "0")}`;
  const inMonth = shown.filter((e) => e.date.startsWith(monthKey));
  const nScheduled = inMonth.filter((e) => e.type === "task").length;
  const nOverdue = inMonth.filter((e) => e.type === "task" && e.status === "overdue").length;
  const nDone = inMonth.filter((e) => e.type === "done").length;

  const inGrid = (iso) => iso >= range.from && iso <= range.to;
  const focusDay = G.focus && inGrid(G.focus) ? G.focus
    : G.selected && inGrid(G.selected) && G.selected.startsWith(monthKey) ? G.selected
      : inGrid(today) && today.startsWith(monthKey) ? today : `${monthKey}-01`;

  const jump = (y, m, pending) => { G.year = y; G.month = m; S.pending = pending; rerender(); };
  const go = (delta, fk) => () => { const s = CAL.shiftMonth(G.year, G.month, delta); G.focus = null; jump(s.year, s.month, fk); };
  const goToday = () => { G.selected = today; G.focus = today; jump(+today.slice(0, 4), +today.slice(5, 7), `v-day-${today}`); };
  const pick = (iso) => () => {
    G.selected = iso; G.focus = iso; S.pending = `v-day-${iso}`;
    if (!iso.startsWith(monthKey)) { G.year = +iso.slice(0, 4); G.month = +iso.slice(5, 7); }
    rerender();
  };

  const onKey = (e) => {
    const btn = e.target && e.target.closest ? e.target.closest("[data-day]") : null;
    if (!btn) return;
    const cur = btn.getAttribute("data-day");
    let next = null;
    if (e.key === "ArrowLeft") next = addDays(cur, -1);
    else if (e.key === "ArrowRight") next = addDays(cur, 1);
    else if (e.key === "ArrowUp") next = addDays(cur, -7);
    else if (e.key === "ArrowDown") next = addDays(cur, 7);
    else if (e.key === "Home") next = addDays(cur, -((weekdayOf(cur) - WEEK_START + 7) % 7));
    else if (e.key === "End") next = addDays(cur, 6 - ((weekdayOf(cur) - WEEK_START + 7) % 7));
    else if (e.key === "PageUp" || e.key === "PageDown") {
      const s = CAL.shiftMonth(+cur.slice(0, 4), +cur.slice(5, 7), e.key === "PageUp" ? -1 : 1);
      const d = Math.min(+cur.slice(8, 10), daysIn(s.year, s.month));
      next = `${String(s.year).padStart(4, "0")}-${String(s.month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
    if (!next) return;
    e.preventDefault();
    G.focus = next; G.year = +next.slice(0, 4); G.month = +next.slice(5, 7); S.pending = `v-day-${next}`;
    rerender();
  };

  const monthTitle = isoToLocalDate(`${monthKey}-01`).toLocaleDateString(undefined, { month: "long", year: "numeric" });

  const weekdayHead = h("tr", {}, Array.from({ length: 7 }, (_, i) => {
    const iso = addDays("2026-11-01", (i + WEEK_START) % 7); // 2026-11-01 is a Sunday
    const d = isoToLocalDate(iso);
    return h("th", { scope: "col", abbr: d.toLocaleDateString(undefined, { weekday: "long" }),
      text: d.toLocaleDateString(undefined, { weekday: "short" }) });
  }));

  const dayCell = (cell) => {
    const iso = cell.date;
    const list = byDate[iso] || [];
    const overdue = list.filter((e) => e.status === "overdue").length;
    const cls = ["v-day"];
    if (!cell.inMonth) cls.push("v-out");
    if (iso === today) cls.push("v-today");
    if (iso === G.selected) cls.push("v-sel");
    if (overdue) cls.push("v-has-overdue");
    const label = `${longDay(iso)}, ${list.length === 0 ? "nothing scheduled" : plural(list.length, "item")}${overdue ? `, ${overdue} overdue` : ""}${iso === today ? ", today" : ""}`;
    const chips = list.slice(0, MAX_CHIPS).map((e) =>
      h("span", { class: `v-chip v-st-${e.status || "none"} v-cat-${e.category || "none"}${e.projected ? " v-proj" : ""}`, "aria-hidden": "true", text: symbolOf(e) }));
    const more = list.length > MAX_CHIPS ? h("span", { class: "v-more", "aria-hidden": "true", text: `+${list.length - MAX_CHIPS}` }) : null;
    return h("td", { class: "v-cell" },
      h("button", {
        type: "button", class: cls.join(" "), "data-day": iso, "data-fk": `v-day-${iso}`,
        tabindex: iso === focusDay ? "0" : "-1", "aria-label": label, "aria-pressed": iso === G.selected ? "true" : "false",
        "aria-current": iso === today ? "date" : null, onclick: pick(iso),
        ondragover: iso > today ? (ev) => { ev.preventDefault(); } : null,
        ondrop: iso > today ? (ev) => {
          ev.preventDefault();
          let tid = ""; try { tid = ev.dataTransfer.getData("text/plain"); } catch { /* none */ }
          if (!tid || typeof ctx.commit !== "function") return;
          try { ctx.commit(snoozeTask(ctx.getState(), tid, iso, today), `Moved to ${fmtDate(iso)}`); }
          catch (err) { if (typeof ctx.toast === "function") ctx.toast(err && err.message ? err.message : "Couldn't move that.", { error: true }); }
        } : null,
      },
      h("span", { class: "v-daynum", "aria-hidden": "true", text: String(+iso.slice(8, 10)) }),
      h("span", { class: "v-chips" }, chips, more),
      list.length ? h("span", { class: "v-count-dot", "aria-hidden": "true", text: String(list.length) }) : null));
  };

  const table = h("table", { class: "v-cal-grid", role: "grid", "aria-label": `${monthTitle} calendar`, onkeydown: onKey },
    h("thead", {}, weekdayHead),
    h("tbody", {}, grid.weeks.map((w) => h("tr", {}, w.map(dayCell)))));

  const toggle = (key, text) => h("div", { class: "v-check-opt" },
    h("input", { type: "checkbox", id: `v-cal-show-${key}`, "data-fk": `v-cal-show-${key}`, checked: G.types[key] ? true : null,
      onchange: (e) => { G.types[key] = e.target.checked; S.pending = `v-cal-show-${key}`; rerender(); } }),
    h("label", { for: `v-cal-show-${key}`, text }));

  const filters = h("div", { class: "v-cal-filters", role: "group", "aria-label": "What to show" },
    toggle("task", "Tasks"), toggle("supply", "Supplies & warranties"), toggle("done", "Done history"),
    h("div", { class: "field v-cal-cat" },
      h("label", { for: "v-cal-cat", text: "Area" }),
      h("select", { id: "v-cal-cat", "data-fk": "v-cal-cat", onchange: (e) => { G.cat = e.target.value; S.pending = "v-cal-cat"; rerender(); } },
        CATS.map(([v, t]) => h("option", { value: v, selected: G.cat === v, text: t })))));

  // ----- selected day panel -----
  const sel = G.selected;
  const selList = sel ? byDate[sel] || [] : [];
  const taskOf = (id) => (state.tasks || []).find((t) => t.id === id) || null;
  const row = (e) => {
    const task = e.type === "task" ? taskOf(e.taskId) : null;
    const tags = [e.carried ? "carried forward" : null, e.estimated ? "estimated date" : null, e.projected ? "projected repeat" : null].filter(Boolean);
    const movable = !!task && !e.projected && e.type === "task" && typeof ctx.commit === "function";
    const move = (iso) => {
      try { ctx.commit(snoozeTask(ctx.getState(), task.id, iso, today), `Moved to ${fmtDate(iso)}: ${task.title}`); }
      catch (err) { if (typeof ctx.toast === "function") ctx.toast(err && err.message ? err.message : "Couldn't move that.", { error: true }); }
    };
    let minMove = addDays(today, 1);
    try { const d = movable ? dueInfo(task, state, today).dueDate : null; if (d && d >= today) minMove = addDays(d, 1); } catch { /* keep tomorrow */ }
    const dateIn = movable ? h("input", { type: "date", id: `v-mv-${e.id}`, min: minMove, max: addDays(today, 365) }) : null;
    return h("li", { class: `v-evt v-st-${e.status || "none"}`, draggable: movable ? "true" : null,
      ondragstart: movable ? (ev) => { try { ev.dataTransfer.setData("text/plain", task.id); ev.dataTransfer.effectAllowed = "move"; } catch { /* no dnd */ } } : null },
      h("span", { class: `v-chip v-st-${e.status || "none"} v-cat-${e.category || "none"}`, "aria-hidden": "true", text: symbolOf(e) }),
      h("div", { class: "v-evt-main" },
        h("p", { class: "v-evt-title", text: e.title }),
        h("p", { class: "v-meta" },
          `${typeWord(e)}${e.category ? ` · ${CAT_LABEL[e.category] || e.category}` : ""} · ${statusWord(e) || "scheduled"}${e.detail ? ` · ${e.detail}` : ""}${tags.length ? ` (${tags.join(", ")})` : ""}`)),
      task ? h("div", { class: "v-actions v-evt-actions" },
        !e.projected && typeof ctx.completeTask === "function"
          ? h("button", { type: "button", class: "btn v-small", text: "Done", "aria-label": `Done: ${e.title}`, "data-fk": `v-evt-done-${e.id}`, onclick: () => ctx.completeTask(task.id) }) : null,
        h("button", { type: "button", class: "btn v-small", text: "Edit", "aria-label": `Edit: ${e.title}`, "data-fk": `v-evt-edit-${e.id}`, onclick: () => ctx.openTaskForm(task) })) : null,
      movable ? h("div", { class: "v-move" },
        h("label", { for: `v-mv-${e.id}`, class: "v-hint", text: "Move to a later day:" }), dateIn,
        h("button", { type: "button", class: "btn v-small", text: "Move", "aria-label": `Move ${e.title}`, onclick: () => { if (dateIn.value) move(dateIn.value); else if (typeof ctx.toast === "function") ctx.toast("Pick a date first.", { error: true }); } })) : null);
  };
  const announce = sel ? `${longDay(sel)}: ${selList.length === 0 ? "nothing scheduled" : plural(selList.length, "item")}` : "No day selected";
  const panel = h("section", { class: "v-day-panel", "aria-labelledby": "v-day-h" },
    h("h3", { id: "v-day-h", class: "v-h3", text: sel ? longDay(sel) : "Pick a day" }),
    selList.length
      ? h("ul", { class: "v-evts" }, selList.map(row))
      : h("p", { class: "v-hint", text: sel ? (events.length === 0 && !loadError ? "Nothing is scheduled in this month yet. Add tasks, supplies or warranty dates and they'll show up here." : "Nothing scheduled this day.") : "Select a day to see what's on it." }),
    h("p", { class: "sr-only", role: "status", "aria-live": "polite", text: announce }));

  const legend = h("ul", { class: "v-legend", "aria-label": "Legend" },
    [["!", "overdue or expired"], ["◐", "coming up soon"], ["○", "not due yet"], ["z", "snoozed"], ["▲", "emergency supply expires"], ["■", "warranty ends"], ["✓", "done"], ["–", "skipped"]]
      .map(([sym, t]) => h("li", {}, h("span", { class: "v-chip v-st-none", "aria-hidden": "true", text: sym }), ` ${t}`)));

  return h("section", { class: "v-cal", "aria-labelledby": "v-cal-grid-h" },
    h("h3", { id: "v-cal-grid-h", class: "v-h2 sr-only", text: "Month view" }),
    h("div", { class: "v-cal-head" },
      h("div", { class: "v-cal-nav" },
        h("button", { type: "button", class: "btn", "data-fk": "v-cal-prev", "aria-label": "Previous month", text: "‹ Prev", onclick: go(-1, "v-cal-prev") }),
        h("button", { type: "button", class: "btn", "data-fk": "v-cal-today", text: "Today", onclick: goToday }),
        h("button", { type: "button", class: "btn", "data-fk": "v-cal-next", "aria-label": "Next month", text: "Next ›", onclick: go(1, "v-cal-next") })),
      h("h3", { class: "v-cal-title", text: monthTitle })),
    h("p", { class: "v-count", role: "status", text: `${plural(nScheduled, "task")} scheduled · ${nOverdue} overdue · ${nDone} done this month` }),
    loadError ? h("p", { class: "form-error", role: "alert", text: loadError }) : null,
    filters,
    h("div", { class: "v-cal-scroll" }, table),
    legend,
    panel,
    h("p", { class: "v-hint", text: "Repeats are projected assuming each task is done on time. Mileage dates are estimates from your odometer. Moving a task to a later day snoozes it until then; drag a task from the day list onto a future day, or use the date box." }));
}

function build(ctx, rerender) {
  const { h } = ctx;
  return h("section", { class: "v-view", "aria-labelledby": "v-cal-h" },
    h("h2", { id: "v-cal-h", class: "v-h2", text: "Calendar" }),
    buildGrid(ctx, rerender),
    buildExport(ctx, rerender));
}

export default { id, label, render };
