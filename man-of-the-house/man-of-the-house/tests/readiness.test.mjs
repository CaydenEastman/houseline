import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUIREMENTS, readiness, emergencySheetHTML, emergencySheetText } from '../src/readiness.js';
import { SUPPLY_STARTERS } from '../src/templates.js';
import { addDays } from '../src/logic.js';
import { T, mkState, mkSupply, mkProfile, mkEmergency, deepFreeze } from './helpers.mjs';

const R = (o = {}, today = T) => readiness(deepFreeze(mkState(o)), today);
const sup = (key, q, o = {}) => mkSupply({ id: 's-' + key + (o.id || ''), name: key, key, quantity: q, ...o });
const item = (r, key) => r.items.find((i) => i.key === key);
const fillAll = (r0) => r0.items.map((i) => sup(i.key, i.needed));

test('REQUIREMENTS shape and unique keys; spec examples present', () => {
  assert.ok(Array.isArray(REQUIREMENTS) && REQUIREMENTS.length >= 10);
  const keys = REQUIREMENTS.map((r) => r.key); assert.equal(new Set(keys).size, keys.length);
  for (const r of REQUIREMENTS) {
    assert.ok(r.key && r.label && r.unit && r.category, JSON.stringify(r));
    assert.ok(['water', 'food', 'medical', 'power', 'tools', 'docs', 'other'].includes(r.category));
    assert.ok(r.perPersonPerDay != null || r.fixed != null || r.days != null, r.key);
  }
  for (const re of [/water/, /food/, /flash/, /batter/, /first/, /radio/, /power|charg/, /med/, /cash/, /doc/, /whistle/, /mask/, /blanket/]) assert.ok(keys.some((k) => re.test(k)), String(re));
  const w = REQUIREMENTS.find((r) => /water/.test(r.key));
  assert.equal(w.perPersonPerDay, 1); assert.equal(w.days, 3);
});
test('SUPPLY_STARTERS keys match REQUIREMENTS keys (or null)', () => {
  const keys = new Set(REQUIREMENTS.map((r) => r.key));
  for (const s of SUPPLY_STARTERS) assert.ok(s.key === null || keys.has(s.key), s.name + ' ' + s.key);
});
test('empty supplies: score 0, everything missing', () => {
  const r = R();
  assert.equal(r.score, 0); assert.deepEqual(r.expiring, []); assert.deepEqual(r.expired, []);
  assert.ok(r.items.length >= 10); assert.ok(r.items.every((i) => i.status === 'missing' && i.have === 0 && i.needed > 0 && !i.expiringSoon));
  for (const i of r.items) for (const k of ['key', 'label', 'unit']) assert.ok(i[k] !== undefined);
});
test('needed scales with household size; fixed ones do not', () => {
  const a = R({ profile: mkProfile({ householdSize: 2 }) }), b = R({ profile: mkProfile({ householdSize: 4 }) });
  const w = REQUIREMENTS.find((r) => /water/.test(r.key)).key;
  assert.equal(item(a, w).needed, 6); assert.equal(item(b, w).needed, 12);
  assert.equal(item(a, 'flashlights')?.needed ?? item(a, REQUIREMENTS.find((r) => /flash/.test(r.key)).key).needed, item(b, REQUIREMENTS.find((r) => /flash/.test(r.key)).key).needed);
  assert.equal(R({ profile: mkProfile({ householdSize: 20 }) }).items.find((i) => i.key === w).needed, 60);
  assert.equal(R({ profile: mkProfile({ householdSize: 1 }) }).items.find((i) => i.key === w).needed, 3);
});
test('full coverage -> score 100, all ok', () => {
  const r0 = R(); const r = R({ supplies: fillAll(r0) });
  assert.equal(r.score, 100); assert.ok(r.items.every((i) => i.status === 'ok'));
});
test('over-supply is capped (cannot raise score above 100 or mask other gaps)', () => {
  const r0 = R();
  const r = R({ supplies: [sup(r0.items[0].key, 1e9)] });
  assert.ok(r.score > 0 && r.score <= 100);
  assert.equal(r.score, Math.round((1 / r0.items.length) * 100));
  assert.equal(R({ supplies: [sup(r0.items[0].key, Number.MAX_VALUE)] }).score, r.score);
});
test('status ok/low/missing and have sums across supplies', () => {
  const key = REQUIREMENTS.find((r) => /water/.test(r.key)).key; // needed 6 for size 2
  const r = R({ supplies: [sup(key, 2, { id: 'a' }), sup(key, 3, { id: 'b' })] });
  assert.equal(item(r, key).have, 5); assert.equal(item(r, key).status, 'low');
  assert.equal(item(R({ supplies: [sup(key, 6)] }), key).status, 'ok');
  assert.equal(item(R({ supplies: [sup(key, 5.99)] }), key).status, 'low');
  assert.equal(item(R({ supplies: [sup(key, 0)] }), key).status, 'missing');
});
test('score equals rounded mean of min(1,have/needed)*100 (internal consistency)', () => {
  const r0 = R(); const ks = r0.items.map((i) => i.key);
  const supplies = [sup(ks[0], r0.items[0].needed / 2), sup(ks[1], 1), sup(ks[2], r0.items[2].needed * 3)];
  const r = R({ supplies });
  const mean = r.items.reduce((a, i) => a + Math.min(1, i.have / i.needed), 0) / r.items.length;
  assert.equal(r.score, Math.round(mean * 100));
  assert.ok(Number.isInteger(r.score));
});
test('unkeyed / unknown-key supplies are ignored for scoring', () => {
  const r = R({ supplies: [mkSupply({ key: null, quantity: 100 }), mkSupply({ id: 's2', key: 'nonsense', quantity: 100 })] });
  assert.equal(r.score, 0);
});
test('pets requirement only when hasPets', () => {
  const a = R({ profile: mkProfile({ hasPets: false }) }), b = R({ profile: mkProfile({ hasPets: true }) });
  assert.equal(b.items.length, a.items.length + 1);
  assert.ok(b.items.some((i) => /pet/.test(i.key)) && !a.items.some((i) => /pet/.test(i.key)));
});
test('expired supplies excluded from have and listed in expired', () => {
  const key = REQUIREMENTS.find((r) => /water/.test(r.key)).key;
  const exp = sup(key, 6, { expires: addDays(T, -1) });
  const r = R({ supplies: [exp] });
  assert.equal(item(r, key).have, 0); assert.equal(item(r, key).status, 'missing');
  assert.deepEqual(r.expired.map((s) => s.id), [exp.id]); assert.deepEqual(r.expiring, []);
});
test('expiring within 60 days flagged but still counted', () => {
  const key = REQUIREMENTS.find((r) => /water/.test(r.key)).key;
  const s59 = sup(key, 6, { id: 'x', expires: addDays(T, 59) }), s61 = sup('food', 9, { id: 'y', expires: addDays(T, 61) });
  const r = R({ supplies: [s59, s61] });
  assert.deepEqual(r.expiring.map((e) => [e.supply.id, e.daysLeft]), [['x', 59]]);
  assert.equal(item(r, key).have, 6); assert.equal(item(r, key).status, 'ok'); assert.equal(item(r, key).expiringSoon, true);
  assert.equal(item(r, 'food').expiringSoon, false);
});
test('expiring ordered ascending by daysLeft; today counts as expiring (not expired) ', () => {
  const r = R({ supplies: [sup('water', 1, { id: 'a', expires: addDays(T, 40) }), sup('food', 1, { id: 'b', expires: addDays(T, 5) }), sup('radio', 1, { id: 'c', expires: T })] });
  assert.deepEqual(r.expiring.map((e) => e.supply.id), ['c', 'b', 'a']);
  assert.deepEqual(r.expired, []);
});
test('leap-day/DST expiry arithmetic', () => {
  assert.equal(readiness(mkState({ supplies: [sup('water', 1, { expires: '2024-03-01' })] }), '2024-02-28').expiring[0].daysLeft, 2);
  assert.equal(readiness(mkState({ supplies: [sup('water', 1, { expires: '2026-03-09' })] }), '2026-03-07').expiring[0].daysLeft, 2);
});
test('readiness does not mutate state and rejects bad today', () => {
  assert.throws(() => readiness(mkState(), 'garbage'), Error);
});

// ---------- emergency sheet ----------
const XSS = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "'; DROP TABLE x; --", '&amp; <b>bold</b>', '</textarea></title><svg/onload=alert(1)>'];
const evil = (n) => mkState({
  profile: mkProfile({ householdSize: 3 }),
  emergency: mkEmergency({
    contacts: [{ name: XSS[0], phone: XSS[1], relation: XSS[3] }], meetingPlace: XSS[1], outOfAreaContact: XSS[4],
    shutoffs: { water: XSS[0], gas: XSS[3], electric: XSS[4] }, notes: XSS[2] + XSS[0],
  }),
  supplies: [mkSupply({ name: XSS[0], key: 'water', quantity: 1, notes: XSS[1] })],
});
test('sheet HTML: standalone doc, no scripts/buttons, print instruction', () => {
  const h = emergencySheetHTML(evil(), T);
  assert.match(h, /^\s*<!doctype html/i); assert.match(h, /<\/html>\s*$/i);
  assert.ok(!/<script/i.test(h)); assert.ok(!/<button/i.test(h)); assert.ok(!/<link /i.test(h));
  assert.ok(!/src\s*=\s*["']?https?:/i.test(h)); assert.match(h, /<style/i);
  assert.match(h, /Ctrl/); assert.match(h, /(Cmd|⌘)/); assert.match(h, /P\b/);
  assert.ok(h.includes(T));
});
test('sheet HTML: all user strings escaped (script/img/svg payloads inert)', () => {
  const h = emergencySheetHTML(evil(), T);
  assert.ok(!h.includes('<script'), 'raw <script'); assert.ok(!h.includes('<img'), 'raw <img'); assert.ok(!h.includes('<svg'), 'raw <svg');
  assert.ok(!h.includes('<b>bold'), 'raw <b>');
  assert.ok(!/<[a-z][^>]*\sonerror\s*=/i.test(h) && !/<[a-z][^>]*\sonload\s*=/i.test(h));
  assert.ok(h.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(h.includes('&amp;amp; &lt;b&gt;bold&lt;/b&gt;'), 'ampersand must be double-escaped');
  assert.ok(h.includes('&quot;&gt;&lt;img') || h.includes('&#34;&gt;&lt;img') || h.includes('"&gt;&lt;img'));
  assert.equal((h.match(/<\/title>/gi) || []).length, 1, 'title tag injection');
  assert.equal((h.match(/<\/textarea>/gi) || []).length, 0);
});
test('sheet HTML contains household size, contacts, places, shutoffs, readiness, notes', () => {
  const st = mkState({ profile: mkProfile({ householdSize: 7 }), emergency: mkEmergency({
    contacts: [{ name: 'Alice Neighbor', phone: '555-0101', relation: 'Friend' }], meetingPlace: 'Oak Park gazebo',
    outOfAreaContact: 'Aunt Bea 555-0199', shutoffs: { water: 'Basement NW', gas: 'Side of house', electric: 'Garage panel' }, notes: 'Dog is named Rex' }) });
  const h = emergencySheetHTML(st, T);
  for (const s of ['Alice Neighbor', '555-0101', 'Friend', 'Oak Park gazebo', 'Aunt Bea 555-0199', 'Basement NW', 'Side of house', 'Garage panel', 'Dog is named Rex']) assert.ok(h.includes(s), s);
  assert.ok(/\b7\b/.test(h)); assert.match(h, /\b0\s*%|score|readiness/i);
});
test('sheet HTML/text with empty emergency data still render', () => {
  const h = emergencySheetHTML(mkState(), T), t = emergencySheetText(mkState(), T);
  assert.ok(h.length > 200 && t.length > 50);
});
test('sheet TEXT: same facts, plain (no HTML scaffolding), unescaped', () => {
  const st = mkState({ emergency: mkEmergency({ contacts: [{ name: 'Bob & Co', phone: '555', relation: 'x' }], meetingPlace: '<park>', notes: 'n1' }) });
  const t = emergencySheetText(st, T);
  assert.ok(t.includes('Bob & Co')); assert.ok(t.includes('<park>')); assert.ok(!/<html|<style|<!doctype/i.test(t));
  assert.ok(t.includes(T)); assert.ok(t.includes('n1'));
});
test('sheet handles max contacts, long strings and huge household without throwing', () => {
  const contacts = Array.from({ length: 12 }, (_, i) => ({ name: 'N' + i, phone: String(i), relation: 'r' }));
  const st = mkState({ profile: mkProfile({ householdSize: 20 }), emergency: mkEmergency({ contacts, notes: 'x'.repeat(500) }) });
  assert.doesNotThrow(() => emergencySheetHTML(st, T)); assert.doesNotThrow(() => emergencySheetText(st, T));
});
test('sheet escapes the date/other params safely (non-ISO today rejected or escaped)', () => {
  let h; try { h = emergencySheetHTML(mkState(), '<script>'); } catch { return; }
  assert.ok(!h.includes('<script>'));
});
