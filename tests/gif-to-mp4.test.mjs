import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { decodeGif, scanGif, walkGif } from '../packages/core/src/gifdecode.ts';
import { cropOnly, flatten, frameTimes, keyFrames, MP4_MAX_SIDE, planGifMp4 } from '../packages/core/src/gifmp4plan.ts';

const FX = new URL('./fixtures/video/', import.meta.url);
const bytes = (n) => new Uint8Array(readFileSync(new URL(n, FX)));

test('planGifMp4: width and height round down to even, never upscaled; long-side cap; original size also not over 1920', () => {
  const p = (width, height, maxLong = 0) => planGifMp4({ width, height, delays: [100, 100], maxLong, passes: 1 });
  assert.deepEqual([p(160, 120).w, p(160, 120).h], [160, 120]);
  assert.deepEqual([p(99, 67).w, p(99, 67).h], [98, 66]);
  assert.deepEqual([p(1, 1).w, p(1, 1).h], [2, 2]);
  assert.deepEqual([p(800, 600, 480).w, p(800, 600, 480).h], [480, 360]);
  assert.deepEqual([p(400, 300, 720).w, p(400, 300, 720).h], [400, 300]);
  assert.deepEqual([p(4000, 1000).w, p(4000, 1000).h], [MP4_MAX_SIDE, 480]);
  assert.deepEqual([p(1000, 4001).w, p(1000, 4001).h], [478, 1920]);
  for (const [w, h, m] of [[99, 67, 0], [333, 777, 480], [4095, 17, 0], [641, 481, 720]]) {
    const r = p(w, h, m);
    assert.ok(r.w % 2 === 0 && r.h % 2 === 0, `${w}×${h} even`);
    assert.ok(r.w <= w + 1 && r.h <= h + 1 && Math.max(r.w, r.h) <= (m || MP4_MAX_SIDE), `${w}×${h} cap`);
  }
});

test('planGifMp4: frame count and duration multiplied by pass count; average frame rate, bitrate bounds, H.264 level', () => {
  const a = planGifMp4({ width: 160, height: 120, delays: [100, 100, 50, 250], maxLong: 0, passes: 3 });
  assert.equal(a.frames, 12);
  assert.equal(a.durationUs, 1_500_000);
  assert.equal(a.fps, 8);
  assert.equal(a.bitrate, 600_000);
  assert.equal(a.codec, 'avc1.640028');
  const b = planGifMp4({ width: 1920, height: 1080, delays: Array(60).fill(20), maxLong: 0, passes: 1 });
  assert.equal(b.fps, 50);
  assert.equal(b.bitrate, 20_000_000);
  assert.equal(b.codec, 'avc1.64002a');
  const c = planGifMp4({ width: 100, height: 100, delays: [5000, 5000], maxLong: 0, passes: 1 });
  assert.equal(c.fps, 1);
});

test('frameTimes: start times converted from cumulative milliseconds and continuous across passes, durations sum to the total; keyFrames every 2 seconds', () => {
  const { ts, dur } = frameTimes([33, 33, 34], 2);
  assert.deepEqual(ts, [0, 33000, 66000, 100000, 133000, 166000]);
  assert.deepEqual(dur, [33000, 33000, 34000, 33000, 33000, 34000]);
  const odd = frameTimes([16.7, 16.7, 16.6], 100);
  assert.equal(odd.ts.length, 300);
  assert.equal(odd.ts[299] + odd.dur[299], 5_000_000);
  assert.ok(odd.dur.every((d) => d >= 16_599 && d <= 16_701));
  assert.equal(odd.dur.reduce((a, d) => a + d, 0), 5_000_000);
  assert.deepEqual(keyFrames([0, 500_000, 1_999_999, 2_000_000, 3_000_000, 4_100_000]), [true, false, false, true, false, true]);
  assert.deepEqual(keyFrames(frameTimes([100], 1).ts), [true]);
});

test('flatten: transparent areas filled with the background color, opaque pixels unchanged, output fully opaque; input not modified', () => {
  const src = new Uint8ClampedArray([10, 20, 30, 255, 1, 2, 3, 0, 40, 50, 60, 255]);
  const keep = src.slice();
  const out = new Uint8ClampedArray(src.length);
  flatten(src, out, [255, 255, 255]);
  assert.deepEqual([...out], [10, 20, 30, 255, 255, 255, 255, 255, 40, 50, 60, 255]);
  assert.deepEqual([...src], [...keep]);
  flatten(src, out, [0, 0, 0]);
  assert.deepEqual([...out.subarray(4, 8)], [0, 0, 0, 255]);
});

for (const name of ['anim.gif', 'odd-once.gif', 'alpha-dispose.gif', 'interlaced.gif']) {
  test(`walkGif ${name}: frames yielded one by one are byte-identical to a full decode, delays and frame count match scanGif; reports size and loop at the end`, () => {
    const b = bytes(name);
    const all = decodeGif(b);
    const s = scanGif(b);
    const it = walkGif(b);
    let i = 0;
    let shared = null;
    for (let r = it.next(); ; r = it.next()) {
      if (r.done) {
        assert.deepEqual({ ...r.value }, { width: all.width, height: all.height, loops: all.loops, hasAlpha: all.hasAlpha });
        break;
      }
      assert.equal(r.value.index, i);
      assert.deepEqual(r.value.rgba, all.frames[i].rgba);
      assert.equal(r.value.delay, s.delays[i]);
      if (shared) assert.equal(r.value.rgba, shared, 'every frame yields the same canvas (no extra memory allocated)');
      shared = r.value.rgba;
      i++;
    }
    assert.equal(i, s.frames);
  });
}

test('walkGif: bad files, truncation and the frame limit still throw errors', () => {
  const drain = (b, l) => {
    const it = walkGif(b, l);
    while (!it.next().done);
  };
  assert.throws(() => drain(bytes('h264.mp4')), /not-gif/);
  assert.throws(() => drain(bytes('truncated.gif')), /truncated/);
  assert.throws(() => drain(bytes('anim.gif'), { maxFrames: 3, maxPixels: Infinity }), /too-many-frames/);
  drain(bytes('anim.gif'), { maxFrames: Infinity, maxPixels: Infinity });
});

test('cropOnly: crops only when off by one odd pixel; pads up to 2 pixels (1 pixel wide or tall), or scales when really shrinking; same size is not cropped', () => {
  const k = (w, h) => { const p = planGifMp4({ width: w, height: h, delays: [100, 100], maxLong: 0, passes: 1 }); return cropOnly(p.w, p.h, w, h); };
  assert.equal(k(99, 67), true);
  assert.equal(k(99, 66), true);
  assert.equal(k(100, 66), false);
  assert.equal(k(1, 40), false);
  assert.equal(k(41, 1), false);
  assert.equal(k(1, 1), false);
  assert.equal(k(3001, 1999), false);
  assert.equal(cropOnly(2, 40, 1, 40), false);
});

test('planGifMp4: H.264 level also checks macroblocks per frame (MaxFS), so large frames at low frame rates are not labeled 4.0 / 4.2', () => {
  const lv = (w, h, d) => parseInt(planGifMp4({ width: w, height: h, delays: Array(10).fill(d), maxLong: 0, passes: 1 }).codec.slice(-2), 16);
  assert.equal(lv(640, 480, 100), 0x28);
  assert.equal(lv(1920, 1080, 100), 0x28);
  assert.equal(lv(1920, 1440, 100), 0x33);
  assert.equal(lv(1500, 1500, 200), 0x33);
  assert.equal(lv(1920, 1920, 20), 0x33);
});

test('planGifMp4: when scaled to the long-side cap the long side equals the cap exactly (integers multiply before divide, no 2-pixel loss from floats)', () => {
  const pl = (w, h, maxLong = 0) => { const p = planGifMp4({ width: w, height: h, delays: [100, 100], maxLong, passes: 1 }); return [p.w, p.h]; };
  assert.deepEqual(pl(2148, 2), [1920, 2]);
  assert.deepEqual(pl(2, 2148), [2, 1920]);
  assert.deepEqual(pl(2148, 1074), [1920, 960]);
  for (let long = 1921; long <= 4096; long += 7) assert.equal(pl(long, 2)[0], 1920, `long side ${long}`);
  assert.deepEqual(pl(1500, 1000, 1080), [1080, 720]);
});

test('walkGif / decodeGif: a bad frame whose descriptor is more than 4 times the canvas reports bad-lzw and is not preallocated', () => {
  const fr = (w, h) => Buffer.concat([Buffer.from([0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0]), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0, 2, 2, 0x44, 1, 0])]);
  const gif = (w, h) => new Uint8Array(Buffer.concat([Buffer.from('GIF89a'), Buffer.from([4, 0, 4, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255]), fr(w, h), fr(1, 1), Buffer.from([0x3b])]));
  assert.throws(() => [...walkGif(gif(65535, 65535))], /bad-lzw/);
  assert.throws(() => decodeGif(gif(9, 8)), /bad-lzw/);
  assert.equal(decodeGif(gif(1, 1)).frames.length, 2);
});
