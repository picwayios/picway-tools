import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeGif, scanGif, walkGif } from '../packages/core/src/gifdecode.ts';
import { compressGif, planGifCompress, verifyGifCompress } from '../packages/core/src/gifcompress.ts';
import { flatten } from '../packages/core/src/gifmp4plan.ts';

const FX = new URL('./fixtures/video/', import.meta.url);
const load = (n) => new Uint8Array(readFileSync(new URL(n, FX)));
const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const Y = [255, 255, 0, 255], B = [0, 0, 255, 255], R = [255, 0, 0, 255], G = [0, 255, 0, 255], T = [0, 0, 0, 0];
const px = (rgba, x, y) => Array.from(rgba.subarray((y * 64 + x) * 4, (y * 64 + x) * 4 + 4));

const same = (a, b) => (a[3] === 0 && b[3] === 0) || a.every((v, i) => v === b[i]);
const at = (rgba, x, y, want, msg) => assert.ok(same(px(rgba, x, y), want), `${msg}: (${x},${y}) gave ${px(rgba, x, y)}, expected ${want}`);

const CASES = {
  'bg-d2.gif': { alpha: false, last: [Y, G, R, R], why: 'no transparent color, disposal 2: the blue block is restored to the yellow background (opaque)' },
  'bg-d2-trans.gif': { alpha: true, last: [T, G, R, R], why: 'blue-block frame has a transparent color, disposal 2: cleared to transparent' },
  'bg-init.gif': { alpha: false, last: [R, G, Y, Y], why: 'first frame covers only the top left, no transparent color: the rest is background yellow' },
  'bg-init-trans.gif': { alpha: true, last: [R, G, T, T], why: 'first frame has a transparent color: uncovered areas are transparent' },
  'bg-d2-first.gif': { alpha: false, last: [Y, G, Y, Y], why: 'first frame is a partial blue block, disposal 2: canvas and block area are both yellow' },
  'bg-d3.gif': { alpha: false, last: [R, G, R, R], why: 'disposal 3: restored to the red from before the blue block' },
  'bg-d1.gif': { alpha: false, last: [B, G, R, R], why: 'disposal 1: the blue block stays' },
};
const PTS = [[20, 20], [45, 33], [50, 5], [5, 40]];

test('Decoding: logical background color, transparent color, local rectangles, disposal 1/2/3; the last frame checks color and alpha pixel by pixel', () => {
  for (const [name, c] of Object.entries(CASES)) {
    const g = decodeGif(load(name));
    const last = g.frames[g.frames.length - 1].rgba;
    PTS.forEach(([x, y], i) => at(last, x, y, c.last[i], `${name} (${c.why})`));
    assert.equal(g.hasAlpha, c.alpha, `${name} hasAlpha`);
  }
});

test('Decoding: every frame of every sample matches FFmpeg pixel by pixel (including alpha)', { skip: !ffmpegOk && 'ffmpeg not installed' }, () => {
  for (const name of Object.keys(CASES)) {
    const g = decodeGif(load(name));
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', new URL(name, FX).pathname, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-']);
    const n = 64 * 48 * 4;
    assert.equal(raw.length / n, g.frames.length, `${name} frame count`);
    g.frames.forEach((f, j) => {
      const ff = raw.subarray(j * n, j * n + n);
      let bad = 0;
      for (let i = 0; i < n; i += 4) if (!same(Array.from(f.rgba.subarray(i, i + 4)), Array.from(ff.subarray(i, i + 4)))) bad++;
      assert.equal(bad, 0, `${name} frame ${j} has ${bad} pixels that differ from FFmpeg`);
    });
  }
});

test('Compressing GIF: bg-d2.gif, which has no transparent color, comes out with the blue block in frame 3 as opaque yellow (as FFmpeg reads the output), not a transparent hole', async () => {
  const src = load('bg-d2.gif');
  const s = scanGif(src);
  const plan = planGifCompress({ width: s.width, height: s.height, delays: s.delays, maxLong: 0, step: 1, colors: 256, tolerance: 0 });
  const out = await compressGif(src, s, plan, { stopAt: Infinity, resize: null, signal: new AbortController().signal, onProgress() {} });
  assert.equal(await verifyGifCompress(out, plan, 0), true);
  const g = decodeGif(out);
  at(g.frames[2].rgba, 20, 20, Y, 'after compression (decoded here)');
  if (ffmpegOk) {
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-f', 'gif_pipe', '-i', 'pipe:0', '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { input: out });
    const n = 64 * 48 * 4;
    at(raw.subarray(2 * n, 3 * n), 20, 20, Y, 'after compression (decoded by FFmpeg)');
  }
});

test('GIF to MP4: before and after laying a background color (black chosen), the blue block of bg-d2.gif stays yellow; only bg-d2-trans.gif, which has a transparent color, gets black underneath', () => {
  const third = (name) => {
    let r;
    for (const f of walkGif(load(name))) if (f.index === 2) r = f.rgba.slice();
    const out = new Uint8ClampedArray(r.length);
    flatten(r, out, [0, 0, 0]);
    return out;
  };
  at(third('bg-d2.gif'), 20, 20, Y, 'no transparent color');
  at(third('bg-d2-trans.gif'), 20, 20, [0, 0, 0, 255], 'has a transparent color');
});
