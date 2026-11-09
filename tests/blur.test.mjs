import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyRegions, blur, box, effectSize, expand, mosaic, outName, rectFrom, scaleRect } from '../packages/core/src/blur.ts';
import { readFileSync } from 'node:fs';
import { S } from '../tools/blur-image/strings.ts';

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const noise = (W, H, seed = 1, alpha = false) => {
  const r = rng(seed);
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < d.length; i++) d[i] = i % 4 === 3 && !alpha ? 255 : Math.floor(r() * 256);
  return d;
};
const px = (d, W, x, y) => Array.from(d.subarray((y * W + x) * 4, (y * W + x) * 4 + 4));
const inside = (r, x, y) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
function outsideSame(a, b, W, H, r) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (!inside(r, x, y)) assert.deepEqual(px(a, W, x, y), px(b, W, x, y), `outside region ${x},${y} changed`);
}

test('effectSize: scales with the long edge in three tiers; mosaic at least 4, blur at least 2; black box has no strength', () => {
  assert.deepEqual([1, 2, 3].map((l) => effectSize('mosaic', l, 4000, 3000)), [40, 80, 160]);
  assert.deepEqual([1, 2, 3].map((l) => effectSize('blur', l, 3000, 4000)), [20, 40, 80]);
  assert.deepEqual([1, 2, 3].map((l) => effectSize('mosaic', l, 100, 50)), [4, 4, 4]);
  assert.equal(effectSize('blur', 1, 100, 100), 2);
  assert.equal(effectSize('box', 3, 4000, 3000), 0);

  assert.equal(effectSize('mosaic', 2, 1600, 1200) / 1600, effectSize('mosaic', 2, 4000, 3000) / 4000);
});

test('rectFrom: two points give the right rect in any drag direction; clamped to the frame; returns null when width or height is under 1 pixel', () => {
  assert.deepEqual(rectFrom(30, 40, 10, 5, 100, 100), { x: 10, y: 5, w: 20, h: 35 });
  assert.deepEqual(rectFrom(-20, -5, 500, 50.4, 100, 80), { x: 0, y: 0, w: 100, h: 50 });
  assert.equal(rectFrom(10, 10, 10.2, 40, 100, 100), null);
  assert.equal(rectFrom(120, 10, 150, 40, 100, 100), null);
});

test('scaleRect: same size returns as is; when shrinking, rounds outward (covers at least as much) and clamps to the frame', () => {
  const r = { x: 10, y: 21, w: 33, h: 7 };
  assert.deepEqual(scaleRect(r, 100, 80, 100, 80), r);
  assert.deepEqual(scaleRect(r, 100, 80, 50, 40), { x: 5, y: 10, w: 17, h: 4 });
  assert.deepEqual(scaleRect({ x: 0, y: 0, w: 100, h: 80 }, 100, 80, 33, 27), { x: 0, y: 0, w: 33, h: 27 });
  assert.deepEqual(scaleRect({ x: 99, y: 79, w: 1, h: 1 }, 100, 80, 10, 8), { x: 9, y: 7, w: 1, h: 1 });
});

test('scaleRect property: for random sizes and regions, every source pixel in the region maps to an output pixel inside the scaled rect (no edge leaks when shrinking)', () => {
  const r = rng(77);
  for (let n = 0; n < 300; n++) {
    const sw = 50 + Math.floor(r() * 5000), sh = 50 + Math.floor(r() * 5000);
    const k = 0.2 + r() * 0.8, w = Math.max(1, Math.floor(sw * k)), h = Math.max(1, Math.floor(sh * k));
    const x = Math.floor(r() * sw), y = Math.floor(r() * sh);
    const g = { x, y, w: 1 + Math.floor(r() * (sw - x)), h: 1 + Math.floor(r() * (sh - y)) };
    const s = scaleRect(g, sw, sh, w, h);
    assert.ok(s.x >= 0 && s.y >= 0 && s.x + s.w <= w && s.y + s.h <= h, `out of bounds ${JSON.stringify([g, s, w, h])}`);

    for (const [a, b, lo, len, K, M] of [[g.x, g.x + g.w, s.x, s.w, w / sw, w], [g.y, g.y + g.h, s.y, s.h, h / sh, h]]) {
      assert.ok(lo <= Math.floor(a * K) && lo + len >= Math.min(Math.ceil(b * K), M), `edge leak ${JSON.stringify([g, s, w, h])}`);
    }
  }
});

test('mosaic: each cell from the region top-left is one colour equal to the cell average; a 2-pixel leftover on the right (at least half a cell) forms its own cell, a 1-pixel leftover at the bottom (under half a cell) merges into the cell above; outside the region is untouched', () => {
  const W = 13, H = 9;
  const a = noise(W, H, 7);
  const d = a.slice();
  const r = { x: 2, y: 1, w: 8, h: 7 };
  mosaic(d, W, r, 3);
  outsideSame(a, d, W, H, r);
  for (const [bx, by, bw, bh] of [[2, 1, 3, 3], [8, 1, 2, 3], [2, 4, 3, 4], [8, 4, 2, 4], [5, 4, 3, 4], [5, 1, 3, 3]]) {
    const want = [0, 1, 2].map((c) => { let s = 0; for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) s += a[(y * W + x) * 4 + c]; return Math.round(s / (bw * bh)); });
    for (let y = by; y < by + bh; y++) for (let x = bx; x < bx + bw; x++) assert.deepEqual(px(d, W, x, y), [...want, 255], `cell ${bx},${by} at ${x},${y}`);
  }
});

test('mosaic leaves no thin strips: when the region width or height leaves a remainder of 1 after dividing by the cell size, every pixel in the region is changed (in both x and y)', () => {
  for (const [rw, rh, size] of [[9, 9, 4], [5, 13, 4], [17, 6, 8], [1, 9, 4]]) {
    const W = rw + 4, H = rh + 4;
    const a = noise(W, H, rw * 31 + rh);
    const d = a.slice();
    const r = { x: 2, y: 2, w: rw, h: rh };
    mosaic(d, W, r, size);
    outsideSame(a, d, W, H, r);
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) assert.notDeepEqual(px(d, W, x, y), px(a, W, x, y), `${rw}×${rh} cell ${size}: ${x},${y} was not changed`);
  }
});

test('mosaic transparency: weighted by alpha so transparent pixel colours do not mix in; fully transparent cells stay fully transparent', () => {
  const W = 4, H = 2;
  const d = new Uint8ClampedArray(W * H * 4);
  d.set([255, 0, 0, 255], 0);
  mosaic(d, W, { x: 0, y: 0, w: 4, h: 2 }, 2);
  assert.deepEqual(px(d, W, 1, 1), [255, 0, 0, 64]);
  assert.deepEqual(px(d, W, 3, 0), [0, 0, 0, 0]);
});

test('box: region becomes opaque black, outside the region is untouched', () => {
  const W = 10, H = 6;
  const a = noise(W, H, 3, true);
  const d = a.slice();
  const r = { x: 3, y: 2, w: 4, h: 3 };
  box(d, W, r);
  outsideSame(a, d, W, H, r);
  for (let y = 2; y < 5; y++) for (let x = 3; x < 7; x++) assert.deepEqual(px(d, W, x, y), [0, 0, 0, 255]);
});

test('blur: a solid colour stays solid; noise is smoothed (variance drops sharply); transparent edges do not bleed black', () => {
  const W = 40, H = 30;
  const a = noise(W, H, 11);
  const d = a.slice();
  const r = { x: 10, y: 8, w: 20, h: 14 };
  blur(d, W, H, r, 4);
  const vari = (arr) => { const v = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) v.push(arr[(y * W + x) * 4]); const m = v.reduce((s, n) => s + n, 0) / v.length; return v.reduce((s, n) => s + (n - m) ** 2, 0) / v.length; };
  assert.ok(vari(d) < vari(a) / 20, `variance ${vari(a)} → ${vari(d)}`);
  const flat = new Uint8ClampedArray(W * H * 4).fill(0).map((_, i) => [30, 140, 220, 255][i % 4]);
  const f2 = flat.slice();
  blur(f2, W, H, { x: 0, y: 0, w: W, h: H }, 5);
  assert.deepEqual(Array.from(f2), Array.from(flat));

  const t = new Uint8ClampedArray(W * 1 * 4);
  for (let x = 0; x < W; x++) t.set(x < W / 2 ? [255, 255, 255, 255] : [0, 0, 0, 0], x * 4);
  blur(t, W, 1, { x: 0, y: 0, w: W, h: 1 }, 3);
  for (let x = 0; x < W; x++) if (t[x * 4 + 3] > 8) assert.ok(t[x * 4] > 240, `x=${x} colour ${px(t, W, x, 0)}`);
  assert.ok(t[(W / 2) * 4 + 3] > 0 && t[(W / 2) * 4 + 3] < 255);
});

function fakeCtx(d, W) {
  return {
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    getImageData(x, y, w, h) { const o = new Uint8ClampedArray(w * h * 4); for (let j = 0; j < h; j++) o.set(d.subarray(((y + j) * W + x) * 4, ((y + j) * W + x + w) * 4), j * w * 4); return { data: o, width: w, height: h }; },
    putImageData(img, dx, dy, sx = 0, sy = 0, sw = img.width, sh = img.height) { for (let j = sy; j < sy + sh; j++) for (let i = sx; i < sx + sw; i++) for (let c = 0; c < 4; c++) d[((dy + j) * W + dx + i) * 4 + c] = img.data[(j * img.width + i) * 4 + c]; },
  };
}

test('applyRegions blur: samples 3x the radius inside the region only, and the result matches a whole-image blur pixel for pixel (one block at the edge, one away from it); semi-transparent pixels outside the region stay unchanged', () => {
  const W = 120, H = 90;
  const a = noise(W, H, 21, true);
  const size = effectSize('blur', 3, W, H);
  for (const r of [{ x: 40, y: 30, w: 25, h: 20 }, { x: 0, y: 70, w: 30, h: 20 }]) {
    const d = a.slice();
    applyRegions(fakeCtx(d, W), W, H, [r], 'blur', 3);
    const whole = a.slice();
    blur(whole, W, H, r, size);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (inside(r, x, y)) assert.deepEqual(px(d, W, x, y), px(whole, W, x, y), `inside region ${x},${y} differs from whole-image blur`);
      else assert.deepEqual(px(d, W, x, y), px(a, W, x, y), `outside region ${x},${y} changed`);
    }
  }
});

test('applyRegions blur with multiple blocks: when the expanded margins of adjacent blocks overlap, each block is computed from the original image, independent of order, and each equals the whole-image blur (overlaps included)', () => {
  const W = 120, H = 60;
  const a = noise(W, H, 33, true);
  const rs = [{ x: 20, y: 10, w: 30, h: 30 }, { x: 55, y: 15, w: 30, h: 30 }, { x: 40, y: 30, w: 30, h: 20 }];
  const size = effectSize('blur', 3, W, H);
  const run = (order) => { const d = a.slice(); applyRegions(fakeCtx(d, W), W, H, order, 'blur', 3); return d; };
  const d1 = run(rs), d2 = run([...rs].reverse());
  assert.deepEqual(Array.from(d1), Array.from(d2), 'a different order gives a different result');
  const whole = a.slice();
  blur(whole, W, H, { x: 0, y: 0, w: W, h: H }, size);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (rs.some((r) => inside(r, x, y))) assert.deepEqual(px(d1, W, x, y), px(whole, W, x, y), `inside region ${x},${y} differs from whole-image blur`);
    else assert.deepEqual(px(d1, W, x, y), px(a, W, x, y), `outside region ${x},${y} changed`);
  }
});

test('applyRegions mosaic / black box: every pixel inside the regions is changed, outside is untouched (multiple blocks)', () => {
  const W = 60, H = 40;
  const a = noise(W, H, 5, true);
  const rs = [{ x: 3, y: 4, w: 17, h: 11 }, { x: 40, y: 25, w: 20, h: 15 }];
  for (const mode of ['mosaic', 'box']) {
    const d = a.slice();
    applyRegions(fakeCtx(d, W), W, H, rs, mode, 2);
    const want = a.slice();
    for (const r of rs) mode === 'mosaic' ? mosaic(want, W, r, effectSize('mosaic', 2, W, H)) : box(want, W, r);
    assert.deepEqual(Array.from(d), Array.from(want), mode);
  }
});

test('expand: grows outward and clamps to the frame', () => {
  assert.deepEqual(expand({ x: 5, y: 5, w: 10, h: 10 }, 3, 100, 100), { x: 2, y: 2, w: 16, h: 16 });
  assert.deepEqual(expand({ x: 1, y: 90, w: 10, h: 10 }, 6, 100, 100), { x: 0, y: 84, w: 17, h: 16 });
});

test('strings: all four languages have the same keys and matching placeholders', () => {
  const keys = Object.keys(S.en).sort();
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const l of ['zh-Hans', 'zh-Hant', 'ja']) {
    assert.deepEqual(Object.keys(S[l]).sort(), keys, l);
    for (const k of keys) assert.equal(ph(S[l][k]), ph(S.en[k]), `${l}.${k}`);
  }
});

test('download name does not include the original file name: effect name + local date and time; the page does not use the original file name when generating download names', () => {
  assert.equal(outName('pixelated', 'jpg', new Date(2026, 10, 9, 15, 30, 12)), 'pixelated-20261109-153012.jpg');
  assert.equal(outName('redacted', 'png', new Date(2026, 0, 2, 3, 4, 5)), 'redacted-20260102-030405.png');
  const ui = readFileSync(new URL('../tools/blur-image/main.ts', import.meta.url), 'utf8');
  const line = ui.split('\n').find((l) => /const name = /.test(l)) ?? '';
  assert.ok(/outName\(/.test(line) && !/f\.name|baseName/.test(line), line);
  assert.ok(!/baseName\(/.test(ui), 'the redaction page should no longer contain baseName(…)');
});
