import test from "node:test";
import assert from "node:assert/strict";
import { addTask, addDays, MAX_INTERVAL_DAYS } from "../src/logic.js";
import { importJSON, loadState, STORAGE_KEY, BACKUP_KEY } from "../src/storage.js";

import { mkState } from "./helpers.mjs";
const empty = () => mkState();
const fakeStorage = (initial = {}) => {
  const m = new Map(Object.entries(initial));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
};

test("addTask rejects intervals above the maximum", () => {
  assert.throws(
    () => addTask(empty(), { title: "t", category: "car", intervalDays: MAX_INTERVAL_DAYS + 1, notes: "" }, () => "t-1"),
    /Interval/
  );
  assert.doesNotThrow(() =>
    addTask(empty(), { title: "t", category: "car", intervalDays: MAX_INTERVAL_DAYS, notes: "" }, () => "t-1")
  );
});

test("importJSON rejects absurd intervals that would overflow date math", () => {
  const bad = {
    version: 1,
    tasks: [{ id: "a", title: "x", category: "car", intervalDays: 1e15, lastDone: "2026-01-01", notes: "", custom: true }],
    completions: [],
  };
  assert.throws(() => importJSON(JSON.stringify(bad)), /intervalDays/);
});

test("addDays throws instead of returning NaN dates when out of range", () => {
  assert.throws(() => addDays("2026-01-01", 1e12), /range/);
});

test("loadState keeps a backup of corrupt or newer-version data", () => {
  const raw = '{"version":2,"tasks":[';
  const st = fakeStorage({ [STORAGE_KEY]: raw });
  const s = loadState(st);
  assert.equal(s.version, 2);
  assert.equal(st.m.get(BACKUP_KEY), raw);
});

test("loadState does not write a backup when storage is simply empty", () => {
  const st = fakeStorage();
  loadState(st);
  assert.equal(st.m.size, 0);
});
