import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Intake, Latest } from '../packages/core/src/collagestate.ts';
import { fitRect, fitVisible, gridLayout, stripLayout } from '../packages/core/src/layout.ts';
import { pngGetIcc, pngSetIcc } from '../packages/core/src/png.ts';

test('slots: two concurrent add batches together never exceed the limit (20)', () => {
  const k = new Intake();
  const a = k.reserve(20, 11);
  const b = k.reserve(20, 11);
  assert.equal(a.n + b.n, 20);
  for (let i = 0; i < a.n; i++) k.settle(a, { i });
  for (let i = 0; i < b.n; i++) k.settle(b, { i });
  assert.equal(k.items.length, 20);
  assert.equal(k.reserve(20, 1).n, 0, 'no more slots once full');
});

test('slots: failed files release their slot, and the failure list keeps the file names', () => {
  const k = new Intake();
  const t = k.reserve(20, 3);
  k.settle(t, { n: 'A' });
  k.settle(t, null, { file: 'f', name: 'bad.png' });
  k.settle(t, { n: 'B' });
  assert.equal(k.items.length, 2);
  assert.deepEqual(k.failures.map((f) => f.name), ['bad.png']);
  assert.equal(k.pending, 0);
});

test('clear: clearing mid-read rejects the old batch when it returns, and the slot count resets to zero', () => {
  const k = new Intake();
  const t = k.reserve(20, 3);
  k.settle(t, { n: 'A' });
  assert.equal(k.clear().length, 1);
  assert.equal(k.settle(t, { n: 'B' }), false, 'an old batch cannot add images back');
  assert.equal(k.items.length, 0);
  assert.equal(k.failures.length, 0);
  assert.equal(k.reserve(20, 20).n, 20, 'after clearing, the new batch’s slots are not taken by the old batch');
  k.settle(t, null, { file: 'x', name: 'x' });
  assert.equal(k.failures.length, 0);
});

test('Latest: pick A then B; if A finishes late, it does not count', () => {
  const l = new Latest();
  const a = l.next();
  const b = l.next();
  assert.equal(l.is(a), false);
  assert.equal(l.is(b), true);
  l.invalidate();
  assert.equal(l.is(b), false);
});

test('long image: two 6000×1 images scaled to 1080 wide would be under 1 pixel tall and must be flagged (old behaviour: height rounded to 0, exported a blank white 1080×12)', () => {
  const l = stripLayout([{ w: 6000, h: 1 }, { w: 6000, h: 1 }], 1080, 12);
  assert.deepEqual(l.thin, [0, 1]);
  assert.equal(l.H, 14, 'two 1-pixel lines with 12 spacing');
});

test('long image: normal screenshots are not flagged; a 1×6000 vertical strip is flagged huge', () => {
  const ok = stripLayout([{ w: 1170, h: 2532 }, { w: 1170, h: 2532 }], 1080, 12);
  assert.deepEqual(ok.thin, []);
  assert.equal(ok.huge, false);
  const tall = stripLayout([{ w: 1, h: 6000 }, { w: 1, h: 6000 }], 1, 12);
  assert.equal(tall.thin.length, 0);
  const big = stripLayout([{ w: 1, h: 6000 }, { w: 1, h: 6000 }], 1080, 12);
  assert.equal(big.huge, true, 'still over the pixel limit at minimum width');
});

test('collage contain: for extreme aspect ratios where the cell cannot show even 1 pixel, fitVisible is false; cover is unaffected', () => {
  const g = gridLayout(2, 1080, 1, 12);
  assert.equal(fitVisible(fitRect({ w: 6000, h: 1 }, g.cells[0], 'contain')), false);
  assert.equal(fitVisible(fitRect({ w: 6000, h: 1 }, g.cells[0], 'cover')), true);
  assert.equal(fitVisible(fitRect({ w: 4000, h: 3000 }, g.cells[0], 'contain')), true);
  assert.equal(fitVisible(fitRect({ w: 1, h: 6000 }, g.cells[0], 'contain')), false);
});

const PNG1 = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const fakeIcc = () => {
  const b = new Uint8Array(612);
  b.set(new TextEncoder().encode('acsp'), 36);
  b.set(new TextEncoder().encode('Display P3'), 200);
  return b;
};

test('PNG: after writing iCCP, reading back gives the same 612 bytes (precondition for the border PNG input going through the P3 preserve path)', async () => {
  const icc = fakeIcc();
  const out = await pngGetIcc(await pngSetIcc(PNG1, icc, 'Display P3'));
  assert.deepEqual(out, icc);
});

test('PNG: no iCCP, truncated, not a PNG, or broken iCCP all return null without throwing', async () => {
  assert.equal(await pngGetIcc(PNG1), null);
  const withIcc = await pngSetIcc(PNG1, fakeIcc());
  assert.equal(await pngGetIcc(withIcc.subarray(0, 40)), null);
  assert.equal(await pngGetIcc(new Uint8Array(100)), null);
  const bad = withIcc.slice();
  const at = Buffer.from(bad).indexOf('iCCP');
  const len = new DataView(bad.buffer).getUint32(at - 4);
  bad[at + 4 + len - 1] ^= 0xff;
  assert.equal(await pngGetIcc(bad), null);
});
