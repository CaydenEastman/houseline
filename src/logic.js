// Pure maintenance logic. Never reads the clock; callers pass `today`.
// All state-changing functions return NEW state and throw Error on invalid input.
import { CATEGORIES } from "./templates.js";

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;
export const MAX_INTERVAL_DAYS = 36500; // 100 years; keeps date math inside Date's range
export const MAX_INTERVAL_MILES = 1000000;
export const MAX_ODOMETER = 1e12;
export const MAX_ODOMETER_LOG = 60;
export const DEFAULT_MILES_PER_DAY = 33;
export const TASK_KINDS = ["interval", "annual", "mileage"];
export const ITEM_KINDS = ["appliance", "hvac", "plumbing", "electrical", "paint", "exterior", "other"];
export const SUPPLY_CATEGORIES = ["water", "food", "medical", "power", "tools", "docs", "other"];
export const HOME_TYPES = ["house", "condo", "apartment"];
export const CLIMATE_TYPES = ["cold", "mild", "hot"];
export const HOME_AGE_TYPES = ["new", "mid", "old"];
export const LIMITS = {
  title: 120, vehicleName: 80, notes: 2000, text: 500, name: 120, label: 100, tag: 40, tags: 20,
  links: 5, photos: 3, contacts: 12, assignee: 200, key: 40, unit: 40,
};

// ---------- dates ----------

function parseISO(iso) {
  const m = typeof iso === "string" ? ISO_RE.exec(iso) : null;
  if (!m) throw new Error(`Invalid date "${iso}": expected YYYY-MM-DD`);
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new Error(`Invalid date "${iso}": no such calendar day`);
  }
  return ms;
}

function formatISO(ms) {
  const dt = new Date(ms);
  const y = String(dt.getUTCFullYear()).padStart(4, "0");
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isValidISO(s) {
  try { parseISO(s); return true; } catch { return false; }
}

export function daysBetween(aISO, bISO) {
  return Math.round((parseISO(bISO) - parseISO(aISO)) / DAY_MS);
}

export function addDays(iso, n) {
  if (!Number.isInteger(n)) throw new Error("addDays: n must be an integer");
  const ms = parseISO(iso) + n * DAY_MS;
  const year = new Date(ms).getUTCFullYear();
  if (!Number.isFinite(ms) || !(year >= 1 && year <= 9999)) {
    throw new Error("addDays: result is outside the supported date range");
  }
  return formatISO(ms);
}

const yearOf = (iso) => +iso.slice(0, 4);
const pad2 = (n) => String(n).padStart(2, "0");
const isoYMD = (y, m, d) => `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;

// ---------- vehicles / mileage helpers ----------

const vehicleOf = (task, state) =>
  task.vehicleId && state && Array.isArray(state.vehicles)
    ? state.vehicles.find((v) => v.id === task.vehicleId) || null
    : null;

/**
 * Miles/day from odometerLog (entries within the last 365 days, >= 2 points spanning >= 14 days),
 * else the default 33. Returns { rate, source: "log"|"default" }.
 */
export function estimateMilesPerDay(vehicle, today) {
  parseISO(today);
  const log = vehicle && Array.isArray(vehicle.odometerLog) ? vehicle.odometerLog : [];
  const cutoff = addDays(today, -365);
  const pts = log.filter((e) => e && isValidISO(e.date) && e.date >= cutoff && e.date <= today && Number.isFinite(e.odometer));
  if (pts.length >= 2) {
    const a = pts[0], b = pts[pts.length - 1];
    const span = daysBetween(a.date, b.date);
    const rate = (b.odometer - a.odometer) / (span || 1);
    if (span >= 14 && rate > 0) return { rate, source: "log" };
  }
  return { rate: DEFAULT_MILES_PER_DAY, source: "default" };
}

// ---------- due dates ----------

function annualDue(task, today) {
  const { month, day } = task;
  if (!Number.isInteger(month) || !Number.isInteger(day)) throw new Error("Annual task needs a month and day");
  if (task.lastDone == null) {
    let y = yearOf(today);
    let o = isoYMD(y, month, day);
    if (o < today) o = isoYMD(y + 1, month, day);
    return o;
  }
  // First occurrence whose (O - 60 days) is strictly after lastDone: done up to 60 days early counts.
  for (let y = yearOf(task.lastDone); ; y++) {
    const o = isoYMD(y, month, day);
    if (addDays(o, -60) > task.lastDone) return o;
  }
}

/**
 * { dueDate, daysUntil, milesLeft, basis }  basis: "date" | "miles" | "start" | "never".
 * `state` is only needed for mileage tasks (vehicle odometer); may be undefined.
 */
export function dueInfo(task, state, today) {
  parseISO(today);
  const kind = task.kind || "interval";
  const out = (dueDate, milesLeft, basis) => ({
    dueDate,
    daysUntil: dueDate == null ? null : daysBetween(today, dueDate),
    milesLeft,
    basis,
  });

  if (kind === "annual") return out(annualDue(task, today), null, "date");

  if (kind === "mileage") {
    const v = vehicleOf(task, state);
    const cap = task.lastDone != null && task.intervalDays ? addDays(task.lastDone, task.intervalDays) : null;
    const haveOdo = v && task.lastDoneOdometer != null && task.intervalMiles != null;
    if (!haveOdo) {
      if (cap) return out(cap, null, "date");
      return out(task.startDate ?? today, null, "start");
    }
    const milesLeft = task.lastDoneOdometer + task.intervalMiles - v.odometer;
    let est, basis = "miles";
    if (milesLeft <= 0) est = today;
    else {
      const { rate } = estimateMilesPerDay(v, today);
      const days = Math.min(MAX_INTERVAL_DAYS, Math.ceil(milesLeft / rate));
      est = addDays(today, days);
    }
    let due = est;
    if (cap && cap < due) { due = cap; basis = "date"; }
    return out(due, milesLeft, basis);
  }

  // interval
  if (task.lastDone != null) return out(addDays(task.lastDone, task.intervalDays), null, "date");
  if (task.startDate != null) return out(task.startDate, null, "start");
  return out(today, null, "never");
}

export function nextDue(task, today, state) {
  const info = dueInfo(task, state, today);
  return info.dueDate ?? today;
}

export function daysUntilDue(task, today, state) {
  const info = dueInfo(task, state, today);
  return info.daysUntil ?? 0;
}

export function statusOf(task, today, state) {
  parseISO(today);
  if (task.snoozedUntil != null && task.snoozedUntil > today) return "snoozed";
  const kind = task.kind || "interval";
  const info = dueInfo(task, state, today);
  const days = info.daysUntil ?? 0;
  if (days < 0 || (info.milesLeft != null && info.milesLeft < 0)) return "overdue";
  if (kind === "annual") return days <= 30 ? "due-soon" : "ok";
  if (kind === "mileage") {
    const milesSoon = info.milesLeft != null && info.milesLeft <= Math.max(200, 0.1 * (task.intervalMiles || 0));
    return days <= 14 || milesSoon ? "due-soon" : "ok";
  }
  const threshold = Math.min(14, Math.max(7, task.intervalDays * 0.1));
  return days <= threshold ? "due-soon" : "ok";
}

// ---------- validation helpers ----------

function str(v, label, max, { required = false } = {}) {
  if (v == null) v = "";
  if (typeof v !== "string") throw new Error(`${label} must be a string`);
  const s = v.trim();
  if (required && s === "") throw new Error(`${label} is required`);
  if (s.length > max) throw new Error(`${label} must be at most ${max} characters`);
  return s;
}

function notesOf(v) {
  if (v == null) return "";
  if (typeof v !== "string") throw new Error("Notes must be a string");
  if (v.length > LIMITS.notes) throw new Error(`Notes must be at most ${LIMITS.notes} characters`);
  return v;
}

function validateTitle(title) {
  if (typeof title !== "string" || title.trim() === "") throw new Error("Task title is required");
  const t = title.trim();
  if (t.length > LIMITS.title) throw new Error(`Task title must be at most ${LIMITS.title} characters`);
  return t;
}

function validateCategory(category) {
  if (!CATEGORIES.includes(category)) {
    throw new Error(`Invalid category "${category}": must be one of ${CATEGORIES.join(", ")}`);
  }
  return category;
}

function intIn(v, label, min, max) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}`);
  }
  return n;
}

function validateInterval(v) {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n) || n <= 0 || n > MAX_INTERVAL_DAYS) {
    throw new Error(`Interval must be a whole number of days from 1 to ${MAX_INTERVAL_DAYS}`);
  }
  return n;
}

function optDate(v, label) {
  if (v == null || v === "") return null;
  if (!isValidISO(v)) throw new Error(`${label} must be a valid YYYY-MM-DD date`);
  return v;
}

function validateLinks(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error("Links must be a list");
  if (v.length > LIMITS.links) throw new Error(`At most ${LIMITS.links} links per task`);
  return v.map((l, i) => {
    if (!l || typeof l !== "object") throw new Error(`Link ${i + 1} must be an object`);
    const url = typeof l.url === "string" ? l.url.trim() : "";
    let ok = false;
    try { const u = new URL(url); ok = u.protocol === "http:" || u.protocol === "https:"; } catch { /* invalid */ }
    if (!ok) throw new Error(`Link ${i + 1}: URL must start with http:// or https://`);
    return { label: str(l.label, `Link ${i + 1} label`, LIMITS.label), url };
  });
}

function validateTags(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error("Tags must be a list");
  if (v.length > LIMITS.tags) throw new Error(`At most ${LIMITS.tags} tags`);
  return v.map((x) => str(x, "Tag", LIMITS.tag, { required: true }));
}

function validatePhotoIds(v) {
  if (v == null) return [];
  if (!Array.isArray(v)) throw new Error("photoIds must be a list");
  if (v.length > LIMITS.photos) throw new Error(`At most ${LIMITS.photos} photos`);
  v.forEach((p) => { if (typeof p !== "string" || p === "") throw new Error("photoIds must be non-empty strings"); });
  return [...v];
}

function validateCost(v) {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) throw new Error("Cost must be a number of 0 or more");
  return n;
}

function validateOdometerValue(v, label = "Odometer") {
  return intIn(v, label, 0, MAX_ODOMETER);
}

// Build a complete, clean task from raw fields. Irrelevant kind-specific fields are nulled.
function normalizeTask(raw, state) {
  const kind = raw.kind == null ? "interval" : raw.kind;
  if (!TASK_KINDS.includes(kind)) throw new Error(`Invalid kind "${kind}": must be one of ${TASK_KINDS.join(", ")}`);
  const task = {
    id: String(raw.id),
    title: validateTitle(raw.title),
    category: validateCategory(raw.category),
    kind,
    intervalDays: null, month: null, day: null,
    intervalMiles: null, lastDoneOdometer: null,
    lastDone: optDate(raw.lastDone, "Last done"),
    startDate: optDate(raw.startDate, "Start date"),
    snoozedUntil: optDate(raw.snoozedUntil, "Snoozed until"),
    vehicleId: raw.vehicleId == null || raw.vehicleId === "" ? null : String(raw.vehicleId),
    itemId: raw.itemId == null || raw.itemId === "" ? null : String(raw.itemId),
    assignee: raw.assignee == null || raw.assignee === "" ? null : str(raw.assignee, "Assignee", LIMITS.assignee),
    links: validateLinks(raw.links),
    tags: validateTags(raw.tags),
    notes: notesOf(raw.notes),
    custom: raw.custom === undefined ? true : !!raw.custom,
  };
  if (kind === "interval") {
    task.intervalDays = validateInterval(raw.intervalDays);
  } else if (kind === "annual") {
    task.month = intIn(raw.month, "Month", 1, 12);
    task.day = intIn(raw.day, "Day", 1, 28);
  } else {
    task.intervalMiles = intIn(raw.intervalMiles, "Mileage interval", 1, MAX_INTERVAL_MILES);
    task.intervalDays = raw.intervalDays == null || raw.intervalDays === "" ? null : validateInterval(raw.intervalDays);
    if (task.vehicleId == null) throw new Error("Mileage tasks need a vehicle");
    if (!(state.vehicles || []).some((v) => v.id === task.vehicleId)) throw new Error(`Vehicle not found: ${task.vehicleId}`);
    task.lastDoneOdometer = raw.lastDoneOdometer == null || raw.lastDoneOdometer === "" ? null : validateOdometerValue(raw.lastDoneOdometer, "Last done odometer");
  }
  if (task.vehicleId != null && !(state.vehicles || []).some((v) => v.id === task.vehicleId)) {
    throw new Error(`Vehicle not found: ${task.vehicleId}`);
  }
  if (task.itemId != null && !(state.items || []).some((i) => i.id === task.itemId)) {
    throw new Error(`Item not found: ${task.itemId}`);
  }
  return task;
}

function findIndex(state, id) {
  const i = state.tasks.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`Task not found: ${id}`);
  return i;
}

const mapAt = (arr, i, f) => arr.map((x, j) => (j === i ? f(x) : x));

// ---------- task CRUD ----------

export function addTask(state, partial, idFn) {
  if (typeof idFn !== "function") throw new Error("addTask requires an id generator function");
  if (!partial || typeof partial !== "object") throw new Error("Task details are required");
  const task = normalizeTask({ ...partial, id: idFn() }, state);
  if (state.tasks.some((t) => t.id === task.id)) throw new Error(`Duplicate task id: ${task.id}`);
  return { ...state, tasks: [...state.tasks, task] };
}

export function updateTask(state, id, patch) {
  const i = findIndex(state, id);
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const merged = { ...state.tasks[i], ...patch, id };
  const next = normalizeTask(merged, state);
  next.custom = state.tasks[i].custom === undefined ? next.custom : !!state.tasks[i].custom;
  if ("custom" in patch) next.custom = !!patch.custom;
  return { ...state, tasks: mapAt(state.tasks, i, () => next) };
}

/** Removes the task; its completions are KEPT (history survives). */
export function deleteTask(state, id) {
  findIndex(state, id);
  return { ...state, tasks: state.tasks.filter((t) => t.id !== id) };
}

export function assignTask(state, taskId, userIdOrNull) {
  const i = findIndex(state, taskId);
  const a = userIdOrNull == null || userIdOrNull === "" ? null : str(userIdOrNull, "Assignee", LIMITS.assignee, { required: true });
  return { ...state, tasks: mapAt(state.tasks, i, (t) => ({ ...t, assignee: a })) };
}

export function snoozeTask(state, taskId, untilISO, today) {
  parseISO(today);
  const i = findIndex(state, taskId);
  parseISO(untilISO);
  if (untilISO <= today) throw new Error("Snooze date must be after today");
  if (untilISO > addDays(today, 365)) throw new Error("Snooze date can be at most one year out");
  return { ...state, tasks: mapAt(state.tasks, i, (t) => ({ ...t, snoozedUntil: untilISO })) };
}

export function unsnoozeTask(state, taskId) {
  const i = findIndex(state, taskId);
  return { ...state, tasks: mapAt(state.tasks, i, (t) => ({ ...t, snoozedUntil: null })) };
}

// ---------- completing ----------

function nextCompletionId(state, today, taskId, idFn) {
  if (typeof idFn === "function") return String(idFn());
  const used = new Set((state.completions || []).map((c) => c.id));
  let n = (state.completions || []).length + 1;
  let id;
  do { id = `c-${today}-${n++}`; } while (used.has(id));
  return id;
}

function complete(state, taskId, today, kind, opts) {
  parseISO(today);
  const i = findIndex(state, taskId);
  const task = state.tasks[i];
  const o = opts || {};
  const done = kind === "done";
  const cost = done ? validateCost(o.cost) : null;
  const notes = done ? notesOf(o.notes) : "";
  const by = o.by == null || o.by === "" ? null : str(o.by, "By", LIMITS.assignee);
  const photoIds = done ? validatePhotoIds(o.photoIds) : [];
  let odoOpt = done && o.odometer != null && o.odometer !== "" ? validateOdometerValue(o.odometer) : null;

  let next = state;
  let patch = { lastDone: today, snoozedUntil: null };
  let completionOdo = odoOpt;
  if ((task.kind || "interval") === "mileage") {
    const v = (state.vehicles || []).find((x) => x.id === task.vehicleId);
    if (!v) throw new Error(`Vehicle not found: ${task.vehicleId}`);
    if (odoOpt != null && odoOpt > v.odometer) next = setOdometer(next, v.id, odoOpt, today);
    const reading = odoOpt ?? v.odometer;
    patch.lastDoneOdometer = reading;
    if (done) completionOdo = reading;
  }
  const completion = {
    id: nextCompletionId(state, today, taskId, o.idFn),
    taskId,
    title: task.title,
    category: task.category,
    date: today,
    kind,
    cost,
    notes,
    odometer: completionOdo,
    by,
    photoIds,
  };
  return {
    ...next,
    tasks: mapAt(next.tasks, i, (t) => ({ ...t, ...patch })),
    completions: [...(next.completions || []), completion],
  };
}

/** opts: { cost, notes, odometer, by, photoIds, idFn? } */
export function markDone(state, taskId, today, opts = {}) {
  return complete(state, taskId, today, "done", opts);
}

/** Advances the schedule without counting toward spend. */
export function skipTask(state, taskId, today, by) {
  return complete(state, taskId, today, "skipped", { by });
}

// ---------- vehicles ----------

function findVehicle(state, id) {
  const i = (state.vehicles || []).findIndex((v) => v.id === id);
  if (i < 0) throw new Error(`Vehicle not found: ${id}`);
  return i;
}

export function addVehicle(state, { name, odometer } = {}, idFn, today) {
  if (typeof idFn !== "function") throw new Error("addVehicle requires an id generator function");
  parseISO(today);
  const v = {
    id: String(idFn()),
    name: str(name, "Vehicle name", LIMITS.vehicleName, { required: true }),
    odometer: validateOdometerValue(odometer ?? 0),
    odometerDate: today,
    odometerLog: [],
  };
  v.odometerLog = [{ date: today, odometer: v.odometer }];
  const vehicles = state.vehicles || [];
  if (vehicles.some((x) => x.id === v.id)) throw new Error(`Duplicate vehicle id: ${v.id}`);
  return { ...state, vehicles: [...vehicles, v] };
}

/** Patch name, or odometer (a CORRECTION: trims log entries above the new value). Use setOdometer for normal updates. */
export function updateVehicle(state, id, patch) {
  const i = findVehicle(state, id);
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const cur = state.vehicles[i];
  const next = { ...cur };
  let tasks = state.tasks;
  if ("name" in patch) {
    next.name = str(patch.name, "Vehicle name", LIMITS.vehicleName, { required: true });
    if (next.name !== cur.name) {
      const oldSuffix = ` — ${cur.name}`, newSuffix = ` — ${next.name}`;
      tasks = state.tasks.map((t) => {
        if (t.vehicleId !== id || !t.title.endsWith(oldSuffix)) return t;
        let head = t.title.slice(0, t.title.length - oldSuffix.length);
        const room = LIMITS.title - newSuffix.length;
        if (head.length > room) head = head.slice(0, Math.max(0, room - 1)).trimEnd() + "…";
        return { ...t, title: head + newSuffix };
      });
    }
  }
  if ("odometer" in patch) {
    next.odometer = validateOdometerValue(patch.odometer);
    let log = (cur.odometerLog || []).filter((e) => e.odometer <= next.odometer);
    if (log.length === 0 || log[log.length - 1].odometer !== next.odometer) {
      const date = log.length ? log[log.length - 1].date : cur.odometerDate;
      if (log.length && log[log.length - 1].date === cur.odometerDate) log = log.slice(0, -1);
      log = [...log, { date: cur.odometerDate, odometer: next.odometer }];
    }
    next.odometerLog = log.slice(-MAX_ODOMETER_LOG);
  }
  return { ...state, tasks, vehicles: mapAt(state.vehicles, i, () => next) };
}

/** Deletes the vehicle and its tasks; their completions are kept. */
export function deleteVehicle(state, id) {
  findVehicle(state, id);
  return {
    ...state,
    vehicles: state.vehicles.filter((v) => v.id !== id),
    tasks: state.tasks.filter((t) => t.vehicleId !== id),
  };
}

export function setOdometer(state, vehicleId, miles, today) {
  parseISO(today);
  const i = findVehicle(state, vehicleId);
  const v = state.vehicles[i];
  const m = validateOdometerValue(miles);
  if (m < v.odometer) throw new Error(`Odometer can't go backwards: current reading is ${v.odometer}`);
  const log = [...(v.odometerLog || [])];
  const last = log[log.length - 1];
  const date = last && last.date > today ? last.date : today; // keep log ascending even if the clock moved back
  if (last && last.date === date) log[log.length - 1] = { date, odometer: m };
  else log.push({ date, odometer: m });
  const nextV = { ...v, odometer: m, odometerDate: date, odometerLog: log.slice(-MAX_ODOMETER_LOG) };
  return { ...state, vehicles: mapAt(state.vehicles, i, () => nextV) };
}

// ---------- items ----------

function normalizeItem(raw) {
  if (!ITEM_KINDS.includes(raw.kind)) throw new Error(`Invalid item kind "${raw.kind}": must be one of ${ITEM_KINDS.join(", ")}`);
  return {
    id: String(raw.id),
    name: str(raw.name, "Item name", LIMITS.name, { required: true }),
    kind: raw.kind,
    location: str(raw.location, "Location", LIMITS.text),
    model: str(raw.model, "Model", LIMITS.text),
    filterSize: str(raw.filterSize, "Filter size", LIMITS.text),
    purchaseDate: optDate(raw.purchaseDate, "Purchase date"),
    warrantyExpires: optDate(raw.warrantyExpires, "Warranty expiry"),
    notes: notesOf(raw.notes),
    photoIds: validatePhotoIds(raw.photoIds),
  };
}

export function addItem(state, partial, idFn) {
  if (typeof idFn !== "function") throw new Error("addItem requires an id generator function");
  if (!partial || typeof partial !== "object") throw new Error("Item details are required");
  const item = normalizeItem({ kind: "other", ...partial, id: idFn() });
  const items = state.items || [];
  if (items.some((x) => x.id === item.id)) throw new Error(`Duplicate item id: ${item.id}`);
  return { ...state, items: [...items, item] };
}

export function updateItem(state, id, patch) {
  const i = (state.items || []).findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`Item not found: ${id}`);
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const next = normalizeItem({ ...state.items[i], ...patch, id });
  return { ...state, items: mapAt(state.items, i, () => next) };
}

/** Deletes the item and unlinks it from tasks (task.itemId = null). */
export function deleteItem(state, id) {
  if (!(state.items || []).some((x) => x.id === id)) throw new Error(`Item not found: ${id}`);
  return {
    ...state,
    items: state.items.filter((x) => x.id !== id),
    tasks: state.tasks.map((t) => (t.itemId === id ? { ...t, itemId: null } : t)),
    ...(state.vendors ? { vendors: state.vendors.map((v) => (v.itemIds || []).includes(id) ? { ...v, itemIds: v.itemIds.filter((x) => x !== id) } : v) } : {}),
  };
}

// ---------- supplies ----------

function normalizeSupply(raw) {
  if (!SUPPLY_CATEGORIES.includes(raw.category)) {
    throw new Error(`Invalid supply category "${raw.category}": must be one of ${SUPPLY_CATEGORIES.join(", ")}`);
  }
  const q = typeof raw.quantity === "string" && raw.quantity.trim() !== "" ? Number(raw.quantity) : raw.quantity;
  if (typeof q !== "number" || !Number.isFinite(q) || q < 0) throw new Error("Quantity must be a number of 0 or more");
  const key = raw.key == null || raw.key === "" ? null : str(raw.key, "Key", LIMITS.key);
  return {
    id: String(raw.id),
    name: str(raw.name, "Supply name", LIMITS.name, { required: true }),
    key,
    category: raw.category,
    quantity: q,
    unit: str(raw.unit, "Unit", LIMITS.unit),
    expires: optDate(raw.expires, "Expiry date"),
    notes: notesOf(raw.notes),
  };
}

export function addSupply(state, partial, idFn) {
  if (typeof idFn !== "function") throw new Error("addSupply requires an id generator function");
  if (!partial || typeof partial !== "object") throw new Error("Supply details are required");
  const s = normalizeSupply({ category: "other", quantity: 0, ...partial, id: idFn() });
  const supplies = state.supplies || [];
  if (supplies.some((x) => x.id === s.id)) throw new Error(`Duplicate supply id: ${s.id}`);
  return { ...state, supplies: [...supplies, s] };
}

export function updateSupply(state, id, patch) {
  const i = (state.supplies || []).findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`Supply not found: ${id}`);
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const next = normalizeSupply({ ...state.supplies[i], ...patch, id });
  return { ...state, supplies: mapAt(state.supplies, i, () => next) };
}

export function deleteSupply(state, id) {
  if (!(state.supplies || []).some((x) => x.id === id)) throw new Error(`Supply not found: ${id}`);
  return { ...state, supplies: state.supplies.filter((x) => x.id !== id) };
}


// ---------- vendors / contractors ----------

function normalizeVendor(raw) {
  const itemIds = raw.itemIds == null ? [] : raw.itemIds;
  if (!Array.isArray(itemIds) || itemIds.length > 50 || itemIds.some((x) => typeof x !== "string" || x === "")) throw new Error("Linked items must be a list of up to 50 item ids");
  const email = str(raw.email, "Email", LIMITS.text);
  if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("Email doesn't look right");
  return {
    id: String(raw.id),
    name: str(raw.name, "Vendor name", LIMITS.name, { required: true }),
    trade: str(raw.trade, "Trade", LIMITS.label),
    phone: str(raw.phone, "Phone", LIMITS.label),
    email,
    notes: notesOf(raw.notes),
    itemIds: [...new Set(itemIds)],
  };
}

export function addVendor(state, partial, idFn) {
  if (typeof idFn !== "function") throw new Error("addVendor requires an id generator function");
  if (!partial || typeof partial !== "object") throw new Error("Vendor details are required");
  const v = normalizeVendor({ ...partial, id: idFn() });
  const vendors = state.vendors || [];
  if (vendors.length >= 200) throw new Error("That's the maximum of 200 vendors");
  if (vendors.some((x) => x.id === v.id)) throw new Error(`Duplicate vendor id: ${v.id}`);
  return { ...state, vendors: [...vendors, v] };
}

export function updateVendor(state, id, patch) {
  const i = (state.vendors || []).findIndex((x) => x.id === id);
  if (i < 0) throw new Error(`Vendor not found: ${id}`);
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const next = normalizeVendor({ ...state.vendors[i], ...patch, id });
  return { ...state, vendors: mapAt(state.vendors, i, () => next) };
}

export function deleteVendor(state, id) {
  if (!(state.vendors || []).some((x) => x.id === id)) throw new Error(`Vendor not found: ${id}`);
  return { ...state, vendors: state.vendors.filter((x) => x.id !== id) };
}

// ---------- profile / emergency ----------

export function updateProfile(state, patch) {
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const p = { ...(state.profile || {}) };
  const bool = (k) => {
    if (typeof patch[k] !== "boolean") throw new Error(`Profile ${k} must be true or false`);
    p[k] = patch[k];
  };
  if ("setupDone" in patch) bool("setupDone");
  if ("hasYard" in patch) bool("hasYard");
  if ("hasPool" in patch) bool("hasPool");
  if ("hasTrailer" in patch) bool("hasTrailer");
  if ("hasPets" in patch) bool("hasPets");
  if ("homeType" in patch) {
    if (!HOME_TYPES.includes(patch.homeType)) throw new Error(`Home type must be one of ${HOME_TYPES.join(", ")}`);
    p.homeType = patch.homeType;
  }
  if ("homeAge" in patch) {
    if (!HOME_AGE_TYPES.includes(patch.homeAge)) throw new Error("Home age must be new, mid or old");
    p.homeAge = patch.homeAge;
  }
  if ("climate" in patch) {
    if (!CLIMATE_TYPES.includes(patch.climate)) throw new Error(`Climate must be one of ${CLIMATE_TYPES.join(", ")}`);
    p.climate = patch.climate;
  }
  if ("householdSize" in patch) {
    const n = patch.householdSize;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 20) throw new Error("Household size must be a whole number from 1 to 20");
    p.householdSize = n;
  }
  return { ...state, profile: p };
}

export function updateEmergency(state, patch) {
  if (!patch || typeof patch !== "object") throw new Error("Patch must be an object");
  const e = { contacts: [], meetingPlace: "", outOfAreaContact: "", shutoffs: { water: "", gas: "", electric: "" }, notes: "", ...(state.emergency || {}) };
  const next = { ...e, shutoffs: { ...e.shutoffs } };
  if ("contacts" in patch) {
    if (!Array.isArray(patch.contacts)) throw new Error("Contacts must be a list");
    if (patch.contacts.length > LIMITS.contacts) throw new Error(`At most ${LIMITS.contacts} contacts`);
    next.contacts = patch.contacts.map((c, i) => {
      if (!c || typeof c !== "object") throw new Error(`Contact ${i + 1} must be an object`);
      return {
        name: str(c.name, `Contact ${i + 1} name`, LIMITS.text),
        phone: str(c.phone, `Contact ${i + 1} phone`, LIMITS.text),
        relation: str(c.relation, `Contact ${i + 1} relation`, LIMITS.text),
      };
    });
  }
  if ("meetingPlace" in patch) next.meetingPlace = str(patch.meetingPlace, "Meeting place", LIMITS.text);
  if ("outOfAreaContact" in patch) next.outOfAreaContact = str(patch.outOfAreaContact, "Out-of-area contact", LIMITS.text);
  if ("shutoffs" in patch) {
    if (!patch.shutoffs || typeof patch.shutoffs !== "object") throw new Error("Shutoffs must be an object");
    for (const k of ["water", "gas", "electric"]) {
      if (k in patch.shutoffs) next.shutoffs[k] = str(patch.shutoffs[k], `Shutoff (${k})`, LIMITS.text);
    }
  }
  if ("notes" in patch) next.notes = str(patch.notes, "Emergency notes", LIMITS.text);
  return { ...state, emergency: next };
}

// ---------- queries ----------

/** Completions, newest first. Filters: taskId, category, year, kind. */
export function historyFor(state, { taskId, category, year, kind } = {}) {
  const y = year == null || year === "" ? null : String(year).padStart(4, "0");
  return (state.completions || [])
    .map((c, idx) => ({ c, idx }))
    .filter(({ c }) =>
      (taskId == null || c.taskId === taskId) &&
      (category == null || c.category === category) &&
      (kind == null || c.kind === kind) &&
      (y == null || (typeof c.date === "string" && c.date.slice(0, 4) === y)))
    .sort((a, b) => (a.c.date < b.c.date ? 1 : a.c.date > b.c.date ? -1 : b.idx - a.idx))
    .map((x) => x.c);
}

/** Spend over "done" completions with a cost. byMonth has 12 slots (Jan..Dec); without `year` all years are summed per month. */
export function spend(state, year) {
  const y = year == null || year === "" ? null : String(year).padStart(4, "0");
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = 0;
  const byMonth = new Array(12).fill(0);
  let total = 0;
  for (const c of state.completions || []) {
    if (c.kind !== "done" || typeof c.cost !== "number" || !Number.isFinite(c.cost)) continue;
    if (y != null && String(c.date).slice(0, 4) !== y) continue;
    total += c.cost;
    if (c.category in byCategory) byCategory[c.category] += c.cost;
    const m = +String(c.date).slice(5, 7) - 1;
    if (m >= 0 && m < 12) byMonth[m] += c.cost;
  }
  const r = (n) => Math.round(n * 100) / 100;
  for (const k of Object.keys(byCategory)) byCategory[k] = r(byCategory[k]);
  return { total: r(total), byCategory, byMonth: byMonth.map(r) };
}

export function sortTasks(tasks, today, state) {
  const rank = { overdue: 0, "due-soon": 1, ok: 1, snoozed: 2 };
  return tasks
    .map((t) => ({ t, d: daysUntilDue(t, today, state), r: rank[statusOf(t, today, state)] }))
    .sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      if (a.d !== b.d) return a.d - b.d;
      return a.t.title.localeCompare(b.t.title);
    })
    .map((x) => x.t);
}

export function searchTasks(state, query, today) {
  const terms = typeof query === "string" ? query.toLowerCase().split(/\s+/).filter(Boolean) : [];
  if (terms.length === 0) return sortTasks(state.tasks, today, state);
  const matches = state.tasks.filter((t) => {
    const item = t.itemId ? (state.items || []).find((i) => i.id === t.itemId) : null;
    const veh = vehicleOf(t, state);
    const hay = [
      t.title, t.notes, ...(t.tags || []), ...(t.links || []).map((l) => l.label),
      item && item.name, item && item.model, veh && veh.name,
    ].filter(Boolean).join("\n").toLowerCase();
    return terms.every((w) => hay.includes(w));
  });
  return sortTasks(matches, today, state);
}

/** Items whose warranty ends within `withinDays` (or ended within the last 30 days). Ascending by daysLeft. */
export function warrantyAlerts(state, today, withinDays = 60) {
  parseISO(today);
  return (state.items || [])
    .filter((it) => it.warrantyExpires)
    .map((item) => ({ item, daysLeft: daysBetween(today, item.warrantyExpires) }))
    .filter((x) => x.daysLeft <= withinDays && x.daysLeft >= -30)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name));
}

const KEY = { overdue: "overdue", "due-soon": "dueSoon", ok: "ok" };

export function summary(state, today) {
  const out = { overdue: 0, dueSoon: 0, ok: 0, snoozed: 0, byCategory: {} };
  for (const c of CATEGORIES) out.byCategory[c] = { overdue: 0, dueSoon: 0, ok: 0 };
  for (const t of state.tasks) {
    const st = statusOf(t, today, state);
    if (st === "snoozed") { out.snoozed++; continue; }
    const k = KEY[st];
    out[k]++;
    if (out.byCategory[t.category]) out.byCategory[t.category][k]++;
  }
  return out;
}
