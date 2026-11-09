import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dumpDict, getGps, hasGps, loadDict, normalizeAfterRender, readFields, removeLocation, setGps, stripAllFromJpeg, stripLocationFromJpeg, writeFields } from '../packages/core/src/exif.ts';
import { readHeifMeta } from '../packages/core/src/isobmff.ts';
import { getExifTiff, getIcc, hasXmpIptc, segments, setExif, setIcc } from '../packages/core/src/jpeg.ts';

const dir = new URL('./fixtures/photo/', import.meta.url);
const text = (u) => Array.from(u, (c) => (c ? String.fromCharCode(c) : '')).join('');
const jpg = new Uint8Array(readFileSync(new URL('gps-p3-rot6.jpg', dir)));
const heic = new Uint8Array(readFileSync(new URL('gps-p3.heic', dir)));

test('sample JPEG: with Display P3 profile, GPS, orientation 6', () => {
  const icc = getIcc(jpg);
  assert.ok(icc && icc.length > 400, 'ICC is in');
  assert.match(text(icc.subarray(0, 800)), /Display P3/);
  const d = loadDict(getExifTiff(jpg));
  assert.ok(hasGps(d));
  const g = getGps(d);
  assert.ok(Math.abs(g.lat - 37.77497) < 0.001 && Math.abs(g.lon + 122.4195) < 0.001, JSON.stringify(g));
  assert.equal(readFields(d).make, 'PicWay Test');
  assert.equal(d['0th'][274], 6);
});

test('HEIC: extracts the Display P3 ICC, EXIF (including GPS) and rotation', () => {
  const m = readHeifMeta(heic);
  assert.ok(m.icc && m.icc.length > 400, 'gets the ICC');
  assert.match(text(m.icc.subarray(0, 800)), /Display P3/, 'the HEIC color profile is Display P3');
  assert.ok(m.exifTiff, 'gets the EXIF');
  const d = loadDict(m.exifTiff);
  assert.ok(getGps(d), 'HEIC EXIF has GPS');
  assert.ok([0, 90, 180, 270].includes(m.rotation));
  console.log('  HEIC irot =', m.rotation, 'mirror =', m.mirror, 'orientation tag =', d['0th'][274]);
});

test('strip location: GPS is gone, other fields and ICC stay, pixel data unchanged', () => {
  const out = stripLocationFromJpeg(jpg);
  const d = loadDict(getExifTiff(out));
  assert.equal(hasGps(d), false, 'GPS must be gone');
  assert.equal(readFields(d).make, 'PicWay Test');
  assert.equal(readFields(d).dateTimeOriginal, '2023:07:15 10:30:00');
  assert.deepEqual(getIcc(out), getIcc(jpg), 'ICC unchanged');
  const tail = (u) => u.subarray(segments(u).at(-1).end);
  assert.deepEqual(tail(out), tail(jpg), 'compressed data after SOS is byte-identical');
  assert.equal(new TextDecoder('latin1').decode(out).includes('GPS'), false);
});

test('strip all EXIF: EXIF is gone but the color profile remains', () => {
  const out = stripAllFromJpeg(jpg);
  assert.deepEqual(Object.keys(loadDict(getExifTiff(out))['0th']), ['274']);
  assert.deepEqual(Object.keys(loadDict(getExifTiff(out)).Exif), []);
  assert.deepEqual(getIcc(out), getIcc(jpg));
  assert.equal(hasXmpIptc(out), false);
});

test('set GPS, time, camera: reads back the new values; nothing else affected', () => {
  const d = loadDict(getExifTiff(jpg));
  setGps(d, -33.8568, 151.2153);
  writeFields(d, { dateTimeOriginal: '2020:01:02 03:04:05', offset: '+08:00', make: 'Apple', model: '', description: '海边' });
  const out = setExif(jpg, dumpDict(d));
  const e = loadDict(getExifTiff(out));
  const g = getGps(e);
  assert.ok(Math.abs(g.lat + 33.8568) < 1e-4 && Math.abs(g.lon - 151.2153) < 1e-4, JSON.stringify(g));
  const f = readFields(e);
  assert.equal(f.dateTimeOriginal, '2020:01:02 03:04:05');
  assert.equal(f.offset, '+08:00');
  assert.equal(f.make, 'Apple');
  assert.equal(f.model, undefined, 'empty string = delete');
  assert.equal(f.description, '海边');
  assert.equal(e.Exif[36867], '2020:01:02 03:04:05');
  assert.equal(e['0th'][306], '2020:01:02 03:04:05', 'DateTime (modified time) is synced');
  assert.deepEqual(getIcc(out), getIcc(jpg));
});

test('after transcoding, orientation becomes 1 and the size is written as new values', () => {
  const d = normalizeAfterRender(loadDict(getExifTiff(jpg)), 426, 640);
  assert.equal(d['0th'][274], 1);
  assert.equal(d.Exif[40962], 426);
  assert.equal(d.Exif[40963], 640);
});

test('setIcc adds ICC to a JPEG with no profile, and it reads back', () => {
  const bare = setIcc(jpg, null);
  assert.equal(getIcc(bare), null);
  const big = new Uint8Array(150000).map((_, i) => i % 251);
  const withIcc = setIcc(bare, big);
  assert.deepEqual(getIcc(withIcc), big, 'data larger than one segment (65519 bytes) is split into chunks and reads back identical');
});

test('removeLocation leaves fields other than the ones passed in untouched', () => {
  const d = removeLocation(loadDict(getExifTiff(jpg)));
  assert.deepEqual(d.GPS, {});
  assert.equal(readFields(d).model, 'Fixture Cam 1');
});

import { pngGetIcc, pngSetIcc } from '../packages/core/src/png.ts';
import { crc32, makeZip } from '../packages/core/src/zip.ts';

test('PNG writes iCCP: reads back as the Display P3 profile, original chunks kept', async () => {

  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const icc = getIcc(jpg);
  const out = await pngSetIcc(png, icc, 'Display P3');
  assert.deepEqual(await pngGetIcc(out), icc);
  assert.equal(text(out.subarray(0, 60)).includes('iCCP'), true);
  assert.equal(text(out).includes('IDAT') && text(out).includes('IEND'), true);
});

test('ZIP: crc32 and structure are correct (checked with system unzip)', async () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = makeZip([{ name: '照片 1.jpg', data: jpg }, { name: '照片 1.jpg', data: heic }]);
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { execFileSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const d = mkdtempSync(`${tmpdir()}/tl1zip-`);
  try {
    writeFileSync(`${d}/a.zip`, zip);
    const out = execFileSync('unzip', ['-t', `${d}/a.zip`]).toString();
    assert.match(out, /No errors detected/);
    assert.match(out, / 1 \(2\)\.jpg/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

import { finalizeOutput } from '../packages/core/src/postprocess.ts';

const bareJpeg = () => setIcc(setExif(jpg, null), null);

test('HEIC full byte pipeline: default options (strip location) → no GPS, has P3, other EXIF kept, orientation 1', async () => {
  const meta = readHeifMeta(heic);
  const r = await finalizeOutput(bareJpeg(), meta, { format: 'jpeg', removeLocation: true, removeAllExif: false }, 426, 640, meta.icc);
  assert.equal(r.hadGps, true);
  assert.equal(r.gpsRemoved, true);
  const d = loadDict(getExifTiff(r.bytes));
  assert.equal(getGps(d), null, 'output must not have GPS');
  assert.equal(d['0th'][274], 1);
  assert.equal(readFields(d).make, 'PicWay Test');
  assert.deepEqual(getIcc(r.bytes), meta.icc, 'Display P3 is written in');
  assert.equal(text(r.bytes).includes('GPS\0') && getGps(d) !== null, false);
});

test('when location is not stripped (user unticks the box) GPS is kept as is, and the page says “location kept”', async () => {
  const meta = readHeifMeta(heic);
  const r = await finalizeOutput(bareJpeg(), meta, { format: 'jpeg', removeLocation: false, removeAllExif: false }, 426, 640, meta.icc);
  assert.equal(r.gpsRemoved, false);
  assert.ok(getGps(loadDict(getExifTiff(r.bytes))));
});

test('strip all EXIF: no EXIF segment, but P3 remains', async () => {
  const meta = readHeifMeta(heic);
  const r = await finalizeOutput(bareJpeg(), meta, { format: 'jpeg', removeLocation: true, removeAllExif: true }, 426, 640, meta.icc);
  assert.equal(getExifTiff(r.bytes), null);
  assert.deepEqual(getIcc(r.bytes), meta.icc);
});

test('PNG output: has iCCP (P3)', async () => {
  const meta = readHeifMeta(heic);
  const png = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
  const r = await finalizeOutput(png, meta, { format: 'png', removeLocation: true, removeAllExif: false }, 1, 1, meta.icc, 'Display P3');
  assert.deepEqual(await pngGetIcc(r.bytes), meta.icc);
});

import { readInfo } from '../packages/core/src/info.ts';

test('readInfo (exifr): JPEG and HEIC both read GPS and camera info; after stripping location, no GPS is read', async () => {
  for (const [name, bytes] of [['jpg', jpg], ['heic', heic]]) {
    const i = await readInfo(bytes);
    assert.ok(i.gps && Math.abs(i.gps.lat - 37.77497) < 0.001 && Math.abs(i.gps.lon + 122.41947) < 0.001, `${name} ${JSON.stringify(i.gps)}`);
    assert.ok(i.rows.some((r) => r.key === 'Make' && r.value === 'PicWay Test'), name);
  }
  const clean = await readInfo(stripLocationFromJpeg(jpg));
  assert.equal(clean.gps, null, 'exifr finds no GPS in the new file after stripping location');
  assert.ok(clean.rows.some((r) => r.key === 'Make'));
});
