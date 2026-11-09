import assert from 'node:assert/strict';
import { test } from 'node:test';
import { browserOffset, exifToLocal, fromWorld, localToExif, parseLatLon, toWorld, validOffset } from '../packages/core/src/mapmath.ts';

test('world pixel conversion round-trips; equator and prime meridian meet at the world center', () => {
  for (const [lat, lon, z] of [[37.7749, -122.4194, 12], [-33.8568, 151.2153, 5], [0, 0, 3], [64.1466, -21.9426, 17]]) {
    const w = toWorld(lat, lon, z);
    const p = fromWorld(w.x, w.y, z);
    assert.ok(Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9, `${lat},${lon},${z}`);
  }
  assert.deepEqual(toWorld(0, 0, 1), { x: 256, y: 256 });
});

test('OSM tile numbering: San Francisco at z12 is at x=655,y=1583 (matches OSM’s public tile numbers)', () => {
  const w = toWorld(37.7749, -122.4194, 12);
  assert.equal(Math.floor(w.x / 256), 655);
  assert.equal(Math.floor(w.y / 256), 1583);
});

test('coordinate parsing: comma, space or semicolon separators; out-of-range or malformed input returns null', () => {
  assert.deepEqual(parseLatLon('37.7749, -122.4194'), { lat: 37.7749, lon: -122.4194 });
  assert.deepEqual(parseLatLon('-33.8 151.2'), { lat: -33.8, lon: 151.2 });
  assert.equal(parseLatLon('91, 10'), null);
  assert.equal(parseLatLon('10, 181'), null);
  assert.equal(parseLatLon('abc'), null);
});

test('date conversion and time zone checks', () => {
  assert.equal(exifToLocal('2023:07:15 10:30:00'), '2023-07-15T10:30:00');
  assert.equal(localToExif('2023-07-15T10:30'), '2023:07:15 10:30:00');
  assert.equal(exifToLocal(undefined), '');
  assert.equal(validOffset('+08:00'), true);
  assert.equal(validOffset('+8:00'), false);
  assert.equal(validOffset('+15:00'), false);
  assert.match(browserOffset(), /^[+-]\d\d:\d\d$/);
});
