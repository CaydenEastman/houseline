// Calendar view: one-time .ics export. Plain about what it can't do.
import * as ICS from "../ics.js";

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

function build(ctx, rerender) {
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

  return h("section", { class: "v-view", "aria-labelledby": "v-cal-h" },
    h("h2", { id: "v-cal-h", class: "v-h2", text: "Calendar" }),
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

export default { id, label, render };
