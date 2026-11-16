// Persistence helpers. `storage` is any localStorage-like object (getItem/setItem).
import { CATEGORIES } from "./templates.js";
import {
  isValidISO, LIMITS, TASK_KINDS, ITEM_KINDS, SUPPLY_CATEGORIES, HOME_TYPES, CLIMATE_TYPES, HOME_AGE_TYPES,
  MAX_INTERVAL_DAYS, MAX_INTERVAL_MILES, MAX_ODOMETER, MAX_ODOMETER_LOG, MAX_COST,
} from "./logic.js";

export const STORAGE_KEY = "motH.v1"; // key kept from v1 so existing data migrates in place
export const BACKUP_KEY = STORAGE_KEY + ".corrupt";
export const STATE_VERSION = 2;
export const MAX_STATE_BYTES = 900_000;

const TOP_KEYS = ["version", "profile", "vehicles", "items", "supplies", "tasks", "completions", "emergency", "vendors"];
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;
const isISO = isValidISO;

function need(cond, msg) {
  if (!cond) throw new Error(msg);
}
const strMax = (v, max) => typeof v === "string" && v.length <= max;

function checkIds(arr, name) {
  const ids = new Set();
  arr.forEach((x, i) => {
    need(isObj(x), `${name}[${i}] must be an object`);
    need(typeof x.id === "string" && x.id !== "", `${name}[${i}].id must be a non-empty string`);
    need(!ids.has(x.id), `${name}[${i}].id is duplicated: ${x.id}`);
    ids.add(x.id);
  });
  return ids;
}

function checkPhotoIds(v, p) {
  need(Array.isArray(v) && v.length <= LIMITS.photos && v.every((x) => typeof x === "string" && x !== ""),
    `${p}.photoIds must be a list of at most ${LIMITS.photos} ids`);
}

// Returns the state if valid; throws Error describing the first problem.
export function validateState(s) {
  need(isObj(s), "State must be an object");
  need(s.version === STATE_VERSION, `Unsupported state version: ${s.version}`);
  for (const k of Object.keys(s)) need(TOP_KEYS.includes(k), `Unknown top-level key: ${k}`);

  const pr = s.profile;
  need(isObj(pr), "State.profile must be an object");
  need(typeof pr.setupDone === "boolean", "profile.setupDone must be a boolean");
  need(HOME_TYPES.includes(pr.homeType), "profile.homeType is invalid");
  for (const k of ["hasYard", "hasPool", "hasTrailer", "hasPets"]) need(typeof pr[k] === "boolean", `profile.${k} must be a boolean`);
  need(isInt(pr.householdSize, 1, 20), "profile.householdSize must be a whole number from 1 to 20");
  need(pr.homeAge === undefined || HOME_AGE_TYPES.includes(pr.homeAge), "profile.homeAge must be new, mid or old");
  need(pr.climate === undefined || CLIMATE_TYPES.includes(pr.climate), "profile.climate must be cold, mild or hot");

  for (const k of ["vehicles", "items", "supplies", "tasks", "completions"]) {
    need(Array.isArray(s[k]), `State.${k} must be an array`);
  }

  const vIds = checkIds(s.vehicles, "vehicles");
  s.vehicles.forEach((v, i) => {
    const p = `vehicles[${i}]`;
    need(typeof v.name === "string" && v.name.trim() !== "" && v.name.length <= LIMITS.vehicleName, `${p}.name must be 1-${LIMITS.vehicleName} characters`);
    need(isInt(v.odometer, 0, MAX_ODOMETER), `${p}.odometer must be a whole number >= 0`);
    need(isISO(v.odometerDate), `${p}.odometerDate must be YYYY-MM-DD`);
    need(Array.isArray(v.odometerLog) && v.odometerLog.length <= MAX_ODOMETER_LOG, `${p}.odometerLog must be a list of at most ${MAX_ODOMETER_LOG}`);
    v.odometerLog.forEach((e, j) => {
      need(isObj(e) && isISO(e.date) && isInt(e.odometer, 0, MAX_ODOMETER), `${p}.odometerLog[${j}] must be {date, odometer}`);
      if (j > 0) need(e.date >= v.odometerLog[j - 1].date, `${p}.odometerLog must be in ascending date order`);
    });
  });

  if (s.vendors !== undefined) {
    need(Array.isArray(s.vendors) && s.vendors.length <= 200, "State.vendors must be a list of at most 200");
    checkIds(s.vendors, "vendors");
    s.vendors.forEach((v, i) => {
      const p = `vendors[${i}]`;
      need(typeof v.name === "string" && v.name.trim() !== "" && v.name.length <= LIMITS.name, `${p}.name must be 1-${LIMITS.name} characters`);
      for (const k of ["trade", "phone"]) need(strMax(v[k], LIMITS.label), `${p}.${k} must be a string of at most ${LIMITS.label} characters`);
      need(strMax(v.email, LIMITS.text), `${p}.email must be a string of at most ${LIMITS.text} characters`);
      need(strMax(v.notes, LIMITS.notes), `${p}.notes must be a string of at most ${LIMITS.notes} characters`);
      need(Array.isArray(v.itemIds) && v.itemIds.length <= 50 && v.itemIds.every((x) => typeof x === "string"), `${p}.itemIds must be a list of ids`);
    });
  }

  const iIds = checkIds(s.items, "items");
  s.items.forEach((it, i) => {
    const p = `items[${i}]`;
    need(typeof it.name === "string" && it.name.trim() !== "" && it.name.length <= LIMITS.name, `${p}.name must be 1-${LIMITS.name} characters`);
    need(ITEM_KINDS.includes(it.kind), `${p}.kind is invalid: ${it.kind}`);
    for (const k of ["location", "model", "filterSize"]) need(strMax(it[k], LIMITS.text), `${p}.${k} must be a string of at most ${LIMITS.text} characters`);
    for (const k of ["purchaseDate", "warrantyExpires"]) need(it[k] === null || isISO(it[k]), `${p}.${k} must be YYYY-MM-DD or null`);
    need(strMax(it.notes, LIMITS.notes), `${p}.notes must be a string of at most ${LIMITS.notes} characters`);
    checkPhotoIds(it.photoIds, p);
  });

  checkIds(s.supplies, "supplies");
  s.supplies.forEach((x, i) => {
    const p = `supplies[${i}]`;
    need(typeof x.name === "string" && x.name.trim() !== "" && x.name.length <= LIMITS.name, `${p}.name must be 1-${LIMITS.name} characters`);
    need(x.key === null || (typeof x.key === "string" && x.key !== "" && x.key.length <= 40), `${p}.key must be a string or null`);
    need(SUPPLY_CATEGORIES.includes(x.category), `${p}.category is invalid: ${x.category}`);
    need(typeof x.quantity === "number" && Number.isFinite(x.quantity) && x.quantity >= 0, `${p}.quantity must be a number >= 0`);
    need(strMax(x.unit, LIMITS.unit), `${p}.unit must be a string of at most ${LIMITS.unit} characters`);
    need(x.expires === null || isISO(x.expires), `${p}.expires must be YYYY-MM-DD or null`);
    need(strMax(x.notes, LIMITS.notes), `${p}.notes must be a string of at most ${LIMITS.notes} characters`);
  });

  const tIds = checkIds(s.tasks, "tasks");
  s.tasks.forEach((t, i) => {
    const p = `tasks[${i}]`;
    need(typeof t.title === "string" && t.title.trim() !== "" && t.title.length <= LIMITS.title, `${p}.title must be 1-${LIMITS.title} characters`);
    need(CATEGORIES.includes(t.category), `${p}.category is invalid: ${t.category}`);
    need(TASK_KINDS.includes(t.kind), `${p}.kind is invalid: ${t.kind}`);
    if (t.kind === "interval") {
      need(isInt(t.intervalDays, 1, MAX_INTERVAL_DAYS), `${p}.intervalDays must be a whole number from 1 to ${MAX_INTERVAL_DAYS}`);
    } else if (t.kind === "annual") {
      need(t.intervalDays === null, `${p}.intervalDays must be null for annual tasks`);
      need(isInt(t.month, 1, 12), `${p}.month must be 1-12`);
      need(isInt(t.day, 1, 28), `${p}.day must be 1-28`);
    } else {
      need(isInt(t.intervalMiles, 1, MAX_INTERVAL_MILES), `${p}.intervalMiles must be a whole number from 1 to ${MAX_INTERVAL_MILES}`);
      need(t.intervalDays === null || isInt(t.intervalDays, 1, MAX_INTERVAL_DAYS), `${p}.intervalDays must be null or 1-${MAX_INTERVAL_DAYS}`);
      need(typeof t.vehicleId === "string" && vIds.has(t.vehicleId), `${p}.vehicleId must reference an existing vehicle`);
      need(t.lastDoneOdometer === null || isInt(t.lastDoneOdometer, 0, MAX_ODOMETER), `${p}.lastDoneOdometer must be a whole number >= 0 or null`);
    }
    if (t.kind !== "annual") need(t.month === null && t.day === null, `${p}.month/day must be null unless annual`);
    if (t.kind !== "mileage") {
      need(t.intervalMiles === null && t.lastDoneOdometer === null, `${p} has mileage fields but is not a mileage task`);
      need(t.vehicleId === null || (typeof t.vehicleId === "string" && vIds.has(t.vehicleId)), `${p}.vehicleId must reference an existing vehicle or be null`);
    }
    for (const k of ["lastDone", "startDate", "snoozedUntil"]) need(t[k] === null || isISO(t[k]), `${p}.${k} must be YYYY-MM-DD or null`);
    need(t.itemId === null || (typeof t.itemId === "string" && iIds.has(t.itemId)), `${p}.itemId must reference an existing item or be null`);
    need(t.assignee === null || (typeof t.assignee === "string" && t.assignee.length <= LIMITS.assignee), `${p}.assignee must be a string or null`);
    need(Array.isArray(t.links) && t.links.length <= LIMITS.links, `${p}.links must be a list of at most ${LIMITS.links}`);
    t.links.forEach((l, j) => {
      let ok = false;
      if (isObj(l) && typeof l.label === "string" && typeof l.url === "string") {
        try { const u = new URL(l.url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { /* invalid */ }
      }
      need(ok, `${p}.links[${j}] must be {label, url} with an http(s) url`);
    });
    need(Array.isArray(t.tags) && t.tags.length <= LIMITS.tags && t.tags.every((x) => typeof x === "string"), `${p}.tags must be a list of strings`);
    need(strMax(t.notes, LIMITS.notes), `${p}.notes must be a string of at most ${LIMITS.notes} characters`);
    need(typeof t.custom === "boolean", `${p}.custom must be a boolean`);
  });

  checkIds(s.completions, "completions");
  s.completions.forEach((c, i) => {
    const p = `completions[${i}]`;
    need(c.taskId === null || typeof c.taskId === "string", `${p}.taskId must be a string or null`);
    need(typeof c.title === "string", `${p}.title must be a string`);
    need(CATEGORIES.includes(c.category), `${p}.category is invalid: ${c.category}`);
    need(isISO(c.date), `${p}.date must be YYYY-MM-DD`);
    need(c.kind === "done" || c.kind === "skipped", `${p}.kind must be "done" or "skipped"`);
    need(c.cost === null || (typeof c.cost === "number" && Number.isFinite(c.cost) && c.cost >= 0 && c.cost <= MAX_COST), `${p}.cost must be a number from 0 to ${MAX_COST} or null`);
    need(typeof c.notes === "string", `${p}.notes must be a string`);
    need(c.odometer === null || isInt(c.odometer, 0, MAX_ODOMETER), `${p}.odometer must be a whole number >= 0 or null`);
    need(c.by === null || typeof c.by === "string", `${p}.by must be a string or null`);
    checkPhotoIds(c.photoIds, p);
  });

  const e = s.emergency;
  need(isObj(e), "State.emergency must be an object");
  need(Array.isArray(e.contacts) && e.contacts.length <= LIMITS.contacts, `emergency.contacts must be a list of at most ${LIMITS.contacts}`);
  e.contacts.forEach((c, i) => {
    need(isObj(c) && ["name", "phone", "relation"].every((k) => strMax(c[k], LIMITS.text)), `emergency.contacts[${i}] must have name/phone/relation strings of at most ${LIMITS.text} characters`);
  });
  need(strMax(e.meetingPlace, LIMITS.text), `emergency.meetingPlace must be a string of at most ${LIMITS.text} characters`);
  need(strMax(e.outOfAreaContact, LIMITS.text), `emergency.outOfAreaContact must be a string of at most ${LIMITS.text} characters`);
  need(isObj(e.shutoffs) && ["water", "gas", "electric"].every((k) => strMax(e.shutoffs[k], LIMITS.text)), `emergency.shutoffs must have water/gas/electric strings of at most ${LIMITS.text} characters`);
  need(strMax(e.notes, LIMITS.text), `emergency.notes must be a string of at most ${LIMITS.text} characters`);
  return s;
}

/** Brand-new v2 state: wizard not done, no tasks/vehicles (the wizard seeds them). */
export function freshState() {
  return {
    version: STATE_VERSION,
    profile: { setupDone: false, homeType: "house", hasYard: true, hasPool: false, hasTrailer: false, hasPets: false, householdSize: 2 },
    vehicles: [], items: [], supplies: [], tasks: [], completions: [],
    emergency: { contacts: [], meetingPlace: "", outOfAreaContact: "", shutoffs: { water: "", gas: "", electric: "" }, notes: "" },
  };
}

/** raw (v1 or v2 object) -> validated v2 state. Never mutates `raw`. Throws on anything else. */
export function migrate(raw) {
  need(isObj(raw), "State must be an object");
  if (raw.version === 2) {
    const o = {};
    for (const k of TOP_KEYS) if (k in raw) o[k] = raw[k];
    if (Array.isArray(o.vehicles)) {
      o.vehicles = o.vehicles.map((v) =>
        isObj(v) && typeof v.name === "string" && v.name.length > LIMITS.vehicleName
          ? { ...v, name: v.name.slice(0, LIMITS.vehicleName) } : v);
    }
    return validateState(o);
  }
  need(!(Number.isInteger(raw.version) && raw.version > STATE_VERSION), "This data was saved by a newer version of the app. Reload or update the app to open it. Nothing was changed.");
  need(raw.version === 1, `Unsupported state version: ${raw.version}`);
  need(Array.isArray(raw.tasks), "State.tasks must be an array");
  need(Array.isArray(raw.completions), "State.completions must be an array");
  const clip = (v, n) => (typeof v === "string" && v.length > n ? v.slice(0, n) : v);
  const tasks = raw.tasks.map((t) => {
    need(isObj(t), "tasks entries must be objects");
    return {
      id: t.id,
      title: typeof t.title === "string" && t.title.trim() !== "" ? clip(t.title, LIMITS.title) : t.title,
      category: t.category,
      kind: "interval",
      intervalDays: t.intervalDays,
      month: null, day: null, intervalMiles: null, lastDoneOdometer: null, vehicleId: null,
      lastDone: t.lastDone === undefined ? null : t.lastDone,
      startDate: null, snoozedUntil: null, itemId: null, assignee: null,
      links: [], tags: [],
      notes: clip(t.notes, LIMITS.notes),
      custom: t.custom,
    };
  });
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const used = new Set();
  let n = 0;
  const completions = raw.completions.map((c) => {
    need(isObj(c), "completions entries must be objects");
    const task = byId.get(c.taskId);
    let id;
    do { id = `c-mig-${++n}`; } while (used.has(id));
    used.add(id);
    return {
      id,
      taskId: c.taskId,
      title: task ? task.title : "Task",
      category: task ? task.category : "house",
      date: c.date,
      kind: "done", cost: null, notes: "", odometer: null, by: null, photoIds: [],
    };
  });
  const base = freshState();
  return validateState({
    ...base,
    profile: { ...base.profile, setupDone: true },
    tasks,
    completions,
  });
}

export function loadState(storage) {
  let raw = null;
  try {
    raw = storage.getItem(STORAGE_KEY);
    if (raw == null) return freshState();
    return migrate(JSON.parse(raw));
  } catch {
    // Unreadable, corrupt, or newer-version data: keep a copy so the first
    // save of the fresh state can't destroy it.
    if (typeof raw === "string") {
      try { storage.setItem(BACKUP_KEY, raw); } catch { /* best effort */ }
    }
    return freshState();
  }
}

export function saveState(storage, state) {
  validateState(state);
  const json = JSON.stringify(state);
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_STATE_BYTES) {
    throw new Error(`Data is too large to save (${bytes} bytes; limit ${MAX_STATE_BYTES}). Remove old history or notes.`);
  }
  storage.setItem(STORAGE_KEY, json);
}

export function exportJSON(state) {
  validateState(state);
  return JSON.stringify(state, null, 2);
}

export function importJSON(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`Invalid JSON: ${e.message}`);
  }
  return migrate(parsed);
}
