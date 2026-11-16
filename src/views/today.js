// Today view: home score, what needs doing now, season reminders, mileage heads-ups.
import { agenda, homeScore, seasonNudges, mileageFlags, CAT_LABEL } from "../insights.js";
import { parseQuick } from "../quickadd.js";
import { addTask } from "../logic.js";
import { estimateFor, rangeText } from "../costs.js";
import { makePaint, plural, dueWords } from "./shared.js";

export const id = "today";
export const label = "Today";
const S = { pending: null, sel: new Set(), q: "", err: "", preview: null };
const paint = makePaint(S);

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
  const go = (tab) => () => { if (typeof ctx.setView === "function") ctx.setView(tab, true); };

  const bandText = { great: "In great shape", ok: "Mostly on track", "needs-work": "Needs attention" }[sc.band];
  const scoreCard = h("section", { class: `v-panel v-today-score v-score-${sc.band}`, "aria-labelledby": "v-score-h" },
    h("h3", { id: "v-score-h", class: "v-h3", text: "Home score" }),
    h("div", { class: "v-score-row" },
      h("div", { class: "v-score-num", role: "img", "aria-label": `Home score ${sc.score} out of 100, ${bandText}` },
        h("span", { "aria-hidden": "true", text: String(sc.score) }), h("small", { "aria-hidden": "true", text: "/100" })),
      h("div", {},
        h("p", { class: "v-score-band", text: bandText }),
        h("p", { class: "v-meta", text: `Maintenance ${sc.parts.maintenance} · Supplies ${sc.parts.supplies} · Emergency info ${sc.parts.info}` }))),
    sc.fixes.length
      ? h("div", { class: "v-steps-wrap" }, h("h4", { class: "v-h5", text: "Best next steps" }),
        h("ol", { class: "v-steps" }, sc.fixes.map((f, i) => h("li", {},
          h("button", { type: "button", class: "v-step", "data-fk": `v-fix-${i}`, onclick: go(f.tab) },
            h("span", { class: "v-step-n", "aria-hidden": "true", text: String(i + 1) }),
            h("span", { class: "v-step-text", text: f.text }))))))
      : h("p", { class: "v-hint", text: "Nothing urgent. Nice work." }));

  const live = new Set([...a.overdue, ...a.today, ...a.week].map((r) => r.task.id));
  for (const id of [...S.sel]) if (!live.has(id)) S.sel.delete(id); // drop ones that are no longer listed

  const submitQuick = () => {
    const p = parseQuick(S.q, today);
    if (p.error) { S.err = p.error; S.preview = null; S.pending = "v-quick-input"; rerender(); return; }
    const dupKey = String(p.task.title).toLowerCase();
    if ((state.tasks || []).some((t) => String(t.title).toLowerCase() === dupKey) && S.dupFor !== dupKey) {
      S.dupFor = dupKey; S.err = `You already have “${p.task.title}”. Press Add again to add it anyway.`; S.preview = null; S.pending = "v-quick-input"; rerender(); return;
    }
    S.dupFor = null;
    try {
      const next = addTask(state, p.task, typeof ctx.newId === "function" ? ctx.newId : () => "q-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      S.q = ""; S.err = ""; S.preview = null; S.pending = "v-quick-input";
      if (!ctx.commit(next, `Added: ${p.summary}`)) rerender();
    } catch (e) { S.err = e && e.message ? e.message : "Couldn't add that."; S.pending = "v-quick-input"; rerender(); }
  };
  const quick = h("form", { class: "v-panel v-quick", "aria-labelledby": "v-quick-h", onsubmit: (e) => { e.preventDefault(); submitQuick(); } },
    h("h3", { id: "v-quick-h", class: "v-h3", text: "Quick add" }),
    h("div", { class: "v-quick-row" },
      h("label", { class: "sr-only", for: "v-quick-input", text: "Describe a task and how often" }),
      h("input", { id: "v-quick-input", "data-fk": "v-quick-input", type: "text", value: S.q, maxlength: "160", autocomplete: "off",
        placeholder: "e.g. clean gutters every 6 months",
        oninput: (e) => { S.q = e.target.value; S.err = ""; S.dupFor = null; } }),
      h("button", { type: "submit", class: "btn primary solid", text: "Add" })),
    S.err ? h("p", { class: "form-error", role: "alert", text: S.err }) : h("p", { class: "v-hint", text: "Try \"mow the lawn weekly\", \"renew registration every January 15\" or \"rotate tires twice a year\"." }));

  const nSel = S.sel.size;
  const bulkBar = live.size > 1 && typeof ctx.markManyDone === "function" ? h("div", { class: "v-bulk", role: "group", "aria-label": "Mark several done" },
    h("button", { type: "button", class: "btn v-small", "data-fk": "v-sel-all", text: nSel === live.size ? "Clear selection" : "Select all", onclick: () => { if (nSel === live.size) S.sel.clear(); else live.forEach((i) => S.sel.add(i)); S.pending = "v-sel-all"; rerender(); } }),
    h("button", { type: "button", class: "btn primary solid v-small", "data-fk": "v-sel-done", disabled: nSel ? null : true, text: nSel ? `Mark ${nSel} done today` : "Mark selected done today",
      onclick: () => { const ids = [...S.sel]; S.sel.clear(); S.pending = "v-quick-input"; if (!ctx.markManyDone(ids)) rerender(); } }),
    h("span", { class: "v-hint", role: "status", text: nSel ? `${plural(nSel, "task")} selected` : "Tick tasks, then mark them done in one go." })) : null;

  const costBit = (t) => { const e = estimateFor(t, state); const x = rangeText(e); return x ? ` · ${e.source === "yours" ? "you paid" : "typical"} ${x}` : ""; };
  const taskRow = (r) => h("li", { class: `v-evt v-st-${r.status}${typeof ctx.markManyDone === "function" ? " v-evt-sel" : ""}` },
    typeof ctx.markManyDone === "function" ? h("input", { type: "checkbox", class: "v-sel-box", id: `v-sel-${r.task.id}`, "data-fk": `v-sel-${r.task.id}`, checked: S.sel.has(r.task.id) ? true : null,
      "aria-label": `Select ${r.task.title}`, onchange: (e) => { if (e.target.checked) S.sel.add(r.task.id); else S.sel.delete(r.task.id); S.pending = `v-sel-${r.task.id}`; rerender(); } }) : null,
    h("span", { class: `v-chip v-st-${r.status}`, "aria-hidden": "true", text: r.bucket === "overdue" ? "!" : r.status === "due-soon" ? "◐" : "○" }),
    h("div", { class: "v-evt-main" },
      h("p", { class: "v-evt-title", text: r.task.title }),
      h("p", { class: "v-meta", text: `${CAT_LABEL[r.task.category] || r.task.category} · ${dueWords(r)}${costBit(r.task)}` })),
    h("div", { class: "v-actions v-evt-actions" },
      typeof ctx.completeTask === "function"
        ? h("button", { type: "button", class: "btn v-small", text: "Done", "aria-label": `Done: ${r.task.title}`, "data-fk": `v-done-${r.task.id}`, onclick: () => ctx.completeTask(r.task.id) }) : null,
      h("button", { type: "button", class: "btn v-small", text: "Edit", "aria-label": `Edit: ${r.task.title}`, onclick: () => ctx.openTaskForm(r.task) })));

  const group = (title, rows) => rows.length
    ? h("section", { class: "v-panel", "aria-label": title }, h("h3", { class: "v-h3", text: `${title} (${rows.length})` }), h("ul", { class: "v-evts" }, rows.map(taskRow))) : null;

  const empty = !a.overdue.length && !a.today.length && !a.week.length
    ? h("section", { class: "v-panel" }, h("h3", { class: "v-h3", text: "You're clear for the week" }), h("p", { class: "v-hint", text: "Nothing is overdue or due in the next 7 days." })) : null;

  const nudgeCard = nudges.length ? h("section", { class: "v-panel", "aria-labelledby": "v-season-h" },
    h("h3", { id: "v-season-h", class: "v-h3", text: "This month" }),
    h("ul", { class: "v-plain" }, nudges.map((n) => h("li", {}, h("span", { class: `v-badge v-badge-muted`, text: CAT_LABEL[n.category] || n.category }), " ", n.text))),
    h("p", { class: "v-hint", text: `Based on a ${(state.profile && state.profile.climate) || "cold"}-climate home. Change it in Settings.` })) : null;

  const flagCard = flags.length ? h("section", { class: "v-panel", "aria-labelledby": "v-miles-h" },
    h("h3", { id: "v-miles-h", class: "v-h3", text: "Coming up by mileage" }),
    h("ul", { class: "v-plain" }, flags.map((f) => h("li", {},
      h("strong", { text: f.task.title }),
      ` · ${f.vehicle ? f.vehicle.name : "vehicle"} · `,
      f.milesLeft <= 0 ? `${Math.abs(f.milesLeft).toLocaleString()} mi past due` : `about ${f.milesLeft.toLocaleString()} mi to go`)))) : null;

  return h("section", { class: "v-view", "aria-labelledby": "v-today-h" },
    h("h2", { id: "v-today-h", class: "v-h2", text: "Today" }),
    scoreCard, quick, bulkBar, empty, group("Overdue", a.overdue), group("Due today", a.today), group("Due this week", a.week), flagCard, nudgeCard,
    h("p", { class: "v-hint", text: `${plural(state.tasks.length, "task")} tracked.` }));
}

export default { id, label, render };
