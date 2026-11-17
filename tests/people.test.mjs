import test from "node:test";
import assert from "node:assert/strict";
import { makeDocument } from "./stubdom.mjs";
import { mount } from "../src/ui.js";
import { addPerson, updatePerson, deletePerson, PEOPLE_MAX } from "../src/logic.js";
import { migrate, validateState } from "../src/storage.js";
import { mergeStates } from "../src/sync.js";
import { joinImpact } from "../src/household.js";
import { emergencySheetText, emergencySheetHTML } from "../src/readiness.js";
import { newMembers, checkMembers, memberLabel } from "../src/invite.js";
import { mkState, mkProfile, idGen } from "./helpers.mjs";

for (const n of ["setInterval", "setTimeout"]) { const o = globalThis[n]; globalThis[n] = (...a) => { const t = o(...a); if (n === "setInterval" || a[1] >= 1000) t?.unref?.(); return t; }; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const store = () => { const saved = []; return { mode: "local", saved, load: async () => null, save: async (s) => { saved.push(s); return true; }, flush: async () => true, onStatus: () => () => {}, subscribe: () => () => {}, putPhoto: async () => {}, getPhoto: async () => null, deletePhoto: async () => {}, whoAmI: async () => ({ id: null, isOwner: false }), names: async () => ({}), saveFile: async () => false }; };
const base = () => mkState({ profile: mkProfile({ setupDone: true }) });

test("people: add, edit, remove, with limits and no echo of what was typed", () => {
  let s = addPerson(base(), { name: " Mia ", kind: "child", allergies: "peanuts", bloodType: "O+" }, idGen("p"));
  assert.equal(s.people[0].name, "Mia");
  s = updatePerson(s, "p1", { medical: "inhaler" });
  assert.equal(s.people[0].medical, "inhaler");
  assert.equal(s.people[0].allergies, "peanuts");
  assert.equal(deletePerson(s, "p1").people.length, 0);
  assert.throws(() => addPerson(base(), { name: "" }, idGen()), /required/);
  assert.throws(() => addPerson(base(), { name: "A", kind: "alien" }, idGen()));
  assert.throws(() => addPerson(base(), { name: "A", bloodType: "Z" }, idGen()));
  const secret = "SECRETMEDICAL" + "x".repeat(600);
  try { addPerson(base(), { name: "A", medical: secret }, idGen()); assert.fail("should throw"); }
  catch (e) { assert.ok(!e.message.includes("SECRETMEDICAL"), "validation messages must not repeat health text"); }
  let many = base();
  for (let i = 0; i < PEOPLE_MAX; i++) many = addPerson(many, { name: "P" + i }, idGen("m" + i + "-"));
  assert.throws(() => addPerson(many, { name: "one more" }, idGen("z")), /maximum/);
});

test("people survive validation and migration, and bad data is refused", () => {
  const s = addPerson(base(), { name: "Rex", kind: "pet", doctor: "Dr. Vet 555-1234" }, idGen("p"));
  const m = migrate(structuredClone({ ...s, version: 2 }));
  assert.equal(m.people[0].kind, "pet");
  assert.doesNotThrow(() => validateState(m));
  const bad = structuredClone(m); bad.people[0].allergies = "x".repeat(5000);
  assert.throws(() => validateState(bad));
});

test("two phones adding different people both keep them; joining warns about them", () => {
  const b = base();
  const mine = addPerson(b, { name: "Ann" }, idGen("a"));
  const theirs = addPerson(b, { name: "Bob" }, idGen("b"));
  assert.deepEqual(mergeStates(b, mine, theirs).people.map((p) => p.name).sort(), ["Ann", "Bob"]);
  const j = joinImpact(mine);
  assert.equal(j.untouched, false);
  assert.match(j.summary, /family profile/);
});

test("the emergency sheet lists people and pets with their details", () => {
  const s = addPerson(addPerson(base(), { name: "Mia", kind: "child", allergies: "peanuts" }, idGen("p")), { name: "Rex", kind: "pet", doctor: "Vet 555" }, idGen("q"));
  const t = emergencySheetText(s, "2026-06-15");
  assert.match(t, /PEOPLE AND PETS/); assert.match(t, /Mia \(child\)/); assert.match(t, /Allergies: peanuts/); assert.match(t, /Vet: Vet 555/);
  const html = emergencySheetHTML(s, "2026-06-15");
  assert.match(html, /People and pets/); assert.match(html, /peanuts/);
  assert.doesNotMatch(emergencySheetText(base(), "2026-06-15"), /PEOPLE AND PETS/);
});

test("Family screen: reachable from Home, adds a person through the form", async () => {
  const doc = makeDocument(); const st = store();
  await mount(doc, { store: st, state: base() });
  doc.getElementById("nav").querySelector("#nav-home").click(); await sleep(5);
  const tile = doc.getElementById("main").querySelectorAll(".hub-tile").find((t) => t.getAttribute("data-fk") === "hub-people");
  assert.ok(tile, "Family tile on Home");
  tile.click(); await sleep(5);
  const main = doc.getElementById("main");
  assert.match(main.textContent, /Everyone who shares this household can see and edit/);
  main.querySelector("#v-ppl-add").click(); await sleep(5);
  const f = doc.getElementById("main");
  const set = (sel, v) => { const el = f.querySelector(sel); el.value = v; el.dispatchEvent({ type: "input", bubbles: true, target: el, preventDefault() {} }); };
  set("#v-pf-name", "Mia"); set("#v-pf-allergies", "peanuts");
  const form = f.querySelector("form");
  form.dispatchEvent({ type: "submit", bubbles: false, target: form, preventDefault() {}, stopPropagation() {} });
  await sleep(20);
  assert.equal(st.saved.at(-1).people[0].name, "Mia");
  assert.equal(st.saved.at(-1).people[0].allergies, "peanuts");
});

test("join notice: nobody is announced the first time; later arrivals are, never yourself", () => {
  const me = { user_id: "u1", email: "me@x.com", me: true }, mal = { user_id: "u2", email: "mallory@x.com" };
  assert.deepEqual(newMembers(null, [me, mal]), []);
  assert.deepEqual(newMembers(["u1"], [me, mal]).map(memberLabel), ["mallory"]);
  assert.deepEqual(newMembers(["u1", "u2"], [me, mal]), []);
  const m = {}; const ls = { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } };
  assert.deepEqual(checkMembers(ls, "u1", [me]), []);          // baseline
  assert.deepEqual(checkMembers(ls, "u1", [me, mal]).length, 1); // Mallory joins
  assert.deepEqual(checkMembers(ls, "u1", [me, mal]), []);       // announced once
});
