import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, TEMPLATES, seedTasks } from '../src/templates.js';

test('CATEGORIES is the four expected categories', () => {
  assert.deepEqual([...CATEGORIES].sort(), ['car', 'emergency', 'house', 'yard']);
});

test('templates have valid shape', () => {
  assert.ok(Array.isArray(TEMPLATES));
  for (const t of TEMPLATES) {
    assert.equal(typeof t.title, 'string');
    assert.ok(t.title.trim().length > 0);
    assert.ok(CATEGORIES.includes(t.category), `bad category ${t.category}`);
    if ((t.kind ?? 'interval') === 'interval') assert.ok(Number.isFinite(t.intervalDays) && t.intervalDays > 0, `bad interval ${t.title}`);
    assert.equal(typeof t.notes, 'string');
  }
});

test('at least 8 templates per category', () => {
  for (const c of CATEGORIES) {
    assert.ok(TEMPLATES.filter((t) => t.category === c).length >= 8, c);
  }
});

test('no duplicate titles (case-insensitive)', () => {
  const titles = TEMPLATES.map((t) => t.title.trim().toLowerCase());
  assert.equal(new Set(titles).size, titles.length);
});

test('templates have no id/lastDone', () => {
  for (const t of TEMPLATES) {
    assert.ok(!('id' in t));
    assert.ok(!('lastDone' in t));
  }
});

test('seedTasks builds a Task per template with unique ids', () => {
  let n = 0;
  const tasks = seedTasks(() => 'id' + n++);
  assert.equal(tasks.length, TEMPLATES.length);
  assert.equal(new Set(tasks.map((t) => t.id)).size, tasks.length);
  tasks.forEach((t, i) => {
    assert.equal(t.title, TEMPLATES[i].title);
    assert.equal(t.category, TEMPLATES[i].category);
    assert.equal(t.intervalDays ?? null, TEMPLATES[i].intervalDays ?? null);
    assert.equal(t.kind, TEMPLATES[i].kind ?? 'interval');
    assert.equal(t.lastDone, null);
    assert.equal(typeof t.notes, 'string');
    assert.equal(t.custom, false);
  });
});

test('seedTasks calls idFn and does not mutate TEMPLATES', () => {
  const before = JSON.stringify(TEMPLATES);
  seedTasks(() => 'x' + Math.random());
  assert.equal(JSON.stringify(TEMPLATES), before);
});

test('realistic examples present', () => {
  const find = (re) => TEMPLATES.find((t) => (t.kind ?? 'interval') === 'interval' && re.test(t.title));
  assert.equal(find(/smoke/i)?.intervalDays, 30);
  assert.equal(find(/hvac|furnace/i)?.intervalDays, 90);
  const gut = TEMPLATES.filter((t) => t.kind === 'annual' && /gutter/i.test(t.title));
  assert.deepEqual(gut.map((t) => [t.month, t.day]).sort(), [[11, 1], [4, 15]].sort());
  assert.equal(find(/mow/i)?.intervalDays, 7);
});
