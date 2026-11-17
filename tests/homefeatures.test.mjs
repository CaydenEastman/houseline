import test from "node:test";
import assert from "node:assert/strict";
import { templatesFor, seedFromProfile } from "../src/templates.js";
import { updateProfile, SYSTEM_TYPES } from "../src/logic.js";
import { freshState, validateState } from "../src/storage.js";

const titles = (p) => templatesFor(p).map((t) => t.title);
const base = { homeType: "house", hasYard: true, hasPool: false, hasTrailer: false, hasPets: false, householdSize: 2 };

test("a profile from before the features question keeps its old garage, chimney and generator tasks", () => {
  const t = titles(base);
  assert.ok(t.includes("Test garage door auto-reverse"));
  assert.ok(t.includes("Chimney and fireplace inspection"));
  assert.ok(t.includes("Test generator or backup power"));
  assert.ok(!t.includes("Pump septic tank"));
});

test("choosing features turns task groups on and off", () => {
  const none = titles({ ...base, systems: [] });
  assert.ok(!none.includes("Test garage door auto-reverse") && !none.includes("Chimney and fireplace inspection") && !none.includes("Test generator or backup power"));
  const all = titles({ ...base, systems: SYSTEM_TYPES });
  for (const x of ["Pump septic tank", "Test well water", "Test sump pump", "Check solar panels and inverter", "Inspect EV charger and cable", "Service generator (oil, filter, fuel)", "Lubricate garage door and rollers", "Check basement or crawlspace for moisture"]) assert.ok(all.includes(x), x);
});

test("renters skip what a landlord handles and get renter tasks", () => {
  const t = titles({ ...base, rents: true, systems: [] });
  for (const x of ["Inspect roof and attic", "Flush water heater", "Clean gutters (fall)", "Furnace service"]) assert.ok(!t.includes(x), x);
  assert.ok(t.includes("Review renter's insurance") && t.includes("Photograph your home and belongings"));
  const own = titles({ ...base, systems: [] });
  assert.ok(!own.includes("Photograph your home and belongings") && !own.includes("Review renter's insurance"));
  const apt = titles({ ...base, homeType: "apartment", hasYard: false, rents: true, systems: [] });
  assert.equal(apt.filter((x) => /renter's/i.test(x)).length, 1, "apartment renters get exactly one insurance task");
});

test("seeded tasks for a feature profile have unique titles", () => {
  let n = 0;
  const out = seedFromProfile({ ...base, systems: SYSTEM_TYPES }, { vehicles: [], idFn: () => "t" + n++, today: "2026-11-17" });
  assert.equal(new Set(out.map((t) => t.title.toLowerCase())).size, out.length);
});

test("profile accepts and validates rents and systems", () => {
  const s = freshState();
  const next = updateProfile(s, { rents: true, systems: ["well", "septic", "well"] });
  assert.equal(next.profile.rents, true);
  assert.deepEqual(next.profile.systems, ["septic", "well"]);
  assert.throws(() => updateProfile(s, { systems: ["moat"] }), /known features/);
  assert.throws(() => updateProfile(s, { rents: "yes" }), /true or false/);
  assert.doesNotThrow(() => validateState({ ...next }));
  assert.throws(() => validateState({ ...next, profile: { ...next.profile, systems: ["moat"] } }), /home features/);
});
