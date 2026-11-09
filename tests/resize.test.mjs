import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normInt, PERCENT_MAX, PX_MAX, resizeFormatFor, targetDims } from '../packages/core/src/resize.ts';
import { fitPixelCap } from '../packages/core/src/convert.ts';

const pct = (percent, noEnlarge = false) => ({ by: 'percent', percent, noEnlarge });
const px = (width, height, keepRatio = true, noEnlarge = false) => ({ by: 'px', width, height, keepRatio, noEnlarge });

test('percentage: scale proportionally, round, at least 1 pixel', () => {
  assert.deepEqual(targetDims(4000, 3000, pct(50)), [2000, 1500, false]);
  assert.deepEqual(targetDims(1001, 333, pct(50)), [501, 167, false]);
  assert.deepEqual(targetDims(10, 3, pct(1)), [1, 1, false]);
  assert.deepEqual(targetDims(100, 50, pct(200)), [200, 100, false]);
});

test('percentage: out-of-range values clamp to 1%–400%, invalid input (≤0, NaN) uses 100%', () => {
  assert.deepEqual(targetDims(100, 100, pct(1000)), [PERCENT_MAX, PERCENT_MAX, false]);
  assert.deepEqual(targetDims(1000, 1000, pct(0.2)), [1000, 1000, false]);
  assert.deepEqual(targetDims(1000, 1000, pct(0.6)), [10, 10, false]);
  assert.deepEqual(targetDims(640, 480, pct(-5)), [640, 480, false]);
  assert.deepEqual(targetDims(640, 480, pct(0)), [640, 480, false]);
  assert.deepEqual(targetDims(640, 480, pct(NaN)), [640, 480, false]);
});

test('pixels plus keep aspect ratio: filling only width or only height computes the other side proportionally; filling both = fit inside the box without distortion', () => {
  assert.deepEqual(targetDims(4000, 3000, px(1080, 0)), [1080, 810, false]);
  assert.deepEqual(targetDims(4000, 3000, px(0, 600)), [800, 600, false]);
  assert.deepEqual(targetDims(4000, 3000, px(1000, 1000)), [1000, 750, false]);
  assert.deepEqual(targetDims(3000, 4000, px(1000, 1000)), [750, 1000, false]);
  assert.deepEqual(targetDims(4000, 3000, px(0, 0)), [4000, 3000, false]);
});

test('pixels without keep aspect ratio: stretch to the values given, an empty side keeps its original value', () => {
  assert.deepEqual(targetDims(4000, 3000, px(1000, 1000, false)), [1000, 1000, false]);
  assert.deepEqual(targetDims(4000, 3000, px(1000, 0, false)), [1000, 3000, false]);
});

test('pixels: maximum 30000, decimals rounded, negative numbers treated as empty', () => {
  assert.deepEqual(targetDims(100, 100, px(99999, 0)), [PX_MAX, PX_MAX, false]);
  assert.deepEqual(targetDims(1000, 500, px(100.6, 0)), [101, 51, false]);
  assert.deepEqual(targetDims(1000, 500, px(-20, 0)), [1000, 500, false]);
});

test('no upscaling: an image smaller than the target keeps its original size and is flagged; downscaling works as usual', () => {
  assert.deepEqual(targetDims(800, 600, px(1080, 0, true, true)), [800, 600, true]);
  assert.deepEqual(targetDims(4000, 3000, px(1080, 0, true, true)), [1080, 810, false]);
  assert.deepEqual(targetDims(100, 50, pct(200, true)), [100, 50, true]);
  assert.deepEqual(targetDims(800, 600, px(1000, 300, false, true)), [800, 300, false]);
  assert.deepEqual(targetDims(800, 600, px(1000, 700, false, true)), [800, 600, true]);
  assert.deepEqual(targetDims(800, 600, px(1080, 0, true, false)), [1080, 810, false]);
});

test('output format: when keeping the original format, JPG/PNG/WebP/AVIF stay as they are, HEIC/BMP/TIFF save as JPG; GIF is not accepted; an explicit PNG request is honored', () => {
  assert.equal(resizeFormatFor('jpeg', 'same'), 'jpeg');
  assert.equal(resizeFormatFor('png', 'same'), 'png');
  assert.equal(resizeFormatFor('webp', 'same'), 'webp');
  assert.equal(resizeFormatFor('avif', 'same'), 'avif');
  for (const k of ['heic', 'bmp', 'tiff']) assert.equal(resizeFormatFor(k, 'same'), 'jpeg');
  assert.equal(resizeFormatFor('gif', 'same'), null);
  assert.equal(resizeFormatFor('gif', 'png'), null);
  assert.equal(resizeFormatFor('jpeg', 'png'), 'png');
  assert.equal(resizeFormatFor('png', 'jpeg'), 'jpeg');
});

test('string keys match across all four languages (en and zh-Hans in resize-image.ts, ja and zh-Hant in the strings file)', async () => {
  const { readFileSync } = await import('node:fs');
  const { EXTRA } = await import('../tools/resize-image/strings.ts');
  const src = readFileSync(new URL('../tools/resize-image/main.ts', import.meta.url), 'utf8');
  const block = (name) => {
    const i = src.indexOf(`  ${name}: {`);
    const j = src.indexOf('\n  },', i);
    return [...src.slice(i, j).matchAll(/(?:^    |, )(\w+): '/gm)].map((m) => m[1]).sort();
  };
  const en = block('en');
  assert.ok(en.length > 30);
  assert.deepEqual(block("'zh-Hans'"), en);
  assert.deepEqual(Object.keys(EXTRA.ja).sort(), en);
  assert.deepEqual(Object.keys(EXTRA['zh-Hant']).sort(), en);
});

test('number box: after rounding, below the minimum (0, negative, 0.4, NaN) counts as empty; above the maximum clamps to the maximum; decimals rounded', () => {
  for (const n of [0, -3, 0.4, NaN, Infinity, -Infinity]) assert.equal(normInt(n, 1, 30000, 0), 0, String(n));
  assert.equal(normInt(0.6, 1, 30000, 0), 1);
  assert.equal(normInt(1080.4, 1, 30000, 0), 1080);
  assert.equal(normInt(99999, 1, 30000, 0), 30000);
  assert.equal(normInt(0.4, 1, 400, 100), 100);
});

test('pixel limit (120M pixels in node): when exceeded, scale by area, round down and flag; WebP single side not over 16383; under the limit is kept as is', () => {
  const [w, h, k] = fitPixelCap('jpeg', 12000, 12000);
  assert.ok(k && w * h <= 120_000_000 && w === h && w > 10900, `${w}x${h}`);
  assert.deepEqual(fitPixelCap('jpeg', 4000, 3000), [4000, 3000, false]);
  const [ww, wh, wk] = fitPixelCap('webp', 20000, 100);
  assert.ok(wk && ww <= 16383 && wh === 81, `${ww}x${wh}`);
  const [aw, ah] = fitPixelCap('avif', 8000, 6000);
  assert.ok(aw * ah <= 24_000_000, `${aw}x${ah}`);
});
