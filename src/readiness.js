// Emergency readiness scoring + printable emergency sheet. Pure; `today` is a parameter.
const DAY_MS = 86400000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const EXPIRING_DAYS = 60;

function isoMs(iso) {
  const m = typeof iso === "string" ? ISO_RE.exec(iso) : null;
  if (!m) throw new Error(`Invalid date "${iso}": expected YYYY-MM-DD`);
  return Date.UTC(+m[1], +m[2] - 1, +m[3]);
}
const daysBetween = (a, b) => Math.round((isoMs(b) - isoMs(a)) / DAY_MS);

export const REQUIREMENTS = [
  { key: "water", label: "Drinking water (1 gal/person/day, 3 days)", category: "water", unit: "gallons", perPersonPerDay: 1, days: 3 },
  { key: "food", label: "Non-perishable food (3 meals/person/day, 3 days)", category: "food", unit: "meals", perPersonPerDay: 3, days: 3 },
  { key: "flashlights", label: "Flashlights or headlamps", category: "power", unit: "flashlights", fixed: 2 },
  { key: "batteries", label: "Spare batteries", category: "power", unit: "packs", fixed: 4 },
  { key: "firstaid", label: "First-aid kit", category: "medical", unit: "kits", fixed: 1 },
  { key: "radio", label: "Battery or hand-crank radio", category: "power", unit: "radios", fixed: 1 },
  { key: "powerbank", label: "Phone chargers / power bank", category: "power", unit: "power banks", fixed: 1 },
  { key: "medications", label: "Prescription medications (7-day supply)", category: "medical", unit: "days' supply", days: 7, fixed: 7 },
  { key: "cash", label: "Emergency cash (small bills)", category: "docs", unit: "USD", fixed: 100 },
  { key: "documents", label: "Copies of important documents", category: "docs", unit: "sets", fixed: 1 },
  { key: "whistle", label: "Whistle", category: "tools", unit: "whistles", fixed: 1 },
  { key: "masks", label: "N95 masks (1 per person)", category: "medical", unit: "masks", perPersonPerDay: 1, days: 1 },
  { key: "blankets", label: "Blankets or sleeping bags (1 per person)", category: "other", unit: "blankets", perPersonPerDay: 1, days: 1 },
  { key: "pets", label: "Pet food and supplies (7 days)", category: "other", unit: "days' supply", days: 7, fixed: 7, requiresPets: true },
];

function householdSize(state) {
  const n = state && state.profile ? state.profile.householdSize : null;
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function needed(req, size) {
  if (req.perPersonPerDay != null) return Math.ceil(req.perPersonPerDay * (req.days ?? 1) * size);
  return req.fixed ?? 1;
}

export function readiness(state, today) {
  isoMs(today);
  const size = householdSize(state);
  const supplies = Array.isArray(state && state.supplies) ? state.supplies : [];
  const expired = [];
  const expiring = [];
  const live = [];
  for (const s of supplies) {
    if (s.expires) {
      const daysLeft = daysBetween(today, s.expires);
      if (daysLeft < 0) { expired.push(s); continue; }
      if (daysLeft <= EXPIRING_DAYS) expiring.push({ supply: s, daysLeft });
    }
    live.push(s);
  }
  expiring.sort((a, b) => a.daysLeft - b.daysLeft);
  const soonIds = new Set(expiring.map((e) => e.supply));
  const reqs = REQUIREMENTS.filter((r) => !r.requiresPets || (state && state.profile && state.profile.hasPets));
  const items = reqs.map((r) => {
    const n = needed(r, size);
    const matching = live.filter((s) => s.key === r.key);
    const have = matching.reduce((a, s) => a + (Number.isFinite(s.quantity) ? s.quantity : 0), 0);
    return {
      key: r.key, label: r.label, unit: r.unit, needed: n, have,
      status: have >= n ? "ok" : have > 0 ? "low" : "missing",
      expiringSoon: matching.some((s) => soonIds.has(s)),
    };
  });
  const score = items.length ? Math.round((items.reduce((a, i) => a + Math.min(1, i.have / i.needed), 0) / items.length) * 100) : 0;
  return { score, items, expiring, expired };
}

const esc = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function model(state, today) {
  const e = (state && state.emergency) || {};
  const sh = e.shutoffs || {};
  const r = readiness(state, today);
  return {
    size: householdSize(state),
    contacts: Array.isArray(e.contacts) ? e.contacts : [],
    meeting: e.meetingPlace || "",
    outOfArea: e.outOfAreaContact || "",
    shutoffs: [["Water", sh.water], ["Gas", sh.gas], ["Electric", sh.electric]],
    notes: e.notes || "",
    r,
    missing: r.items.filter((i) => i.status !== "ok"),
  };
}

const PERSON_LINES = (p0, priv) => { const p = p0.private && priv && priv[p0.id] ? { ...p0, ...priv[p0.id] } : p0; return PERSON_LINES0(p).concat(p0.private && !(priv && priv[p0.id]) ? [["Allergies and health", "kept private by the person who added them"]] : []); };
const PERSON_LINES0 = (p) => [
  ["Allergies", p.allergies], ["Blood type", p.bloodType], [p.kind === "pet" ? "Health" : "Health", p.medical],
  [p.kind === "pet" ? "Vet" : "Doctor", p.doctor], ["Needs", p.needs], ["Good to know", p.things], ["Phone", p.phone],
].filter(([, v]) => v && String(v).trim());

export function emergencySheetText(state, today, priv) {
  const m = model(state, today);
  const dash = (v) => (v && String(v).trim() ? String(v) : "(not set)");
  const L = [];
  L.push("EMERGENCY INFORMATION SHEET", `Date: ${today}`, `Household size: ${m.size}`, "");
  const ppl = state.people || [];
  if (ppl.length) {
    L.push("PEOPLE AND PETS");
    for (const p of ppl) { L.push(`  ${p.name} (${p.kind})`); for (const [k, v] of PERSON_LINES(p, priv)) L.push(`    ${k}: ${v}`); }
    L.push("");
  }
  L.push("CONTACTS");
  if (!m.contacts.length) L.push("  (none)");
  for (const c of m.contacts) L.push(`  - ${c.name || "(no name)"}${c.relation ? ` (${c.relation})` : ""}: ${c.phone || "(no phone)"}`);
  L.push("", `MEETING PLACE: ${dash(m.meeting)}`, `OUT-OF-AREA CONTACT: ${dash(m.outOfArea)}`, "", "UTILITY SHUTOFFS");
  for (const [k, v] of m.shutoffs) L.push(`  ${k}: ${dash(v)}`);
  L.push("", `READINESS: ${m.r.score}/100`);
  if (!m.missing.length) L.push("  All recommended supplies are stocked.");
  for (const i of m.missing) L.push(`  - ${i.label}: have ${i.have} of ${i.needed} ${i.unit} (${i.status})`);
  if (m.r.expiring.length) L.push("", "EXPIRING WITHIN 60 DAYS");
  for (const x of m.r.expiring) L.push(`  - ${x.supply.name}: ${x.supply.expires} (${x.daysLeft} days)`);
  if (m.r.expired.length) L.push("", "EXPIRED");
  for (const s of m.r.expired) L.push(`  - ${s.name}: ${s.expires}`);
  L.push("", "NOTES", `  ${m.notes ? m.notes.replace(/\n/g, "\n  ") : "(none)"}`, "");
  if (ppl.length) L.push("This sheet has personal and health details. Keep it somewhere private.");
  L.push("To print: open this page and press Ctrl+P (Windows/Linux) or Cmd+P (Mac).");
  return L.join("\n");
}

export function emergencySheetHTML(state, today, priv) {
  const m = model(state, today);
  const dash = (v) => (v && String(v).trim() ? esc(v) : '<span class="muted">(not set)</span>');
  const contacts = m.contacts.length
    ? `<table><thead><tr><th>Name</th><th>Relation</th><th>Phone</th></tr></thead><tbody>${m.contacts
        .map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.relation)}</td><td>${esc(c.phone)}</td></tr>`)
        .join("")}</tbody></table>`
    : '<p class="muted">(none)</p>';
  const missing = m.missing.length
    ? `<ul>${m.missing.map((i) => `<li>${esc(i.label)}: have ${esc(i.have)} of ${esc(i.needed)} ${esc(i.unit)} (${esc(i.status)})</li>`).join("")}</ul>`
    : "<p>All recommended supplies are stocked.</p>";
  const expiring = m.r.expiring.length
    ? `<h2>Expiring within 60 days</h2><ul>${m.r.expiring.map((x) => `<li>${esc(x.supply.name)}: ${esc(x.supply.expires)} (${esc(x.daysLeft)} days)</li>`).join("")}</ul>`
    : "";
  const expired = m.r.expired.length
    ? `<h2>Expired</h2><ul>${m.r.expired.map((s) => `<li>${esc(s.name)}: ${esc(s.expires)}</li>`).join("")}</ul>`
    : "";
  const ppl = state.people || [];
  const peopleHtml = ppl.length
    ? `<h2>People and pets</h2>${ppl.map((p) => `<div class="person"><strong>${esc(p.name)}</strong> (${esc(p.kind)})<ul>${PERSON_LINES(p, priv).map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${esc(v)}</li>`).join("")}</ul></div>`).join("")}`
    : "";
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Emergency Information Sheet</title>
<style>
body{font:16px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;max-width:7.5in;margin:0 auto;padding:24px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.1rem;margin:22px 0 6px;border-bottom:2px solid #111;padding-bottom:2px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #555;padding:6px 8px;text-align:left}th{background:#eee}
.muted{color:#555}.notes{white-space:pre-wrap}.tip{margin-top:24px;font-size:.9rem;color:#333}
@media print{.noprint{display:none}body{padding:0;max-width:none}.person{break-inside:avoid}.tip{font-size:.8rem}h2{break-after:avoid}table,li{break-inside:avoid}}
</style></head><body>
<h1>Emergency Information Sheet</h1>
<p>Date: ${esc(today)} &middot; Household size: ${esc(m.size)}</p>
${peopleHtml}<h2>Contacts</h2>${contacts}
<h2>Meeting place</h2><p>${dash(m.meeting)}</p>
<h2>Out-of-area contact</h2><p>${dash(m.outOfArea)}</p>
<h2>Utility shutoffs</h2><ul>${m.shutoffs.map(([k, v]) => `<li><strong>${esc(k)}:</strong> ${dash(v)}</li>`).join("")}</ul>
<h2>Readiness: ${esc(m.r.score)}/100</h2>${missing}${expiring}${expired}
<h2>Notes</h2><p class="notes">${m.notes ? esc(m.notes) : '<span class="muted">(none)</span>'}</p>
<p class="tip">${ppl.length ? 'This sheet has personal and health details. Keep it somewhere private. ' : ''}Print this page: press Ctrl+P (Windows/Linux) or Cmd+P (Mac).</p>
</body></html>
`;
}
