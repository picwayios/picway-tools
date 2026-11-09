import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dumpDict, getGps, hasGps, loadDict, removeLocation, setGps, stripLocationFromJpeg } from '../packages/core/src/exif.ts';
import { dropXmpIptc, exifSegment, getExifTiff, rewrite, setExif, xmpTexts } from '../packages/core/src/jpeg.ts';
import { locationLeaks } from '../packages/core/src/location.ts';
import { buildEdited, LocationLeakError } from '../packages/core/src/editsave.ts';
import { parseCoordInputs } from '../packages/core/src/mapmath.ts';
import { Reprocessor } from '../packages/core/src/reprocess.ts';

const dir = new URL('./fixtures/photo/', import.meta.url);
const base = new Uint8Array(readFileSync(new URL('gps-p3-rot6.jpg', dir)));

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const xmpSeg = (xml, head = 'http://ns.adobe.com/xap/1.0/\0') => {
  const payload = Uint8Array.from([...ascii(head), ...ascii(xml)]);
  const len = payload.length + 2;
  return Uint8Array.from([0xff, 0xe1, len >> 8, len & 255, ...payload]);
};
const XMP = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:exif="http://ns.adobe.com/exif/1.0/" exif:GPSLatitude="12,30.0N" exif:GPSLongitude="45,15.0E"/></rdf:RDF></x:xmpmeta>';
const noGps = (jpg) => {
  const d = loadDict(getExifTiff(jpg));
  return setExif(jpg, dumpDict(removeLocation(d)));
};
const exifOnly = noGpsXmp(base);
function noGpsXmp(jpg) { return rewrite(jpg, { dropXmp: true, dropIptc: true }); }
const xmpOnly = rewrite(noGps(base), { insert: [xmpSeg(XMP)] });
const both = rewrite(base, { insert: [xmpSeg(XMP)] });

test('samples: the location carried by each of the three synthetic files', () => {
  assert.ok(hasGps(loadDict(getExifTiff(exifOnly))) && xmpTexts(exifOnly).length === 0);
  assert.ok(!hasGps(loadDict(getExifTiff(xmpOnly))) && /exif:GPSLatitude/.test(xmpTexts(xmpOnly).join()));
  assert.ok(hasGps(loadDict(getExifTiff(both))) && /exif:GPSLatitude/.test(xmpTexts(both).join()));
});

test('repro: after only removeLocation + setExif (the editor’s old approach), XMP coordinates remain and the check function catches them', () => {
  for (const [name, jpg] of [['xmpOnly', xmpOnly], ['both', both]]) {
    const old = setExif(jpg, dumpDict(removeLocation(loadDict(getExifTiff(jpg)))));
    assert.ok(locationLeaks(old, { strict: true }).includes('XMP location'), name + ' should report leftover XMP location');
  }
});

test('after the fix: shared cleanup (EXIF+XMP+IPTC) leaves all three samples clean, check passes', () => {
  for (const [name, jpg] of [['exifOnly', exifOnly], ['xmpOnly', xmpOnly], ['both', both]]) {
    const out = stripLocationFromJpeg(jpg);
    assert.deepEqual(locationLeaks(out, { strict: true }), [], name);
    assert.equal(getGps(loadDict(getExifTiff(out))), null, name);
  }
});

test('check function: clean file not flagged; EXIF with GPS is flagged', () => {
  assert.deepEqual(locationLeaks(stripLocationFromJpeg(both), { strict: true }), []);
  assert.ok(locationLeaks(exifOnly).includes('EXIF GPS'));
  assert.deepEqual(locationLeaks(both, { exif: false }), ['XMP location']);
});

const origGps = (jpg) => getGps(loadDict(getExifTiff(jpg)));
test('editor: tick “strip location”, EXIF and XMP location gone from all three sample outputs', () => {
  for (const [name, jpg] of [['exifOnly', exifOnly], ['xmpOnly', xmpOnly], ['both', both]]) {
    const { out } = buildEdited(jpg, { clearLoc: true, pin: null, origGps: origGps(jpg), patch: {} });
    assert.deepEqual(locationLeaks(out, { strict: true }), [], name);
    assert.equal(getGps(loadDict(getExifTiff(out))), null, name);
    assert.ok(!/GPS/.test(xmpTexts(out).join()), name + ' has no GPS in XMP');
  }
});
test('editor: when replaced with new coordinates, old XMP coordinates must not remain either', () => {
  const { out, droppedXmpIptc } = buildEdited(both, { clearLoc: false, pin: { lat: 10, lon: 20 }, origGps: origGps(both), patch: {} });
  assert.equal(droppedXmpIptc, true);
  assert.deepEqual(locationLeaks(out, { exif: false, strict: true }), []);
  const g = getGps(loadDict(getExifTiff(out)));
  assert.ok(Math.abs(g.lat - 10) < 1e-3 && Math.abs(g.lon - 20) < 1e-3);
});
test('editor: when location is untouched, XMP is untouched (nothing extra deleted)', () => {
  const { out, droppedXmpIptc } = buildEdited(both, { clearLoc: false, pin: origGps(both), origGps: origGps(both), patch: { make: 'X' } });
  assert.equal(droppedXmpIptc, false);
  assert.ok(xmpTexts(out).length === 1);
});
test('check: if cleanup is incomplete, it errors and gives no file', () => {
  assert.ok(LocationLeakError);
  const bad = locationLeaks(both, { strict: true });
  assert.ok(bad.includes('EXIF GPS') && bad.includes('XMP location'));
});

test('coordinate input: invalid values such as 999 are marked bad, valid values pass', () => {
  assert.deepEqual(parseCoordInputs('999', '10'), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('-90.5', '10'), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('10', '181'), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('10', ''), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('abc', '10'), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('1e2', '10'), { kind: 'bad' });
  assert.deepEqual(parseCoordInputs('', ''), { kind: 'empty' });
  assert.deepEqual(parseCoordInputs('90', '-180'), { kind: 'ok', lat: 90, lon: -180 });
  assert.deepEqual(parseCoordInputs(' −12.5 ', '0.000001'), { kind: 'ok', lat: -12.5, lon: 0.000001 });
});

const deferred = () => {
  let res;
  const p = new Promise((r) => (res = r));
  return { p, res };
};
const mk = () => {
  const opt = { fmt: 'jpg' };
  const log = { starts: [], done: [], runs: [] };
  const gates = [];
  const q = new Reprocessor({
    snapshot: () => ({ ...opt }),
    run: async (item, o) => {
      log.runs.push(item.name + ':' + o.fmt);
      const d = deferred();
      gates.push(d);
      await d.p;
      return item.name + '.' + o.fmt;
    },
    start: (item) => log.starts.push(item.name),
    done: (item, r, o) => log.done.push([item.name, r, o.fmt]),
    fail: () => {},
  });
  return { opt, log, gates, q };
};
const flush = () => new Promise((r) => setTimeout(r, 5));

test('switch to JPG first, then PNG: old JPG result discarded, PNG regenerated automatically', async () => {
  const { opt, log, gates, q } = mk();
  q.add({ name: 'a', gen: -1 });
  await flush();
  gates[0].res();
  await flush();
  assert.deepEqual(log.done, [['a', 'a.jpg', 'jpg']]);
  assert.equal(q.settled, 1);
  opt.fmt = 'png';
  q.invalidate();
  assert.equal(q.settled, 0, 'old result is invalid immediately after changing settings');
  await flush();
  gates[1].res();
  await flush();
  assert.deepEqual(log.done.at(-1), ['a', 'a.png', 'png']);
  assert.equal(q.settled, 1);
});
test('change settings during conversion: this result is discarded, not shown with old settings; only the settings copied at start are used', async () => {
  const { opt, log, gates, q } = mk();
  q.add({ name: 'a', gen: -1 });
  await flush();
  opt.fmt = 'png';
  q.invalidate();
  gates[0].res();
  await flush();
  assert.deepEqual(log.done, [], 'a result made with old settings is never shown');
  await flush();
  gates[1].res();
  await flush();
  assert.deepEqual(log.done, [['a', 'a.png', 'png']]);
  assert.deepEqual(log.runs, ['a:jpg', 'a:png']);
});
test('after clearing the list, in-progress results no longer appear', async () => {
  const { log, gates, q } = mk();
  q.add({ name: 'a', gen: -1 });
  await flush();
  q.clear();
  gates[0].res();
  await flush();
  assert.deepEqual(log.done, []);
});
test('multiple files: after changing settings, all are redone with the new settings', async () => {
  const { opt, log, gates, q } = mk();
  q.add({ name: 'a', gen: -1 });
  q.add({ name: 'b', gen: -1 });
  await flush();
  gates[0].res();
  await flush();
  gates[1].res();
  await flush();
  assert.equal(q.settled, 2);
  opt.fmt = 'png';
  q.invalidate();
  for (let i = 0; i < 2; i++) {
    await flush();
    gates[2 + i].res();
  }
  await flush();
  assert.deepEqual(log.done.slice(2).map((d) => d.join(':')), ['a:a.png:png', 'b:b.png:png']);
});

test('coordinates in an extended XMP segment must not remain after editor cleanup', () => {
  const ext = rewrite(noGps(base), { insert: [xmpSeg(XMP, 'http://ns.adobe.com/xmp/extension/\0')] });
  assert.ok(locationLeaks(ext, { strict: true }).includes('XMP location'));
  const { out } = buildEdited(ext, { clearLoc: true, pin: null, origGps: null, patch: {} });
  assert.deepEqual(locationLeaks(out, { strict: true }), []);
  assert.equal(xmpTexts(out).length, 0);
});

import { TaskGate, UrlBag } from '../packages/core/src/task.ts';

test('TaskGate: a new task replaces the old one, the old task loses eligibility and is aborted; invalidate voids the current task; cancel only aborts', () => {
  const g = new TaskGate();
  const a = g.begin();
  assert.ok(a.current);
  const b = g.begin();
  assert.ok(!a.current && a.signal.aborted, 'A replaced by B');
  assert.ok(b.current && b.id === a.id + 1);
  g.invalidate();
  assert.ok(!b.current && b.signal.aborted, 'changing input voids the current task');
  const c = g.begin();
  g.cancel();
  assert.ok(!c.current && g.version === c.id, 'cancel: no longer the current task, but its id is still its own (the UI shows “cancelled”)');
});

test('TaskGate: A is compressing when B is picked, and A’s completion must not write to the UI (simulates the compress-video guard)', async () => {
  const g = new TaskGate();
  const ui = [];
  const runTask = async (name, ms) => {
    const t = g.begin();
    await new Promise((r) => setTimeout(r, ms));
    if (!t.current) return;
    ui.push(name);
  };
  const pa = runTask('A', 20);
  g.invalidate();
  const pb = runTask('B', 5);
  await Promise.all([pa, pb]);
  assert.deepEqual(ui, ['B']);
});

test('UrlBag: on replace or clear, registered URLs are revoked', () => {
  const revoked = [];
  const orig = globalThis.URL.revokeObjectURL;
  globalThis.URL.revokeObjectURL = (u) => revoked.push(u);
  try {
    const bag = new UrlBag();
    bag.own('blob:1'); bag.own('blob:2');
    bag.revoke('blob:1');
    bag.revoke('blob:1');
    bag.revoke(undefined);
    bag.revokeAll();
    assert.deepEqual(revoked, ['blob:1', 'blob:2']);
    assert.equal(bag.size, 0);
  } finally {
    globalThis.URL.revokeObjectURL = orig;
  }
});

test('repro: after two photos finish, settings change (invalidate) and old results are cleared; batch download is unavailable while idle is false, and returns only after redo finishes, with all results belonging to the new settings', async () => {
  let fmt = 'jpg';
  const done = [];
  const q = new Reprocessor({
    snapshot: () => ({ fmt }),
    run: async (it, o) => (await new Promise((r) => setTimeout(r, 2)), o.fmt),
    start: (it) => (it.out = undefined),
    done: (it, r) => (it.out = r),
    fail: () => {},
  });
  const zipable = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out).map((r) => r.out) : []);
  const rows = [{ gen: -1 }, { gen: -1 }];
  for (const r of rows) await q.add(r);
  assert.deepEqual(zipable(), ['jpg', 'jpg']);
  fmt = 'png';
  const p = q.invalidate();

  assert.equal(q.idle, false);
  assert.deepEqual(zipable(), []);
  await p;
  assert.equal(q.idle, true);
  assert.deepEqual(zipable(), ['png', 'png'], 'ZIP contents all come from current settings');
  done.push(1);
});

test('negative control: the old check that ignores idle returns an empty list the moment settings change (the source of empty ZIPs)', () => {
  const q = new Reprocessor({ snapshot: () => ({}), run: async () => 1, start: (it) => (it.out = undefined), done: () => {}, fail: () => {} });
  q.items.push({ gen: 0, out: 1 }, { gen: 0, out: 1 });
  q.invalidate();
  const oldDoneList = q.items.filter((r) => r.gen === q.gen && r.out);
  assert.equal(oldDoneList.length, 0);
});

test('map.ts does not render tiles by default (no <img> before enable), edit-photo-metadata enables it with the “show map” button', () => {
  const map = readFileSync(new URL('../packages/core/src/map.ts', import.meta.url), 'utf8');
  assert.match(map, /private render\(\) \{\s*if \(!this\.on\) return;/);
  assert.match(map, /enable\(\) \{\s*this\.on = true;/);
  const edit = readFileSync(new URL('../tools/edit-photo-metadata/main.ts', import.meta.url), 'utf8');
  assert.match(edit, /map\.enable\(\)/);
  assert.match(edit, /showMap/);
  assert.equal((edit.match(/map\.enable\(\)/g) ?? []).length, 1, 'only this button enables it');
});

test('wiring: both batch pages check idle before enabling download, and sync the button at start', () => {
  for (const f of ['heic-to-jpg', 'remove-photo-location']) {
    const src = readFileSync(new URL(`../tools/${f}/main.ts`, import.meta.url), 'utf8');
    assert.match(src, /q\.idle \?/, f);
    assert.match(src, /start: \(row\) => \{[\s\S]*?sync\(\);\s*\},\s*done/, f + ' must call sync in start');
    assert.match(src, /urls\.revokeAll\(\)/, f);
  }
});
