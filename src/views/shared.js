// Small helpers shared by the newer views.
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
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const money = (n) => `$${(Math.round(n * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function dueWords(r) {
  if (r.task.kind === "mileage" && r.info.milesLeft != null && r.info.basis === "miles") {
    const m = r.info.milesLeft;
    return m <= 0 ? `${Math.abs(m).toLocaleString()} mi past due` : `~${m.toLocaleString()} mi left`;
  }
  const d = r.days;
  if (d < 0) return plural(-d, "day") + " overdue";
  if (d === 0) return "Due today";
  if (d === 1) return "Due tomorrow";
  return `Due in ${d} days`;
}
