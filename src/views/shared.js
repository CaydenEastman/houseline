// Small helpers shared by the newer views.
import { plural, money, milesText } from "../dom.js";
export function makePaint(S) {
  return function paint(container, build, doc) {
    let fk = null;
    try { const ae = doc.activeElement; fk = ae && container.contains(ae) && ae.getAttribute ? ae.getAttribute("data-fk") : null; } catch { /* best-effort */ }
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
  };
}
export { plural, money };
export function dueWords(r) {
  if (r.task.kind === "mileage" && r.info.milesLeft != null && r.info.basis === "miles") {
    return milesText(r.info.milesLeft);
  }
  const d = r.days;
  if (d < 0) return plural(-d, "day") + " overdue";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}
