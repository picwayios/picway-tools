import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { scanGif, walkGif } from '../packages/core/src/gifdecode.ts';
import { GIF_LEVELS, compressGif, planGifCompress, verifyGifCompress } from '../packages/core/src/gifcompress.ts';
import { GifPacker, bitsFor, gifLoops, strictFrames } from '../packages/core/src/gifpack.ts';

const FX = new URL('./fixtures/video/', import.meta.url);
const load = (n) => new Uint8Array(readFileSync(new URL(n, FX)));
const frames = (bytes) => {
  const out = [];
  for (const f of walkGif(bytes, { maxFrames: Infinity, maxPixels: Infinity })) out.push(f.rgba.slice());
  return out;
};
const ctl = () => new AbortController().signal;
const run = (bytes, plan, stopAt = Infinity) => compressGif(bytes, scanGif(bytes), plan, { stopAt, resize: null, signal: ctl(), onProgress() {} });
const planFor = (bytes, o = {}) => {
  const s = scanGif(bytes);
  return planGifCompress({ width: s.width, height: s.height, delays: s.delays, maxLong: 0, step: 1, colors: 256, tolerance: 0, ...o });
};

function compare(a, b) {
  assert.equal(a.length, b.length, 'frame count');
  let max = 0;
  for (let k = 0; k < a.length; k++) {
    const p = a[k], q = b[k];
    for (let i = 0; i < p.length; i += 4) {
      assert.equal(p[i + 3] >= 128, q[i + 3] >= 128, `frame ${k} pixel ${i / 4} differs in transparency`);
      if (p[i + 3] >= 128) max = Math.max(max, Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]));
    }
  }
  return max;
}
const solid = (w, h, fill) => {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(fill(x, y), (y * w + x) * 4);
  return a;
};
const T = [0, 0, 0, 0];

test('Plan: do not upscale, scale down proportionally by the long side; when taking every other frame, the duration of each skipped frame is merged into the previous one, total duration unchanged', () => {
  const delays = [100, 20, 30, 40, 50, 60, 70];
  const p1 = planGifCompress({ width: 300, height: 200, delays, maxLong: 640, step: 1, colors: 128 });
  assert.deepEqual([p1.w, p1.h], [300, 200]);
  assert.deepEqual(p1.keep, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(p1.delaysCs, [10, 2, 3, 4, 5, 6, 7]);
  const p2 = planGifCompress({ width: 1000, height: 333, delays, maxLong: 480, step: 3, colors: 128 });
  assert.deepEqual([p2.w, p2.h], [480, 160]);
  assert.deepEqual(p2.keep, [0, 3, 6]);
  assert.deepEqual(p2.delaysCs, [15, 15, 7]);
  assert.equal(p2.delaysCs.reduce((a, b) => a + b) * 10, delays.reduce((a, b) => a + b));
  const p3 = planGifCompress({ width: 2000, height: 1, delays, maxLong: 320, step: 2, colors: 64 });
  assert.deepEqual([p3.w, p3.h], [320, 1]);
  assert.deepEqual(p3.keep, [0, 2, 4, 6]);
  assert.deepEqual(GIF_LEVELS.medium, { colors: 128, tolerance: 24 });
});

test('Tolerance 0, 256 colors: the fixture decodes back frame by frame with a matching transparency mask and very small color error; width / height, frame count, duration and loop all pass the check', async () => {
  for (const n of ['alpha-dispose.gif', 'anim.gif', 'vardelay.gif', 'odd-once.gif', 'interlaced.gif']) {
    const b = load(n);
    const plan = planFor(b);
    const out = await run(b, plan);
    assert.ok(await verifyGifCompress(out, plan, gifLoops(b)), n);
    const err = compare(frames(b), frames(out));
    assert.ok(err <= 24, `${n} max error ${err}`);
    assert.deepEqual(scanGif(out).delays, scanGif(b).delays, `${n} frame duration`);
  }
});

test('Loop setting matches the original: a file with no loop extension still has none; 0 times (infinite) and n times are written as given', async () => {
  for (const [n, want] of [['odd-once.gif', null], ['anim.gif', 0], ['alpha-dispose.gif', 3]]) {
    const b = load(n);
    assert.equal(gifLoops(b), want, n);
    assert.equal(gifLoops(await run(b, planFor(b))), want, n);
  }
});

test('Opaque back to transparent: the previous frame is cleared after drawing (disposal method 2), so the places that should be transparent decode as transparent', () => {
  const w = 12, h = 8;
  const red = [255, 0, 0, 255];
  const f1 = solid(w, h, (x) => (x < 4 ? red : T));
  const f2 = solid(w, h, (x) => (x >= 8 ? red : T));
  const f3 = solid(w, h, () => T);
  const f4 = solid(w, h, (x, y) => (y === 7 && x === 11 ? red : T));
  const p = new GifPacker({ width: w, height: h, loops: 0, colors: 256 });
  for (const f of [f1, f2, f3, f4]) p.add(f, 10);
  const out = p.finish();
  assert.equal(compare([f1, f2, f3, f4], frames(out)), 0);
});

test('Only the changed region is written: small changes are written as small rectangles with the top-left offset correct', () => {
  const w = 64, h = 48;
  const bg = (x, y) => [(x % 8) * 32, (y % 4) * 64, 88, 255];
  const f1 = solid(w, h, bg);
  const f2 = solid(w, h, (x, y) => (x >= 50 && x < 54 && y >= 40 && y < 43 ? [0, 255, 0, 255] : bg(x, y)));
  const p = new GifPacker({ width: w, height: h, loops: 0, colors: 256 });
  p.add(f1, 10);
  p.add(f2, 10);
  const out = p.finish();
  assert.equal(compare([f1, f2], frames(out)), 0);

  const at = [];
  for (let i = 0; i < out.length - 9; i++) if (out[i] === 0x2c && out[i - 8] === 0x21 && out[i - 7] === 0xf9) at.push(i);
  assert.equal(at.length, 2);
  const d = at[1];
  const u16 = (i) => out[i] | (out[i + 1] << 8);
  assert.deepEqual([u16(d + 1), u16(d + 3), u16(d + 5), u16(d + 7)], [50, 40, 4, 3]);
});

test('No frame changed: write one transparent pixel to hold the time, frame count and duration are not lost', () => {
  const f = solid(10, 10, (x, y) => [x * 20, y * 20, 0, 255]);
  const p = new GifPacker({ width: 10, height: 10, loops: 0, colors: 256 });
  p.add(f, 10);
  p.add(f, 33);
  p.add(f, 7);
  const out = p.finish();
  assert.deepEqual(scanGif(out).delays, [100, 330, 70]);
  assert.equal(compare([f, f, f], frames(out)), 0);
});

test('LZW code size follows the palette size: 32-color frames start at 5 bits, not always 8', () => {
  assert.deepEqual([bitsFor(1), bitsFor(2), bitsFor(3), bitsFor(32), bitsFor(33), bitsFor(256)], [1, 1, 2, 5, 6, 8]);
  const f = solid(16, 16, (x, y) => [((x + y * 16) % 32) * 8, 0, 0, 255]);
  const p = new GifPacker({ width: 16, height: 16, loops: null, colors: 32 });
  p.add(f, 10);
  const out = p.finish();
  const d = out.indexOf(0x2c, 13);
  assert.equal(out[d + 9] & 7, 4, 'Local palette of 32 entries');
  assert.equal(out[d + 10 + 32 * 3], 5, 'LZW minimum code size');
  assert.equal(compare([f], frames(out)), 0);
});

test('Tolerance: pixels whose difference from the previous frame is within the tolerance are not redrawn, so the error viewers see does not exceed the tolerance plus color quantization error', () => {
  const w = 20, h = 20, tol = 24;
  const fs = [];
  for (let k = 0; k < 12; k++) fs.push(solid(w, h, (x, y) => [96 + k * 8, 80 + ((x + k) % 3) * 4, 64 + y * 8, 255]));
  const p = new GifPacker({ width: w, height: h, loops: 0, colors: 256, tolerance: tol });
  for (const f of fs) p.add(f, 10);
  const out = p.finish();
  const err = compare(fs, frames(out));
  assert.ok(err <= tol + 4, `max error ${err}`);
  assert.ok(err > 0, 'Tolerance really takes effect');
});

test('Every other frame: frame count matches the plan, total duration the same as the original', async () => {
  const b = load('vardelay.gif');
  const plan = planFor(b, { step: 2 });
  const out = await run(b, plan);
  assert.ok(await verifyGifCompress(out, plan, gifLoops(b)));
  const s = scanGif(out), o = scanGif(b);
  assert.equal(s.frames, Math.ceil(o.frames / 2));
  assert.equal(s.delays.reduce((a, d) => a + d, 0), o.delays.reduce((a, d) => a + d, 0));
});

test('Already no smaller than the original halfway through writing: stop and throw not-smaller', async () => {
  const b = load('anim.gif');
  await assert.rejects(run(b, planFor(b), 1000), /not-smaller/);
});

test('Check before success: files with changed duration, loop or truncation are judged as failing', async () => {
  const b = load('alpha-dispose.gif');
  const plan = planFor(b);
  const out = await run(b, plan);
  assert.ok(await verifyGifCompress(out, plan, 3));
  assert.equal(await verifyGifCompress(out, plan, 0), false, 'Wrong loop');
  assert.equal(await verifyGifCompress(out, plan, null), false, 'Wrong loop');
  assert.equal(await verifyGifCompress(out.subarray(0, out.length - 20), plan, 3), false, 'Truncated');
  const bad = out.slice();
  const g = bad.indexOf(0xf9, 13);
  bad[g + 3] ^= 1;
  assert.equal(await verifyGifCompress(bad, plan, 3), false, 'Wrong duration');
  assert.equal(await verifyGifCompress(out, { ...plan, w: plan.w + 1 }, 3), false, 'Wrong width');
});

test('First frame fills the whole screen: edges the original did not draw (transparent) are also explicitly written as transparent, not left for the decoder to fill with a background color', () => {
  const w = 9, h = 5;
  const f = solid(w, h, (x) => (x < 8 ? [0, 0, 255, 255] : T));
  const p = new GifPacker({ width: w, height: h, loops: 0, colors: 256 });
  p.add(f, 10);
  p.add(f, 10);
  const out = p.finish();
  const d = out.indexOf(0x2c, 13);
  const u16 = (i) => out[i] | (out[i + 1] << 8);
  assert.deepEqual([u16(d + 1), u16(d + 3), u16(d + 5), u16(d + 7)], [0, 0, w, h]);
  assert.equal(out[d - 5] & 1, 1, 'First frame has a transparent color');
  assert.equal(compare([f, f], frames(out)), 0);
});

test('Merging every other frame would exceed the single-frame duration limit (65535 centiseconds): that frame is kept too, total duration unchanged and passes the check', async () => {
  const p = planGifCompress({ width: 4, height: 4, delays: [400000, 400000, 20, 300000, 300000], maxLong: 0, step: 2, colors: 64 });
  assert.deepEqual(p.keep, [0, 1, 2, 4]);
  assert.deepEqual(p.delaysCs, [40000, 40000, 30002, 30000]);
  assert.ok(p.delaysCs.every((d) => d <= 65535));
  const src = new GifPacker({ width: 4, height: 4, loops: 0, colors: 256 });
  [0, 1, 2, 3, 4].forEach((k) => src.add(solid(4, 4, (x) => [k * 40, x * 50, 0, 255]), [40000, 40000, 2, 30000, 30000][k]));
  const b = src.finish();
  const plan = planFor(b, { step: 2 });
  const out = await run(b, plan);
  assert.ok(await verifyGifCompress(out, plan, 0));
  assert.equal(scanGif(out).delays.reduce((a, d) => a + d, 0), scanGif(b).delays.reduce((a, d) => a + d, 0));
});

test('Strict LZW check: bad data that a lenient decoder still “decodes” is judged as failing before success', async () => {
  const b = load('anim.gif');
  const plan = planFor(b);
  const out = await run(b, plan);
  assert.equal(strictFrames(out), plan.keep.length);
  for (const n of ['alpha-dispose.gif', 'vardelay.gif', 'odd-once.gif', 'interlaced.gif', 'still.gif']) {
    const g = await run(load(n), planFor(load(n)));
    assert.equal(strictFrames(g), scanGif(g).frames, n);
  }

  const bad = out.slice();
  const d = bad.indexOf(0x2c, 13);
  const lct = bad[d + 9] & 0x80 ? 3 << ((bad[d + 9] & 7) + 1) : 0;
  const sub = d + 10 + lct + 1;
  bad[sub + Math.min(40, bad[sub] - 1)] ^= 0xff;
  let n = 0;
  for (const _ of walkGif(bad, { maxFrames: Infinity, maxPixels: Infinity })) n++;
  assert.equal(n, plan.keep.length, 'Lenient decoder did not notice');
  assert.equal(strictFrames(bad), -1);
  assert.equal(await verifyGifCompress(bad, plan, gifLoops(b)), false);
});

test('The check before success can be cancelled: cancelling midway throws AbortError and returns no result', async () => {
  const b = load('anim.gif');
  const plan = planFor(b);
  const out = await run(b, plan);
  const c = new AbortController();
  c.abort();
  await assert.rejects(verifyGifCompress(out, plan, gifLoops(b), c.signal), (e) => e.name === 'AbortError');
});

test('Boundary of “not smaller than the original”: when stopAt equals the new file size, no result that is not smaller than stopAt is returned as success', async () => {
  const b = load('vardelay.gif');
  const plan = planFor(b, { step: 2 });
  const out = await run(b, plan);
  for (const stop of [out.length, out.length - 1, out.length + 1]) {
    try {
      const r = await run(b, plan, stop);
      if (stop <= out.length) assert.ok(r.length >= stop, `stop=${stop}: the returned result is not smaller than stop, the page will block it`);
    } catch (e) {
      assert.match(e.message, /not-smaller/);
    }
  }
});
