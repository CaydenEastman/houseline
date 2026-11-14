import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarCSV, csvFilename } from '../src/ics.js';
import { addDays } from '../src/logic.js';
import { T, mkState, mkTask, mkVehicle, mkItem, mkSupply } from './helpers.mjs';

function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
    i++;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const HEADER = ['Subject', 'Start Date', 'Start Time', 'End Date', 'End Time', 'All Day Event', 'Description', 'Location', 'Private'];
const us = (iso) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`;
const csv = (state, opts) => parseCSV(buildCalendarCSV(state, T, opts));
const body = (state, opts) => csv(state, opts).slice(1);

test('header row exact; every row has 9 cells', () => {
  const rows = csv(mkState({ tasks: [mkTask({ lastDone: T, intervalDays: 30 })] }));
  assert.deepEqual(rows[0], HEADER);
  for (const r of rows) assert.equal(r.length, 9, JSON.stringify(r));
});
test('empty state: header only', () => assert.deepEqual(csv(mkState()), [HEADER]));
test('deterministic', () => {
  const st = mkState({ tasks: [mkTask({ lastDone: T })] });
  assert.equal(buildCalendarCSV(st, T), buildCalendarCSV(st, T));
});
test('rows: MM/DD/YYYY, all-day, same start/end date, subject has title', () => {
  const [r] = body(mkState({ tasks: [mkTask({ title: 'Filter', kind: 'annual', intervalDays: null, month: 10, day: 15 })] }), { horizonDays: 200 });
  assert.equal(r[0].includes('Filter'), true); assert.equal(r[1], '10/15/2026'); assert.equal(r[3], '10/15/2026');
  assert.equal(r[2], ''); assert.equal(r[4], ''); assert.match(r[5], /^true$/i);
});
test('interval repeats until horizon, capped by maxOccurrencesPerTask (default 26)', () => {
  const mk = (n) => mkState({ tasks: [mkTask({ lastDone: T, intervalDays: n })] });
  assert.equal(body(mk(7)).length, 26);
  assert.equal(body(mk(7), { maxOccurrencesPerTask: 3 }).length, 3);
  assert.equal(body(mk(30)).length, 13); // 30..390 within 400
  assert.equal(body(mk(200)).length, 2);
  assert.equal(body(mk(500)).length, 0);
  const dates = body(mk(30)).map((r) => r[1]);
  assert.equal(dates[0], us(addDays(T, 30))); assert.equal(dates[1], us(addDays(T, 60)));
});
test('annual: occurrences within horizon', () => {
  const st = mkState({ tasks: [mkTask({ kind: 'annual', intervalDays: null, month: 1, day: 5 })] });
  const r = body(st, { horizonDays: 800 });
  assert.deepEqual(r.map((x) => x[1]), ['01/05/2027', '01/05/2028']);
});
test('mileage: single "(estimated)" row', () => {
  const st = mkState({ vehicles: [mkVehicle()], tasks: [mkTask({ kind: 'mileage', title: 'Oil', intervalDays: null, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 47000 })] });
  const r = body(st); assert.equal(r.length, 1); assert.ok(r[0][0].includes('(estimated)'));
});
test('supplies and warranties with include flags', () => {
  const st = mkState({ supplies: [mkSupply({ name: 'Jugs', expires: addDays(T, 100) })], items: [mkItem({ name: 'Furnace', warrantyExpires: addDays(T, 120) })] });
  assert.equal(body(st).length, 2);
  assert.equal(body(st, { includeSupplies: false }).length, 1);
  assert.equal(body(st, { includeWarranties: false }).length, 1);
  assert.equal(body(st, { includeSupplies: false, includeWarranties: false }).length, 0);
  assert.ok(body(st).some((r) => r[0].includes('Warranty ends: Furnace')));
});
test('CSV quoting: commas, quotes, newlines round-trip', () => {
  const t = mkTask({ title: 'He said "hi", ok', notes: 'line1\nline2, x', lastDone: T, intervalDays: 100 });
  const text = buildCalendarCSV(mkState({ tasks: [t] }), T);
  const rows = parseCSV(text);
  assert.equal(rows.length, 1 + 4); // 100,200,300,400 within horizon
  assert.ok(rows[1][0].includes('He said "hi", ok'));
  assert.ok(rows[1][6].includes('line1\nline2, x'));
  assert.ok(text.includes('"He said ""hi"", ok'));
});
test('formula injection guard: leading = + - @ get a single quote prefix', () => {
  for (const ch of ['=', '+', '-', '@']) {
    const t = mkTask({ title: `${ch}HYPERLINK("http://evil","x")`, notes: `${ch}cmd`, lastDone: T, intervalDays: 300 });
    const [r] = body(mkState({ tasks: [t] }));
    assert.ok(r[0].startsWith("'" + ch), `${ch}: ${r[0]}`);
    assert.ok(!/^[=+\-@]/.test(r[0]) && !/^[=+\-@]/.test(r[6] || 'x'));
  }
  const [r] = body(mkState({ tasks: [mkTask({ title: 'Normal', lastDone: T, intervalDays: 300 })] }));
  assert.ok(!r[0].startsWith("'"));
});
test('formula guard applies to supplies, warranties, and description/location cells', () => {
  const st = mkState({ supplies: [mkSupply({ name: '=1+1', expires: addDays(T, 10), notes: '@x' })], items: [mkItem({ name: '+SUM(A1)', warrantyExpires: addDays(T, 10) })] });
  for (const r of body(st)) for (const c of r) assert.ok(!/^[=+\-@]/.test(c), c);
});
test('subject with leading tab/CR also not interpreted (tab guard best-effort)', () => {
  const t = mkTask({ title: '\t=cmd', lastDone: T, intervalDays: 300 });
  const [r] = body(mkState({ tasks: [t] }));
  assert.ok(!/^[=+\-@]/.test(r[0]));
});
test('<script> text is inert (csv is plain text)', () => {
  const [r] = body(mkState({ tasks: [mkTask({ title: '<script>alert(1)</script>', lastDone: T, intervalDays: 300 })] }));
  assert.ok(r[0].includes('<script>'));
});
test('csvFilename', () => {
  const f = csvFilename('2026-06-15'); assert.match(f, /\.csv$/); assert.ok(f.includes('2026-06-15'));
});
