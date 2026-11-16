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

test("More menu: list starts hidden, opens, and a pick closes it and shows More: <name>", async () => {
  const doc = makeDocument(); doc.defaultView = { localStorage: fakeLS({ "motH.tour": "1" }) };
  await mount(doc, { store: store(), state: state() });
  const nav = doc.getElementById("nav");
  const list = nav.querySelector("#nav-more-list");
  assert.ok(list.hasAttribute("hidden"));
  nav.querySelector("#nav-more").click();
  assert.ok(!nav.querySelector("#nav-more-list").hasAttribute("hidden"));
  assert.equal(nav.querySelector("#nav-more").getAttribute("aria-expanded"), "true");
  nav.querySelector("#nav-inventory").click(); await sleep(5);
  assert.ok(nav.querySelector("#nav-more-list").hasAttribute("hidden"));
  assert.ok(nav.querySelector("#nav-more").textContent.includes("More: Inventory"));
  assert.equal(nav.querySelectorAll("[aria-current]").length, 1);
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
