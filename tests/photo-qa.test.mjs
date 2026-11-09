import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildEdited } from '../packages/core/src/editsave.ts';
import { dumpDict, getGps, loadDict } from '../packages/core/src/exif.ts';
import { getExifTiff } from '../packages/core/src/jpeg.ts';

const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/photo/qa/${n}`, import.meta.url)));
const gpsOf = (jpg) => loadDict(getExifTiff(jpg)).GPS;
const noChange = (jpg) => {
  const g = getGps(loadDict(getExifTiff(jpg)));
  return { clearLoc: false, pin: g, origGps: g, patch: {} };
};

for (const name of ['landscape-gps-xmp.jpg', 'high-precision-gps.jpg']) {
  test(`${name}: saved without changes, GPS segment byte-identical (altitude, GPS date and time, high-precision coordinates all present)`, () => {
    const src = fx(name);
    const out = buildEdited(src, noChange(src)).out;
    assert.deepEqual(gpsOf(out), gpsOf(src));
    assert.equal(gpsOf(out)[6] !== undefined && gpsOf(out)[7] !== undefined && gpsOf(out)[29] !== undefined, true);
  });
  test(`${name}: only author or only date changed, GPS segment also unchanged`, () => {
    const src = fx(name);
    for (const patch of [{ artist: 'Me' }, { dateTimeOriginal: '2024:01:02 03:04:05' }]) {
      const out = buildEdited(src, { ...noChange(src), patch }).out;
      assert.deepEqual(gpsOf(out), gpsOf(src));
    }
  });
}

test('location really changed: only latitude and longitude swapped, GPS date and time kept, old altitude removed', () => {
  const src = fx('landscape-gps-xmp.jpg');
  const out = buildEdited(src, { clearLoc: false, pin: { lat: 40.5, lon: 116.25 }, origGps: getGps(loadDict(getExifTiff(src))), patch: {} }).out;
  const g = gpsOf(out);
  const p = getGps(loadDict(getExifTiff(out)));
  assert.ok(Math.abs(p.lat - 40.5) < 1e-4 && Math.abs(p.lon - 116.25) < 1e-4);
  assert.equal(g[29], '2024:02:29');
  assert.deepEqual(g[7], [[15, 1], [30, 1], [45, 1]]);
  assert.equal(g[6], undefined);
});

import { readInfo } from '../packages/core/src/info.ts';
test('HEIC with GPS (root-gps-probe.heic): reads out location, camera and date, no longer shows “no location”', async () => {
  const i = await readInfo(fx('root-gps-probe.heic'));
  assert.equal(i.readable, true);
  assert.ok(i.gps && Math.abs(i.gps.lat - 12.345) < 1e-4 && Math.abs(i.gps.lon + 45.678) < 1e-4);
  assert.ok(i.rows.some((r) => r.key === 'Make') && i.rows.some((r) => r.key === 'DateTimeOriginal'));
});
test('truncated HEIC cannot be read: readable=false, the UI shows “cannot be read” instead of “no location”', async () => {
  const i = await readInfo(fx('root-gps-probe.heic').subarray(0, 200));
  assert.equal(i.readable, false);
  assert.equal(i.gps, null);
});

import { capOf, overCap, usedItems } from '../packages/core/src/collagecap.ts';
test('long image already has 30 photos, switch to collage: only the first 20 are used and a limit notice is shown; switch back to long image, all 30 are used', () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(usedItems(items, 'grid'), items.slice(0, 20));
  assert.equal(overCap(items.length, 'grid'), 20);
  assert.equal(usedItems(items, 'strip').length, 30);
  assert.equal(overCap(items.length, 'strip'), 0);
  assert.equal(capOf('grid'), 20);
  assert.equal(capOf('strip'), 30);
});

import { planEncode, resultDetail } from '../packages/core/src/videoplan.ts';
const tt = (k, v = {}) => ({ resChange: 'R {fw}x{fh}>{tw}x{th}', audioNone: 'A-none', audioKept: 'A-kept', audioDropped: 'A-dropped' })[k].replace(/\{(\w+)\}/g, (_, x) => v[x] ?? '');
test('result area: landscape 4K → 1080p, audio kept', () => {
  const m = { w: 3840, h: 2160, rotation: 0, hasAudio: true, audioKept: true };
  assert.equal(resultDetail(m, planEncode({ w: 3840, h: 2160, bitrate: 0, fps: 30, hevc: false }, 'balanced', 1920), tt), 'R 3840x2160>1920x1080 A-kept');
});
test('result area: portrait video (rotated 90) written in display orientation; source with no audio shows “none”, non-AAC audio shows “dropped”', () => {
  const p = planEncode({ w: 1920, h: 1080, bitrate: 0, fps: 30, hevc: false }, 'smaller', 1280);
  assert.equal(resultDetail({ w: 1920, h: 1080, rotation: 90, hasAudio: false, audioKept: false }, p, tt), 'R 1080x1920>720x1280 A-none');
  assert.equal(resultDetail({ w: 1920, h: 1080, rotation: 90, hasAudio: true, audioKept: false }, p, tt), 'R 1080x1920>720x1280 A-dropped');
});

import { borderLayout, POLAROID_MIN } from '../packages/core/src/layout.ts';
test('Polaroid: small photo + 1% border, border width at least POLAROID_MIN, bottom text area large enough', () => {
  const l = borderLayout(400, 300, 'polaroid', 1);
  assert.ok(l.x >= POLAROID_MIN && l.y >= POLAROID_MIN);
  const zone = l.H - (l.y + 300);
  assert.ok(zone * 0.35 >= 12, `font size ${zone * 0.35}`);
  const big = borderLayout(4000, 3000, 'polaroid', 5);
  assert.equal(big.x, 150);
});

test('complete meta but mdat truncated (491 bytes) also counts as unreadable', async () => {
  const i = await readInfo(fx('root-gps-probe.heic').subarray(0, 491));
  assert.equal(i.readable, false);
});
test('Polaroid at 0% still has no border', () => {
  assert.equal(borderLayout(400, 300, 'polaroid', 0).x, 0);
});

import { dumpDict as dd, loadDict as ld, setGps as sg } from '../packages/core/src/exif.ts';
import { readHeifMeta } from '../packages/core/src/isobmff.ts';
test('set location: GPS destination coordinates (GPSDest*) also removed', () => {
  const d = ld(getExifTiff(fx('landscape-gps-xmp.jpg')));
  d.GPS[19] = 'N'; d.GPS[20] = [[1, 1], [2, 1], [3, 1]]; d.GPS[21] = 'E'; d.GPS[22] = [[4, 1], [5, 1], [6, 1]];
  sg(d, 1, 2);
  for (const k of [19, 20, 21, 22]) assert.equal(d.GPS[k], undefined);
  assert.ok(dd(d));
});
test('set location: a small move of about 0.4 m is not treated as “unchanged”', () => {
  const src = fx('landscape-gps-xmp.jpg');
  const g = getGps(loadDict(getExifTiff(src)));
  const out = buildEdited(src, { clearLoc: false, pin: { lat: g.lat + 0.000004, lon: g.lon }, origGps: g, patch: {} }).out;
  assert.ok(Math.abs(getGps(loadDict(getExifTiff(out))).lat - (g.lat + 0.000004)) < 5e-6);
});
test('truncated HEIC: readHeifMeta does not throw (conversion path unchanged), only marks truncated', () => {
  const m = readHeifMeta(fx('root-gps-probe.heic').subarray(0, 491));
  assert.equal(m.truncated, true);
  assert.equal(m.exifTiff, null);
});

test('high-precision coordinates rounded by toFixed(6) from the input box, only author changed, GPS segment (incl. altitude) still unchanged', () => {
  const src = fx('high-precision-gps.jpg');
  const g = getGps(loadDict(getExifTiff(src)));
  const pin = { lat: Number(g.lat.toFixed(6)), lon: Number(g.lon.toFixed(6)) };
  const out = buildEdited(src, { clearLoc: false, pin, origGps: g, patch: { artist: 'Me' } });
  assert.deepEqual(gpsOf(out.out), gpsOf(src));
  assert.equal(out.droppedXmpIptc, false);
});

test('empty file, non-JPEG, JPEG with truncated header segment: readable=false; complete JPEG and JPEG missing only its tail still readable', async () => {
  const full = fx('landscape-gps-xmp.jpg');
  for (const bad of [new Uint8Array(0), full.subarray(0, 300), full.subarray(0, 891), Uint8Array.from([1, 2, 3, 4, 5, 6])]) {
    const i = await readInfo(bad);
    assert.equal(i.readable, false, `length ${bad.length}`);
  }
  const ok = await readInfo(full.subarray(0, full.length - 2));
  assert.equal(ok.readable, true);
  assert.ok(ok.gps);
});
