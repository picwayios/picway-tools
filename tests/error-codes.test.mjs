import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coded, errCode, ERR_CODES, REASONS } from '../packages/core/src/errcode.ts';
import { readFileSync } from 'node:fs';

test('errCode: a thrown coded error is recognized; plain Error, DOMException, strings, null and made-up codes are all unknown', () => {
  for (const c of ERR_CODES) assert.equal(errCode(coded(c, 'x')), c);
  assert.equal(coded('raw', 'camera RAW files aren’t supported').message, 'camera RAW files aren’t supported');
  for (const e of [new Error('encode failed'), new DOMException('The source image could not be decoded.', 'InvalidStateError'), 'boom', null, undefined, Object.assign(new Error('x'), { code: 'ENOENT' })]) assert.equal(errCode(e), 'unknown');
});

test('REASONS: all four language keys present; Chinese and Japanese sentences contain no English words (except RAW)', () => {
  const keys = Object.keys(REASONS.en).sort();
  assert.deepEqual(keys, [...ERR_CODES].sort());
  for (const l of ['zh-Hans', 'zh-Hant', 'ja']) {
    assert.deepEqual(Object.keys(REASONS[l]).sort(), keys, l);
    for (const k of keys) assert.ok(!/[A-Za-z]{2,}/.test(REASONS[l][k].replace('RAW', '')), `${l}.${k}: ${REASONS[l][k]}`);
  }
});

test('convert.ts / heic.ts: no more new …Error without an error code (both throw and Promise rejections count)', () => {
  for (const f of ['packages/core/src/convert.ts', 'packages/core/src/heic.ts']) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.deepEqual(s.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /new \w*Error\(/.test(l)).map(([i]) => i), [], f);
  }
});

test('compress, resize, crop and blur pages: errors no longer concatenate e.message', () => {
  for (const f of ['compress-image', 'resize-image', 'crop-image', 'blur-image']) {
    const s = readFileSync(new URL(`../tools/${f}/main.ts`, import.meta.url), 'utf8');
    assert.ok(!/e instanceof Error \? e\.message : String\(e\)|\{ e: e\.message|\{ e: String\(e\)/.test(s), f);
    assert.ok(/makeT\(REASONS, host\)\(errCode\(e\)\)/.test(s), f);
  }
});

test('tiffDataCut: strips / tiles all inside the file means not truncated; any outside the file, missing or count mismatch means truncated', async () => {
  const { tiffDataCut } = await import('../packages/core/src/sniff.ts');
  assert.equal(tiffDataCut({ t273: [8, 1008], t279: [1000, 1000] }, 2008), false);
  assert.equal(tiffDataCut({ t273: [8, 1008], t279: [1000, 1000] }, 1500), true);
  assert.equal(tiffDataCut({ t324: [100], t325: [50] }, 149), true);
  assert.equal(tiffDataCut({ t324: [100], t325: [50] }, 150), false);
  assert.equal(tiffDataCut({}, 10), true);
  assert.equal(tiffDataCut({ t273: [8], t279: [] }, 10), true);
  assert.equal(tiffDataCut({ t273: [8, 20], t279: [5] }, 100), true);
});

test('JPEG structure check: complete passes; a 1.5 MB tail after EOI (the MP4 of a live photo) also passes; cut in half means truncated', async () => {
  const { structureError } = await import('../packages/core/src/sniff.ts');
  const jpg = new Uint8Array(readFileSync(new URL('./fixtures/photo/gps-p3-rot6.jpg', import.meta.url)));
  assert.equal(structureError(jpg, 'jpeg'), null);
  const tail = new Uint8Array(1536 * 1024).map((_, i) => (i * 2654435761) >>> 24);
  const motion = new Uint8Array(jpg.length + tail.length); motion.set(jpg); motion.set(tail, jpg.length);
  assert.equal(structureError(motion, 'jpeg'), null, 'live photo (1.5 MB after EOI) should not be judged truncated');
  assert.match(structureError(jpg.slice(0, Math.floor(jpg.length * 0.6)), 'jpeg') ?? '', /^the JPEG data is (cut off|incomplete)$/);
});
