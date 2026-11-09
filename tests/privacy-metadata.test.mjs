import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dumpDict, loadDict, stripAllFromJpeg, stripLocationFromJpeg } from '../packages/core/src/exif.ts';
import { exifSegs, getExifTiff, looksLikeJpegImage, setExif, walkJpeg } from '../packages/core/src/jpeg.ts';
import { checkLocation, checkTiffLocation, locationLeaks, locationVerdict } from '../packages/core/src/location.ts';
import { prepareExif } from '../packages/core/src/imgmeta.ts';
import { finalizeOutput } from '../packages/core/src/postprocess.ts';
import { buildEdited, origLocationState, readBackSaysNone, savedProblem } from '../packages/core/src/editsave.ts';
import { readInfo } from '../packages/core/src/info.ts';
import { openPhoto } from '../packages/core/src/opensel.ts';
import { TaskGate } from '../packages/core/src/task.ts';

const base = new Uint8Array(readFileSync(new URL('./fixtures/photo/gps-p3-rot6.jpg', import.meta.url)));

const PROG = new Uint8Array(Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAABQb/xAAVAQEBAAAAAAAAAAAAAAAAAAABAv/aAAwDAQACEAMQAAABlGmGqP/EABYQAAMAAAAAAAAAAAAAAAAAAAADBP/aAAgBAQABBQJU4qcVOKnP/8QAFhEBAQEAAAAAAAAAAAAAAAAABQAx/9oACAEDAQE/ASkcv//EABYRAAMAAAAAAAAAAAAAAAAAAAADBP/aAAgBAgEBPwF9x//EABQQAQAAAAAAAAAAAAAAAAAAACD/2gAIAQEABj8CH//EABcQAAMBAAAAAAAAAAAAAAAAAAAhMWH/2gAIAQEAAT8hmjMmiaP/2gAMAwEAAgADAAAAEK//xAAVEQEBAAAAAAAAAAAAAAAAAAAAUf/aAAgBAwEBPxCp/8QAFhEAAwAAAAAAAAAAAAAAAAAAACEx/9oACAECAQE/EKM//8QAFxABAQEBAAAAAAAAAAAAAAAAAPExwf/aAAgBAQABPxCCw5QUF//Z', 'base64'));

const LAT = '31,14.0599N';
const LON = '121,28.5479E';
const XMP = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="${LAT}" exif:GPSLongitude="${LON}"/></rdf:RDF></x:xmpmeta>`;

const leaked = (u8) => { const b = Buffer.from(u8); return b.includes(LAT, 0, 'latin1') || b.includes(LON, 0, 'latin1'); };
const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) (o.set(x, i), (i += x.length)); return o; };
const app1 = (head, body) => { const pl = cat(ascii(head), body); const n = pl.length + 2; return cat(Uint8Array.of(0xff, 0xe1, n >> 8, n & 255), pl); };
const xmpSeg = app1('http://ns.adobe.com/xap/1.0/\0', ascii(XMP));

const withTag700 = (jpg, keepGps = true) => {
  const d = loadDict(getExifTiff(jpg));
  if (!keepGps) d.GPS = {};
  d['0th'][700] = Array.from(ascii(XMP));
  return setExif(jpg, dumpDict(d));
};
const tag700 = withTag700(base);
const tag700Only = withTag700(base, false);

const firstScanEnd = (u8) => {
  let p = 2;
  while (!(u8[p] === 0xff && u8[p + 1] === 0xda)) p += 2 + ((u8[p + 2] << 8) | u8[p + 3]);
  p += 2 + ((u8[p + 2] << 8) | u8[p + 3]);
  while (!(u8[p] === 0xff && u8[p + 1] !== 0 && !(u8[p + 1] >= 0xd0 && u8[p + 1] <= 0xd7))) p++;
  return p;
};
const at = firstScanEnd(PROG);
const progXmp = cat(PROG.subarray(0, at), xmpSeg, PROG.subarray(at));
const scans = (u8) => { let n = 0; for (let i = 0; i + 1 < u8.length; i++) if (u8[i] === 0xff && u8[i + 1] === 0xda) n++; return n; };

test('sample self-check: coordinates really are in the sample, progressive sample structure is valid', () => {
  for (const s of [tag700, tag700Only, progXmp]) assert.ok(leaked(s));
  assert.ok(scans(PROG) > 1, 'must be a multi-scan progressive JPEG');
  assert.ok(looksLikeJpegImage(PROG) && looksLikeJpegImage(progXmp));
});

test('tag 700: after location removal, coordinates in embedded XMP are not in the output', () => {
  for (const s of [tag700, tag700Only]) {
    const out = stripLocationFromJpeg(s);
    assert.equal(leaked(out), false, 'tag 700 coordinates still present after location removal');
    assert.deepEqual(locationLeaks(out, { strict: true }), []);
  }
});
test('tag 700: check function recognises coordinates in tag 700 (it used to only look at the GPS block and report “no location”)', () => {
  const d = loadDict(getExifTiff(tag700));
  d.GPS = {};
  const old = setExif(tag700, dumpDict(d));
  assert.ok(leaked(old));
  assert.ok(locationLeaks(old).length > 0, 'check missed coordinates in tag 700');
});
test('tag 700: prepareExif, shared by compress, resize and format convert, leaves no embedded coordinates after removing location', () => {
  for (const s of [tag700, tag700Only]) {
    const r = prepareExif(getExifTiff(s), { removeLocation: true, removeAllExif: false }, 16, 16);
    assert.equal(leaked(r.tiff), false, 'prepareExif output EXIF still has tag 700 coordinates');
    assert.equal(r.hadGps, true, 'coordinates in embedded XMP also count as the original carrying location');
  }
});
test('tag 700: HEIC to JPG finalizeOutput leaves no embedded coordinates after removing location; the conclusion is based on the checked output', async () => {
  const encoded = setExif(base, null);
  for (const s of [tag700, tag700Only]) {
    const fin = await finalizeOutput(encoded, { exifTiff: getExifTiff(s) }, { format: 'jpeg', removeLocation: true, removeAllExif: false }, 16, 16, null);
    assert.equal(leaked(fin.bytes), false, 'HEIC to JPG output still has tag 700 coordinates');
    assert.equal(fin.gpsRemoved, true);
    assert.equal(fin.gpsUnsure, false);
  }
  const kept = await finalizeOutput(encoded, { exifTiff: getExifTiff(tag700Only) }, { format: 'jpeg', removeLocation: false, removeAllExif: false }, 16, 16, null);
  assert.ok(leaked(kept.bytes) && kept.hadGps && !kept.gpsRemoved, 'when location is kept, the page says so truthfully');
});
test('tag 700: EXIF editor removes location or replaces it with new coordinates, no old embedded coordinates remain', () => {
  const origGps = { lat: 37.7749, lon: -122.4194 };
  const clr = buildEdited(tag700, { clearLoc: true, pin: null, origGps, patch: {} });
  assert.equal(leaked(clr.out), false, 'editor: tag 700 coordinates still present after removing location');
  const moved = buildEdited(tag700, { clearLoc: false, pin: { lat: 10, lon: 20 }, origGps, patch: {} });
  assert.equal(leaked(moved.out), false, 'editor: old tag 700 coordinates still present after replacing coordinates');
});

test('progressive: removing location or all metadata clears XMP between scans, output is still a complete JPEG with the same scan count', () => {
  for (const out of [stripLocationFromJpeg(progXmp), stripAllFromJpeg(progXmp)]) {
    assert.equal(leaked(out), false, 'XMP coordinates between scans still present');
    assert.ok(looksLikeJpegImage(out));
    assert.equal(scans(out), scans(PROG));
    assert.deepEqual(locationLeaks(out, { strict: true }), []);
  }
});
test('progressive: check function walks the whole file and recognises XMP between scans', () => {
  assert.ok(locationLeaks(progXmp).includes('XMP location'), 'check stopped at the first SOS');
});

test('cannot verify: when file structure cannot be walked through or EXIF cannot be read, checkLocation returns unsure', () => {
  const cut = PROG.subarray(0, at + 3);
  assert.ok(checkLocation(cut).unsure.length > 0);
  const badExif = cat(base.subarray(0, 2), app1('Exif\0\0', ascii('MM\0*garbage')), base.subarray(2));
  assert.ok(checkLocation(badExif).unsure.includes('EXIF'));
  assert.deepEqual(checkLocation(stripLocationFromJpeg(base)).unsure, [], 'a normal file should not be reported as unverifiable');
});

test('conclusion: if location is still found in the output, do not say “removed”; if unverifiable, say it could not be confirmed', () => {
  assert.deepEqual(locationVerdict(true, true, { leaks: ['EXIF XMP location'], unsure: [] }), { hadGps: true, gpsRemoved: false, gpsUnsure: false });
  assert.deepEqual(locationVerdict(false, true, { leaks: ['XMP location'], unsure: [] }), { hadGps: true, gpsRemoved: false, gpsUnsure: false });
  assert.deepEqual(locationVerdict(true, true, { leaks: [], unsure: ['EXIF'] }), { hadGps: true, gpsRemoved: false, gpsUnsure: true });
  assert.deepEqual(locationVerdict(true, true, { leaks: [], unsure: [] }), { hadGps: true, gpsRemoved: true, gpsUnsure: false });
});

const truncated = base.subarray(0, base.length - 32);
const soiOnly = Uint8Array.of(0xff, 0xd8);
test('truncated files, files with only FFD8, and FFD8FFD9 are not complete JPEGs', () => {
  assert.equal(looksLikeJpegImage(truncated), false, 'JPEG with its end cut off was treated as complete');
  assert.equal(looksLikeJpegImage(soiOnly), false);
  assert.equal(looksLikeJpegImage(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9)), false);
  assert.equal(looksLikeJpegImage(base), true);
});
test('EXIF editor entry blocks a fake JPEG that is only FFD8 (it used to check only the first two bytes)', async () => {
  const calls = [];
  const deps = {
    read: async (b) => b,
    isJpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
    checkJpeg: (b) => { if (!looksLikeJpegImage(b)) throw new Error('bad'); },
    looksHeif: async () => false,
    convert: async () => { throw new Error('no'); },
    begin: () => {},
    ready: () => calls.push('ready'),
    fail: () => calls.push('fail'),
  };
  for (const b of [soiOnly, truncated]) {
    calls.length = 0;
    await openPhoto(new TaskGate(), b, deps);
    assert.deepEqual(calls, ['fail']);
  }
  calls.length = 0;
  await openPhoto(new TaskGate(), base, deps);
  assert.deepEqual(calls, ['ready']);
});
test('after saving, if read-back gives readable:false or no valid image, it must not report saved', async () => {

  const fake = buildEdited(soiOnly, { clearLoc: false, pin: null, origGps: null, patch: { make: 'X' } }).out;
  const back = await readInfo(fake);
  assert.equal(back.image, false, 'fake JPEG treated as having an image');
  assert.notEqual(savedProblem(back, false), null, 'fake JPEG judged saveable');
  assert.equal(savedProblem({ readable: false, image: true, gps: null }, false), 'unreadable');

  assert.equal(savedProblem({ readable: true, image: false, gps: null }, false), 'image', 'metadata readable but no image, still judged saveable');
  const hollow = buildEdited(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9), { clearLoc: false, pin: null, origGps: null, patch: { make: 'X' } }).out;
  assert.equal((await readInfo(hollow)).image, false);
  const ok = buildEdited(base, { clearLoc: true, pin: null, origGps: null, patch: {} }).out;
  assert.equal(savedProblem(await readInfo(ok), true), null);
});
test('truncated input: readInfo reports “metadata readable” and “image complete” separately', async () => {
  const i = await readInfo(truncated);
  assert.equal(i.image, false);
  assert.equal((await readInfo(base)).image, true);
});

test('walkJpeg boundaries: fill bytes, FF00 / RSTn inside scans, and trailing data after EOI are not misjudged', () => {
  const w = walkJpeg(PROG);
  assert.ok(w.complete && w.scans.length === scans(PROG));

  const fill = cat(PROG.subarray(0, at), Uint8Array.of(0xff, 0xff), PROG.subarray(at));
  assert.ok(looksLikeJpegImage(fill));

  const rst = cat(PROG.subarray(0, at), Uint8Array.of(0xff, 0x00, 0xff, 0xd0), PROG.subarray(at));
  assert.equal(walkJpeg(rst).scans.length, scans(PROG));
  assert.ok(looksLikeJpegImage(rst));

  const tail = cat(PROG, xmpSeg);
  assert.ok(looksLikeJpegImage(tail));
  assert.ok(locationLeaks(tail).length > 0, 'coordinates in the trailing data were not found');
  assert.equal(leaked(stripLocationFromJpeg(tail)), false);
});
test('removing location also strips IPTC (33723) and the Photoshop resource block (34377); checkTiffLocation recognises tag 700', () => {
  const d = loadDict(getExifTiff(base));
  d['0th'][34377] = Array.from(ascii('8BIM' + LAT));
  d['0th'][700] = Array.from(ascii(XMP));
  const s = setExif(base, dumpDict(d));
  assert.ok(leaked(s));
  assert.equal(leaked(stripLocationFromJpeg(s)), false, 'content in the Photoshop resource block still present');
  assert.ok(checkTiffLocation(getExifTiff(tag700Only)).leaks.includes('EXIF XMP location'));
  assert.deepEqual(checkTiffLocation(prepareExif(getExifTiff(tag700Only), { removeLocation: true, removeAllExif: false }, 16, 16).tiff), { leaks: [], unsure: [] });
  assert.deepEqual(checkTiffLocation(Uint8Array.of(1, 2, 3)).unsure, ['EXIF']);
});
test('user-written description text containing the word GPSLatitude is not treated as leftover location', () => {
  const d = loadDict(getExifTiff(base));
  d['0th'][270] = 'GPSLatitude test caption';
  const out = stripLocationFromJpeg(setExif(base, dumpDict(d)));
  assert.deepEqual(locationLeaks(out, { strict: true }), []);
});
test('checkLocation on a file broken before the first scan returns unsure without throwing', () => {
  const bad = Uint8Array.of(0xff, 0xd8, 0x12, 0x34, 0x56, 0x78);
  assert.ok(checkLocation(bad).unsure.length > 0);
});
test('original location only in tag 700 / XMP: readInfo flags hiddenLoc (the UI does not say “no location”)', async () => {
  const i = await readInfo(tag700Only);
  assert.equal(i.gps, null);
  assert.equal(i.hiddenLoc, true);
  assert.equal((await readInfo(progXmp)).hiddenLoc, true);
  assert.equal((await readInfo(stripLocationFromJpeg(base))).hiddenLoc, false);
});

test('fake JPEG with only 1 byte of scan data is not treated as complete', () => {
  const w = walkJpeg(PROG);
  const s0 = w.scans[0].sos;
  const fake = cat(PROG.subarray(0, s0.end), Uint8Array.of(0x00), Uint8Array.of(0xff, 0xd9));
  assert.equal(looksLikeJpegImage(fake), false);
});
test('when the original EXIF cannot be read, do not say “there was never a location”', async () => {
  const junk = ascii('MM\0*garbage-tiff');
  assert.deepEqual(locationVerdict(false, false, { leaks: [], unsure: [] }, true), { hadGps: false, gpsRemoved: false, gpsUnsure: true });
  assert.deepEqual(locationVerdict(false, true, { leaks: [], unsure: [] }, true), { hadGps: true, gpsRemoved: true, gpsUnsure: false });
  const encoded = setExif(base, null);
  const keep = await finalizeOutput(encoded, { exifTiff: junk }, { format: 'jpeg', removeLocation: false, removeAllExif: false }, 16, 16, null);
  assert.equal(keep.gpsUnsure, true, 'original EXIF cannot be read and location is kept: must not say it was never there');
  const rm = await finalizeOutput(encoded, { exifTiff: junk }, { format: 'jpeg', removeLocation: true, removeAllExif: false }, 16, 16, null);
  assert.ok(rm.gpsRemoved && !rm.gpsUnsure && !leaked(rm.bytes));
});
test('when the original EXIF cannot be read, readInfo flags locUnsure (the original card does not say “no location”)', async () => {
  const badExif = cat(base.subarray(0, 2), app1('Exif\0\0', ascii('MM\0*garbage')), base.subarray(2));
  const i = await readInfo(badExif);
  assert.ok(!i.readable || i.locUnsure || i.hiddenLoc, 'reads a location but still says no location');
  assert.equal(checkLocation(badExif, { exif: false }).unsure.includes('EXIF'), true);
  assert.equal((await readInfo(stripLocationFromJpeg(base))).locUnsure, false);
});

test('editor’s “existing location”: when the GPS block has no coordinates, tell apart location hidden in XMP, unable to determine, and truly absent', () => {
  assert.equal(origLocationState(tag700Only, false), 'hidden');
  assert.equal(origLocationState(progXmp, false), 'hidden');
  const badExif = cat(base.subarray(0, 2), app1('Exif\0\0', ascii('MM\0*garbage')), stripLocationFromJpeg(base).subarray(2));
  assert.equal(origLocationState(badExif, false), 'unsure');
  assert.equal(origLocationState(stripLocationFromJpeg(base), false), 'none');
  assert.equal(origLocationState(base, true), 'gps');
});

test('location present only in IPTC, only in a second EXIF segment, or only in an embedded image after EOI: neither the original card nor the editor says “no location”', async () => {
  const clean = stripLocationFromJpeg(base);
  const iptcBody = cat(ascii('Photoshop 3.0\0'), ascii('8BIM'), Uint8Array.of(0x04, 0x04, 0, 0, 0, 0, 0, 12), Uint8Array.of(0x1c, 2, 90, 0, 8), ascii('Shanghai'));
  const n = iptcBody.length + 2;
  const iptcOnly = cat(clean.subarray(0, 2), Uint8Array.of(0xff, 0xed, n >> 8, n & 255), iptcBody, clean.subarray(2));
  const secondExif = cat(PROG.subarray(0, at), app1('Exif\0\0', getExifTiff(base)), PROG.subarray(at));
  const tailExif = cat(clean, Uint8Array.of(0xff, 0xd8), app1('Exif\0\0', getExifTiff(base)), Uint8Array.of(0xff, 0xd9));
  for (const [name, s, want] of [['iptc', iptcOnly, 'unsure'], ['second', secondExif, 'hidden'], ['tail', tailExif, 'unsure']]) {
    assert.equal(origLocationState(s, false), want, name);
    const i = await readInfo(s);
    assert.ok(!i.readable || i.gps || i.hiddenLoc || i.locUnsure, name + ' original card says there is no location');
  }
  assert.equal(origLocationState(clean, false), 'none');
});

const iptcSeg = (() => {
  const body = cat(ascii('Photoshop 3.0\0'), ascii('8BIM'), Uint8Array.of(0x04, 0x04, 0, 0, 0, 0, 0, 12), Uint8Array.of(0x1c, 2, 90, 0, 8), ascii('Shanghai'));
  const n = body.length + 2;
  return cat(Uint8Array.of(0xff, 0xed, n >> 8, n & 255), body);
})();
test('editor changes only the date and the photo has IPTC: after saving and reading back, does not write “location: none”', async () => {
  const clean = stripLocationFromJpeg(base);
  const withIptc = cat(clean.subarray(0, 2), iptcSeg, clean.subarray(2));
  const built = buildEdited(withIptc, { clearLoc: false, pin: null, origGps: null, patch: { dateTimeOriginal: '2020:01:02 03:04:05' } });
  const back = await readInfo(built.out);
  assert.equal(readBackSaysNone(back, built.locationUnsure), false, 'IPTC still present, but read-back writes “none”');
  const plain = buildEdited(clean, { clearLoc: false, pin: null, origGps: null, patch: { dateTimeOriginal: '2020:01:02 03:04:05' } });
  assert.equal(readBackSaysNone(await readInfo(plain.out), plain.locationUnsure), true);
});
test('no JFIF in the file header and an APP0 between scans: new EXIF goes into the file header, not between scans', () => {
  const noJfif = PROG[2] === 0xff && PROG[3] === 0xe0 ? cat(PROG.subarray(0, 2), PROG.subarray(4 + ((PROG[4] << 8) | PROG[5]))) : PROG;
  const app0 = Uint8Array.of(0xff, 0xe0, 0, 4, 1, 2);
  const s = cat(noJfif.subarray(0, firstScanEnd(noJfif)), app0, noJfif.subarray(firstScanEnd(noJfif)));
  const out = setExif(s, getExifTiff(base));
  const firstScan = walkJpeg(out).scans[0].sos.start;
  assert.ok(exifSegs(out).every((x) => x.start < firstScan), 'EXIF was inserted between scans');
  assert.ok(looksLikeJpegImage(out));
});
