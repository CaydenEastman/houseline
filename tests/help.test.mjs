import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { h as rawH } from "../src/dom.js";
import today from "../src/views/today.js";
import vehiclesView from "../src/views/vehicles.js";
import inventoryView from "../src/views/inventory.js";
import { helpFor, vehicleLabel } from "../src/help.js";
import { HOWTO, SOURCES, howtoFor } from "../src/howto.js";
import { TEMPLATES } from "../src/templates.js";
import { addVehicle, updateVehicle, addItem, updateItem, VEHICLE_SPECS } from "../src/logic.js";
import { validateState } from "../src/storage.js";
import { mergeStates } from "../src/sync.js";
import { mkState, mkTask, mkVehicle, mkItem } from "./helpers.mjs";

const idFn = () => "id1";
const veh = (o = {}) => mkVehicle({ id: "v1", name: "Equinox", odometer: 80000, ...o });
const oilTask = (o = {}) => mkTask({ id: "t1", title: "Oil change — Equinox", category: "car", kind: "mileage", vehicleId: "v1", intervalMiles: 5000, lastDoneOdometer: 70000, ...o });

test("every how-to entry is complete, matches a real standard task, and only cites checked sources", () => {
  const titles = new Set(TEMPLATES.map((t) => t.title.toLowerCase().replace(/\s*\([^)]*\)\s*$/, "")));
  for (const [key, e] of Object.entries(HOWTO)) {
    assert.ok(titles.has(key), `"${key}" matches no standard task title`);
    assert.ok(e.q && e.steps.length >= 2 && e.need.length >= 1, `${key} needs q, steps and a needs list`);
    for (const k of e.links || []) assert.ok(SOURCES[k], `${key} cites unknown source ${k}`);
    for (const s of e.specs || []) assert.ok(VEHICLE_SPECS.some((x) => x.key === s), `${key} uses unknown spec ${s}`);
  }
  for (const s of Object.values(SOURCES)) assert.match(s.url, /^https:\/\/(www\.ready\.gov|www\.nfpa\.org|www\.cpsc\.gov|www\.nhtsa\.gov)\//);
  assert.ok(Object.keys(HOWTO).length >= 40);
});

test("how-to lookup ignores the vehicle suffix and season", () => {
  assert.ok(howtoFor({ title: "Oil change — My Truck" }));
  assert.ok(howtoFor({ title: "Clean gutters (fall)" }));
  assert.equal(howtoFor({ title: "Call the plumber" }), null);
});

test("oil change for a known car: video, guide and manual searches use year/make/model, and the saved specs show", () => {
  const s = mkState({ vehicles: [veh({ year: 2015, make: "Chevy", model: "Equinox", oilType: "5W-30", oilCapacity: "5.7 qt" })], tasks: [oilTask()] });
  const h = helpFor(s.tasks[0], s);
  const by = Object.fromEntries(h.links.map((l) => [l.kind, l]));
  assert.ok(decodeURIComponent(by.video.url).includes("how to change oil 2015 Chevy Equinox"));
  assert.ok(by.video.url.startsWith("https://www.youtube.com/results?"));
  assert.ok(decodeURIComponent(by.manual.url).includes("2015 Chevy Equinox owner's manual"));
  assert.deepEqual(h.specs.map((x) => x.value), ["5W-30", "5.7 qt"]);
  assert.equal(h.missingSpecs, 1, "oil filter not filled in");
  assert.ok(h.steps.length > 3);
});

test("without year/make/model it falls back to the vehicle's name; a saved manual link replaces the search", () => {
  assert.equal(vehicleLabel({ name: "2015 Chevy Equinox" }), "2015 Chevy Equinox");
  const s = mkState({ vehicles: [veh({ manualUrl: "https://example.com/manual.pdf" })], tasks: [oilTask()] });
  const m = helpFor(s.tasks[0], s).links.find((l) => l.kind === "manual");
  assert.equal(m.url, "https://example.com/manual.pdf");
  assert.equal(m.label, "Your owner's manual");
});

test("item tasks use the item's own manual link, else a search on its name and model; plain custom tasks get no help", () => {
  const it = mkItem({ id: "i1", name: "Dishwasher", model: "GDF510" });
  const t = mkTask({ id: "t2", title: "Clean dishwasher filter", itemId: "i1" });
  let s = mkState({ items: [it], tasks: [t] });
  const m1 = helpFor(t, s).links.find((l) => l.kind === "manual");
  assert.ok(decodeURIComponent(m1.url).includes("Dishwasher GDF510 manual pdf"));
  s = mkState({ items: [{ ...it, manualUrl: "https://example.com/dw.pdf" }], tasks: [t] });
  assert.equal(helpFor(t, s).links.find((l) => l.kind === "manual").url, "https://example.com/dw.pdf");
  assert.equal(helpFor(mkTask({ id: "x", title: "Call mom" }), mkState()), null);
});

test("vehicle details are validated and stored cleanly; empty values are removed", () => {
  let s = mkState({ vehicles: [veh()] });
  s = updateVehicle(s, "v1", { year: "2015", make: " Chevy ", model: "Equinox", manualUrl: " https://x.com/m.pdf ", oilType: "5W-30" });
  assert.deepEqual([s.vehicles[0].year, s.vehicles[0].make, s.vehicles[0].manualUrl, s.vehicles[0].oilType], [2015, "Chevy", "https://x.com/m.pdf", "5W-30"]);
  validateState(s);
  s = updateVehicle(s, "v1", { oilType: "", manualUrl: "", year: "" });
  assert.equal("oilType" in s.vehicles[0], false);
  assert.equal("manualUrl" in s.vehicles[0], false);
  assert.equal("year" in s.vehicles[0], false);
  assert.throws(() => updateVehicle(s, "v1", { year: "20x5" }), /year/i);
  assert.throws(() => updateVehicle(s, "v1", { manualUrl: "javascript:alert(1)" }), /http/);
  assert.throws(() => updateVehicle(s, "v1", { oilType: "x".repeat(101) }), /at most/);
  const added = addVehicle(mkState(), { name: "Truck", odometer: 1000, year: 2020, make: "Ford" }, idFn, "2026-01-01");
  assert.equal(added.vehicles[0].make, "Ford");
  validateState(added);
});

test("item manual link: saved when valid, rejected when not, removed when cleared; state validation rejects a bad link", () => {
  let s = addItem(mkState(), { name: "Washer", kind: "appliance", manualUrl: "https://x.com/w.pdf" }, idFn);
  assert.equal(s.items[0].manualUrl, "https://x.com/w.pdf");
  validateState(s);
  s = updateItem(s, "id1", { manualUrl: "" });
  assert.equal("manualUrl" in s.items[0], false);
  assert.throws(() => addItem(mkState(), { name: "W", kind: "appliance", manualUrl: "ftp://x" }, idFn), /http/);
  const bad = mkState({ items: [mkItem({ id: "i", manualUrl: "javascript:1" })] });
  assert.throws(() => validateState(bad), /manualUrl/);
});

test("two phones editing different specs of the same car merge without losing either", () => {
  const base = mkState({ vehicles: [veh()] });
  const mine = mkState({ vehicles: [veh({ oilType: "5W-30" })] });
  const theirs = mkState({ vehicles: [veh({ tireSize: "235/65R17" })] });
  const m = mergeStates(base, mine, theirs).vehicles[0];
  assert.equal(m.oilType, "5W-30");
  assert.equal(m.tireSize, "235/65R17");
});

// ---------- screens ----------
function setup(view, state, extra = {}) {
  const doc = makeDocument();
  const container = doc.createElement("div");
  const calls = { commits: [] };
  let st = state;
  const ctx = { doc, h: (t, a, ...c) => rawH(doc, t, a, ...c), getState: () => st, today: () => "2026-06-15",
    completeTask() {}, openTaskForm() {}, saveFile: async () => false, toast() {}, personName: (i) => i, setView() {},
    commit: (next, msg) => { calls.commits.push({ next, msg }); st = next; return true; }, ...extra };
  view.render(container, ctx);
  return { container, ctx, calls, rerender: () => view.render(container, ctx) };
}

test("Today card shows a How to and manuals section with the car's specs and working links", () => {
  const s = mkState({ vehicles: [veh({ year: 2015, make: "Chevy", model: "Equinox", oilType: "5W-30" })], tasks: [oilTask({ lastDoneOdometer: 60000 })] });
  const { container } = setup(today, s);
  assert.ok(container.querySelector("details.task-help"), "help section present");
  const text = container.textContent;
  assert.ok(text.includes("How to and manuals"));
  assert.ok(text.includes("5W-30"));
  assert.ok(text.includes("What you'll need"));
  const hrefs = container.querySelectorAll("a").map((a) => a.getAttribute("href"));
  assert.ok(hrefs.some((u) => u.startsWith("https://www.youtube.com/results")));
  assert.ok(hrefs.every((u) => /^https:\/\//.test(u)));
});

test("Vehicles: Edit details saves year, make, model, manual link and specs, and the card then shows them", () => {
  const s = mkState({ vehicles: [veh()], tasks: [] });
  const { container, calls, rerender } = setup(vehiclesView, s);
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit details").click();
  rerender();
  const set = (id, v) => { const el = container.querySelector(`#${id}`); assert.ok(el, id); el.value = v; el.dispatchEvent(new (globalThis.Event || class { constructor(t) { this.type = t; } })("input")); };
  const input = (id, v) => { const el = container.querySelector(`#${id}`); el.value = v; if (el.oninput) el.oninput({ target: el }); else el.dispatchEvent({ type: "input", target: el }); };
  input("ve-year-v1", "2015"); input("ve-make-v1", "Chevy"); input("ve-model-v1", "Equinox");
  input("ve-manualUrl-v1", "https://example.com/m.pdf"); input("ve-oilType-v1", "5W-30");
  const form = container.querySelector("form");
  form.dispatchEvent({ type: "submit", preventDefault() {} });
  assert.equal(calls.commits.length, 1, "saved");
  const v = calls.commits[0].next.vehicles[0];
  assert.deepEqual([v.year, v.make, v.model, v.manualUrl, v.oilType], [2015, "Chevy", "Equinox", "https://example.com/m.pdf", "5W-30"]);
  rerender();
  assert.ok(container.textContent.includes("5W-30"));
  assert.ok(container.querySelectorAll("a").some((a) => a.getAttribute("href") === "https://example.com/m.pdf"));
});
