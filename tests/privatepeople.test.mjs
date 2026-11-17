import test from "node:test";
import assert from "node:assert/strict";
import { addPerson, updatePerson } from "../src/logic.js";
import { validateState } from "../src/storage.js";
import { emergencySheetText } from "../src/readiness.js";
import { mkState } from "./helpers.mjs";

const id = () => "p1";
test("a private person keeps allergies and health notes out of the shared state", () => {
  let s = addPerson(mkState(), { name: "Sam", kind: "adult", allergies: "peanuts", medical: "asthma", doctor: "Dr A", private: true }, id);
  assert.equal(s.people[0].private, true);
  assert.equal(s.people[0].allergies, "");
  assert.equal(s.people[0].medical, "");
  assert.equal(s.people[0].doctor, "Dr A");
  validateState(s);
  s = updatePerson(s, "p1", { private: false, allergies: "peanuts" });
  assert.equal(s.people[0].private, undefined);
  assert.equal(s.people[0].allergies, "peanuts");
});
test("emergency sheet shows private notes only when supplied", () => {
  const s = addPerson(mkState(), { name: "Sam", kind: "adult", private: true }, id);
  const without = emergencySheetText(s, "2026-11-16");
  assert.match(without, /kept private/);
  const withMine = emergencySheetText(s, "2026-11-16", { p1: { allergies: "peanuts", medical: "asthma" } });
  assert.match(withMine, /Allergies: peanuts/);
  assert.match(withMine, /Health: asthma/);
  assert.doesNotMatch(withMine, /kept private/);
});
test("a non-boolean private flag is rejected by validation", () => {
  const s = addPerson(mkState(), { name: "Sam", kind: "adult" }, id);
  assert.throws(() => validateState({ ...s, people: [{ ...s.people[0], private: "yes" }] }));
});
