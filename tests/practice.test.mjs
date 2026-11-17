import test from "node:test";
import assert from "node:assert/strict";
import { updateEmergency, addPerson, setBag, markDone } from "../src/logic.js";
import { validateState } from "../src/storage.js";
import { drillStatus, addMissingDrills, DRILLS, bagFromPreset, bagProgress, houseReview, reviewText } from "../src/practice.js";
import { emergencySheetText, emergencySheetHTML } from "../src/readiness.js";
import { mkState, mkTask } from "./helpers.mjs";

let n = 0; const id = () => `x${++n}`;
const T = "2026-11-16";

test("addMissingDrills adds each standard drill once", () => {
  const r = addMissingDrills(mkState(), id);
  assert.equal(r.added, DRILLS.length);
  assert.equal(addMissingDrills(r.state, id).added, 0);
  validateState(r.state);
  assert.ok(r.state.tasks.every((t) => t.tags.includes("drill")));
});
test("drill status shows never, then the last practice", () => {
  let s = addMissingDrills(mkState(), id).state;
  const fire = s.tasks.find((t) => t.title === "Practice fire escape drill");
  assert.equal(drillStatus(s, T).find((x) => x.task.id === fire.id).last, null);
  s = markDone(s, fire.id, "2026-11-01", { notes: "took 2 minutes" });
  assert.equal(drillStatus(s, T).find((x) => x.task.id === fire.id).last, "2026-11-01");
  assert.equal(drillStatus(mkState(), T).every((x) => x.task === null), true);
});
test("house info saves, validates, and stays off the printed sheet", () => {
  let s = updateEmergency(mkState(), { houseInfo: [{ label: "Garage code", value: "4821" }, { label: "Spare key", value: "blue pot" }] });
  validateState(s);
  assert.equal(s.emergency.houseInfo.length, 2);
  assert.doesNotMatch(emergencySheetText(s, T), /4821|Garage code/);
  assert.doesNotMatch(emergencySheetHTML(s, T), /4821|Garage code/);
  assert.throws(() => updateEmergency(s, { houseInfo: [{ label: "", value: "x" }] }));
  assert.throws(() => updateEmergency(s, { houseInfo: Array.from({ length: 21 }, (_, i) => ({ label: `a${i}`, value: "" })) }));
  s = updateEmergency(s, { meetingPlace: "Park" });
  assert.equal(s.emergency.houseInfo.length, 2, "other emergency edits keep house info");
});
test("go-bag: standard list, packing, limits, and the sheet line", () => {
  let s = addPerson(mkState(), { name: "Ava", kind: "child" }, () => "p1");
  s = setBag(s, "p1", bagFromPreset("child"));
  validateState(s);
  assert.ok(s.people[0].bag.length >= 6 && s.people[0].bag.every((b) => b.ok === false));
  s = setBag(s, "p1", s.people[0].bag.map((b, i) => ({ ...b, ok: i < 2 })));
  assert.deepEqual(bagProgress(s.people[0].bag).ok, 2);
  assert.match(emergencySheetText(s, T), /Go-bag: 2 of \d+ packed/);
  assert.throws(() => setBag(s, "p1", Array.from({ length: 31 }, (_, i) => ({ t: `i${i}`, ok: false }))));
  assert.throws(() => setBag(s, "p1", [{ t: "", ok: false }]));
  assert.equal(bagFromPreset("pet").length > 0 && bagFromPreset("zzz").length > 0, true);
  s = { ...s, people: [{ ...s.people[0], bag: [{ t: "x", ok: "yes" }] }] };
  assert.throws(() => validateState(s));
});
test("yearly review flags old appliances, warranties, overdue tasks and unpracticed drills", () => {
  let s = mkState({
    tasks: [mkTask({ id: "o", title: "Clean gutters", lastDone: "2025-01-01", intervalDays: 90 })],
    items: [{ id: "i1", name: "Water heater", kind: "plumbing", purchaseDate: "2014-05-01", warrantyExpires: "2026-12-20", location: "", model: "", filterSize: "", notes: "", photoIds: [] }],
  });
  s = addMissingDrills(s, id).state;
  const r = houseReview(s, T);
  const titles = r.sections.map((x) => x.title);
  assert.ok(titles.includes("Overdue right now") && titles.includes("Getting old") && titles.includes("Warranties") && titles.includes("Family preparedness"));
  assert.match(reviewText(s, T), /Water heater: about 12 years old/);
  assert.equal(houseReview(mkState(), T).sections.length >= 1, true);
});
