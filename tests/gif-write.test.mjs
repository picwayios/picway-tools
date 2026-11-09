import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { decodeGif } from '../packages/core/src/gifdecode.ts';
import { framesBefore, GIF_MAX_FRAMES, GIF_MAX_SECONDS, GIF_MAX_SIDE, planGif } from '../packages/core/src/gifplan.ts';
import { GifWriter } from '../packages/core/src/gifwrite.ts';

const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const base = { w: 1920, h: 1080, rotation: 0, duration: 12, start: 0, length: 3, fps: 10, width: 480 };

test('planGif: size scaled proportionally by width, width and height swapped after rotating portrait shots, never upscaled, long side not over 800', () => {
  assert.deepEqual([planGif(base).w, planGif(base).h], [480, 270]);
  const p = planGif({ ...base, rotation: 90, width: 480 });
  assert.deepEqual([p.w, p.h], [450, 800]);
  const tall = planGif({ ...base, rotation: 90, width: 0 });
  assert.ok(Math.max(tall.w, tall.h) <= GIF_MAX_SIDE + 1, `${tall.w}×${tall.h}`);
  assert.deepEqual([planGif({ ...base, w: 320, h: 240, width: 640 }).w], [320]);

  for (const [w, h] of [[2, 5000], [1, 1000], [3, 4000]]) {
    const q = planGif({ ...base, w, h, width: 0 });
    assert.ok(q.w >= 1 && q.h >= 1 && Math.max(q.w, q.h) <= GIF_MAX_SIDE, `${w}×${h} → ${q.w}×${q.h}`);
  }
});

test('planGif: frame times evenly spaced, delays sum to the clip length (no cumulative drift), each frame at least 2 centiseconds', () => {
  const p = planGif({ ...base, fps: 15, start: 1.5, length: 2 });
  assert.equal(p.times.length, 30);
  assert.equal(p.times[0], 1_500_000);
  assert.equal(p.delays.reduce((a, b) => a + b, 0), 200);
  assert.ok(p.delays.every((d) => d === 6 || d === 7), p.delays.join(','));
  const fast = planGif({ ...base, fps: 30, length: 1 });
  assert.ok(fast.delays.every((d) => d >= 2));
});

test('planGif: a start past the duration is pulled back, the clip does not run past the end of the video, max 20 seconds, max 300 frames', () => {
  const p = planGif({ ...base, start: 11.5, length: 3 });
  assert.ok(p.end <= 12 && p.start < p.end);
  const long = planGif({ ...base, length: 60, duration: 100, fps: 30 });
  assert.equal(long.end - long.start, GIF_MAX_SECONDS);
  assert.equal(long.times.length, GIF_MAX_FRAMES);
  assert.equal(planGif({ ...base, start: 50 }).start < 12, true);
});

test('framesBefore: decoded frames arrive in display order, each output time uses the nearest frame before it', () => {
  const times = [0, 100, 200, 300, 400];
  assert.equal(framesBefore(times, 0, 0), 0);
  assert.equal(framesBefore(times, 0, 150), 2);
  assert.equal(framesBefore(times, 2, 150), 0);
  assert.equal(framesBefore(times, 2, 1000), 3);
});

const solid = (w, h, [r, g, b, a = 255]) => { const x = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < x.length; i += 4) x.set([r, g, b, a], i); return x; };

test('GifWriter: a GIF written with inter-frame differencing reads back with every frame matching the original, loop count and delays correct; the second frame holds only the changed pixels', () => {
  const w = 32, h = 24;
  const f1 = solid(w, h, [255, 0, 0]);
  const f2 = f1.slice();
  for (let y = 5; y < 10; y++) for (let x = 5; x < 12; x++) f2.set([0, 0, 255, 255], (y * w + x) * 4);
  const g = new GifWriter({ width: w, height: h, repeat: 0, colors: 64, alpha: false });
  g.add(f1, 10);
  g.add(f2, 25);
  g.add(f2, 5);
  const back = decodeGif(g.finish());
  assert.deepEqual([back.width, back.height, back.frames.length, back.loops], [w, h, 3, 0]);
  assert.deepEqual(back.frames.map((f) => f.delay), [100, 250, 50]);
  for (const [i, src] of [[0, f1], [1, f2], [2, f2]]) {
    for (let p = 0; p < w * h * 4; p++) assert.ok(Math.abs(back.frames[i].rgba[p] - src[p]) <= 8, `frame ${i} byte ${p}`);
  }
});

test('GifWriter: inputs with transparency write each full frame with disposal method 2, transparent areas still transparent on readback; plays once', () => {
  const w = 16, h = 16;
  const a = solid(w, h, [0, 0, 0, 0]);
  for (let p = 0; p < 64; p++) a.set([0, 200, 0, 255], p * 4);
  const b = solid(w, h, [0, 0, 0, 0]);
  for (let p = 128; p < 192; p++) b.set([200, 0, 0, 255], p * 4);
  const g = new GifWriter({ width: w, height: h, repeat: -1, colors: 16, alpha: true });
  g.add(a, 10);
  g.add(b, 10);
  const back = decodeGif(g.finish());
  assert.equal(back.loops, 1);
  assert.equal(back.frames[1].rgba[3], 0, 'top-left of the second frame is transparent (the green of the first frame is cleared)');
  assert.equal(back.frames[1].rgba[150 * 4 + 3], 255);
});

test('GifWriter: wrong size throws an error; GIFs that ffmpeg can read and write (runs only if ffmpeg is installed locally)', { skip: !ffmpegOk && 'ffmpeg not installed' }, () => {
  const g = new GifWriter({ width: 8, height: 8, repeat: 0, colors: 8, alpha: false });
  assert.throws(() => g.add(new Uint8ClampedArray(10), 10), /frame-size/);
  g.add(solid(8, 8, [10, 20, 30]), 10);
  g.add(solid(8, 8, [200, 20, 30]), 10);
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-gif-'));
  try {
    const p = join(dir, 'x.gif');
    writeFileSync(p, g.finish());
    const n = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim().replace(/,$/, '');
    assert.equal(n, '2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('planGif: portrait shot limited by long side, rounding keeps the long side at or under 800 (540×961 used to give 450×801)', () => {
  for (const [w, h] of [[540, 961], [961, 540], [1080, 1921], [720, 1281], [333, 999]]) {
    for (const width of [0, 320, 480, 640]) {
      const p = planGif({ w, h, rotation: 0, duration: 5, start: 0, length: 3, fps: 10, width });
      assert.ok(Math.max(p.w, p.h) <= GIF_MAX_SIDE, `${w}×${h} width ${width} → ${p.w}×${p.h}`);
    }
  }
  const p = planGif({ w: 540, h: 961, rotation: 0, duration: 5, start: 0, length: 3, fps: 10, width: 480 });
  assert.deepEqual([p.w, p.h], [449, 799]);
});
