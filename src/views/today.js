// Today: a simple feed. Top line says what needs doing, chips filter by area, big cards each have one clear Done button.
import { helpPanel } from "./help.js";
import { milesText, fmtDate, fmtNum } from "../dom.js";
import { snoozeTask, addDays, setOdometer } from "../logic.js";
import { agenda, homeScore, seasonNudges, mileageFlags, staleOdometers, CAT_LABEL } from "../insights.js";
import { estimateFor, rangeText } from "../costs.js";
import { makePaint, plural, dueWords } from "./shared.js";

export const id = "today";
export const label = "Today";
const S = { pending: null, sel: new Set(), selecting: false, cat: "all", scoreOpen: false, showAll: false, ideasHidden: false };
const FEED_LIMIT = 10; // the most urgent are shown first; the rest sit behind "Show more"
const FEED_SLACK = 3;  // not worth hiding for just a few extra
const CAT_ICON = { car: "\u{1F697}", house: "\u{1F3E0}", yard: "\u{1F33F}", emergency: "\u{1F6DF}" };
const paint = makePaint(S);

/** Reset module state (tests mount several views in one process). */
export function resetTodayView() { S.pending = null; S.sel = new Set(); S.selecting = false; S.cat = "all"; S.scoreOpen = false; S.showAll = false; S.ideasHidden = false; }

export function render(container, ctx) {
  const rerender = () => render(container, ctx);
  paint(container, () => build(ctx, rerender), ctx.doc);
}

function build(ctx, rerender) {
  const { h } = ctx;
  const state = ctx.getState();
  const today = ctx.today();
  const sc = homeScore(state, today);
  const a = agenda(state, today, 7);
  const nudges = seasonNudges(state, today, 3);
  const flags = mileageFlags(state, today);
  const stale = staleOdometers(state, today);
  const go = (tab) => () => { if (typeof ctx.setView === "function") ctx.setView(tab, true); };

  const all = [...a.overdue.map((r) => ({ ...r, group: "Overdue" })), ...a.today.map((r) => ({ ...r, group: "Today" })), ...a.week.map((r) => ({ ...r, group: "This week" }))];
  const count = (c) => all.filter((r) => c === "all" || r.task.category === c).length;
  if (S.cat !== "all" && count(S.cat) === 0 && count("all") > 0) S.cat = "all";
  const allRows = all.filter((r) => S.cat === "all" || r.task.category === S.cat);
  const collapsed = !S.showAll && allRows.length > FEED_LIMIT + FEED_SLACK;
  const rows = collapsed ? allRows.slice(0, FEED_LIMIT) : allRows; // what is on screen (and what "Select all" means)
  const live = new Set(all.map((r) => r.task.id));
  for (const i of [...S.sel]) if (!live.has(i)) S.sel.delete(i);

  // ----- headline -----
  const nOver = a.overdue.length, nSoon = a.today.length + a.week.length;
  const headline = !all.length ? "You're all caught up"
    : nOver ? `${nOver} overdue${nSoon ? ` · ${nSoon} coming up` : ""}`
      : `${plural(nSoon, "thing")} coming up this week`;
  // Day one, nothing finished yet: a failing grade would be unfair, so say it is just the start.
  const starting = !(state.completions || []).length;
  const bandText = { great: "In great shape", ok: "Mostly on track", "needs-work": starting ? "Getting started" : "Needs attention" }[sc.band];
  const head = h("div", { class: "tf-head" },
    h("h3", { class: "tf-title", text: headline }),
    h("details", { class: `tf-score v-score-${sc.band}`, open: S.scoreOpen ? true : null, ontoggle: (e) => { S.scoreOpen = !!(e.target && e.target.open); } },
      h("summary", { "data-fk": "tf-score", "aria-label": `Home score ${sc.score} out of 100, ${bandText}. Show details` },
        h("span", { class: "tf-ring", "aria-hidden": "true", text: String(sc.score) }),
        h("span", { class: "tf-score-text" }, h("strong", { text: bandText }), h("small", { text: "Home score" }))),
      h("p", { class: "v-meta", text: `Maintenance ${sc.parts.maintenance} · Supplies ${sc.parts.supplies} · Emergency info ${sc.parts.info}` }),
      sc.fixes.length
        ? h("div", { class: "v-steps-wrap" }, h("h4", { class: "v-h5", text: "Best next steps" }),
          h("ol", { class: "v-steps" }, sc.fixes.map((f, i) => h("li", {},
            h("button", { type: "button", class: "v-step", "data-fk": `v-fix-${i}`, onclick: go(f.tab) },
              h("span", { class: "v-step-n", "aria-hidden": "true", text: String(i + 1) }),
              h("span", { class: "v-step-text", text: f.text }))))))
        : h("p", { class: "v-hint", text: "Nothing urgent. Nice work." })));

  // ----- filter chips -----
  const chip = (c, text) => h("button", { type: "button", class: "chip", "aria-pressed": String(S.cat === c), "data-fk": `tf-chip-${c}`,
    onclick: () => { S.cat = c; S.pending = `tf-chip-${c}`; rerender(); } }, text, h("span", { class: "count", text: String(count(c)) }));
  const chips = h("div", { class: "chips tf-chips", role: "group", "aria-label": "Filter by area" },
    chip("all", "All"), ["car", "house", "yard", "emergency"].filter((c) => count(c) > 0).map((c) => chip(c, `${CAT_ICON[c]} ${CAT_LABEL[c] || c}`)));

  // ----- select several -----
  const canSelect = rows.length > 1 && typeof ctx.markManyDone === "function";
  const nSel = S.sel.size;
  const selectToggle = canSelect ? h("button", { type: "button", class: "btn subtle v-small tf-select", "data-fk": "tf-select",
    text: S.selecting ? "Cancel" : "Mark several done", onclick: () => { S.selecting = !S.selecting; S.sel.clear(); S.pending = "tf-select"; rerender(); } }) : null;
  const bulkBar = S.selecting && canSelect ? h("div", { class: "v-bulk", role: "group", "aria-label": "Mark several done" },
    h("button", { type: "button", class: "btn v-small", "data-fk": "v-sel-all", text: nSel === rows.length ? "Clear selection" : "Select all",
      onclick: () => { if (nSel === rows.length) S.sel.clear(); else rows.forEach((r) => S.sel.add(r.task.id)); S.pending = "v-sel-all"; rerender(); } }),
    h("button", { type: "button", class: "btn primary solid v-small", "data-fk": "v-sel-done", disabled: nSel ? null : true, text: nSel ? `Mark ${nSel} done today` : "Mark selected done today",
      onclick: () => { const ids = [...S.sel]; S.sel.clear(); S.selecting = false; if (!ctx.markManyDone(ids)) rerender(); } }),
    h("span", { class: "v-hint", role: "status", text: nSel ? `${plural(nSel, "task")} selected` : "Tick tasks, then mark them done in one go." })) : null;

  // ----- cards -----
  const costBit = (t) => { const e = estimateFor(t, state); const x = rangeText(e); return x ? ` · ${e.source === "yours" ? "you paid" : "typical"} ${x}` : ""; };
  const card = (r) => h("li", { class: `tf-card v-st-${r.status}${S.selecting ? " tf-sel" : ""}` },
    S.selecting ? h("input", { type: "checkbox", class: "v-sel-box", id: `v-sel-${r.task.id}`, "data-fk": `v-sel-${r.task.id}`, checked: S.sel.has(r.task.id) ? true : null,
      "aria-label": `Select ${r.task.title}`, onchange: (e) => { if (e.target.checked) S.sel.add(r.task.id); else S.sel.delete(r.task.id); S.pending = `v-sel-${r.task.id}`; rerender(); } }) : null,
    h("span", { class: "tf-icon", "aria-hidden": "true", text: CAT_ICON[r.task.category] || "•" }),
    h("div", { class: "tf-main" },
      h("p", { class: "tf-name", text: r.task.title }),
      h("p", { class: "v-meta" }, h("span", { class: `tf-due v-st-${r.status}`, text: `${r.bucket === "overdue" ? "! " : ""}${dueWords(r)}` }), `${costBit(r.task)}`)),
    S.selecting ? null : h("div", { class: "tf-actions" },
      typeof ctx.completeTask === "function"
        ? h("button", { type: "button", class: "btn primary solid tf-done", text: "Done", "aria-label": `Done: ${r.task.title}`, "data-fk": `v-done-${r.task.id}`, onclick: () => ctx.completeTask(r.task.id) }) : null,
      h("span", { class: "tf-minor" },
        h("button", { type: "button", class: "tf-edit", text: "Edit", "aria-label": `Edit: ${r.task.title}`, onclick: () => ctx.openTaskForm(r.task) }),
        typeof ctx.commit === "function"
          ? h("button", { type: "button", class: "tf-edit", text: "Later", "aria-label": `Snooze for a week: ${r.task.title}`, onclick: () => {
            try { const until = addDays(today, 7); ctx.commit(snoozeTask(ctx.getState(), r.task.id, until, today), `Snoozed until ${fmtDate(until)}.`); }
            catch (e) { if (typeof ctx.toast === "function") ctx.toast(e.message || "Couldn't snooze that.", { error: true }); }
          } }) : null)),
    S.selecting ? null : (() => { const p = helpPanel(h, r.task, state); return p ? h("div", { class: "tf-help" }, p) : null; })());

  const feed = [];
  let lastGroup = null;
  for (const r of rows) {
    if (r.group !== lastGroup) { feed.push(h("li", { class: "tf-group", "aria-hidden": "true", text: r.group })); lastGroup = r.group; }
    feed.push(card(r));
  }
  const hidden = allRows.length - rows.length;
  const moreBtn = (collapsed || (S.showAll && allRows.length > FEED_LIMIT + FEED_SLACK))
    ? h("div", { class: "tf-more" }, h("button", { type: "button", class: "btn", "data-fk": "tf-more",
        text: collapsed ? `Show ${hidden} more` : "Show fewer",
        onclick: () => { S.showAll = !S.showAll; S.sel.clear(); S.pending = "tf-more"; rerender(); } })) : null;
  const list = rows.length
    ? h("div", {}, h("ul", { class: "tf-feed" }, feed), moreBtn)
    : h("section", { class: "v-panel" }, h("h3", { class: "v-h3", text: all.length ? "Nothing in this area" : "You're clear for the week" }),
      h("p", { class: "v-hint", text: all.length ? "Try another area, or pick All." : "Nothing is overdue or due in the next 7 days. Use + to add something." }));

  // ----- extras, kept small and below the feed -----
  const nudgeCard = nudges.length ? h("section", { class: "v-panel", "aria-labelledby": "v-season-h" },
    h("h3", { id: "v-season-h", class: "v-h3", text: "This month" }),
    h("ul", { class: "v-plain" }, nudges.map((n) => h("li", {}, h("span", { class: "v-badge v-badge-muted", text: CAT_LABEL[n.category] || n.category }), " ", n.text))),
    h("p", { class: "v-hint", text: `Based on a ${(state.profile && state.profile.climate) || "cold"}-climate home. Change it in Settings.` })) : null;
  const flagCard = flags.length ? h("section", { class: "v-panel", "aria-labelledby": "v-miles-h" },
    h("h3", { id: "v-miles-h", class: "v-h3", text: "Coming up by mileage" }),
    h("ul", { class: "v-plain" }, flags.map((f) => h("li", {},
      h("strong", { text: f.task.title }),
      ` · ${f.vehicle ? f.vehicle.name : "vehicle"} · `,
      milesText(f.milesLeft))))) : null;

  const odoCard = stale.length ? h("section", { class: "v-panel", "aria-labelledby": "v-odo-h" },
    h("h3", { id: "v-odo-h", class: "v-h3", text: "Update your mileage" }),
    h("p", { class: "v-hint", text: "Car reminders are only as good as the odometer reading. It takes a few seconds." }),
    ...stale.map(({ vehicle: v, ageDays }) => {
      const inp = h("input", { type: "number", inputmode: "numeric", min: String(v.odometer), step: "1", id: `odo-${v.id}`, placeholder: String(v.odometer), "aria-label": `Odometer for ${v.name}` });
      const err = h("p", { class: "form-error", role: "alert", hidden: true });
      const save = () => {
        const n = Number(inp.value);
        if (inp.value.trim() === "" || !Number.isInteger(n)) { err.textContent = "Type the whole number of miles."; err.hidden = false; return; }
        try { ctx.commit(setOdometer(ctx.getState(), v.id, n, today), `${v.name} updated to ${fmtNum(n)} miles`); }
        catch (e) { err.textContent = e.message || "Couldn't save that."; err.hidden = false; }
      };
      return h("div", { class: "field" },
        h("label", { for: `odo-${v.id}`, text: `${v.name}: last updated ${ageDays > 3650 ? "a long time ago" : plural(ageDays, "day") + " ago"} (${fmtNum(v.odometer)} mi)` }),
        h("div", { class: "row" }, inp, h("button", { type: "button", class: "btn", text: "Save", onclick: save })), err);
    })) : null;

  const ideaCard = state.profile && state.profile.setupDone && !state.profile.homeAge && (state.completions || []).length >= 3 && !S.ideasHidden
    ? h("section", { class: "v-panel", "aria-labelledby": "v-idea-h" },
      h("h3", { id: "v-idea-h", class: "v-h3", text: "More tasks for your home" }),
      h("p", { class: "v-hint", text: "Older homes need a few extra checks (wiring, water lines, sump pump). Tell the app how old your home is and it can suggest them." }),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn", text: "Choose home age", onclick: (e) => ctx.openSettings(e.currentTarget) }),
        h("button", { type: "button", class: "btn subtle", text: "Not now", onclick: () => { S.ideasHidden = true; rerender(); } }))) : null;

  return h("section", { class: "v-view tf", "aria-labelledby": "v-today-h" },
    h("h2", { id: "v-today-h", class: "sr-only", text: "Today" }),
    head, chips, ...(selectToggle ? [h("div", { class: "tf-selectrow" }, selectToggle)] : []), bulkBar, list, odoCard, flagCard, nudgeCard, ideaCard);
}

export default { id, label, render };
