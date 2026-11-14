import test from 'node:test';
import assert from 'node:assert/strict';
import { buildICS, icsFilename } from '../src/ics.js';
import { addDays } from '../src/logic.js';
import { T, mkState, mkTask, mkVehicle, mkItem, mkSupply } from './helpers.mjs';

const unfold = (s) => s.replace(/\r\n[ \t]/g, '');
const lines = (s) => unfold(s).split('\r\n');
const events = (s) => {
  const out = []; let cur = null;
  for (const l of lines(s)) {
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') { out.push(cur); cur = null; }
    else if (cur) cur.push(l);
  }
  return out;
};
const prop = (ev, name) => ev.find((l) => l === name || l.startsWith(name + ':') || l.startsWith(name + ';'));
const val = (ev, name) => { const l = prop(ev, name); return l ? l.slice(l.indexOf(':') + 1) : undefined; };
const ymd = (iso) => iso.replace(/-/g, '');
const one = (task, state = mkState(), opts) => events(buildICS({ ...state, tasks: [task] }, T, opts));

test('calendar skeleton: CRLF only, VERSION, PRODID, BEGIN/END, balanced events', () => {
  const s = buildICS(mkState({ tasks: [mkTask({ lastDone: T })] }), T);
  assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n')); assert.ok(s.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/(?<!\r)\n/.test(s), 'bare LF found'); assert.ok(!/\r(?!\n)/.test(s), 'bare CR');
  assert.ok(lines(s).includes('VERSION:2.0')); assert.ok(lines(s).some((l) => l.startsWith('PRODID:')));
  assert.equal((s.match(/BEGIN:VEVENT/g) || []).length, (s.match(/END:VEVENT/g) || []).length);
});
test('default and custom calendar name', () => {
  assert.ok(lines(buildICS(mkState(), T)).includes('X-WR-CALNAME:Man of the House'));
  assert.ok(lines(buildICS(mkState(), T, { calName: 'Our, Home; 1' })).some((l) => l.startsWith('X-WR-CALNAME:') && l.includes('Our\\, Home\\; 1')));
});
test('empty state yields a valid empty calendar', () => {
  const s = buildICS(mkState(), T); assert.equal(events(s).length, 0); assert.ok(s.endsWith('END:VCALENDAR\r\n'));
});
test('deterministic (pure; no clock reads)', () => {
  const st = mkState({ tasks: [mkTask({ lastDone: '2026-06-01' })] });
  assert.equal(buildICS(st, T), buildICS(st, T));
});
test('interval task: DTSTART all-day at due date, RRULE DAILY;INTERVAL, UID, DTSTAMP, VALARM -P1D', () => {
  const [ev] = one(mkTask({ id: 'abc', title: 'Filter', lastDone: '2026-06-01', intervalDays: 30 }));
  assert.equal(prop(ev, 'DTSTART;VALUE=DATE'), `DTSTART;VALUE=DATE:${ymd('2026-07-01')}`);
  assert.equal(val(ev, 'RRULE'), 'FREQ=DAILY;INTERVAL=30');
  assert.equal(val(ev, 'UID'), 'abc@man-of-the-house');
  assert.match(val(ev, 'DTSTAMP'), /^\d{8}T\d{6}Z$/);
  assert.equal(val(ev, 'SUMMARY').includes('Filter'), true);
  assert.ok(ev.includes('BEGIN:VALARM') && ev.includes('END:VALARM'));
  assert.equal(val(ev, 'TRIGGER'), '-P1D'); assert.equal(val(ev, 'ACTION'), 'DISPLAY');
  assert.ok(val(ev, 'DESCRIPTION') !== undefined || ev.some((l) => l.startsWith('DESCRIPTION')));
});
test('UID stable across runs and distinct per task', () => {
  const st = mkState({ tasks: [mkTask({ id: 'a', lastDone: T }), mkTask({ id: 'b', lastDone: T })] });
  const u1 = events(buildICS(st, T)).map((e) => val(e, 'UID')), u2 = events(buildICS(st, addDays(T, 3))).map((e) => val(e, 'UID'));
  assert.deepEqual(u1, u2); assert.equal(new Set(u1).size, 2);
});
test('annual: RRULE FREQ=YEARLY at next occurrence', () => {
  const [ev] = one(mkTask({ kind: 'annual', intervalDays: null, month: 10, day: 15 }));
  assert.equal(val(ev, 'RRULE'), 'FREQ=YEARLY'); assert.equal(prop(ev, 'DTSTART;VALUE=DATE'), 'DTSTART;VALUE=DATE:20261015');
});
test('mileage: single non-repeating event with "(estimated)"', () => {
  const st = mkState({ vehicles: [mkVehicle()] });
  const [ev] = one(mkTask({ kind: 'mileage', title: 'Oil', intervalDays: null, intervalMiles: 5000, vehicleId: 'v1', lastDoneOdometer: 47000 }), st);
  assert.equal(prop(ev, 'RRULE'), undefined); assert.ok(val(ev, 'SUMMARY').includes('(estimated)'));
  assert.equal(prop(ev, 'DTSTART;VALUE=DATE'), `DTSTART;VALUE=DATE:${ymd(addDays(T, 61))}`);
});
test('snoozed task starts at max(due, snoozedUntil)', () => {
  const [a] = one(mkTask({ lastDone: '2026-06-01', intervalDays: 30, snoozedUntil: '2026-08-01' }));
  assert.equal(prop(a, 'DTSTART;VALUE=DATE'), 'DTSTART;VALUE=DATE:20260801');
  const [b] = one(mkTask({ lastDone: '2026-06-01', intervalDays: 30, snoozedUntil: '2026-06-20' }));
  assert.equal(prop(b, 'DTSTART;VALUE=DATE'), 'DTSTART;VALUE=DATE:20260701');
});
test('overdue task is still emitted (starts at its due date or later)', () => {
  const evs = one(mkTask({ lastDone: '2025-01-01', intervalDays: 30 }));
  assert.equal(evs.length, 1);
});
test('horizon: tasks starting beyond it are skipped; default 400', () => {
  const far = mkTask({ lastDone: T, intervalDays: 500 });
  assert.equal(one(far).length, 0);
  assert.equal(one(far, mkState(), { horizonDays: 600 }).length, 1);
  assert.equal(one(mkTask({ lastDone: T, intervalDays: 399 })).length, 1);
  assert.equal(one(mkTask({ lastDone: T, intervalDays: 30 }), mkState(), { horizonDays: 10 }).length, 0);
});
test('supply expiry and warranty events with -P7D alarm', () => {
  const st = mkState({
    supplies: [mkSupply({ id: 'sA', name: 'Water jugs', expires: addDays(T, 100) }), mkSupply({ id: 'sB', name: 'Old', expires: null }), mkSupply({ id: 'sC', name: 'Far', expires: addDays(T, 900) })],
    items: [mkItem({ id: 'iA', name: 'Furnace', warrantyExpires: addDays(T, 200) }), mkItem({ id: 'iB', name: 'NoW', warrantyExpires: null })],
  });
  const evs = events(buildICS(st, T));
  assert.equal(evs.length, 2);
  const w = evs.find((e) => val(e, 'SUMMARY').startsWith('Warranty ends: Furnace'));
  assert.ok(w); assert.equal(val(w, 'TRIGGER'), '-P7D');
  assert.equal(prop(w, 'DTSTART;VALUE=DATE'), `DTSTART;VALUE=DATE:${ymd(addDays(T, 200))}`);
  assert.equal(prop(w, 'RRULE'), undefined);
  const sp = evs.find((e) => val(e, 'SUMMARY').includes('Water jugs'));
  assert.ok(sp); assert.equal(val(sp, 'TRIGGER'), '-P7D');
  const uids = evs.map((e) => val(e, 'UID')); assert.equal(new Set(uids).size, 2);
  assert.ok(uids.every((u) => u.endsWith('@man-of-the-house')));
});
test('supply/warranty respect horizon option', () => {
  const st = mkState({ items: [mkItem({ warrantyExpires: addDays(T, 200) })] });
  assert.equal(events(buildICS(st, T, { horizonDays: 100 })).length, 0);
});
test('TEXT escaping: backslash, semicolon, comma, newline in summary/description', () => {
  const [ev] = one(mkTask({ title: 'a,b;c\\d', notes: 'line1\nline2; x, y', lastDone: T, category: 'car' }));
  assert.ok(val(ev, 'SUMMARY').includes('a\\,b\\;c\\\\d'), val(ev, 'SUMMARY'));
  const d = val(ev, 'DESCRIPTION');
  assert.ok(d.includes('line1\\nline2\\; x\\, y'), d);
  assert.ok(/car/i.test(d), 'description includes category');
});
test('CRLF/CR inside user text cannot inject lines', () => {
  const t = mkTask({ title: 'x\r\nBEGIN:VEVENT\r\nSUMMARY:evil', notes: 'a\rb\r\nEND:VCALENDAR', lastDone: T });
  const s = buildICS(mkState({ tasks: [t] }), T);
  assert.equal(events(s).length, 1);
  assert.equal(lines(s).filter((l) => l === 'END:VCALENDAR').length, 1);
  assert.ok(!lines(s).some((l) => l === 'SUMMARY:evil'));
});
test('description includes links and notes', () => {
  const [ev] = one(mkTask({ lastDone: T, notes: 'my note', links: [{ label: 'Manual', url: 'https://example.com/m' }] }));
  const d = val(ev, 'DESCRIPTION');
  assert.ok(d.includes('my note')); assert.ok(d.includes('https://example.com/m'.replace(/[,;]/g, '\\$&')));
  assert.ok(d.includes('Manual'));
});
test('<script> payload passes through as inert text (ics is not html)', () => {
  const [ev] = one(mkTask({ title: '<script>alert(1)</script>', lastDone: T }));
  assert.ok(val(ev, 'SUMMARY').includes('<script>'));
});
test('folding: every physical line <= 75 octets; continuation starts with one space; round-trips', () => {
  const title = 'T'.repeat(300), notes = 'n'.repeat(1000) + ',;' + 'é'.repeat(100);
  const s = buildICS(mkState({ tasks: [mkTask({ title, notes, lastDone: T })] }), T);
  const phys = s.split('\r\n'); phys.pop();
  for (const l of phys) assert.ok(Buffer.byteLength(l, 'utf8') <= 75, `${Buffer.byteLength(l)}: ${l.slice(0, 20)}`);
  assert.ok(phys.some((l) => l.startsWith(' ')));
  const [ev] = events(s);
  assert.ok(val(ev, 'SUMMARY').includes(title));
  assert.ok(val(ev, 'DESCRIPTION').includes('n'.repeat(1000) + '\\,\\;' + 'é'.repeat(100)));
});
test('folding never splits a multi-byte UTF-8 character', () => {
  const dec = new TextDecoder('utf-8', { fatal: true });
  for (const ch of ['é', '€', '🔧', '漢']) {
    for (let pad = 0; pad < 5; pad++) {
      const title = 'x'.repeat(pad) + ch.repeat(60);
      const s = buildICS(mkState({ tasks: [mkTask({ title, lastDone: T })] }), T);
      for (const l of s.split('\r\n')) assert.doesNotThrow(() => dec.decode(Buffer.from(l, 'utf8')));
      const [ev] = events(s);
      assert.ok(val(ev, 'SUMMARY').includes(ch.repeat(60)), `${ch} pad ${pad}`);
      assert.ok(!val(ev, 'SUMMARY').includes('�'));
      for (const l of s.split('\r\n')) assert.ok(!l.includes('�'));
    }
  }
});
test('leap-day and DST dates format correctly', () => {
  const dt = (iso, n) => prop(events(buildICS(mkState({ tasks: [mkTask({ lastDone: iso, intervalDays: n })] }), iso))[0], 'DTSTART;VALUE=DATE');
  assert.equal(dt('2024-02-28', 1), 'DTSTART;VALUE=DATE:20240229');
  assert.equal(dt('2026-03-07', 2), 'DTSTART;VALUE=DATE:20260309');
  assert.equal(dt('2026-10-31', 2), 'DTSTART;VALUE=DATE:20261102');
});
test('many tasks (stress): 500 tasks build quickly and one VEVENT each', () => {
  const tasks = Array.from({ length: 500 }, (_, i) => mkTask({ id: 't' + i, title: 'Task ' + i, lastDone: T, intervalDays: 30 + (i % 300) }));
  const t0 = Date.now(); const s = buildICS(mkState({ tasks }), T);
  assert.ok(Date.now() - t0 < 3000); assert.equal(events(s).length, 500);
});
test('icsFilename', () => {
  assert.equal(icsFilename('2026-06-15'), 'man-of-the-house-2026-06-15.ics');
  assert.equal(icsFilename('2024-02-29'), 'man-of-the-house-2024-02-29.ics');
});
