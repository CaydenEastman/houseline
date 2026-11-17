// The "type it in plain words" task form. Used inside the + sheet. Pure DOM: pass ctx ({ h, getState, today, commit, newId }).
import { parseQuick } from "./quickadd.js";
import { addTask } from "./logic.js";

export function quickForm(ctx, { onAdded } = {}) {
  const { h } = ctx;
  let dupFor = null;
  const hint = () => h("p", { class: "v-hint", text: "Try “mow the lawn weekly”, “renew registration every January 15” or “rotate tires twice a year”. For a one-time task, use “Task with details”." });
  const note = h("div", { class: "v-quick-note" }, hint());
  const say = (text, isError) => note.replaceChildren(isError ? h("p", { class: "form-error", role: "alert", text }) : hint());

  const input = h("input", {
    id: "v-quick-input", "data-fk": "v-quick-input", type: "text", maxlength: "160", autocomplete: "off",
    placeholder: "e.g. clean gutters every 6 months",
    oninput: () => { dupFor = null; say("", false); },
  });

  const submit = () => {
    const state = ctx.getState();
    const p = parseQuick(input.value, ctx.today());
    if (p.error) { say(p.error, true); input.focus(); return; }
    const key = String(p.task.title).toLowerCase();
    if ((state.tasks || []).some((t) => String(t.title).toLowerCase() === key) && dupFor !== key) {
      dupFor = key; say(`You already have “${p.task.title}”. Press Add again to add it anyway.`, true); input.focus(); return;
    }
    dupFor = null;
    try {
      const idFn = typeof ctx.newId === "function" ? ctx.newId : () => "q-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const next = addTask(state, p.task, idFn);
      if (ctx.commit(next, `Added: ${p.summary}`) === false) return;
      input.value = ""; say("", false);
      if (onAdded) onAdded(p);
    } catch (e) { say(e && e.message ? e.message : "Couldn't add that.", true); }
  };

  return h("form", { class: "v-quick", "aria-label": "Add a task in plain words", novalidate: true, onsubmit: (e) => { e.preventDefault(); submit(); } },
    h("div", { class: "v-quick-row" },
      h("label", { class: "sr-only", for: "v-quick-input", text: "Describe a task and how often" }),
      input,
      h("button", { type: "submit", class: "btn primary solid", text: "Add" })),
    note);
}
