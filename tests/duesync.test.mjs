import test from "node:test";
import assert from "node:assert/strict";
import { dueInfo as appDue, statusOf as appStatus } from "../src/logic.js";
import { dueInfo as srvDue, statusOf as srvStatus } from "../supabase/functions/send-reminders/due.js";
import { mkState, mkTask } from "./helpers.mjs";

// The reminder server keeps its own copy of the due-date rules. If these ever disagree, a push would not match the app.
const veh = { id: "v1", name: "Van", odometer: 60000, odometerDate: "2026-09-01", odometerLog: [{ date: "2026-03-01", odometer: 55000 }, { date: "2026-09-01", odometer: 60000 }] };
const tasks = [
  mkTask({ id: "i1", kind: "interval", lastDone: "2026-05-01", intervalDays: 90 }),
  mkTask({ id: "i2", kind: "interval", lastDone: null, intervalDays: 30 }),
  mkTask({ id: "i3", kind: "interval", lastDone: "2026-08-01", intervalDays: 60, seasonStart: 4, seasonEnd: 10 }),
  mkTask({ id: "a1", kind: "annual", month: 3, day: 15, lastDone: "2026-03-10" }),
  mkTask({ id: "a2", kind: "annual", month: 12, day: 1, lastDone: null }),
  mkTask({ id: "m1", kind: "mileage", vehicleId: "v1", intervalMiles: 5000, intervalDays: 180, lastDone: "2026-06-01", lastDoneOdometer: 57000 }),
  mkTask({ id: "m2", kind: "mileage", vehicleId: "v1", intervalMiles: 3000, intervalDays: null, lastDone: "2026-01-01", lastDoneOdometer: 56000 }),
];
const state = mkState({ tasks, vehicles: [veh] });
for (const today of ["2026-02-01", "2026-07-15", "2026-11-16", "2027-01-05"]) {
  for (const t of tasks) {
    test(`server due-date rules match the app: ${t.id} on ${today}`, () => {
      const a = appDue(t, state, today), s = srvDue(t, state, today);
      assert.deepEqual({ d: s.dueDate, n: s.daysUntil, b: s.basis, m: s.milesLeft }, { d: a.dueDate, n: a.daysUntil, b: a.basis, m: a.milesLeft });
      assert.equal(srvStatus(t, today, state), appStatus(t, today, state));
    });
  }
}
