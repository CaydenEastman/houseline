import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => ({ mode: "local", load: async () => null, save: async () => true, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false });
const fakeLS = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m }; };
const state = () => mkState({ tasks: [mkTask({ id: "a", title: "A", lastDone: "2026-01-01", intervalDays: 30 })] });

test("Bottom bar: five buttons; + opens the add sheet; Home tiles open screens with a back bar", async () => {
  const doc = makeDocument(); doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }) };
  await mount(doc, { store: store(), state: state() });
  const nav = doc.getElementById("nav");
  assert.equal(nav.querySelectorAll("button").length, 5);
  assert.equal(nav.querySelector("#nav-today").getAttribute("aria-current"), "page");
  assert.ok(doc.getElementById("backbar").hidden);
  nav.querySelector("#nav-add").click(); await sleep(5);
  const dlg = doc.getElementById("confirm-dialog");
  assert.ok(dlg.querySelector("#v-quick-input"));
  assert.ok(dlg.textContent.includes("Task with details") && dlg.textContent.includes("Log mileage"));
  dlg.querySelector("#add-close").click(); await sleep(5);
  nav.querySelector("#nav-home").click(); await sleep(5);
  doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-inventory").click(); await sleep(5);
  assert.equal(nav.querySelector("#nav-home").getAttribute("aria-current"), "page");
  assert.equal(nav.querySelectorAll("[aria-current]").length, 1);
  assert.equal(doc.getElementById("backbar").hidden, false);
  doc.getElementById("back-btn").click(); await sleep(5);
  assert.ok(doc.getElementById("backbar").hidden);
});

test("Add sheet: typing a task in plain words adds it and closes the sheet", async () => {
  const doc = makeDocument(); doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }) };
  const saved = [];
  const st = store(); st.save = async (s) => { saved.push(s); return true; };
  await mount(doc, { store: st, state: state() });
  doc.getElementById("nav").querySelector("#nav-add").click(); await sleep(5);
  const dlg = doc.getElementById("confirm-dialog");
  const input = dlg.querySelector("#v-quick-input"); input.value = "clean gutters every 6 months";
  input.dispatchEvent({ type: "input", bubbles: true, target: input, preventDefault() {} });
  const form = dlg.querySelector("form");
  form.dispatchEvent({ type: "submit", bubbles: false, target: form, preventDefault() {}, stopPropagation() {} });
  await sleep(700);
  assert.ok(saved.some((s) => s.tasks.some((t) => t.title === "Clean gutters")));
});

test("Tour: shows once, walks 3 steps, remembers it was seen", async () => {
  const doc = makeDocument(); const ls = fakeLS(); doc.defaultView = { localStorage: ls };
  await mount(doc, { store: store(), state: state() });
  const dlg = doc.getElementById("confirm-dialog");
  assert.ok(dlg.textContent.includes("Quick tour · 1 of 3"));
  dlg.querySelector("#tour-next").click();
  assert.ok(dlg.textContent.includes("2 of 3"));
  dlg.querySelector("#tour-back").click();
  assert.ok(dlg.textContent.includes("1 of 3"));
  dlg.querySelector("#tour-next").click(); dlg.querySelector("#tour-next").click();
  assert.ok(dlg.textContent.includes("3 of 3"));
  dlg.querySelector("#tour-next").click();
  assert.equal(ls._m["motH.tour"], "1");
  const doc2 = makeDocument(); doc2.defaultView = { localStorage: ls };
  await mount(doc2, { store: store(), state: state() });
  assert.ok(!doc2.getElementById("confirm-dialog").textContent.includes("Quick tour"));
});

test("Tour: skipping also remembers; no storage means no auto tour", async () => {
  const doc = makeDocument(); const ls = fakeLS(); doc.defaultView = { localStorage: ls };
  await mount(doc, { store: store(), state: state() });
  doc.getElementById("confirm-dialog").querySelector("#tour-skip").click();
  assert.equal(ls._m["motH.tour"], "1");
  const bare = makeDocument();
  await mount(bare, { store: store(), state: state() });
  assert.ok(!bare.getElementById("confirm-dialog").textContent.includes("Quick tour"));
});

test("Home tiles show a badge when something needs attention; the banner no longer repeats task counts", async () => {
  const doc = makeDocument(); doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }) };
  await mount(doc, { store: store(), state: state() }); // one overdue task
  assert.equal(doc.getElementById("today-strip").textContent, ""); // the top banner is gone, so no "null" or counts
  assert.ok(doc.getElementById("sync-pill")); // the Saved indicator lives in the header
  doc.getElementById("nav").querySelector("#nav-home").click(); await sleep(5);
  const tile = doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-tasks");
  assert.ok(tile.querySelector(".hub-badge-overdue"));
  assert.ok(/overdue/.test(tile.getAttribute("aria-label")));
});
