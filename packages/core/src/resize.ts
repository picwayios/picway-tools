import { convertImage, DEFAULT_QUALITY, type ConvertResult, type OutFormat } from './convert.ts';
import { outFormatFor } from './compress.ts';
import { sniffKind, type Kind } from './sniff.ts';

export type ResizeChoice = 'same' | 'jpeg' | 'png' | 'webp';
export const RESIZE_ACCEPT = '.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.bmp,.tif,.tiff,image/*';

export const PERCENT_MIN = 1;
export const PERCENT_MAX = 400;

export const PX_MAX = 30000;

export const PERCENTS = [25, 50, 75, 150, 200];

export type ResizeSpec =
  | { by: 'percent'; percent: number; noEnlarge: boolean }
  | { by: 'px'; width: number; height: number; keepRatio: boolean; noEnlarge: boolean };

export interface ResizeOptions {
  spec: ResizeSpec;
  format: ResizeChoice;
  background: string;
  removeLocation: boolean;
  removeAllExif: boolean;
}
export interface ResizeResult extends ConvertResult {
  format: OutFormat;

  srcWidth: number;
  srcHeight: number;

  keptSmall: boolean;

  stretched: boolean;
}
export class Unsupported extends Error {
  kind: 'gif';
  constructor(kind: 'gif') { super(kind); this.kind = kind; }
}

const clampInt = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : 0);

export function resizeFormatFor(kind: Kind | null, choice: ResizeChoice): OutFormat | null {
  if (kind === 'gif') return null;
  return choice === 'same' ? outFormatFor(kind, 'same') : choice;
}

export function targetDims(w: number, h: number, s: ResizeSpec): [number, number, boolean] {
  if (!(w > 0 && h > 0)) return [Math.max(1, w | 0), Math.max(1, h | 0), false];
  let tw: number;
  let th: number;
  if (s.by === 'percent') {
    const k = normInt(s.percent, PERCENT_MIN, PERCENT_MAX, 100) / 100;
    (tw = w * k), (th = h * k);
  } else {
    const W = clampInt(s.width, 0, PX_MAX);
    const H = clampInt(s.height, 0, PX_MAX);
    if (!W && !H) return [w, h, false];
    if (s.keepRatio) {
      const k = W && H ? Math.min(W / w, H / h) : W ? W / w : H / h;
      (tw = w * k), (th = h * k);
    } else (tw = W || w), (th = H || h);
  }
  tw = Math.max(1, Math.round(tw));
  th = Math.max(1, Math.round(th));
  if (s.noEnlarge && (tw > w || th > h)) {
    if (s.by === 'px' && !s.keepRatio) return [Math.min(tw, w), Math.min(th, h), tw >= w && th >= h];
    return [w, h, true];
  }
  return [tw, th, false];
}

export async function resizeImage(file: File, o: ResizeOptions): Promise<ResizeResult> {
  const kind = sniffKind(new Uint8Array(await file.slice(0, 4096).arrayBuffer()));
  const fmt = resizeFormatFor(kind, o.format);
  if (!fmt) throw new Unsupported('gif');
  let sw = 0;
  let sh = 0;
  let keptSmall = false;
  const r = await convertImage(file, {
    format: fmt,
    quality: DEFAULT_QUALITY[fmt] / 100,
    background: o.background,
    removeLocation: o.removeLocation,
    removeAllExif: o.removeAllExif,
    resize: (w, h) => {
      (sw = w), (sh = h);
      const [a, b, kept] = targetDims(w, h, o.spec);
      keptSmall = kept;
      return [a, b];
    },
  });
  const ratio = (a: number, b: number) => a / b;
  return {
    ...r,
    from: kind ?? r.from,
    format: fmt,
    srcWidth: sw || r.width,
    srcHeight: sh || r.height,
    keptSmall: keptSmall && !r.downscaled,
    stretched: o.spec.by === 'px' && !o.spec.keepRatio && Math.abs(ratio(r.width, r.height) / ratio(sw || r.width, sh || r.height) - 1) > 0.01,
  };
}

export function normInt(n: number, lo: number, hi: number, empty: number): number {
  const r = Math.round(n);
  return Number.isFinite(r) && r >= lo ? Math.min(hi, r) : empty;
}
