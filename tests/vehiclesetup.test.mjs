import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { freshState } from "../src/storage.js";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => { const saved = []; return { mode: "local", saved, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }; };
const btn = (doc, re) => doc.getElementById("wizard").querySelectorAll("button").find((b) => re.test(b.textContent));
async function run(odo, oil) {
  const doc = makeDocument(); const st = store();
  await mount(doc, { store: st, state: freshState() });
  btn(doc, /^Next$/).click(); await sleep(5); // home -> what's in it
  btn(doc, /^Next$/).click(); await sleep(5); // -> vehicles
  const wz = doc.getElementById("wizard");
  wz.querySelector("#w-vname").value = "Civic"; wz.querySelector("#w-vodo").value = odo;
  if (oil !== undefined) wz.querySelector("#w-voil").value = oil;
  btn(doc, /^Next$/).click(); await sleep(5);
  return { doc, st, wz: doc.getElementById("wizard") };
}

test("a new car with a known last oil change counts the oil reminder from that mileage", async () => {
  const { doc, st } = await run("90000", "88500");
  btn(doc, /Finish setup/).click(); await sleep(20);
  const s = st.saved.at(-1);
  const oil = s.tasks.find((t) => t.kind === "mileage" && /oil/i.test(t.title));
  assert.ok(oil, "an oil task was seeded");
  assert.equal(oil.lastDoneOdometer, 88500);
  const others = s.tasks.filter((t) => t.kind === "mileage" && !/oil/i.test(t.title));
  assert.ok(others.every((t) => t.lastDoneOdometer === 90000), "other mileage tasks start from today's odometer");
});

test("leaving the oil question blank starts every mileage reminder from the current odometer", async () => {
  const { doc, st } = await run("45000");
  btn(doc, /Finish setup/).click(); await sleep(20);
  const m = st.saved.at(-1).tasks.filter((t) => t.kind === "mileage");
  assert.ok(m.length > 0);
  assert.ok(m.every((t) => t.lastDoneOdometer === 45000));
});

test("an oil change at a higher mileage than the odometer is refused with a clear message", async () => {
  const { wz } = await run("45000", "50000");
  assert.match(wz.textContent, /can't be at a higher mileage/);
});
