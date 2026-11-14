import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSize, newPhotoId, downscaleImage, PHOTO_MAX_DIM, PHOTO_QUALITY, PHOTO_MAX_BYTES } from '../src/photos.js';

test('constants match spec', () => {
  assert.equal(PHOTO_MAX_DIM, 800); assert.equal(PHOTO_QUALITY, 0.72); assert.equal(PHOTO_MAX_BYTES, 150_000);
});
test('fitSize scales down preserving aspect, never upscales', () => {
  assert.deepEqual(fitSize(1600, 800, 800), { w: 800, h: 400 });
  assert.deepEqual(fitSize(800, 1600, 800), { w: 400, h: 800 });
  assert.deepEqual(fitSize(4000, 3000, 800), { w: 800, h: 600 });
  assert.deepEqual(fitSize(400, 300, 800), { w: 400, h: 300 });
  assert.deepEqual(fitSize(800, 800, 800), { w: 800, h: 800 });
  assert.deepEqual(fitSize(801, 801, 800), { w: 800, h: 800 });
  assert.deepEqual(fitSize(1, 1, 800), { w: 1, h: 1 });
});
test('fitSize returns integers >= 1 and within max for extreme aspect ratios', () => {
  for (const [w, h] of [[10000, 1], [1, 10000], [1e7, 3], [3, 1e7], [799, 801], [1234, 567], [99999, 99999]]) {
    const r = fitSize(w, h, 800);
    assert.ok(Number.isInteger(r.w) && Number.isInteger(r.h), `${w}x${h}`);
    assert.ok(r.w >= 1 && r.h >= 1, `${w}x${h} -> ${JSON.stringify(r)}`);
    assert.ok(r.w <= 800 && r.h <= 800);
  }
});
test('fitSize preserves aspect ratio approx', () => {
  const r = fitSize(3000, 2000, 800);
  assert.ok(Math.abs(r.w / r.h - 1.5) < 0.01);
});
test('newPhotoId: p- prefix, unique', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newPhotoId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^p-[A-Za-z0-9_-]+$/);
});
test('downscaleImage rejects non-image files', async () => {
  const fake = { createElement() { throw new Error('should not need doc'); } };
  for (const f of [{ type: 'text/plain', name: 'a.txt', size: 3 }, { type: 'application/pdf' }, { type: '' }, null, undefined]) {
    await assert.rejects(() => downscaleImage(f, { doc: fake }), Error);
  }
});
