import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { captionInk, contrastRatio, relativeLuminance } from '../packages/core/src/colour.ts';

const oldInk = (hex) => (parseInt(hex.slice(1), 16) < 0x808080 ? '#eeeeee' : '#333333');

test('relativeLuminance / contrastRatio match WCAG reference values', () => {
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#ffffff') - 1) < 1e-9);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 1e-6);
  assert.ok(Math.abs(contrastRatio('#00ffff', '#eeeeee') - 1.08) < 0.02, 'the 1.08:1 from the audit');
});

for (const [name, bg] of [['cyan', '#00ffff'], ['bright green', '#00ff00'], ['green', '#008000'], ['dark red', '#8b0000'], ['dark red 2', '#800000'], ['dark red just past the old threshold', '#810000'], ['yellow', '#ffff00'], ['mid gray', '#777777'], ['white', '#ffffff'], ['black', '#000000']]) {
  test(`${name} ${bg}: text contrast ≥ 4.5:1`, () => {
    const ink = captionInk(bg);
    assert.ok(contrastRatio(ink, bg) >= 4.5, `on ${bg} pick ${ink}, contrast ${contrastRatio(ink, bg).toFixed(2)}`);
  });
}

test('explicit choices: cyan, bright green and yellow use dark text; dark red uses soft light text, #008000 uses pure white (soft light text only reaches 4.43:1); white and black backgrounds keep their original soft text colours', () => {
  for (const bg of ['#00ffff', '#00ff00', '#ffff00']) assert.equal(captionInk(bg), '#333333', bg);
  for (const bg of ['#8b0000', '#800000', '#810000']) assert.equal(captionInk(bg), '#eeeeee', bg);
  assert.equal(captionInk('#008000'), '#ffffff');
  assert.equal(captionInk('#ffffff'), '#333333');
  assert.equal(captionInk('#000000'), '#eeeeee');
});

test('old rule as control: cyan and dark red fail (shows the test catches this defect)', () => {
  assert.ok(contrastRatio(oldInk('#00ffff'), '#00ffff') < 1.5);
  assert.ok(contrastRatio(oldInk('#8b0000'), '#8b0000') < 3);
});

test('sweep the whole RGB cube (step 17): every background is ≥ 4.5:1', () => {
  let worst = 99;
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    const bg = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    worst = Math.min(worst, contrastRatio(captionInk(bg), bg));
  }
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}`);
});

test('unrecognised colours do not throw', () => {
  assert.equal(typeof captionInk('nonsense'), 'string');
  assert.equal(captionInk('#fff'), '#333333');
});

test('page source anchor: photo-border uses captionInk, no longer compared by RGB integers', () => {
  const src = readFileSync(new URL('../tools/photo-border/main.ts', import.meta.url), 'utf8');
  assert.match(src, /captionInk\(st\.color\)/);
  assert.doesNotMatch(src, /0x808080/);
});
