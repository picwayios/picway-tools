import * as G from 'gifenc';

const lib = ((G as unknown as { GIFEncoder?: unknown }).GIFEncoder ? G : (G as unknown as { default: typeof G }).default) as typeof G;
const { applyPalette, GIFEncoder, quantize } = lib;

export interface PackOptions {
  width: number;
  height: number;

  loops: number | null;

  colors: number;

  tolerance?: number;
}
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Pending {

  rgba: Uint8ClampedArray;

  draw: Uint8Array;
  rect: Rect;
  delayCs: number;
  dispose: 1 | 2;
}

const opaque = (a: Uint8ClampedArray, p: number) => a[p * 4 + 3] >= 128;

export const bitsFor = (n: number) => Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));

function bbox(mask: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (!mask[row + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const union = (a: Rect, b: Rect): Rect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

export class GifPacker {
  private enc = GIFEncoder({ auto: false });

  private shown: Uint8ClampedArray;
  private pending: Pending | null = null;
  private n = 0;
  private o: PackOptions;
  constructor(o: PackOptions) {
    if (o.width < 1 || o.height < 1 || o.width > 65535 || o.height > 65535) throw new Error('bad-size');
    this.o = o;
    this.shown = new Uint8ClampedArray(o.width * o.height * 4);
    const s = this.enc.stream;
    this.enc.writeHeader();

    s.writeBytes([o.width & 255, o.width >> 8, o.height & 255, o.height >> 8, 0x70, 0, 0]);
    if (o.loops !== null) {
      s.writeBytes([0x21, 0xff, 11, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 3, 1, o.loops & 255, (o.loops >> 8) & 255, 0]);
    }
  }

  get frames() {
    return this.n;
  }

  get size() {
    return this.enc.stream.bytesView().length;
  }

  add(rgba: Uint8ClampedArray, delayCs: number) {
    const { width: w, height: h } = this.o;
    const N = w * h;
    if (rgba.length !== N * 4) throw new Error('frame-size');
    const cur = new Uint8ClampedArray(rgba);
    for (let p = 0; p < N; p++) if (!opaque(cur, p)) cur[p * 4] = cur[p * 4 + 1] = cur[p * 4 + 2] = cur[p * 4 + 3] = 0;
    else cur[p * 4 + 3] = 255;
    const shown = this.shown;
    const prev = this.pending;

    if (prev) {
      const clear = new Uint8Array(N);
      for (let p = 0; p < N; p++) if (opaque(shown, p) && !opaque(cur, p)) clear[p] = 1;
      const c = bbox(clear, w, h);
      if (c) {
        prev.rect = union(prev.rect, c);
        prev.dispose = 2;
        const r = prev.rect;
        for (let y = r.y; y < r.y + r.h; y++) shown.fill(0, (y * w + r.x) * 4, (y * w + r.x + r.w) * 4);
      }
      this.flush(prev);
    }

    const draw = new Uint8Array(N);
    const tol = this.o.tolerance ?? 0;
    for (let p = 0, i = 0; p < N; p++, i += 4) {
      if (!cur[i + 3]) continue;
      if (!shown[i + 3] || Math.abs(cur[i] - shown[i]) + Math.abs(cur[i + 1] - shown[i + 1]) + Math.abs(cur[i + 2] - shown[i + 2]) > tol) draw[p] = 1;
    }
    const rect = this.n === 0 ? { x: 0, y: 0, w, h } : (bbox(draw, w, h) ?? { x: 0, y: 0, w: 1, h: 1 });
    for (let p = 0, i = 0; p < N; p++, i += 4) if (draw[p]) shown.set(cur.subarray(i, i + 4), i);
    this.pending = { rgba: cur, draw, rect, delayCs: Math.min(65535, Math.max(2, Math.round(delayCs))), dispose: 1 };
    this.n++;
  }

  private flush(f: Pending) {
    const { width: w } = this.o;
    const { x, y, w: rw, h: rh } = f.rect;
    let k = 0;
    for (let yy = y; yy < y + rh; yy++) for (let xx = x; xx < x + rw; xx++) k += f.draw[yy * w + xx];
    const all = k === rw * rh;
    const index = new Uint8Array(rw * rh);
    let palette: number[][];
    let t = -1;
    if (k) {
      const sub = new Uint8ClampedArray(k * 4);
      for (let yy = y, j = 0; yy < y + rh; yy++) {
        for (let xx = x; xx < x + rw; xx++) {
          const p = yy * w + xx;
          if (f.draw[p]) sub.set(f.rgba.subarray(p * 4, p * 4 + 4), (j++) * 4);
        }
      }
      palette = quantize(sub, all ? this.o.colors : Math.max(1, this.o.colors - 1));
      const idx = applyPalette(sub, palette);
      if (!all) {
        t = palette.length;
        palette.push([0, 0, 0]);
      }
      for (let yy = y, j = 0, q = 0; yy < y + rh; yy++) {
        for (let xx = x; xx < x + rw; xx++, q++) index[q] = f.draw[yy * w + xx] ? idx[j++] : t;
      }
    } else {
      palette = [[0, 0, 0], [0, 0, 0]];
      t = 0;
    }
    if (palette.length < 2) palette.push([0, 0, 0]);
    const s = this.enc.stream;
    const at = s.bytesView().length;
    this.enc.writeFrame(index, rw, rh, {
      palette,
      delay: f.delayCs * 10,
      dispose: f.dispose,
      colorDepth: bitsFor(palette.length),
      first: false,
      ...(t >= 0 ? { transparent: true, transparentIndex: t } : {}),
    });

    const v = s.bytesView();
    if (v[at + 8] !== 0x2c) throw new Error('gifenc-layout');
    v[at + 9] = x & 255;
    v[at + 10] = x >> 8;
    v[at + 11] = y & 255;
    v[at + 12] = y >> 8;
  }

  finish(): Uint8Array {
    if (this.pending) this.flush(this.pending);
    this.pending = null;
    this.enc.finish();
    return this.enc.bytes();
  }
}

export function gifLoops(bytes: Uint8Array): number | null {
  const at = (i: number) => {
    if (i >= bytes.length) throw new Error('truncated');
    return bytes[i];
  };
  let p = 13;
  if (at(10) & 0x80) p += 3 * (1 << ((at(10) & 7) + 1));
  const skipSub = () => {
    for (let n = at(p++); n; n = at(p++)) p += n;
  };
  for (;;) {
    const t = at(p++);
    if (t === 0x3b) return null;
    if (t === 0x21) {
      const label = at(p++);
      if (label === 0xff && at(p) === 11) {
        const id = String.fromCharCode(...bytes.subarray(p + 1, p + 12));
        if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && at(p + 12) >= 3 && at(p + 13) === 1) return at(p + 14) | (at(p + 15) << 8);
      }
      skipSub();
      continue;
    }
    if (t !== 0x2c) throw new Error('bad-block');
    const f = at(p + 8);
    p += 9;
    if (f & 0x80) p += 3 * (1 << ((f & 7) + 1));
    p++;
    skipSub();
  }
}

export function strictLzw(data: Uint8Array, minSize: number, n: number, colors: number): boolean {
  if (minSize < 2 || minSize > 8) return false;
  const clear = 1 << minSize, eoi = clear + 1;
  const prefix = new Int32Array(4096).fill(-1), suffix = new Uint8Array(4096), len = new Int32Array(4096);
  for (let i = 0; i < clear; i++) (suffix[i] = i), (len[i] = 1);
  let size = minSize + 1, next = eoi + 1, prev = -1, bit = 0, out = 0;
  const total = data.length * 8;
  for (;;) {
    if (bit + size > total) return false;
    let code = 0;
    for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
    if (code === clear) {
      (size = minSize + 1), (next = eoi + 1), (prev = -1);
      continue;
    }
    if (code === eoi) return out === n;
    const known = code < clear || (code > eoi && code < next);
    if (!known && !(code === next && prev >= 0)) return false;
    const c = known ? code : prev;
    let k = c;
    for (; prefix[k] >= 0; k = prefix[k]) if (suffix[k] >= colors) return false;
    if (suffix[k] >= colors) return false;
    out += known ? len[c] : len[c] + 1;
    if (out > n) return false;
    if (prev >= 0 && next < 4096) {
      (prefix[next] = prev), (suffix[next] = suffix[k]), (len[next] = len[prev] + 1);
      if (++next === 1 << size && size < 12) size++;
    }
    prev = code;
  }
}

export function strictFrames(bytes: Uint8Array): number {
  const it = strictScan(bytes);
  let r = it.next();
  while (!r.done) r = it.next();
  return r.value;
}

export function* strictScan(bytes: Uint8Array): Generator<number, number> {
  try {
    const at = (i: number) => {
      if (i >= bytes.length) throw new Error('truncated');
      return bytes[i];
    };
    const W = at(6) | (at(7) << 8), H = at(8) | (at(9) << 8);
    const global = at(10) & 0x80 ? 1 << ((at(10) & 7) + 1) : 0;
    let p = 13 + global * 3, frames = 0;
    for (;;) {
      const t = at(p++);
      if (t === 0x3b) return frames;
      if (t === 0x21) {
        p++;
        for (let n = at(p++); n; n = at(p++)) p += n;
        continue;
      }
      if (t !== 0x2c) return -1;
      const x = at(p) | (at(p + 1) << 8), y = at(p + 2) | (at(p + 3) << 8), w = at(p + 4) | (at(p + 5) << 8), h = at(p + 6) | (at(p + 7) << 8), f = at(p + 8);
      if (!w || !h || x + w > W || y + h > H || f & 0x40) return -1;
      const colors = f & 0x80 ? 1 << ((f & 7) + 1) : global;
      if (!colors) return -1;
      p += 9 + (f & 0x80 ? colors * 3 : 0);
      const minSize = at(p++);
      const parts: Uint8Array[] = [];
      for (let n = at(p++); n; n = at(p++)) {
        at(p + n - 1);
        parts.push(bytes.subarray(p, p + n));
        p += n;
      }
      const data = new Uint8Array(parts.reduce((a, b) => a + b.length, 0));
      parts.reduce((o, b) => (data.set(b, o), o + b.length), 0);
      if (!strictLzw(data, minSize, w * h, colors)) return -1;
      yield ++frames;
    }
  } catch {
    return -1;
  }
}
