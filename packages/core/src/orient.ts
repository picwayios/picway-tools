export interface Pixels { data: Uint8ClampedArray; w: number; h: number }

export function orientRGBA(data: Uint8ClampedArray, w: number, h: number, o: number): Pixels {
  if (!Number.isInteger(o) || o < 2 || o > 8) return { data, w, h };
  const swap = o >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const src = data.byteOffset % 4 ? new Uint32Array(data.slice().buffer, 0, w * h) : new Uint32Array(data.buffer, data.byteOffset, w * h);
  const out = new Uint8ClampedArray(w * h * 4);
  const dst = new Uint32Array(out.buffer);

  const from: Record<number, (x: number, y: number) => number> = {
    2: (x, y) => y * w + (w - 1 - x),
    3: (x, y) => (h - 1 - y) * w + (w - 1 - x),
    4: (x, y) => (h - 1 - y) * w + x,
    5: (x, y) => x * w + y,
    6: (x, y) => (h - 1 - x) * w + y,
    7: (x, y) => (h - 1 - x) * w + (w - 1 - y),
    8: (x, y) => x * w + (w - 1 - y),
  };
  const f = from[o];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dst[y * W + x] = src[f(x, y)];
  return { data: out, w: W, h: H };
}
