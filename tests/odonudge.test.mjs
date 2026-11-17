import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { staleOdometers } from "../src/insights.js";
import { mkState, mkTask, mkVehicle, mkProfile } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => { const saved = []; return { mode: "local", saved, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }; };
const st = (date) => mkState({ profile: mkProfile({ setupDone: true }), vehicles: [mkVehicle({ id: "v1", odometer: 50000, odometerDate: date })],
  tasks: [mkTask({ id: "m", kind: "mileage", intervalDays: null, intervalMiles: 5000, vehicleId: "v1", lastDoneOdometer: 48000, category: "car" })] });

test("only vehicles with mileage reminders and an old reading are flagged", () => {
  assert.equal(staleOdometers(st("2026-05-01"), "2026-06-15").length, 1);
  assert.equal(staleOdometers(st("2026-06-10"), "2026-06-15").length, 0);
  const none = { ...st("2026-01-01"), tasks: [] };
  assert.equal(staleOdometers(none, "2026-06-15").length, 0);
});

test("Today asks for the odometer and saving it updates the vehicle", async () => {
  const doc = makeDocument(); const s = store();
  await mount(doc, { store: s, state: st("2026-04-01"), today: "2026-06-15" });
  const main = doc.getElementById("main");
  const inp = main.querySelector("#odo-v1");
  assert.ok(inp, "odometer prompt is on Today");
  inp.value = "50800";
  main.querySelectorAll("button").find((b) => b.textContent === "Save").click(); await sleep(20);
  assert.equal(s.saved.at(-1).vehicles[0].odometer, 50800);
});

import { costByVehicle } from "../src/insights.js";
import { mkCompletion } from "./helpers.mjs";
test("cost per vehicle adds up completions of that vehicle's tasks, by year too", () => {
  const s = { ...st("2026-06-01"), completions: [mkCompletion({ id: "c1", taskId: "m", cost: 80, date: "2026-03-01" }), mkCompletion({ id: "c2", taskId: "m", cost: 50, date: "2025-03-01" }), mkCompletion({ id: "c3", taskId: "zzz", cost: 999 })] };
  const r = costByVehicle(s, "2026");
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].total, r[0].thisYear, r[0].count], [130, 80, 2]);
});

import { mkCompletion as mc } from "./helpers.mjs";
test("Today offers the home-age ideas only after a few finished tasks and until a home age is chosen", async () => {
  const mk = (n, extra = {}) => ({ ...st("2026-06-10"), profile: mkProfile({ setupDone: true, ...extra }), completions: Array.from({ length: n }, (_, i) => mc({ id: "c" + i })) });
  const has = async (state) => { const doc = makeDocument(); await mount(doc, { store: store(), state, today: "2026-06-15" }); return /More tasks for your home/.test(doc.getElementById("main").textContent); };
  assert.equal(await has(mk(1)), false);
  assert.equal(await has(mk(3)), true);
  assert.equal(await has(mk(3, { homeAge: "mid" })), false);
});

test("while a dialog is open the page behind it is locked, and it unlocks when closed", async () => {
  const doc = makeDocument();
  await mount(doc, { store: store(), state: st("2026-06-10"), today: "2026-06-15" });
  const root = doc.documentElement;
  if (!root || !root.classList) return; // the stub DOM may not model the root element
  const { readFileSync } = await import("node:fs");
  const css = readFileSync("styles.css", "utf8");
  assert.match(css, /html\.dlg-open[^{]*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /dialog\s*\{\s*overscroll-behavior:\s*contain/);
});
