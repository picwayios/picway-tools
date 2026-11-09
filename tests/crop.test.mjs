import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, clampRect, dragRect, drawFrame, fitRatio, flip, frameDims, frameMatrix, initGeometry, mul, rotate, scaleGeometry, setSize } from '../packages/core/src/crop.ts';
import { EXTRA } from '../tools/crop-image/strings.ts';
import { readFileSync } from 'node:fs';

const OPS = {
  cw: (fw, fh) => [[0, 1, -1, 0, fh, 0], [fh, fw]],
  ccw: (fw, fh) => [[0, -1, 1, 0, 0, fw], [fh, fw]],
  h: (fw, fh) => [[-1, 0, 0, 1, fw, 0], [fw, fh]],
  v: (fw, fh) => [[1, 0, 0, -1, 0, fh], [fw, fh]],
};
const step = (g, w, h, op) => (op === 'cw' ? rotate(g, w, h, true) : op === 'ccw' ? rotate(g, w, h, false) : flip(g, w, h, op === 'h'));

const cell = (m, x, y) => apply(m, x + 0.5, y + 0.5).map((n) => Math.floor(n));

test('frameMatrix: all 8 geometries place every source pixel inside the frame, one to one', () => {
  const W = 5, H = 3;
  for (const rot of [0, 1, 2, 3]) for (const fl of [false, true]) {
    const m = frameMatrix(rot, fl, W, H);
    const [fw, fh] = frameDims(W, H, rot);
    const seen = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const [a, b] = cell(m, x, y);
      assert.ok(a >= 0 && a < fw && b >= 0 && b < fh, `rot ${rot} flip ${fl}: (${x},${y}) → (${a},${b}) out of bounds`);
      seen.add(`${a},${b}`);
    }
    assert.equal(seen.size, W * H);
    assert.ok(m.every((n) => Number.isInteger(n)), 'coefficients and offsets are all integers (no interpolation)');
  }
});

test('after each operation: the new geometry frame equals the old frame with that step applied; the crop box follows the frame (random sequences of 300 operations)', () => {
  let seed = 7;
  const rnd = (n) => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
  const used = { cw: 0, ccw: 0, h: 0, v: 0 };
  const W = 7, H = 4;
  for (let run = 0; run < 300; run++) {
    let g = initGeometry(W, H);
    g = { ...g, crop: clampRect({ x: rnd(W), y: rnd(H), w: 1 + rnd(W), h: 1 + rnd(H) }, W, H) };
    for (let s = 0; s < 6; s++) {
      const op = ['cw', 'ccw', 'h', 'v'][rnd(4)];
      used[op]++;
      const [fw, fh] = frameDims(W, H, g.rot);
      const [M, [nfw, nfh]] = OPS[op](fw, fh);
      const before = frameMatrix(g.rot, g.flip, W, H);
      const next = step(g, W, H, op);
      assert.deepEqual(frameDims(W, H, next.rot), [nfw, nfh]);
      const after = frameMatrix(next.rot, next.flip, W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) assert.deepEqual(cell(after, x, y), cell(mul(M, before), x, y), `op ${op}`);

      const c = g.crop;
      const pts = [[c.x, c.y], [c.x + c.w, c.y + c.h]].map(([a, b]) => apply(M, a, b));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      assert.deepEqual(next.crop, { x: Math.min(...xs), y: Math.min(...ys), w: Math.abs(xs[0] - xs[1]), h: Math.abs(ys[0] - ys[1]) });
      g = next;
    }
  }
  for (const [op, n] of Object.entries(used)) assert.ok(n > 300, `all four operations must be tested: ${op} only ran ${n} times`);
});

test('four rotations and two flips return to the original', () => {
  const g0 = { rot: 0, flip: false, crop: { x: 1, y: 2, w: 3, h: 1 } };
  let g = g0;
  for (let i = 0; i < 4; i++) g = rotate(g, 6, 4, true);
  assert.deepEqual(g, g0);
  assert.deepEqual(flip(flip(g0, 6, 4, true), 6, 4, true), g0);
  assert.deepEqual(flip(flip(g0, 6, 4, false), 6, 4, false), g0);
  assert.deepEqual(rotate(rotate(g0, 6, 4, true), 6, 4, false), g0);
});

test('clampRect: rounds, at least 1 pixel, placed back inside the frame; NaN falls back', () => {
  assert.deepEqual(clampRect({ x: -5, y: 2.6, w: 0, h: 999 }, 100, 50), { x: 0, y: 0, w: 1, h: 50 });
  assert.deepEqual(clampRect({ x: 90, y: 40, w: 30, h: 20 }, 100, 50), { x: 70, y: 30, w: 30, h: 20 });
  assert.deepEqual(clampRect({ x: NaN, y: Infinity, w: NaN, h: 10 }, 100, 50), { x: 0, y: 40, w: 100, h: 10 });
});

test('fitRatio: the largest box of this ratio inside the frame, centred; if it does not fit, it sits at the edge', () => {
  assert.deepEqual(fitRatio(1, 4000, 3000), { x: 500, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(fitRatio(16 / 9, 4000, 3000), { x: 0, y: 375, w: 4000, h: 2250 });
  assert.deepEqual(fitRatio(4 / 5, 3000, 4000), { x: 0, y: 125, w: 3000, h: 3750 });
  assert.deepEqual(fitRatio(1, 4000, 3000, { x: 3900, y: 0, w: 100, h: 100 }), { x: 1000, y: 0, w: 3000, h: 3000 });
  assert.deepEqual(fitRatio(9 / 16, 1, 1), { x: 0, y: 0, w: 1, h: 1 });
  assert.deepEqual(fitRatio(9 / 16, 3, 3), { x: 1, y: 0, w: 2, h: 3 });
});

test('dragRect: moving stays in bounds; dragging a corner keeps the opposite corner fixed; with aspect lock, the ratio is kept and stays in bounds', () => {
  const s = { x: 10, y: 10, w: 40, h: 30 };
  assert.deepEqual(dragRect(s, 'move', 1000, -1000, null, 100, 100), { x: 60, y: 0, w: 40, h: 30 });
  assert.deepEqual(dragRect(s, 'se', 5, 7, null, 100, 100), { x: 10, y: 10, w: 45, h: 37 });
  assert.deepEqual(dragRect(s, 'nw', -5, -100, null, 100, 100), { x: 5, y: 0, w: 45, h: 40 });
  assert.deepEqual(dragRect(s, 'se', -100, -100, null, 100, 100), { x: 10, y: 10, w: 1, h: 1 });
  assert.deepEqual(dragRect(s, 'nw', 100, 100, null, 100, 100), { x: 49, y: 39, w: 1, h: 1 });
  const sq = { x: 10, y: 10, w: 20, h: 20 };
  const a = dragRect(sq, 'se', 500, 3, 1, 100, 60);
  assert.deepEqual(a, { x: 10, y: 10, w: 50, h: 50 });
  const b = dragRect(sq, 'ne', 3, -500, 1, 100, 60);
  assert.deepEqual(b, { x: 10, y: 0, w: 30, h: 30 });
  for (const hd of ['nw', 'ne', 'sw', 'se']) for (const [dx, dy] of [[37, -12], [-80, 80], [3, 200]]) {
    const r = dragRect({ x: 30, y: 20, w: 32, h: 24 }, hd, dx, dy, 4 / 3, 120, 90);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 120 && r.y + r.h <= 90, `${hd} out of bounds`);
    assert.ok(Math.abs(r.w - r.h * 4 / 3) <= 1, `${hd} ${dx},${dy} ratio ${r.w}/${r.h}`);
  }
});

test('setSize: with aspect lock the other side follows, and overflow scales back proportionally; without lock each side is clamped to the frame', () => {
  const r = { x: 50, y: 50, w: 100, h: 100 };
  assert.deepEqual(setSize(r, 300, 100, null, 400, 300, 'w'), { x: 50, y: 50, w: 300, h: 100 });
  assert.deepEqual(setSize(r, 380, 100, null, 400, 300, 'w'), { x: 20, y: 50, w: 380, h: 100 });
  assert.deepEqual(setSize(r, 200, 100, 16 / 9, 400, 300, 'w'), { x: 50, y: 50, w: 200, h: 113 });
  assert.deepEqual(setSize(r, 100, 400, 1, 400, 300, 'h'), { x: 50, y: 0, w: 300, h: 300 });
  assert.deepEqual(setSize(r, NaN, 0, null, 400, 300, 'w'), { x: 50, y: 50, w: 100, h: 1 });
  assert.deepEqual(setSize(r, -5, 2.5, null, 400, 300, 'w'), { x: 50, y: 50, w: 1, h: 3 });
  assert.deepEqual(setSize(r, 2.4, 1e9, null, 400, 300, 'h'), { x: 50, y: 0, w: 2, h: 300 });
  assert.deepEqual(setSize(r, Infinity, -Infinity, null, 400, 300, 'w'), { x: 0, y: 50, w: 400, h: 1 });
  assert.deepEqual(setSize({ x: 0, y: 0, w: 160, h: 90 }, 1, 90, 16 / 9, 160, 90, 'w'), { x: 0, y: 0, w: 2, h: 1 });
  assert.deepEqual(dragRect({ x: 0, y: 0, w: 100, h: 50 }, 'move', Infinity, 0, null, 400, 300), { x: 300, y: 0, w: 100, h: 50 });
});

test('scaleGeometry: if the decoded size matches the geometry size, returned as is; otherwise converted proportionally', () => {
  const g = { rot: 1, flip: false, crop: { x: 10, y: 20, w: 30, h: 40 } };
  assert.equal(scaleGeometry(g, 100, 200, 100, 200), g);
  assert.deepEqual(scaleGeometry(g, 100, 200, 50, 100).crop, { x: 5, y: 10, w: 15, h: 20 });
});

test('UI strings in all four languages: same keys, matching placeholders', () => {
  const src = readFileSync(new URL('../tools/crop-image/main.ts', import.meta.url), 'utf8');
  const block = (lang) => src.slice(src.indexOf(`${lang}: {`), src.indexOf('\n  },', src.indexOf(`${lang}: {`)));
  const keys = (b) => [...b.matchAll(/(\w+): '/g)].map((m) => m[1]).sort();
  const en = keys(block('en'));
  assert.deepEqual(keys(block("'zh-Hans'")), en);
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of en) assert.equal(ph(block("'zh-Hans'").match(new RegExp(`${k}: '([^']*)'`))[1]), ph(block('en').match(new RegExp(`${k}: '([^']*)'`))[1]), `zh-Hans.${k}`);
  for (const l of ['ja', 'zh-Hant']) {
    assert.deepEqual(Object.keys(EXTRA[l]).sort(), en, l);
    for (const k of en) assert.equal(ph(EXTRA[l][k]), ph(block('en').match(new RegExp(`${k}: '([^']*)'`))[1]), `${l}.${k}`);
  }
});

test('drawFrame: for any rotation / flip and any crop box, both when shrunk (pixel limit) and not shrunk, the four crop corners land exactly on the output corners; interpolation is turned off only when not scaling', () => {
  const inv = ([a, b, c, d, e, f]) => { const det = a * d - b * c; return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det]; };
  let seed = 5; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let n = 0; n < 200; n++) {
    const w = 10 + Math.floor(rnd() * 400), h = 10 + Math.floor(rnd() * 400), rot = Math.floor(rnd() * 4), fl = rnd() < 0.5;
    const [fw, fh] = frameDims(w, h, rot);
    const cx = Math.floor(rnd() * (fw - 1)), cy = Math.floor(rnd() * (fh - 1));
    const crop = { x: cx, y: cy, w: 1 + Math.floor(rnd() * (fw - cx - 1)), h: 1 + Math.floor(rnd() * (fh - cy - 1)) };
    const k = n % 2 ? 1 : 0.1 + rnd() * 0.8;
    const ow = n % 2 ? crop.w : Math.max(1, crop.w * k), oh = n % 2 ? crop.h : Math.max(1, crop.h * k);
    const rec = { m: null, smooth: true, draw: null };
    drawFrame({ set imageSmoothingEnabled(v) { rec.smooth = v; }, transform: (...m) => (rec.m = m), drawImage: (...a) => (rec.draw = a) }, 'IMG', w, h, { rot, flip: fl, crop }, ow, oh);
    assert.deepEqual(rec.draw, ['IMG', 0, 0, w, h]);
    assert.equal(rec.smooth, !(ow === crop.w && oh === crop.h), 'interpolation is turned off only when not scaling');
    const toSrc = inv(frameMatrix(rot, fl, w, h));
    for (const [fx, fy, ex, ey] of [[crop.x, crop.y, 0, 0], [crop.x + crop.w, crop.y, ow, 0], [crop.x, crop.y + crop.h, 0, oh], [crop.x + crop.w, crop.y + crop.h, ow, oh]]) {
      const [sx, sy] = apply(toSrc, fx, fy);
      const [ox, oy] = apply(rec.m, sx, sy);
      assert.ok(Math.abs(ox - ex) < 1e-6 && Math.abs(oy - ey) < 1e-6, `rot ${rot} flip ${fl} k ${k}: frame ${fx},${fy} → output ${ox},${oy}, expected ${ex},${ey}`);
    }
  }
});
