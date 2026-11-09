import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { encodeBmp } from '../packages/core/src/bmp.ts';
import { pngGetExif, pngSetExif, prepareExif, webpGetMeta, webpSetMeta } from '../packages/core/src/imgmeta.ts';
import { countGifFrames, isAnimated, RAW_EXT, sniffKind, structureError } from '../packages/core/src/sniff.ts';
import { dumpDict, getGps, loadDict } from '../packages/core/src/exif.ts';
import { getExifTiff, getIcc } from '../packages/core/src/jpeg.ts';
import { pngGetIcc } from '../packages/core/src/png.ts';
import { p3ToSrgbInPlace } from '../packages/core/src/colour.ts';

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/convert/${n}`, import.meta.url)));
const photo = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/photo/${n}`, import.meta.url)));
const jpg = photo('gps-p3-rot6.jpg');
const heic = photo('gps-p3.heic');

test('detect format by content: each of the 8 input types is recognised correctly, file extension not used', () => {
  const want = { 'alpha.png': 'png', 'alpha.webp': 'webp', 'alpha.avif': 'avif', 'photo.bmp': 'bmp', 'alpha.tif': 'tiff', 'anim.gif': 'gif', 'still.gif': 'gif' };
  for (const [n, k] of Object.entries(want)) assert.equal(sniffKind(fx(n)), k, n);
  assert.equal(sniffKind(jpg), 'jpeg');
  assert.equal(sniffKind(heic), 'heic');
});

test('fake extension / empty file / random content: unrecognised or structurally incomplete, never reported as success', () => {
  assert.equal(sniffKind(fx('fake-text.jpg')), null);
  assert.equal(sniffKind(fx('fake-random.png')), null);
  assert.equal(sniffKind(fx('fake-empty.webp')), null);
  assert.equal(sniffKind(fx('fake-ffd8ffd9.jpg')), null);
  const four = Uint8Array.from([0xff, 0xd8, 0xff, 0xd9, ...new Array(20).fill(0)]);
  assert.equal(sniffKind(four), 'jpeg');
  assert.ok(structureError(four, 'jpeg'), 'FFD8FFD9 plus zero padding is not an image');
});

test('truncated files: each format cut in half, structure check errors; complete files do not error', () => {
  const cases = { jpeg: jpg, png: fx('alpha.png'), webp: fx('alpha.webp'), gif: fx('anim.gif'), bmp: fx('photo.bmp'), avif: fx('alpha.avif'), heic };
  for (const [kind, u] of Object.entries(cases)) {
    assert.equal(structureError(u, kind), null, `${kind} complete`);
    assert.ok(structureError(u.subarray(0, Math.floor(u.length * 0.6)), kind), `${kind} truncated`);
  }
});

test('animated: GIF with 3 frames / single frame, PNG acTL, WebP ANIM', () => {
  assert.equal(countGifFrames(fx('anim.gif')), 3);
  assert.equal(countGifFrames(fx('still.gif')), 1);
  assert.equal(isAnimated(fx('anim.gif'), 'gif'), true);
  assert.equal(isAnimated(fx('still.gif'), 'gif'), false);
  assert.equal(isAnimated(fx('alpha.png'), 'png'), false);
  assert.equal(isAnimated(fx('alpha.webp'), 'webp'), false);

  const png = fx('alpha.png');
  const i = Buffer.from(png).indexOf('IDAT') - 4;
  const actl = Uint8Array.from([0, 0, 0, 8, 0x61, 0x63, 0x54, 0x4c, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0]);
  const apng = Uint8Array.from([...png.subarray(0, i), ...actl, ...png.subarray(i)]);
  assert.equal(isAnimated(apng, 'png'), true);
});

test('RAW extensions are always blocked: DNG/CR2/NEF are TIFF containers and would be misdetected as TIFF by content', () => {
  for (const n of ['a.DNG', 'b.cr2', 'c.NEF', 'd.arw', 'e.RAF', 'f.rw2']) assert.ok(RAW_EXT.test(n), n);
  for (const n of ['a.tif', 'b.tiff', 'c.jpg', 'raw.png']) assert.ok(!RAW_EXT.test(n), n);
});

test('BMP encoding: header, dimensions, bottom-up rows, rows padded to 4 bytes, BGR colour order', () => {
  const w = 3, h = 2;
  const rgba = Uint8ClampedArray.from([1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255, 13, 14, 15, 255, 16, 17, 18, 255]);
  const bmp = encodeBmp(rgba, w, h);
  assert.equal(sniffKind(Uint8Array.from([...bmp, 0, 0, 0, 0, 0, 0])), 'bmp');
  assert.equal(bmp.length, 54 + 12 * 2);
  const dv = new DataView(bmp.buffer);
  assert.equal(dv.getInt32(18, true), 3);
  assert.equal(dv.getInt32(22, true), 2);
  assert.equal(dv.getUint16(28, true), 24);
  assert.deepEqual([...bmp.subarray(54, 63)], [12, 11, 10, 15, 14, 13, 18, 17, 16]);
  assert.deepEqual([...bmp.subarray(63, 66)], [0, 0, 0]);
  assert.deepEqual([...bmp.subarray(66, 75)], [3, 2, 1, 6, 5, 4, 9, 8, 7]);
});

test('WebP metadata: ICC + EXIF read back after writing, container upgraded to VP8X, RIFF size correct, pixel chunk unchanged', () => {
  const src = fx('alpha.webp');
  const bare = webpSetMeta(src, { icc: null, exif: null });
  const icc = getIcc(jpg);
  const tiff = getExifTiff(jpg);
  const out = webpSetMeta(bare, { icc, exif: tiff });
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  assert.equal(dv.getUint32(4, true) + 8, out.length);
  const m = webpGetMeta(out);
  assert.deepEqual([...m.icc], [...icc]);
  assert.deepEqual([...m.exifTiff], [...tiff]);
  assert.equal(webpGetMeta(bare).icc, null);
  assert.ok(Buffer.from(out).includes(Buffer.from('VP8X')));
  assert.equal(sniffKind(out), 'webp');
  assert.equal(structureError(out, 'webp'), null);

  const orig = webpGetMeta(src);
  assert.ok(orig.icc && orig.exifTiff);
  assert.ok(getGps(loadDict(orig.exifTiff)));
});

test('PNG eXIf: reads back consistently after writing, placed before IDAT, repeated writes do not stack; iCCP can be read', async () => {
  const png = fx('alpha-srgb.png');
  const tiff = getExifTiff(jpg);
  const once = pngSetExif(png, tiff);
  const twice = pngSetExif(once, tiff);
  assert.deepEqual([...pngGetExif(once)], [...tiff]);
  assert.equal(once.length, twice.length);
  const s = Buffer.from(once);
  assert.ok(s.indexOf('eXIf') < s.indexOf('IDAT'));
  assert.equal(structureError(once, 'png'), null);
  assert.ok(await pngGetIcc(fx('alpha.png')), 'sample PNG has a P3 colour profile');
  assert.equal(pngGetExif(png), null);
});

test('prepareExif: orientation set to 1, dimensions written with new values, location removed by default, all removed, no EXIF invented when none exists', () => {
  const tiff = getExifTiff(jpg);
  assert.ok(getGps(loadDict(tiff)));
  const a = prepareExif(tiff, { removeLocation: true, removeAllExif: false }, 100, 200);
  assert.equal(a.hadGps, true);
  assert.equal(a.gpsRemoved, true);
  const d = loadDict(a.tiff);
  assert.equal(getGps(d), null);
  assert.equal(d['0th'][274], 1, 'orientation must be 1 (pixels already upright)');
  assert.equal(d.Exif[40962], 100);
  assert.equal(d.Exif[40963], 200);
  const keep = prepareExif(tiff, { removeLocation: false, removeAllExif: false }, 100, 200);
  assert.ok(getGps(loadDict(keep.tiff)));
  assert.equal(keep.gpsRemoved, false);
  const none = prepareExif(tiff, { removeLocation: true, removeAllExif: true }, 100, 200);
  assert.equal(none.tiff, null);
  assert.equal(none.gpsRemoved, true);
  assert.deepEqual(prepareExif(null, { removeLocation: true, removeAllExif: false }, 1, 1), { tiff: null, hadGps: false, gpsRemoved: false });
  assert.ok(dumpDict(loadDict(tiff)).length > 0);
});

test('Display P3 to sRGB: greys and white unchanged, P3 red clipped to the sRGB boundary, intermediate colours match an independent algorithm', () => {
  const px = Uint8ClampedArray.from([0, 0, 0, 255, 255, 255, 255, 7, 128, 128, 128, 255, 255, 0, 0, 255, 0, 255, 0, 255, 200, 120, 60, 255]);
  p3ToSrgbInPlace(px);
  assert.deepEqual([...px.subarray(0, 4)], [0, 0, 0, 255]);
  assert.deepEqual([...px.subarray(4, 8)], [255, 255, 255, 7], 'alpha unchanged');
  assert.ok([...px.subarray(8, 11)].every((v) => Math.abs(v - 128) <= 1), 'greys unchanged');
  assert.deepEqual([...px.subarray(12, 15)], [255, 0, 0], 'P3 red is outside sRGB, clipped to the boundary');
  assert.equal(px[16], 0);
  assert.equal(px[17], 255);

  const lin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const enc = (v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055));
  const [r, g, b] = [200, 120, 60].map((v) => lin(v / 255));
  const want = [1.2249401 * r - 0.2249404 * g, -0.0420569 * r + 1.0420571 * g, -0.0196376 * r - 0.0786361 * g + 1.0982735 * b].map((v) => enc(Math.min(1, Math.max(0, v))));
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(px[20 + i] - want[i]) <= 1, `channel ${i}: ${px[20 + i]} vs ${want[i]}`);
});
