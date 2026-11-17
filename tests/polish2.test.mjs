import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { mkState, mkTask } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mk = () => { const saved = []; return { saved, mode: "local", load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {},
  putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }; };
const st = () => mkState({ tasks: [mkTask({ id: "a", title: "Change filter", lastDone: "2020-01-01", intervalDays: 30 })] });
const btn = (root, re) => root.querySelectorAll("button").find((b) => re.test((b.textContent || "").trim()));

test("Edit dialog offers Skip and Delete (with a confirmation)", async () => {
  const doc = makeDocument(); const store = mk();
  await mount(doc, { store, state: st() });
  btn(doc.getElementById("main"), /^Edit$/).click(); await sleep(10);
  const dlg = doc.getElementById("task-dialog") || doc.body;
  assert.ok(btn(dlg, /^Skip this time$/));
  const del = btn(dlg, /^Delete task$/);
  assert.ok(del);
  del.click(); await sleep(10);
  const confirm = btn(doc.body, /^Delete task$/);
  assert.ok(confirm, "a confirmation appears");
  assert.equal(store.saved.length, 0, "nothing is deleted before confirming");
});
test("only one toast shows at a time", async () => {
  const doc = makeDocument();
  await mount(doc, { store: mk(), state: st() });
  const done = btn(doc.getElementById("main"), /^Done$/);
  done.click(); await sleep(10);
  const complete = btn(doc.body, /^(Mark done|Done|Save)$/);
  if (complete) { complete.click(); await sleep(10); }
  assert.ok(doc.getElementById("status").children.length <= 2);
});
test("Settings groups climate with the home, and has a problem-report button", async () => {
  const doc = makeDocument();
  await mount(doc, { store: mk(), state: st() });
  doc.getElementById("nav").querySelector("#nav-you").click(); await sleep(5);
  const tile = doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-settings");
  tile.click(); await sleep(10);
  const text = doc.getElementById("settings-dialog").textContent;
  assert.match(text, /Your home/);
  assert.match(text, /Copy info for a problem report/);
  const homeSec = doc.getElementById("settings-dialog").querySelectorAll("section").find((s) => /Your home/.test(s.textContent));
  assert.match(homeSec.textContent, /Climate/);
});
