import { convertImage, DEFAULT_QUALITY, type ConvertResult, type OutFormat } from './convert.ts';
import { resizeFormatFor, Unsupported, type ResizeChoice } from './resize.ts';
import { sniffKind } from './sniff.ts';
import type { Rect } from './crop.ts';

export { CROP_ACCEPT as BLUR_ACCEPT } from './crop.ts';
export type Mode = 'mosaic' | 'blur' | 'box';
export type Level = 1 | 2 | 3;
export const MODES: Mode[] = ['mosaic', 'blur', 'box'];

export function effectSize(mode: Mode, level: Level, w: number, h: number): number {
  const long = Math.max(w, h);
  if (mode === 'mosaic') return Math.max(4, Math.round(long / [100, 50, 25][level - 1]));
  if (mode === 'blur') return Math.max(2, Math.round(long / [200, 100, 50][level - 1]));
  return 0;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function rectFrom(x0: number, y0: number, x1: number, y1: number, w: number, h: number): Rect | null {
  const l = clamp(Math.round(Math.min(x0, x1)), 0, w);
  const t = clamp(Math.round(Math.min(y0, y1)), 0, h);
  const r = clamp(Math.round(Math.max(x0, x1)), 0, w);
  const b = clamp(Math.round(Math.max(y0, y1)), 0, h);
  return r - l >= 1 && b - t >= 1 ? { x: l, y: t, w: r - l, h: b - t } : null;
}

export function scaleRect(r: Rect, sw: number, sh: number, w: number, h: number): Rect {
  const kx = w / sw;
  const ky = h / sh;
  const l = clamp(Math.floor(r.x * kx), 0, w);
  const t = clamp(Math.floor(r.y * ky), 0, h);
  const rr = clamp(Math.ceil((r.x + r.w) * kx), 0, w);
  const b = clamp(Math.ceil((r.y + r.h) * ky), 0, h);
  return { x: l, y: t, w: Math.max(1, rr - l), h: Math.max(1, b - t) };
}

export function mosaic(d: Uint8ClampedArray, W: number, r: Rect, size: number) {
  const step = (a: number, end: number) => (end - a - size < size / 2 ? end : a + size);
  for (let by = r.y; by < r.y + r.h; by = step(by, r.y + r.h)) {
    for (let bx = r.x; bx < r.x + r.w; bx = step(bx, r.x + r.w)) {
      const ex = step(bx, r.x + r.w), ey = step(by, r.y + r.h);
      let sa = 0, sr = 0, sg = 0, sb = 0, n = 0;
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * W + x) * 4;
        const a = d[i + 3];
        (sa += a), (sr += d[i] * a), (sg += d[i + 1] * a), (sb += d[i + 2] * a), n++;
      }
      const [cr, cg, cb, ca] = sa ? [Math.round(sr / sa), Math.round(sg / sa), Math.round(sb / sa), Math.round(sa / n)] : [0, 0, 0, 0];
      for (let y = by; y < ey; y++) for (let x = bx; x < ex; x++) {
        const i = (y * W + x) * 4;
        (d[i] = cr), (d[i + 1] = cg), (d[i + 2] = cb), (d[i + 3] = ca);
      }
    }
  }
}

function boxLine(d: Uint8ClampedArray, n: number, stride: number, off: number, rad: number, line: Uint8ClampedArray) {
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) line[i * 4 + c] = d[off + i * stride + c];
  const win = 2 * rad + 1;
  const at = (i: number) => clamp(i, 0, n - 1) * 4;
  for (let c = 0; c < 4; c++) {
    let sum = 0;
    for (let k = -rad; k <= rad; k++) sum += line[at(k) + c];
    for (let i = 0; i < n; i++) {
      d[off + i * stride + c] = Math.round(sum / win);
      sum += line[at(i + rad + 1) + c] - line[at(i - rad) + c];
    }
  }
}

export function blur(d: Uint8ClampedArray, W: number, H: number, r: Rect, rad: number) {
  const p = d;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    (p[i] = (d[i] * a) / 255), (p[i + 1] = (d[i + 1] * a) / 255), (p[i + 2] = (d[i + 2] * a) / 255), (p[i + 3] = a);
  }
  const line = new Uint8ClampedArray(Math.max(W, H) * 4);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < H; y++) boxLine(p, W, 4, y * W * 4, rad, line);
    for (let x = 0; x < W; x++) boxLine(p, H, W * 4, x * 4, rad, line);
  }
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = (y * W + x) * 4;
    const a = p[i + 3];
    if (a) (d[i] = (p[i] * 255) / a), (d[i + 1] = (p[i + 1] * 255) / a), (d[i + 2] = (p[i + 2] * 255) / a);
    else d[i] = d[i + 1] = d[i + 2] = 0;
    d[i + 3] = a;
  }
}

export function box(d: Uint8ClampedArray, W: number, r: Rect) {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    const i = (y * W + x) * 4;
    (d[i] = d[i + 1] = d[i + 2] = 0), (d[i + 3] = 255);
  }
}

export const expand = (r: Rect, m: number, w: number, h: number): Rect => {
  const x = Math.max(0, r.x - m);
  const y = Math.max(0, r.y - m);
  return { x, y, w: Math.min(w, r.x + r.w + m) - x, h: Math.min(h, r.y + r.h + m) - y };
};

export function applyRegions(ctx: CanvasRenderingContext2D, w: number, h: number, regions: Rect[], mode: Mode, level: Level) {
  const size = effectSize(mode, level, w, h); const ex = (r: Rect) => (mode === 'blur' ? expand(r, 3 * size, w, h) : r); const u = regions.map(ex).reduce((a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }), regions.length ? ex(regions[0]) : { x: 0, y: 0, w: 0, h: 0 }); const snap = mode === 'blur' && regions.length > 1 ? ctx.getImageData(u.x, u.y, u.w, u.h) : null;
  for (const r of regions) {
    const e = ex(r);
    const img = snap ? ctx.createImageData(e.w, e.h, { colorSpace: snap.colorSpace }) : ctx.getImageData(e.x, e.y, e.w, e.h); if (snap) for (let y = 0; y < e.h; y++) img.data.set(snap.data.subarray(((e.y - u.y + y) * u.w + e.x - u.x) * 4, ((e.y - u.y + y) * u.w + e.x - u.x + e.w) * 4), y * e.w * 4);
    const local = { x: r.x - e.x, y: r.y - e.y, w: r.w, h: r.h };
    if (mode === 'mosaic') mosaic(img.data, e.w, local, size);
    else if (mode === 'blur') blur(img.data, e.w, e.h, local, size);
    else box(img.data, e.w, local);
    ctx.putImageData(img, e.x, e.y, local.x, local.y, r.w, r.h);
  }
}

export interface BlurOptions {

  regions: Rect[];
  mode: Mode;
  level: Level;

  srcWidth: number;
  srcHeight: number;
  format: ResizeChoice;
  background: string;
}
export interface BlurResult extends ConvertResult {
  format: OutFormat;
  srcWidth: number;
  srcHeight: number;
}

export async function blurImage(file: File, o: BlurOptions): Promise<BlurResult> {
  const kind = sniffKind(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  const fmt = resizeFormatFor(kind, o.format);
  if (!fmt) throw new Unsupported('gif');
  let sw = 0;
  let sh = 0;
  const r = await convertImage(file, {
    format: fmt,
    quality: DEFAULT_QUALITY[fmt] / 100,
    background: o.background,
    removeLocation: true,
    removeAllExif: true,
    resize: (w, h) => ((sw = w), (sh = h), [w, h]),
    draw: (ctx, bmp, w, h) => {
      ctx.drawImage(bmp, 0, 0, w, h);
      applyRegions(ctx, w, h, o.regions.map((g) => scaleRect(g, o.srcWidth, o.srcHeight, w, h)), o.mode, o.level);
    },
  });
  return { ...r, from: kind ?? r.from, format: fmt, srcWidth: sw || r.width, srcHeight: sh || r.height };
}

export function outName(tag: string, ext: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${tag}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${ext}`;
}
