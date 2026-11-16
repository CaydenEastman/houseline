// Monthly recap + streaks. Pure; `today` is a parameter.
import { addDays, statusOf } from "./logic.js";
import { CAT_LABEL } from "./insights.js";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The calendar month before `today` ("YYYY-MM" plus label). */
export function previousMonth(today) {
  let y = +today.slice(0, 4), m = +today.slice(5, 7) - 1;
  if (m === 0) { y -= 1; m = 12; }
  return { key: `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}`, label: `${MONTH_NAMES[m - 1]} ${y}` };
}
export function currentMonth(today) {
  return { key: today.slice(0, 7), label: `${MONTH_NAMES[+today.slice(5, 7) - 1]} ${today.slice(0, 4)}` };
}

/** Weeks in a row (ending this week, Sunday start) that include at least one completed task. */
export function weekStreak(state, today) {
  const done = new Set((state.completions || []).filter((c) => c.kind === "done").map((c) => c.date));
  const dow = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10))).getUTCDay();
  let start = addDays(today, -dow); // this week's Sunday
  const weekHas = (s) => { for (let i = 0; i < 7; i++) if (done.has(addDays(s, i))) return true; return false; };
  let n = 0;
  if (!weekHas(start)) start = addDays(start, -7); // this week may not have started yet: don't break the streak
  while (n < 520 && weekHas(start)) { n++; start = addDays(start, -7); }
  return n;
}

export function monthlyRecap(state, month, today) {
  const inMonth = (state.completions || []).filter((c) => String(c.date).startsWith(month.key));
  const done = inMonth.filter((c) => c.kind === "done");
  const skipped = inMonth.filter((c) => c.kind === "skipped");
  const spent = Math.round(done.reduce((a, c) => a + (typeof c.cost === "number" ? c.cost : 0), 0) * 100) / 100;
  const byCat = {};
  for (const c of done) byCat[c.category] = (byCat[c.category] || 0) + 1;
  const top = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || null;
  const overdueNow = (state.tasks || []).filter((t) => statusOf(t, today, state) === "overdue").length;
  const biggest = done.filter((c) => typeof c.cost === "number").sort((a, b) => b.cost - a.cost)[0] || null;
  return { label: month.label, done: done.length, skipped: skipped.length, spent, topArea: top ? { area: top[0], count: top[1] } : null, overdueNow, biggest, streak: weekStreak(state, today) };
}

export function recapText(r) {
  const money = (n) => `$${n.toFixed(2)}`;
  const L = [`Home recap for ${r.label}`];
  L.push(`${r.done} ${r.done === 1 ? "task" : "tasks"} done${r.skipped ? `, ${r.skipped} skipped` : ""}.`);
  if (r.spent > 0) L.push(`Spent ${money(r.spent)}${r.biggest ? `; biggest job: ${r.biggest.title} (${money(r.biggest.cost)})` : ""}.`);
  if (r.topArea) L.push(`Most active area: ${CAT_LABEL[r.topArea.area] || r.topArea.area} (${r.topArea.count}).`);
  L.push(r.overdueNow ? `${r.overdueNow} ${r.overdueNow === 1 ? "task is" : "tasks are"} overdue right now.` : "Nothing is overdue right now.");
  if (r.streak >= 2) L.push(`${r.streak}-week streak of getting something done.`);
  return L.join("\n");
}
