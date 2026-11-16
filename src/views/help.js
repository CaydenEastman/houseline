// A small collapsible "How to & manuals" section for a task: what you'll need, steps, the vehicle's specs, and links.
import { helpFor } from "../help.js";
import { safeUrl } from "../dom.js";

const ICON = { video: "▶️", guide: "\u{1F4C4}", manual: "\u{1F4D6}", source: "\u{1F517}" };

export function helpPanel(h, task, state) {
  let help = null;
  try { help = helpFor(task, state); } catch { help = null; }
  if (!help) return null;
  const kids = [];
  if (help.specs.length) {
    kids.push(h("div", { class: "help-specs" }, h("strong", { text: "Your vehicle's details" }),
      h("dl", {}, help.specs.map((s) => h("div", {}, h("dt", { text: s.label }), h("dd", { text: s.value }))))));
  } else if (help.hasVehicle && help.missingSpecs) {
    kids.push(h("p", { class: "help-nudge", text: "Tip: write your oil type, filter numbers and tire size once under Home, Vehicles, Edit details. They'll show up here." }));
  }
  if (help.need.length) kids.push(h("div", {}, h("strong", { text: "What you'll need" }), h("ul", {}, help.need.map((x) => h("li", { text: x })))));
  if (help.steps.length) kids.push(h("div", {}, h("strong", { text: "Steps" }), h("ol", {}, help.steps.map((x) => h("li", { text: x })))));
  if (help.tip) kids.push(h("p", { class: "help-tip", text: help.tip }));
  if (help.need.length || help.steps.length) kids.push(h("p", { class: "help-fine", text: "General guidance. If your manual says something different, follow your manual." }));
  const links = help.links.map((l) => {
    const u = safeUrl(l.url);
    return u ? h("li", {}, h("a", { href: u, target: "_blank", rel: "noopener noreferrer", text: `${ICON[l.kind] || ""} ${l.label}`.trim() })) : null;
  }).filter(Boolean);
  if (links.length) kids.push(h("ul", { class: "help-links" }, links));
  if (!kids.length) return null;
  return h("details", { class: "task-help" }, h("summary", { text: "How to and manuals" }), h("div", { class: "help-body" }, kids));
}
