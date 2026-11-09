import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
const hasDjpeg = spawnSync('djpeg', ['-version']).error === undefined;
const skip = hasDjpeg ? false : 'djpeg not installed (brew install jpeg-turbo)';
import { browserDecoder, canDecode } from '../packages/core/src/decodable.ts';
import { looksLikeJpegImage } from '../packages/core/src/jpeg.ts';
import { openPhoto } from '../packages/core/src/opensel.ts';
import { TaskGate } from '../packages/core/src/task.ts';

const base = new Uint8Array(readFileSync(new URL('./fixtures/photo/gps-p3-rot6.jpg', import.meta.url)));
const djpeg = async (b) => spawnSync('djpeg', [], { input: b, maxBuffer: 1 << 28 }).status === 0;
const badDqt = (() => {
  const b = Uint8Array.from(base);
  let i = 2;
  while (!(b[i] === 0xff && b[i + 1] === 0xdb)) i++;
  b[i + 4] = 4;
  return b;
})();
const truncated = base.subarray(0, base.length - 32);
const soiOnly = Uint8Array.of(0xff, 0xd8);

test('sample validity: the structure check passes but an independent decoder rejects it (exactly the miss the audit found)', { skip }, async () => {
  assert.equal(looksLikeJpegImage(badDqt), true, 'the sample should be structurally complete, otherwise the new check is not tested');
  assert.equal(await djpeg(badDqt), false);
  assert.equal(await djpeg(base), true);
});
test('canDecode rejects an invalid DQT table number, accepts a normal JPEG; missing EOI and SOI-only are still rejected', { skip }, async () => {
  assert.equal(await canDecode(badDqt, 'image/jpeg', djpeg), false);
  assert.equal(await canDecode(base, 'image/jpeg', djpeg), true);
  assert.equal(await canDecode(truncated, 'image/jpeg', djpeg), false);
  assert.equal(await canDecode(soiOnly, 'image/jpeg', djpeg), false);
  assert.equal(await canDecode(base, 'image/jpeg', async () => { throw new Error('boom'); }), false, 'a decoder that throws counts as undecodable');
});
test('EXIF editor entry (openPhoto + async checkJpeg) blocks an invalid DQT table number', { skip }, async () => {
  const calls = [];
  const deps = {
    read: async (b) => b,
    isJpeg: (b) => b[0] === 0xff && b[1] === 0xd8,
    checkJpeg: async (b) => {
      if (!looksLikeJpegImage(b) || !(await canDecode(b, 'image/jpeg', djpeg))) throw new Error('bad');
    },
    looksHeif: async () => false,
    convert: async () => { throw new Error('no'); },
    begin: () => {},
    ready: () => calls.push('ready'),
    fail: () => calls.push('fail'),
  };
  for (const [b, want] of [[badDqt, 'fail'], [truncated, 'fail'], [soiOnly, 'fail'], [base, 'ready']]) {
    calls.length = 0;
    await openPhoto(new TaskGate(), b, deps);
    assert.deepEqual(calls, [want]);
  }
});
test('async checkJpeg: when the selection changes mid-check, the stale result does not touch the UI', async () => {
  const calls = [];
  const gate = new TaskGate();
  let release;
  const slow = new Promise((r) => (release = r));
  const mk = (tag, wait) => ({
    read: async (b) => b, isJpeg: () => true, checkJpeg: async () => { if (wait) await slow; },
    looksHeif: async () => false, convert: async () => base, begin: () => {},
    ready: () => calls.push(tag + ':ready'), fail: () => calls.push(tag + ':fail'),
  });
  const first = openPhoto(gate, base, mk('old', true));
  await new Promise((r) => setTimeout(r, 5));
  await openPhoto(gate, base, mk('new', false));
  release();
  assert.equal(await first, false);
  assert.deepEqual(calls, ['new:ready']);
});
test('browserDecoder: data that cannot be decoded counts as bad; environment failures pass; close is called after a successful decode', async () => {
  const g = globalThis;
  const saved = g.createImageBitmap;
  try {
    let closed = 0;
    g.createImageBitmap = async () => ({ close: () => closed++ });
    assert.equal(await browserDecoder(base, 'image/jpeg'), true);
    assert.equal(closed, 1, 'ImageBitmap not closed');
    g.createImageBitmap = async () => { throw Object.assign(new Error('x'), { name: 'InvalidStateError' }); };
    assert.equal(await browserDecoder(badDqt, 'image/jpeg'), false);
    g.createImageBitmap = async () => { throw new RangeError('out of memory'); };
    assert.equal(await browserDecoder(base, 'image/jpeg'), true, 'memory failures must not wrongly reject normal photos');
  } finally {
    g.createImageBitmap = saved;
  }
});
test('browserDecoder fallback: without createImageBitmap, Image.decode is used and the objectURL is always released; EncodingError counts as a bad image; if neither API exists, pass', async () => {
  const g = globalThis;
  const saved = { cib: g.createImageBitmap, Image: g.Image, cou: URL.createObjectURL, rou: URL.revokeObjectURL };
  try {
    g.createImageBitmap = undefined;
    let revoked = 0;
    URL.createObjectURL = () => 'blob:x';
    URL.revokeObjectURL = () => revoked++;
    g.Image = class { decode() { return Promise.resolve(); } };
    assert.equal(await browserDecoder(base, 'image/jpeg'), true);
    assert.equal(revoked, 1);
    g.Image = class { decode() { return Promise.reject(Object.assign(new Error('x'), { name: 'EncodingError' })); } };
    assert.equal(await browserDecoder(badDqt, 'image/jpeg'), false);
    assert.equal(revoked, 2, 'objectURL is released even when decoding fails');
    g.Image = undefined;
    assert.equal(await browserDecoder(base, 'image/jpeg'), true);
  } finally {
    g.createImageBitmap = saved.cib;
    g.Image = saved.Image;
    URL.createObjectURL = saved.cou;
    URL.revokeObjectURL = saved.rou;
  }
});
test('source anchor: both tool entry points and the pre-download step call canDecode', () => {
  const rm = readFileSync(new URL('../tools/remove-photo-location/main.ts', import.meta.url), 'utf8');
  const ed = readFileSync(new URL('../tools/edit-photo-metadata/main.ts', import.meta.url), 'utf8');
  assert.match(rm, /if \(!heic && !\(await canDecode\(src\)\)\) throw new Error\(t\('badJpeg'\)\)/);
  assert.match(rm, /if \(!\(await canDecode\(out\)\)\) throw new Error\(t\('badOut'\)\)/);
  assert.match(ed, /if \(!\(await canDecode\(b\)\)\) throw new Hint\(t\('badJpeg'\)/);
  assert.match(ed, /if \(!decodable\) return void \(status\.textContent = t\('badOut'\)\)/);
  assert.match(ed, /canDecode\(out\);[^\n]*\n\s*if \(stale\(\)\) return;/, 'after decoding, check for stale results before writing the UI');
});
