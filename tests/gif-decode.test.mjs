import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeGif, isGif, playDelay } from '../packages/core/src/gifdecode.ts';

const FX = new URL('./fixtures/video/', import.meta.url);
const bytes = (n) => new Uint8Array(readFileSync(new URL(n, FX)));
const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const reference = (n, w, h) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', new URL(n, FX).pathname, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 });
  const size = w * h * 4;
  return Array.from({ length: raw.length / size }, (_, i) => raw.subarray(i * size, (i + 1) * size));
};

const same = (a, b) => {
  let bad = 0;
  for (let i = 0; i < a.length; i += 4) {
    const oa = a[i + 3] > 127;
    const ob = b[i + 3] > 127;
    if (oa !== ob || (oa && (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]))) bad++;
  }
  return bad;
};

test('isGif / playDelay: recognizes GIF87a and GIF89a; delays of 0 and 1 centisecond count as 100 ms', () => {
  assert.ok(isGif(bytes('anim.gif')));
  assert.ok(!isGif(bytes('h264.mp4')));
  assert.ok(!isGif(new TextEncoder().encode('GIF')));
  assert.equal(playDelay(0), 100);
  assert.equal(playDelay(1), 100);
  assert.equal(playDelay(2), 20);
  assert.equal(playDelay(12), 120);
});

for (const [name, w, h, frames, loops] of [['anim.gif', 160, 120, 10, 0], ['odd-once.gif', 98, 66, 5, 1], ['alpha-dispose.gif', 64, 48, 4, 3], ['interlaced.gif', 24, 20, 2, 1]]) {
  test(`decode ${name}: size, frame count and loop count match; each composited frame matches ffmpeg pixel for pixel`, { skip: !ffmpegOk && 'ffmpeg not installed' }, () => {
    const g = decodeGif(bytes(name));
    assert.deepEqual([g.width, g.height, g.frames.length, g.loops], [w, h, frames, loops]);
    const ref = reference(name, w, h);
    assert.equal(ref.length, frames);
    g.frames.forEach((f, i) => assert.equal(same(f.rgba, ref[i]), 0, `frame ${i}`));
  });
}

test('transparent, disposal method 2: transparency flag set, frame delays from the file (0 counts as 100 ms), previous frame area cleared with no residue', () => {
  const g = decodeGif(bytes('alpha-dispose.gif'));
  assert.equal(g.hasAlpha, true);
  assert.deepEqual(g.frames.map((f) => f.delay), [50, 120, 100, 200]);
  const a = (f, x, y) => g.frames[f].rgba[(y * 64 + x) * 4 + 3];
  assert.equal(a(0, 2, 20), 255);
  assert.equal(a(1, 2, 20), 0);
});

test('interlaced: the sample really is interlaced, row order restored in 8/8/4/2 passes (compared against ffmpeg above)', () => {
  const b = bytes('interlaced.gif');
  assert.ok(b[13 + 12 + 8 + 9] & 0x40, 'interlace flag of the first frame');
  const g = decodeGif(b);
  const idx = (f, x, y) => { const o = (y * 24 + x) * 4; const c = [g.frames[f].rgba[o], g.frames[f].rgba[o + 1], g.frames[f].rgba[o + 2]]; return [[0, 0, 0], [255, 0, 0], [0, 255, 0], [0, 0, 255]].findIndex((p) => p.every((v, i) => v === c[i])); };
  for (let y = 0; y < 20; y++) for (let x = 0; x < 24; x++) assert.equal(idx(0, x, y), (Math.floor(x / 6) + Math.floor(y / 5)) % 4, `(${x},${y})`);
});

test('bad input: not a GIF, truncated, or over the frame limit all throw errors, no hang', () => {
  assert.throws(() => decodeGif(bytes('h264.mp4')), /not-gif/);
  assert.throws(() => decodeGif(bytes('truncated.gif')), /truncated/);
  assert.throws(() => decodeGif(bytes('anim.gif'), { maxFrames: 3, maxPixels: 1e9 }), /too-many-frames/);
  assert.throws(() => decodeGif(bytes('anim.gif'), { maxFrames: 1000, maxPixels: 160 * 120 * 4 }), /too-many-frames/);
  const zero = bytes('anim.gif').slice();
  zero[6] = zero[7] = 0;
  assert.throws(() => decodeGif(zero), /bad-size/);
});

test('scanGif: reads size, frame count, loop and delays without decompressing, matching a full decode; truncation throws', async () => {
  const { scanGif } = await import('../packages/core/src/gifdecode.ts');
  for (const n of ['anim.gif', 'odd-once.gif', 'alpha-dispose.gif', 'interlaced.gif']) {
    const b = bytes(n);
    const g = decodeGif(b);
    const s = scanGif(b);
    assert.deepEqual([s.width, s.height, s.frames, s.loops, s.delays], [g.width, g.height, g.frames.length, g.loops, g.frames.map((f) => f.delay)], n);
  }
  assert.throws(() => scanGif(bytes('truncated.gif')), /truncated/);
  assert.throws(() => scanGif(bytes('h264.mp4')), /not-gif/);
});
