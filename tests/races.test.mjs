import test from "node:test";
import assert from "node:assert/strict";
import { mergeStates } from "../src/sync.js";
import { mkState, mkTask } from "./helpers.mjs";

test("one phone finishes a task while another snoozes it: finished wins and the snooze is cleared", () => {
  const base = mkState({ tasks: [mkTask({ id: "a", lastDone: "2026-01-01" })] });
  const mine = { ...base, tasks: [{ ...base.tasks[0], snoozedUntil: "2026-07-01" }] };
  const theirs = { ...base, tasks: [{ ...base.tasks[0], lastDone: "2026-06-10" }] };
  for (const [m, t] of [[mine, theirs], [theirs, mine]]) {
    const out = mergeStates(base, m, t).tasks[0];
    assert.equal(out.lastDone, "2026-06-10");
    assert.equal(out.snoozedUntil, null);
  }
});

test("a snooze alone still survives a merge", () => {
  const base = mkState({ tasks: [mkTask({ id: "a" })] });
  const mine = { ...base, tasks: [{ ...base.tasks[0], snoozedUntil: "2026-07-01" }] };
  assert.equal(mergeStates(base, mine, base).tasks[0].snoozedUntil, "2026-07-01");
});

import { migrate } from "../src/storage.js";
import { mkCompletion } from "./helpers.mjs";
test("an import with oversized tags, link text or history strings is refused", () => {
  const ok = mkState({ tasks: [mkTask({ id: "a", tags: ["x"] })] });
  assert.doesNotThrow(() => migrate(structuredClone(ok)));
  const bad = (f) => { const s = structuredClone(ok); f(s); assert.throws(() => migrate(s)); };
  bad((s) => { s.tasks[0].tags = ["x".repeat(500)]; });
  bad((s) => { s.tasks[0].links = [{ label: "x".repeat(500), url: "https://a.com" }]; });
  bad((s) => { s.completions = [mkCompletion({ title: "x".repeat(5000) })]; });
  bad((s) => { s.completions = [mkCompletion({ notes: "x".repeat(50000) })]; });
});

import { isQuietDay, weekdayOf } from "../supabase/functions/send-reminders/due.js";
test("quiet days: weekday of a date, and only listed days are quiet", () => {
  assert.equal(weekdayOf("2026-06-14"), 0); // a Sunday
  assert.equal(isQuietDay([0, 6], "2026-06-14"), true);
  assert.equal(isQuietDay([0, 6], "2026-06-15"), false);
  assert.equal(isQuietDay(null, "2026-06-14"), false);
  assert.equal(isQuietDay([], "2026-06-14"), false);
});
