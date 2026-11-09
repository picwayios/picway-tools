import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orientRGBA } from '../packages/core/src/orient.ts';

const W = 3, H = 2;
const shown = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => y * W + x + 1));

const stored = {
  1: [[1, 2, 3], [4, 5, 6]],
  2: [[3, 2, 1], [6, 5, 4]],
  3: [[6, 5, 4], [3, 2, 1]],
  4: [[4, 5, 6], [1, 2, 3]],
  5: [[1, 4], [2, 5], [3, 6]],
  6: [[3, 6], [2, 5], [1, 4]],
  7: [[6, 3], [5, 2], [4, 1]],
  8: [[4, 1], [5, 2], [6, 3]],
};
const toRGBA = (g) => { const d = new Uint8ClampedArray(g.length * g[0].length * 4); g.flat().forEach((v, i) => d.set([v, 255, 0, 255], i * 4)); return d; };
const fromRGBA = (d, w, h) => Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => d[(y * w + x) * 4]));

test('orientRGBA: orientations 1–8 all rotate upright to display orientation (5–8 swap width and height)', () => {
  for (const [o, g] of Object.entries(stored)) {
    const r = orientRGBA(toRGBA(g), g[0].length, g.length, Number(o));
    assert.deepEqual([r.w, r.h], [W, H], `orientation ${o} width and height`);
    assert.deepEqual(fromRGBA(r.data, r.w, r.h), shown, `orientation ${o} pixels`);
  }
});

test('orientRGBA: missing, 0, 9, fractional and NaN orientations are treated as 1 and returned as is', () => {
  const d = toRGBA(stored[1]);
  for (const o of [undefined, 0, 9, 2.5, NaN, -1]) assert.equal(orientRGBA(d, W, H, o).data, d);
});

test('orientRGBA: 1200×800 orientation 6 → 800×1200 (sample size from the audit)', () => {
  const r = orientRGBA(new Uint8ClampedArray(1200 * 800 * 4), 1200, 800, 6);
  assert.deepEqual([r.w, r.h], [800, 1200]);
});

test('orientRGBA: an input view that is not 4-byte aligned still rotates upright', () => {
  const g = stored[6]; const d = toRGBA(g);
  const buf = new Uint8ClampedArray(d.length + 1); buf.set(d, 1);
  const r = orientRGBA(buf.subarray(1), g[0].length, g.length, 6);
  assert.deepEqual(fromRGBA(r.data, r.w, r.h), shown);
});
