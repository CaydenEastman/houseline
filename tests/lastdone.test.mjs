import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { freshState } from "../src/storage.js";
import { statusOf } from "../src/logic.js";
import { LAST_TITLES } from "../src/wizard.js";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => { const saved = []; return { mode: "local", saved, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }; };
const btn = (doc, re) => doc.getElementById("wizard").querySelectorAll("button").find((b) => re.test(b.textContent));

async function toReview() {
  const doc = makeDocument(); const st = store();
  await mount(doc, { store: st, state: freshState() });
  for (let i = 0; i < 3; i++) { btn(doc, /^Next$/).click(); await sleep(5); }
  return { doc, st, wz: doc.getElementById("wizard") };
}
const pick = (wz, title, value) => {
  const sel = wz.querySelectorAll("select").find((s) => { const l = wz.querySelector(`label[for="${s.id}"]`); return l && l.textContent === title; });
  assert.ok(sel, `no select for ${title}`);
  sel.value = value; sel.dispatchEvent({ type: "change", bubbles: false, target: sel });
};

test("review lists the key recurring tasks with a not-sure default", async () => {
  const { doc, wz } = await toReview();
  const labels = wz.querySelectorAll("label").map((l) => l.textContent).filter((t) => LAST_TITLES.includes(t));
  assert.ok(labels.length >= 6, labels.join(","));
  btn(doc, /Finish setup/).click(); await sleep(20); // wizard state is module-level; close it for the next test
});

test("a remembered date counts from then; untouched tasks keep their normal start", async () => {
  const { doc, st, wz } = await toReview();
  pick(wz, "Replace HVAC filter", "recent");
  pick(wz, "Flush water heater", "year");
  btn(doc, /Finish setup/).click(); await sleep(20);
  const s = st.saved.at(-1);
  const today = new Date().toISOString().slice(0, 10);
  const hvac = s.tasks.find((t) => t.title === "Replace HVAC filter");
  const heater = s.tasks.find((t) => t.title === "Flush water heater");
  const dryer = s.tasks.find((t) => t.title === "Clean dryer vent");
  assert.ok(hvac.lastDone && hvac.lastDone < today);
  assert.equal(statusOf(hvac, today, s), "ok");
  assert.equal(statusOf(heater, today, s), "overdue");
  assert.equal(dryer.lastDone, null);
  assert.ok(dryer.startDate);
});
