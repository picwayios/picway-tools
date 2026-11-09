import { convertImage, type ConvertOptions, type ConvertResult, type OutFormat } from './convert.ts';
import { fitToSize, FitStopped } from './fitsize.ts'; import { fitPixelCap } from './convert.ts';
import { sniffKind, type Kind } from './sniff.ts';

export type Choice = 'same' | 'jpeg' | 'webp';

export const COMPRESS_QUALITY = 80;
export const COMPRESS_ACCEPT = '.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.tif,.tiff,image/*';

export const MAX_SIDES = [0, 4096, 3000, 2048, 1600, 1280, 1024, 800];

export interface CompressOptions {
  format: Choice;

  quality: number;

  maxSide: number;

  target: number;

  reduceColors: boolean;
  background: string;
  removeLocation: boolean;
  removeAllExif: boolean;
}
export interface CompressResult extends ConvertResult {
  format: OutFormat;

  q?: number;

  srcWidth: number;
  srcHeight: number;

  fits?: boolean;

  shrunkForTarget: boolean;

  paletted: boolean;

  notSmaller: boolean;
}
export class Unsupported extends Error {
  kind: 'gif';
  constructor(kind: 'gif') { super(kind); this.kind = kind; }
}

export function outFormatFor(kind: Kind | null, choice: Choice): OutFormat | null {
  if (kind === 'gif') return null;
  if (choice !== 'same') return choice;
  return kind === 'png' ? 'png' : kind === 'webp' ? 'webp' : kind === 'avif' ? 'avif' : 'jpeg';
}

export function fitLongSide(w: number, h: number, max: number): [number, number] {
  const m = Math.max(w, h);
  if (!max || m <= max) return [w, h];
  const k = max / m;
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

const SLOW_DECODE: Kind[] = ['heic', 'tiff', 'avif'];

export async function compressImage(file: File, o: CompressOptions, stop?: () => boolean): Promise<CompressResult> {
  const kind = sniffKind(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  const fmt = outFormatFor(kind, o.format);
  if (!fmt) throw new Unsupported('gif');
  const base: ConvertOptions = { format: fmt, quality: 1, background: o.background, removeLocation: o.removeLocation, removeAllExif: o.removeAllExif };
  let src: File = file; const t0 = Date.now();
  let preShrunk = false; let midFirst = false; let midConv = false;
  if (o.target > 0 && kind && SLOW_DECODE.includes(kind)) {
    const mid = await convertImage(file, { ...base, format: 'png', removeLocation: false, removeAllExif: false });
    src = new File([mid.blob], 'intermediate.png', { type: 'image/png' });
    preShrunk = mid.downscaled; midFirst = mid.firstFrameOnly; midConv = mid.colourConverted; if (stop?.()) throw new FitStopped();
  }
  let sw = 0;
  let sh = 0; let capShrunk = false;
  const sizeAt = (scale: number) => (w: number, h: number): [number, number] => {
    (sw = w), (sh = h);
    const [a, b, capped] = fitPixelCap(fmt, ...fitLongSide(w, h, o.maxSide)); if (capped) capShrunk = true;
    return scale < 1 ? [Math.max(1, Math.round(a * scale)), Math.max(1, Math.round(b * scale))] : [a, b];
  };
  const once = async (q: number, scale: number) => {
    if (fmt !== 'png') {
      const r = await convertImage(src, { ...base, quality: q, resize: sizeAt(scale) });
      return { size: r.blob.size, r, paletted: false };
    }
    const r = await convertImage(src, { ...base, resize: sizeAt(scale) });
    const bytes = new Uint8Array(await r.blob.arrayBuffer());

    if (stop?.()) throw new FitStopped();
    const { repackPng: rp } = await import('./pngcolors.ts'); const repackPng = (b: Uint8Array, n: number) => rp(b, n).catch(() => ({ png: b, paletted: false }));
    const alt = await repackPng(bytes, o.reduceColors ? 256 : 0);
    if (alt.png.length < bytes.length) return { size: alt.png.length, r: { ...r, blob: new Blob([alt.png as BlobPart], { type: 'image/png' }) }, paletted: alt.paletted };
    return { size: bytes.length, r, paletted: false };
  };
  const q0 = fmt === 'png' ? 1 : Math.min(1, Math.max(0.3, o.quality || 0.8));
  let pick: { size: number; r: ConvertResult; paletted: boolean };
  let q: number | undefined = fmt === 'png' ? undefined : q0;
  let fits: boolean | undefined;
  let shrunkForTarget = false;
  if (o.target > 0) {
    const f = await fitToSize(once, o.target, { fixedQuality: fmt === 'png' ? 1 : undefined, hi: fmt === 'png' ? 1 : 0.92, maxTries: fmt === 'avif' ? 6 : 14, deadline: t0 + 90_000, stop });
    pick = f.result;
    if (fmt !== 'png') q = f.q;
    fits = f.fits;
    shrunkForTarget = f.scale < 1;
  } else pick = await once(q0, 1);
  const r = pick.r;
  return {
    ...r,
    from: kind ?? r.from,
    downscaled: r.downscaled || preShrunk || capShrunk, firstFrameOnly: r.firstFrameOnly || midFirst, colourConverted: r.colourConverted || midConv,
    format: fmt,
    q,
    srcWidth: sw || r.width,
    srcHeight: sh || r.height,
    fits,
    shrunkForTarget,
    paletted: pick.paletted,
    notSmaller: r.blob.size >= file.size,
  };
}

export const pctChange = (from: number, to: number) => (from > 0 ? (to === from ? '0%' : `${to < from ? '−' : '+'}${Math.round((Math.abs(from - to) / from) * 100)}%`) : '');
