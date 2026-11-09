import assert from 'node:assert/strict';
import { test } from 'node:test';
import { borderLayout, fitRect, gridLayout, stripLayout } from '../packages/core/src/layout.ts';

const inside = (c, W, H) => c.x >= 0 && c.y >= 0 && c.x + c.w <= W && c.y + c.h <= H;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('grid: 1–20 images, four aspect ratios, cells all inside the canvas, no overlap, counts match', () => {
  for (const ratio of [1, 4 / 5, 3 / 4, 9 / 16]) {
    for (let n = 1; n <= 20; n++) {
      const g = gridLayout(n, 1080, ratio, 12);
      assert.equal(g.cells.length, n);
      g.cells.forEach((c, i) => {
        assert.ok(c.w > 0 && c.h > 0 && inside(c, g.W, g.H), `n=${n} r=${ratio} #${i} ${JSON.stringify(c)}`);
        g.cells.slice(0, i).forEach((o) => assert.equal(overlap(c, o), false, `n=${n} overlapping`));
      });
    }
  }
});

test('grid: 4 square images in a 2×2 layout; last row centered', () => {
  const g = gridLayout(4, 1000, 1, 0);
  assert.deepEqual(g.cells.map((c) => [c.x, c.y]), [[0, 0], [500, 0], [0, 500], [500, 500]]);
  const g5 = gridLayout(5, 900, 1, 0);
  const lastY = Math.max(...g5.cells.map((c) => c.y));
  const last = g5.cells.filter((c) => c.y === lastY);
  const left = last[0].x;
  const right = g5.W - (last.at(-1).x + last.at(-1).w);
  assert.ok(Math.abs(left - right) <= 1, `last row left and right margins should be equal: ${left} vs ${right}`);
});

test('long image: same width, stacked vertically, total height equals the sum of heights plus gaps; scaled down as a whole when over the pixel limit', () => {
  const s = stripLayout([{ w: 1170, h: 2532 }, { w: 1170, h: 2532 }, { w: 585, h: 1000 }], 1080, 10);
  assert.equal(s.W, 1080);
  assert.ok(s.rects.every((r) => r.w === 1080));
  assert.equal(s.H, s.rects.at(-1).y + s.rects.at(-1).h);
  assert.equal(s.rects[1].y, s.rects[0].h + 10);
  const many = stripLayout(Array.from({ length: 30 }, () => ({ w: 1170, h: 2532 })), 1080, 0);
  assert.equal(many.scaled, true);
  assert.ok(many.W * many.H <= 16_000_000, `${many.W}×${many.H}`);
});

test('add border: dimensions for four styles', () => {
  assert.deepEqual(borderLayout(1000, 800, 'even', 5), { W: 1080, H: 880, x: 40, y: 40 });
  assert.deepEqual(borderLayout(1000, 800, 'polaroid', 5), { W: 1080, H: 800 + 40 + 140, x: 40, y: 40 });
  const sq = borderLayout(1000, 800, 'square', 0);
  assert.equal(sq.W, sq.H);
  assert.deepEqual([sq.x, sq.y], [0, 100]);
  const p = borderLayout(800, 1000, 'portrait45', 0);
  assert.equal(p.W / p.H, 0.8);
  const p2 = borderLayout(1000, 800, 'portrait45', 0);
  assert.ok(Math.abs(p2.W / p2.H - 0.8) < 1e-3 && p2.x >= 0 && p2.y >= 0 && p2.W >= 1000 && p2.H >= 800);
});

test('fitRect: cover fills and center-crops, contain fits the whole image', () => {
  const c = fitRect({ w: 400, h: 200 }, { x: 0, y: 0, w: 100, h: 100 }, 'cover');
  assert.deepEqual([c.sx, c.sy, c.sw, c.sh], [100, 0, 200, 200]);
  const n = fitRect({ w: 400, h: 200 }, { x: 0, y: 0, w: 100, h: 100 }, 'contain');
  assert.deepEqual([n.dx, n.dy, n.dw, n.dh], [0, 25, 100, 50]);
});
