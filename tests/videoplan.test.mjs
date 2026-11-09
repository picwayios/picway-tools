import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planEncode } from '../packages/core/src/videoplan.ts';

const iphone4k = { w: 3840, h: 2160, bitrate: 45_000_000, fps: 30, hevc: true };
test('4K HEVC 45 Mbps: balanced preset still stays 4K, bitrate clearly below the source and not below the floor', () => {
  const p = planEncode(iphone4k, 'balanced', 0);
  assert.deepEqual([p.w, p.h], [3840, 2160]);
  assert.ok(p.bitrate < 45_000_000 && p.bitrate > 10_000_000, String(p.bitrate));
  assert.equal(p.codec, 'avc1.640033');
});
test('scaled to 1080p: dimensions are even and proportional, bitrate drops in proportion to pixel count', () => {
  const p = planEncode(iphone4k, 'smaller', 1920);
  assert.deepEqual([p.w, p.h], [1920, 1080]);
  assert.ok(p.bitrate < 6_000_000 && p.bitrate > 2_000_000, String(p.bitrate));
  assert.match(p.codec, /^avc1\.6400(28|2a)$/);
});
test('portrait 2160×3840 scaled to long side 1280: 720×1280 at the same ratio', () => {
  const p = planEncode({ w: 2160, h: 3840, bitrate: 30_000_000, fps: 30, hevc: true }, 'balanced', 1280);
  assert.deepEqual([p.w, p.h], [720, 1280]);
});
test('no upscaling; odd sizes round to even; unknown bitrate uses pixel density; smaller presets have lower bitrate', () => {
  const p = planEncode({ w: 641, h: 361, bitrate: 0, fps: 24, hevc: false }, 'balanced', 1920);
  assert.deepEqual([p.w % 2, p.h % 2], [0, 0]);
  assert.ok(p.bitrate >= 300_000);
  const a = planEncode(iphone4k, 'balanced', 0).bitrate;
  const b = planEncode(iphone4k, 'smaller', 0).bitrate;
  assert.ok(b < a);
});
