import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadImage } from '../packages/core/src/image.ts';
import { webpSetMeta } from '../packages/core/src/imgmeta.ts';
import { getIcc, setIcc } from '../packages/core/src/jpeg.ts';
import { pngSetIcc } from '../packages/core/src/png.ts';

const jpgSrc = new Uint8Array(readFileSync(new URL('./fixtures/photo/gps-p3-rot6.jpg', import.meta.url)));
const p3 = getIcc(jpgSrc);
const webpPlain = new Uint8Array(readFileSync(new URL('./fixtures/convert/plain.webp', import.meta.url)));
const text = (u) => Array.from(u, (c) => (c ? String.fromCharCode(c) : '')).join('');

const png1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

globalThis.createImageBitmap = async () => ({ width: 1, height: 1, close() {} });
const file = (bytes, name) => new File([bytes], name);

test('precondition: the ICC in the sample is really Display P3', () => {
  assert.ok(p3 && p3.length > 400);
  assert.match(text(p3.subarray(0, 800)), /Display P3/);
});

test('the same Display P3 ICC embedded in JPG / PNG / WebP: loadImage recognizes p3 in all three and returns the ICC', async () => {
  const jpg = await loadImage(file(setIcc(jpgSrc, p3), 'a.jpg'));
  const png = await loadImage(file(await pngSetIcc(png1, p3, 'Display P3'), 'a.png'));
  const webp = await loadImage(file(webpSetMeta(webpPlain, { icc: p3 }), 'a.webp'));
  assert.equal(jpg.p3, true, 'JPG detected as P3');
  assert.equal(png.p3, true, 'PNG detected as P3');
  assert.equal(webp.p3, true, 'WebP must be detected as P3 (previously p3:false)');
  assert.ok(webp.icc && webp.icc.length === p3.length, 'WebP ICC is returned unchanged so it can be written back on output');
  assert.deepEqual(Array.from(webp.icc), Array.from(p3));
});

test('file named .jpg but containing WebP: ICC is read from the content too (the extension is not trusted)', async () => {
  const l = await loadImage(file(webpSetMeta(webpPlain, { icc: p3 }), 'photo.jpg'));
  assert.equal(l.p3, true);
});

test('control: WebP without ICC, or WebP with a non-sRGB profile that is not P3, is not treated as P3', async () => {
  const plain = await loadImage(file(webpPlain, 'plain.webp'));
  assert.equal(plain.p3, false);
  assert.equal(plain.icc, null);
  const fake = new Uint8Array(200);
  fake.set(new TextEncoder().encode('sRGB IEC61966-2.1'), 40);
  const s = await loadImage(file(webpSetMeta(webpPlain, { icc: fake }), 's.webp'));
  assert.equal(s.p3, false);
});

test('corrupt WebP does not throw, it just fails to read ICC (decoding is left to the browser)', async () => {
  const bad = webpPlain.slice(0, 40);
  const l = await loadImage(file(bad, 'bad.webp'));
  assert.equal(l.icc, null);
});
