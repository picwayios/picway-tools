import { convertImage, DEFAULT_QUALITY, type ConvertResult, type OutFormat } from './convert.ts';
import { resizeFormatFor, Unsupported, type ResizeChoice } from './resize.ts';
import { sniffKind } from './sniff.ts';

export const CROP_ACCEPT = '.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.tif,.tiff,image/*';
export type Quarter = 0 | 1 | 2 | 3;
export interface Rect { x: number; y: number; w: number; h: number }

export interface Geometry { rot: Quarter; flip: boolean; crop: Rect }

export type Matrix = [number, number, number, number, number, number];
export type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se';

export const frameDims = (w: number, h: number, rot: Quarter): [number, number] => (rot % 2 ? [h, w] : [w, h]);
export const fullRect = (fw: number, fh: number): Rect => ({ x: 0, y: 0, w: fw, h: fh });
export const initGeometry = (w: number, h: number): Geometry => ({ rot: 0, flip: false, crop: fullRect(w, h) });

export function mul(A: Matrix, B: Matrix): Matrix {
  const [a, b, c, d, e, f] = A;
  const [p, q, r, s, t, u] = B;
  return [a * p + c * q, b * p + d * q, a * r + c * s, b * r + d * s, a * t + c * u + e, b * t + d * u + f];
}
export const apply = (m: Matrix, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function frameMatrix(rot: Quarter, flip: boolean, w: number, h: number): Matrix {
  const F: Matrix = flip ? [-1, 0, 0, 1, w, 0] : [1, 0, 0, 1, 0, 0];
  const R: Matrix[] = [[1, 0, 0, 1, 0, 0], [0, 1, -1, 0, h, 0], [-1, 0, 0, -1, w, h], [0, -1, 1, 0, 0, w]];
  return mul(R[rot], F);
}

const q4 = (n: number) => (((n % 4) + 4) % 4) as Quarter;

export function rotate(g: Geometry, w: number, h: number, cw: boolean): Geometry {
  const [fw, fh] = frameDims(w, h, g.rot);
  const { x, y, w: cwid, h: chei } = g.crop;
  const crop = cw ? { x: fh - y - chei, y: x, w: chei, h: cwid } : { x: y, y: fw - x - cwid, w: chei, h: cwid };
  return { rot: q4(g.rot + (cw ? 1 : 3)), flip: g.flip, crop };
}

export function flip(g: Geometry, w: number, h: number, horizontal: boolean): Geometry {
  const [fw, fh] = frameDims(w, h, g.rot);
  const { x, y, w: cwid, h: chei } = g.crop;
  const crop = horizontal ? { x: fw - x - cwid, y, w: cwid, h: chei } : { x, y: fh - y - chei, w: cwid, h: chei };
  return { rot: q4(horizontal ? -g.rot : 2 - g.rot), flip: !g.flip, crop };
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const int = (n: number, fallback: number) => (Number.isFinite(n) ? Math.round(n) : n === Infinity ? 1e9 : n === -Infinity ? -1e9 : fallback);

export function clampRect(r: Rect, fw: number, fh: number): Rect {
  const w = clamp(int(r.w, fw), 1, fw);
  const h = clamp(int(r.h, fh), 1, fh);
  return { x: clamp(int(r.x, 0), 0, fw - w), y: clamp(int(r.y, 0), 0, fh - h), w, h };
}

export function fitRatio(ratio: number, fw: number, fh: number, around: Rect = fullRect(fw, fh)): Rect {
  let w = fw;
  let h = Math.round(w / ratio);
  if (h > fh) (h = fh), (w = Math.round(h * ratio));
  w = clamp(w, 1, fw);
  h = clamp(h, 1, fh);
  return clampRect({ x: around.x + (around.w - w) / 2, y: around.y + (around.h - h) / 2, w, h }, fw, fh);
}

export function dragRect(s: Rect, handle: Handle, dx: number, dy: number, ratio: number | null, fw: number, fh: number): Rect {
  if (handle === 'move') return clampRect({ ...s, x: s.x + dx, y: s.y + dy }, fw, fh);
  const sx = handle === 'ne' || handle === 'se' ? 1 : -1;
  const sy = handle === 'sw' || handle === 'se' ? 1 : -1;
  const ax = sx > 0 ? s.x : s.x + s.w;
  const ay = sy > 0 ? s.y : s.y + s.h;
  const maxW = sx > 0 ? fw - ax : ax;
  const maxH = sy > 0 ? fh - ay : ay;
  let w = clamp(s.w + sx * dx, 1, maxW);
  let h = clamp(s.h + sy * dy, 1, maxH);
  if (ratio) {
    if (Math.abs(dx) >= Math.abs(dy) * ratio) h = w / ratio;
    else w = h * ratio;
    if (w > maxW) (w = maxW), (h = w / ratio);
    if (h > maxH) (h = maxH), (w = h * ratio);
    if (w < 1) (w = 1), (h = w / ratio);
    if (h < 1) (h = 1), (w = h * ratio);
  }
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  return clampRect({ x: sx > 0 ? ax : ax - w, y: sy > 0 ? ay : ay - h, w, h }, fw, fh);
}

export function setSize(r: Rect, w: number, h: number, ratio: number | null, fw: number, fh: number, changed: 'w' | 'h'): Rect {
  w = clamp(int(w, r.w), 1, fw);
  h = clamp(int(h, r.h), 1, fh);
  if (ratio) {
    if (changed === 'w') h = w / ratio;
    else w = h * ratio;
    if (w > fw) (w = fw), (h = w / ratio);
    if (h > fh) (h = fh), (w = h * ratio); if (w < 1) (w = 1), (h = w / ratio); if (h < 1) (h = 1), (w = h * ratio);
  }
  return clampRect({ x: r.x, y: r.y, w, h }, fw, fh);
}

export function drawFrame(ctx: CanvasRenderingContext2D, img: CanvasImageSource, w: number, h: number, g: Geometry, outW: number, outH: number) {
  const k: Matrix = [outW / g.crop.w, 0, 0, outH / g.crop.h, 0, 0];
  const m = mul(k, mul([1, 0, 0, 1, -g.crop.x, -g.crop.y], frameMatrix(g.rot, g.flip, w, h)));
  if (outW === g.crop.w && outH === g.crop.h) ctx.imageSmoothingEnabled = false;
  ctx.transform(...m);
  ctx.drawImage(img, 0, 0, w, h);
}

export function scaleGeometry(g: Geometry, sw: number, sh: number, w: number, h: number): Geometry {
  if (sw === w && sh === h) return g;
  const [fw0, fh0] = frameDims(sw, sh, g.rot);
  const [fw, fh] = frameDims(w, h, g.rot);
  const kx = fw / fw0;
  const ky = fh / fh0;
  return { ...g, crop: clampRect({ x: g.crop.x * kx, y: g.crop.y * ky, w: g.crop.w * kx, h: g.crop.h * ky }, fw, fh) };
}

export interface CropOptions {
  geometry: Geometry;

  srcWidth: number;
  srcHeight: number;
  format: ResizeChoice;
  background: string;
  removeLocation: boolean;
  removeAllExif: boolean;
}
export interface CropResult extends ConvertResult {
  format: OutFormat;
  srcWidth: number;
  srcHeight: number;
}

export async function cropImage(file: File, o: CropOptions): Promise<CropResult> {
  const kind = sniffKind(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  const fmt = resizeFormatFor(kind, o.format);
  if (!fmt) throw new Unsupported('gif');
  let sw = 0;
  let sh = 0;
  let g = o.geometry;
  const r = await convertImage(file, {
    format: fmt,
    quality: DEFAULT_QUALITY[fmt] / 100,
    background: o.background,
    removeLocation: o.removeLocation,
    removeAllExif: o.removeAllExif,
    resize: (w, h) => {
      (sw = w), (sh = h);
      g = scaleGeometry(o.geometry, o.srcWidth, o.srcHeight, w, h);
      return [g.crop.w, g.crop.h];
    },
    draw: (ctx, bmp, ow, oh) => drawFrame(ctx, bmp, sw, sh, g, ow, oh),
  });
  return { ...r, from: kind ?? r.from, format: fmt, srcWidth: sw || r.width, srcHeight: sh || r.height };
}
