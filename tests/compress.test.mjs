import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import UPNG from 'upng-js';
import { fitToSize, FitStopped, nextScale } from '../packages/core/src/fitsize.ts';
import { repackPng } from '../packages/core/src/pngcolors.ts';
import { fitLongSide, MAX_SIDES, outFormatFor } from '../packages/core/src/compress.ts';
import { pctChange } from '../packages/core/src/compress.ts';
import { pngGetIcc, pngSetIcc } from '../packages/core/src/png.ts';
import { pngGetExif, pngSetExif } from '../packages/core/src/imgmeta.ts';
import { getExifTiff } from '../packages/core/src/jpeg.ts';

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/convert/${n}`, import.meta.url)));
const photo = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/photo/${n}`, import.meta.url)));

const fake = (base, log = []) => async (q, scale) => (log.push([q, scale]), { size: Math.round(base * q * scale * scale) });

test('target size: the original at maximum quality is already small enough, encoded once, quality not lowered', async () => {
  const log = [];
  const r = await fitToSize(fake(100_000, log), 500_000, { hi: 0.92 });
  assert.equal(log.length, 1);
  assert.equal(r.q, 0.92);
  assert.equal(r.scale, 1);
  assert.equal(r.fits, true);
});

test('target size: binary search finds the highest quality not exceeding the target (within one step), dimensions unchanged', async () => {
  const r = await fitToSize(fake(1_000_000), 600_000, { hi: 0.92 });
  assert.equal(r.fits, true);
  assert.equal(r.scale, 1);
  assert.ok(r.result.size <= 600_000);
  assert.ok(r.q >= 0.55 && r.q <= 0.6, `q=${r.q}`);
});

test('target size: if even the lowest quality is over, shrink dimensions and search again, end within the target and flag the resize', async () => {
  const r = await fitToSize(fake(10_000_000), 200_000, { hi: 0.92 });
  assert.equal(r.fits, true);
  assert.ok(r.scale < 1);
  assert.ok(r.result.size <= 200_000);
});

test('target size: if the target can never be reached (fixed encoder overhead), return the smallest result with fits=false, attempts are capped', async () => {
  const log = [];
  const make = async (q, scale) => (log.push(1), { size: 50_000 + Math.round(1e6 * q * scale * scale) });
  const r = await fitToSize(make, 10_000, { maxTries: 14 });
  assert.equal(r.fits, false);
  assert.ok(log.length <= 14, `tries ${log.length}`);
  const all = [];
  await fitToSize(async (q, s) => { const x = await make(q, s); all.push(x.size); return x; }, 10_000, { maxTries: 14 });
  assert.equal(r.result.size, Math.min(...all), 'returns the smallest of the tried results');
  assert.ok(r.scale < 0.2, `should shrink to a very small scale=${r.scale}`);
});

test('target size: PNG has fixed quality, so only dimensions shrink', async () => {
  const log = [];
  const r = await fitToSize(fake(4_000_000, log), 500_000, { fixedQuality: 1 });
  assert.ok(log.every(([q]) => q === 1));
  assert.equal(r.fits, true);
  assert.ok(r.scale < 1);
});

test('target size: once stop() returns true it throws FitStopped (settings changed, result discarded)', async () => {
  let n = 0;
  await assert.rejects(fitToSize(fake(1_000_000), 100_000, { stop: () => ++n > 3 }), FitStopped);
});

test('target size: a non-positive target throws an error right away', async () => {
  await assert.rejects(fitToSize(fake(1), 0), /above 0/);
});

test('target size: maxTries is a hard cap (also checked within a round), and once used up returns the existing result', async () => {
  for (const n of [1, 2, 3, 5]) {
    const log = [];
    const r = await fitToSize(fake(10_000_000, log), 200_000, { maxTries: n });
    assert.ok(log.length <= n, `maxTries=${n} actual ${log.length}`);
    assert.ok(r.result.size > 0);
  }
});

test('target size: once the deadline passes no new encode starts and the existing result is used (at least one encode always runs)', async () => {
  let clock = 0;
  const log = [];
  const slow = async (q, scale) => ((clock += 10), log.push([q, scale]), { size: Math.round(1_000_000 * q * scale * scale) });
  const r = await fitToSize(slow, 10_000, { hi: 0.92, deadline: 25, now: () => clock });
  assert.equal(log.length, 3);
  assert.equal(r.tries, 3);
  assert.ok(r.result.size > 0);
  const once = [];
  const r1 = await fitToSize(fake(1_000_000, once), 10_000, { deadline: -1, now: () => 0 });
  assert.equal(once.length, 1);
  assert.equal(r1.fits, false);
});

test('size change text: smaller shows −, larger shows +, equal is 0%, a 0-byte original shows no text', () => {
  assert.equal(pctChange(1000, 280), '−72%');
  assert.equal(pctChange(1000, 1050), '+5%');
  assert.equal(pctChange(1000, 1000), '0%');
  assert.equal(pctChange(0, 10), '');
});

test('nextScale: each round scales to 0.9x or less, minimum 0.05', () => {
  assert.ok(nextScale(1, 1000, 999) <= 0.9);
  assert.equal(nextScale(1, 1000, 100_000), 0.9);
  assert.ok(nextScale(1, 4_000_000, 1_000_000) < 0.5);
  assert.equal(nextScale(0.06, 1e9, 1), 0.05);
});

test('output format: keeps the matching source format; HEIC / BMP / TIFF save as JPG; GIF is rejected; an explicit JPG/WebP request is honoured', () => {
  const same = { jpeg: 'jpeg', png: 'png', webp: 'webp', avif: 'avif', heic: 'jpeg', bmp: 'jpeg', tiff: 'jpeg' };
  for (const [k, f] of Object.entries(same)) assert.equal(outFormatFor(k, 'same'), f, k);
  assert.equal(outFormatFor('gif', 'same'), null);
  assert.equal(outFormatFor('gif', 'jpeg'), null);
  assert.equal(outFormatFor('png', 'jpeg'), 'jpeg');
  assert.equal(outFormatFor('heic', 'webp'), 'webp');
  assert.equal(outFormatFor(null, 'same'), 'jpeg');
});

test('long edge: only shrinks, never enlarges, keeps proportions, at least 1 pixel; 0 leaves it unchanged', () => {
  assert.deepEqual(fitLongSide(4032, 3024, 2048), [2048, 1536]);
  assert.deepEqual(fitLongSide(3024, 4032, 1600), [1200, 1600]);
  assert.deepEqual(fitLongSide(800, 600, 2048), [800, 600]);
  assert.deepEqual(fitLongSide(4032, 3024, 0), [4032, 3024]);
  assert.deepEqual(fitLongSide(10000, 3, 800), [800, 1]);
  assert.equal(MAX_SIDES[0], 0);
});

function synthPng(w, h, kind) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = ((x * 7919 + y * 104729) ^ (x * y)) % 23;
      if (kind === 'gradient') (px[i] = (x * 230) / w + n), (px[i + 1] = (y * 230) / h + n), (px[i + 2] = ((x + y) * 120) / (w + h) + n), (px[i + 3] = 255);
      else {
        const c = ((x >> 4) + (y >> 4)) % 5;
        (px[i] = c * 50), (px[i + 1] = 255 - c * 40), (px[i + 2] = 80), (px[i + 3] = c === 4 ? 0 : 255);
      }
    }
  return { png: new Uint8Array(UPNG.encode([px.buffer], w, h, 0)), px };
}
const rgbaOf = (png) => new Uint8Array(UPNG.toRGBA8(UPNG.decode(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength)))[0]);

test('PNG reduced to 256 colours: a many-colour photo-like sample becomes a palette image, pixel size unchanged, colour count ≤256', async () => {
  const { png } = synthPng(300, 200, 'gradient');
  const r = await repackPng(png, 256);
  assert.equal(r.paletted, true);
  assert.equal(r.width, 300);
  assert.equal(r.height, 200);
  const colors = new Set();
  const px = new Uint32Array(rgbaOf(r.png).buffer);
  for (const c of px) colors.add(c);
  assert.ok(colors.size <= 256, `colors ${colors.size}`);
  assert.ok(r.png.length < png.length, `${r.png.length} < ${png.length}`);
});

test('PNG keeps all colours (colors=0): pixels unchanged one by one, transparency unchanged', async () => {
  const { png, px } = synthPng(160, 96, 'blocks');
  const r = await repackPng(png, 0);
  assert.deepEqual(rgbaOf(r.png), px);
});

test('rewritten PNG brings back the colour profile and EXIF; none added if absent', async () => {
  const { png } = synthPng(64, 64, 'blocks');
  const icc = await pngGetIcc(fx('alpha.png'));
  assert.ok(icc, 'fixture has iCCP');
  const exif = getExifTiff(photo('gps-p3-rot6.jpg'));
  assert.ok(exif, 'fixture has EXIF');
  const src = pngSetExif(await pngSetIcc(png, icc, 'Display P3'), exif);
  const r = await repackPng(src, 256);
  assert.deepEqual(await pngGetIcc(r.png), icc);
  assert.deepEqual(pngGetExif(r.png), exif);
  const plain = await repackPng(png, 256);
  assert.equal(await pngGetIcc(plain.png), null);
  assert.equal(pngGetExif(plain.png), null);
});

test('bad PNG: unreadable input throws an error, not reported as success', async () => {
  await assert.rejects(repackPng(fx('fake-random.png'), 256));
  const { png } = synthPng(64, 64, 'blocks');
  await assert.rejects(repackPng(png.subarray(0, 60), 256));
});

test('all four languages have the same string keys and matching placeholders (en and zh-Hans in compress-image.ts, ja and zh-Hant in the strings file)', async () => {
  const { EXTRA } = await import('../tools/compress-image/strings.ts');
  const src = readFileSync(new URL('../tools/compress-image/main.ts', import.meta.url), 'utf8');
  const block = (name) => {
    const i = src.indexOf(`  ${name}: {`);
    const j = src.indexOf('\n  },', i);
    const out = {};
    for (const m of src.slice(i, j).matchAll(/(?:^    |, )(\w+): '((?:[^'\\]|\\.)*)'/gm)) out[m[1]] = m[2];
    return out;
  };
  const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  const en = block('en');
  assert.ok(Object.keys(en).length > 35);
  for (const [name, dict] of [['zh-Hans', block("'zh-Hans'")], ['ja', EXTRA.ja], ['zh-Hant', EXTRA['zh-Hant']]]) {
    assert.deepEqual(Object.keys(dict).sort(), Object.keys(en).sort(), name);
    for (const k of Object.keys(en)) assert.equal(holes(dict[k]), holes(en[k]), `${name}.${k}`);
  }
});
