import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dumpDict, getGps, loadDict, stripAllFromJpeg, stripLocationFromJpeg } from '../packages/core/src/exif.ts';
import { extrasLeft, getExifTiff, getIcc, imageEnd, rewrite, segments, setExif } from '../packages/core/src/jpeg.ts';
import { locationLeaks } from '../packages/core/src/location.ts';
import { buildEdited } from '../packages/core/src/editsave.ts';

const base = new Uint8Array(readFileSync(new URL('./fixtures/photo/gps-p3-rot6.jpg', import.meta.url)));
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const seg = (marker, payload) => Uint8Array.from([0xff, marker, (payload.length + 2) >> 8, (payload.length + 2) & 255, ...payload]);
const cat = (...p) => Uint8Array.from(p.flatMap((x) => [...x]));
const text = (u8) => Buffer.from(u8).toString('latin1');

const COM_TEXT = 'QAX SYNTHETIC Location: 12.345678, -45.678901; capture 2024-02-03; Camera QAX';
const withExtras = (jpg) => {
  const injected = rewrite(jpg, { insert: [seg(0xfe, ascii(COM_TEXT)), seg(0xe2, cat(ascii('MPF\0'), ascii('mpfdata'))), seg(0xe5, ascii('VENDOR5 12.345678,-45.678901\0'))] });
  return cat(injected, ascii('TAILGPS 12.345678,-45.678901'));
};
const dirty = withExtras(base);

test('sample: COM / MPF / vendor segment / trailing data are present, and the check function detects them', () => {
  assert.ok(text(dirty).includes('QAX SYNTHETIC'));
  assert.deepEqual(extrasLeft(dirty).sort(), ['APPn', 'COM', 'trailing data']);
  assert.ok(locationLeaks(stripLocationFromJpegOld(dirty), { strict: true }).includes('COM'));
});

function stripLocationFromJpegOld(jpg) {
  return rewrite(jpg, { dropXmp: true, dropIptc: true });
}

test('remove location: COM, MPF, vendor segments and trailing data are all stripped, GPS is cleared, ICC is kept, and the output is still a parseable JPEG', () => {
  const out = stripLocationFromJpeg(dirty);
  const s = text(out);
  for (const w of ['QAX SYNTHETIC', 'VENDOR5', 'TAILGPS', 'mpfdata']) assert.ok(!s.includes(w), w);
  assert.deepEqual(extrasLeft(out), []);
  assert.deepEqual(locationLeaks(out, { strict: true }), []);
  assert.equal(getGps(loadDict(getExifTiff(out))), null);
  assert.ok(getIcc(out) && getIcc(out).length === getIcc(base).length, 'ICC kept');
  assert.equal(imageEnd(out), out.length);
  assert.ok(segments(out).length > 0);
});

test('remove everything: COM and the like are also not left behind', () => {
  const out = stripAllFromJpeg(dirty);
  assert.ok(!text(out).includes('QAX SYNTHETIC') && !text(out).includes('TAILGPS'));
  assert.deepEqual(extrasLeft(out), []);
  assert.deepEqual(Object.keys(loadDict(getExifTiff(out))['0th']), ['274'], 'only the orientation tag is left');
});

test('editor “remove location”: COM and the like are removed too; when location is not changed, COM is left alone', () => {
  const origGps = getGps(loadDict(getExifTiff(dirty)));
  const cleared = buildEdited(dirty, { clearLoc: true, pin: null, origGps, patch: {} });
  assert.ok(!text(cleared.out).includes('QAX SYNTHETIC'));
  assert.deepEqual(extrasLeft(cleared.out), []);
  assert.equal(cleared.droppedXmpIptc, true);
  const kept = buildEdited(dirty, { clearLoc: false, pin: origGps, origGps, patch: { make: 'X' } });
  assert.ok(text(kept.out).includes('QAX SYNTHETIC'), 'location not changed, comment left untouched');
});

test('imageEnd: FF00 / RST inside entropy-coded data are not treated as the end; for a normal JPEG the end equals the file length', () => {
  assert.equal(imageEnd(base), base.length);
  const noEoi = base.subarray(0, base.length - 2);
  assert.equal(imageEnd(noEoi), noEoi.length);
});

import { openPhoto } from '../packages/core/src/opensel.ts';
import { TaskGate } from '../packages/core/src/task.ts';

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const mkDeps = (log, files) => ({
  read: async (f) => (await delay(files[f].readMs), files[f].bytes),
  isJpeg: (b) => b[0] === 0xff,
  looksHeif: async () => true,
  convert: async (f) => (await delay(files[f].convMs ?? 0), new Uint8Array([0xff, 1])),
  begin: () => log.push('begin'),
  ready: (f) => log.push('ready:' + f),
  fail: (e, np) => log.push('fail:' + (np ? 'notphoto' : e.message)),
});

test('select a slow HEIC first, then a fast JPG: only the JPG enters the editor, and the HEIC does nothing when it finishes late', async () => {
  const log = [];
  const files = { A: { readMs: 10, bytes: new Uint8Array([0, 0]), convMs: 80 }, B: { readMs: 5, bytes: new Uint8Array([0xff, 0xd8]) } };
  const gate = new TaskGate();
  const a = openPhoto(gate, 'A', mkDeps(log, files));
  const b = openPhoto(gate, 'B', mkDeps(log, files));
  assert.deepEqual(await Promise.all([a, b]), [false, true]);
  assert.deepEqual(log.filter((x) => x !== 'begin'), ['ready:B']);
});

test('an error from an old selection must not clear the editor for the new selection; an error from the current selection still shows', async () => {
  const log = [];
  const deps = (f) => ({ ...mkDeps(log, { A: { readMs: 5, bytes: new Uint8Array([1]) }, B: { readMs: 20, bytes: new Uint8Array([0xff]) } }), convert: async () => { throw new Error('decode ' + f); } });
  const gate = new TaskGate();
  const a = openPhoto(gate, 'A', deps('A'));
  const b = openPhoto(gate, 'B', deps('B'));
  await Promise.all([a, b]);
  assert.deepEqual(log.filter((x) => x !== 'begin'), ['ready:B']);
  const log2 = [];
  const gate2 = new TaskGate();
  await openPhoto(gate2, 'A', { ...mkDeps(log2, { A: { readMs: 1, bytes: new Uint8Array([1]) } }), convert: async () => { throw new Error('boom'); } });
  assert.deepEqual(log2, ['begin', 'fail:boom']);
});

import { exportWithSnapshot } from '../packages/core/src/exportsnap.ts';

test('format changed from JPG to PNG during export: bytes and suffix still use the format at click time', async () => {
  const st = { format: 'jpeg' };
  const snap = { format: st.format, name: 'plain-border' };
  let got;
  const encode = async (s) => (await delay(20), (st.format = 'png'), new Blob([s.format === 'png' ? 'PNGBYTES' : 'JPEGBYTES']));
  const delivered = await exportWithSnapshot(snap, encode, () => true, (b, name) => (got = { b, name }));
  assert.equal(delivered, true);
  assert.equal(got.name, 'plain-border.jpg');
  assert.equal(await got.b.text(), 'JPEGBYTES');
});

test('photo swapped or cleared during export: nothing is delivered', async () => {
  let cur = true;
  const delivered = await exportWithSnapshot({ format: 'png', name: 'x' }, async () => (await delay(5), (cur = false), new Blob(['a'])), () => cur, () => assert.fail('should not download'));
  assert.equal(delivered, false);
});

test('wiring: border and collage downloads both go through exportWithSnapshot; the download point no longer reads st.format again to build the file name', () => {
  for (const f of ['photo-border', 'photo-collage']) {
    const src = readFileSync(new URL(`../tools/${f}/main.ts`, import.meta.url), 'utf8');
    assert.match(src, /exportWithSnapshot\(snap,/, f);
    assert.doesNotMatch(src, /downloadBlob\([^)]*st\.format/, f + ' must not read st.format again after await');
  }
});

import { readInfo } from '../packages/core/src/info.ts';

test('strip all EXIF: orientation tag is kept (orientation only), no camera/date/GPS', async () => {
  const out = stripAllFromJpeg(base);
  const d = loadDict(getExifTiff(out));
  assert.equal(d['0th'][274], 6, 'orientation 6 kept');
  assert.deepEqual(Object.keys(d['0th']), ['274']);
  assert.deepEqual(Object.keys(d.Exif ?? {}), []);
  assert.equal(getGps(d), null);
  const info = await readInfo(out);
  assert.deepEqual(info.rows.map((r) => r.key), ['Orientation']);
});

test('orientation is 1 or absent: after stripping everything, no EXIF segment remains', () => {
  const upright = setExif(base, dumpDict({ '0th': { 274: 1 }, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null }));
  assert.equal(getExifTiff(stripAllFromJpeg(upright)), null);
  assert.equal(getExifTiff(stripAllFromJpeg(setExif(base, null))), null);
});

test('wiring: the location-clearing page’s “remove location” is locked on, removeLocation is always true, and there is no longer a switch that makes JPEG and HEIC behave differently', () => {
  const src = readFileSync(new URL('../tools/remove-photo-location/main.ts', import.meta.url), 'utf8');
  assert.match(src, /const loc = h\('input', \{ type: 'checkbox', checked: true, disabled: true \}\)/);
  assert.doesNotMatch(src, /opt\.removeLocation\s*=/);
  assert.match(src, /const opt: Opts = \{ removeLocation: true,/);
});

import { looksLikeJpegImage } from '../packages/core/src/jpeg.ts';

test('four bytes FFD8FFD9 / truncated header / random content is not an image; a real JPEG (including one with COM added) is', () => {
  assert.equal(looksLikeJpegImage(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)), false);
  assert.equal(looksLikeJpegImage(base.subarray(0, 300)), false);
  assert.equal(looksLikeJpegImage(Uint8Array.of(0xff, 0xd8, 1, 2, 3, 4, 5, 6)), false);
  assert.equal(looksLikeJpegImage(new Uint8Array(0)), false);
  assert.equal(looksLikeJpegImage(base), true);
  assert.equal(looksLikeJpegImage(dirty), true);
});

test('wiring: the location-clearing page validates JPEG structure before reading info', () => {
  const src = readFileSync(new URL('../tools/remove-photo-location/main.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(!heic && !looksLikeJpegImage\(src\)\) throw new Error\(t\('badJpeg'\)\)/);
});

test('wiring: the intermediate representation for HEIC loading (shared by border and collage) is lossless PNG, not going through JPEG', () => {
  const src = readFileSync(new URL('../packages/core/src/image.ts', import.meta.url), 'utf8');
  const call = src.match(/convertHeic\(f, \{[^}]*\}\)/)?.[0] ?? '';
  assert.match(call, /format: 'png'/);
  assert.doesNotMatch(call, /format: 'jpeg'/);
});

import { hasHiddenAudio } from '../packages/core/src/videoplan.ts';

test('track table from a measured Live Photo MOV (lpcm classified as metadata by mp4box): detects audio; a silent video is not reported as having audio', () => {
  const live = JSON.parse(readFileSync(new URL('./fixtures/live-photo-tracks.json', import.meta.url), 'utf8'));
  assert.equal(hasHiddenAudio(live.tracks), true);
  assert.equal(hasHiddenAudio([{ codec: 'hvc1.1.6.L123.b0', type: 'video' }, { codec: 'mebx', type: 'metadata' }]), false);
  assert.equal(hasHiddenAudio([{ codec: 'mp4a.40.2', type: 'audio' }]), false, 'AAC tracks use the existing audioTracks path');
  assert.equal(hasHiddenAudio(undefined), false);
});

test('wiring: hasAudio checks both audioTracks and hidden PCM tracks', () => {
  const src = readFileSync(new URL('../packages/core/src/transcode.ts', import.meta.url), 'utf8');
  assert.match(src, /hasAudio: !!a \|\| hasHiddenAudio\(info\.tracks\)/);
});

import { MAX_FIELD_CHARS, TooLongError } from '../packages/core/src/editsave.ts';

test('note with 6000 repeats of “test note”: throws TooLongError (the UI maps it to a localized hint) instead of showing the internal English “segment too large”', () => {
  const origGps = getGps(loadDict(getExifTiff(base)));
  const long = '测试说明'.repeat(6000);
  assert.throws(() => buildEdited(base, { clearLoc: false, pin: origGps, origGps, patch: { description: long } }), (e) => e instanceof TooLongError && !/segment/.test(e.message));
});

test('worst case at the character limit (5 boxes all full, 3 bytes per character) can still be saved', () => {
  const origGps = getGps(loadDict(getExifTiff(base)));
  const s = '说'.repeat(MAX_FIELD_CHARS);
  const r = buildEdited(base, { clearLoc: false, pin: origGps, origGps, patch: { make: s, model: s, artist: s, description: s, copyright: s } });
  assert.ok(r.out.length > 0);
});

test('wiring: after moving a collage image up or down, refocus puts focus back on the same image’s button', () => {
  const src = readFileSync(new URL('../tools/photo-collage/main.ts', import.meta.url), 'utf8');
  assert.match(src, /refocus = \{ i: j, d \}; draw\(\)/);
  assert.match(src, /\.focus\(\)/);
});
