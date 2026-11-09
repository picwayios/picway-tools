import { scanGif, walkGif } from './gifdecode.ts';
import { GifPacker, gifLoops, strictScan } from './gifpack.ts';

export interface GifCompressIn {
  width: number;
  height: number;

  delays: number[];

  maxLong: number;

  step: number;

  colors: number;
  tolerance?: number;
}
export interface GifCompressPlan {
  w: number;
  h: number;

  keep: number[];

  delaysCs: number[];
  colors: number;
  step: number;
  tolerance: number;
}

export const GIF_STEPS = [1, 2, 3];

export const GIF_LEVELS = { light: { colors: 256, tolerance: 12 }, medium: { colors: 128, tolerance: 24 }, heavy: { colors: 64, tolerance: 48 } } as const;
export type GifLevel = keyof typeof GIF_LEVELS;
export const GIF_SIZES = [0, 640, 480, 320];

export function planGifCompress(s: GifCompressIn): GifCompressPlan {
  const long = Math.max(s.width, s.height);
  const k = s.maxLong && long > s.maxLong ? s.maxLong / long : 1;
  const w = k === 1 ? s.width : Math.max(1, Math.round(s.width * k));
  const h = k === 1 ? s.height : Math.max(1, Math.round(s.height * k));
  const step = Math.max(1, Math.floor(s.step));
  const keep: number[] = [];
  const delaysCs: number[] = [];
  s.delays.forEach((d, i) => {
    if (i % step === 0 || delaysCs[delaysCs.length - 1] + Math.round(d / 10) > 65535) {
      keep.push(i);
      delaysCs.push(0);
    }
    delaysCs[delaysCs.length - 1] += Math.round(d / 10);
  });
  return { w, h, keep, delaysCs, colors: s.colors, step, tolerance: s.tolerance ?? 0 };
}

export type Resize = (rgba: Uint8ClampedArray, gw: number, gh: number, w: number, h: number) => Uint8ClampedArray;
export interface GifCompressOptions {

  stopAt: number;
  resize: Resize;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}

const yieldNow = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => (c.port1.close(), r()); c.port2.postMessage(0); });

export async function compressGif(bytes: Uint8Array, src: { width: number; height: number }, plan: GifCompressPlan, o: GifCompressOptions): Promise<Uint8Array> {
  const pack = new GifPacker({ width: plan.w, height: plan.h, loops: gifLoops(bytes), colors: plan.colors, tolerance: plan.tolerance });
  const scaled = plan.w !== src.width || plan.h !== src.height;
  const total = plan.keep[plan.keep.length - 1] + 1;
  let k = 0;
  let last = performance.now();
  for (const f of walkGif(bytes, { maxFrames: Infinity, maxPixels: Infinity })) {
    if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (f.index === plan.keep[k]) {
      if (k >= plan.keep.length) throw new Error('frame-count');
      pack.add(scaled ? o.resize(f.rgba, src.width, src.height, plan.w, plan.h) : f.rgba, plan.delaysCs[k++]);
      if (pack.size >= o.stopAt) throw new Error('not-smaller');
    }
    o.onProgress(Math.min(f.index + 1, total), total); if (k === plan.keep.length) break;
    if (performance.now() - last > 30) {
      await yieldNow();
      last = performance.now();
    }
  }
  if (k !== plan.keep.length) throw new Error('frame-count');
  return pack.finish();
}

export async function verifyGifCompress(out: Uint8Array, plan: GifCompressPlan, loops: number | null, signal?: AbortSignal): Promise<boolean> {
  try {
    const s = scanGif(out);
    if (s.width !== plan.w || s.height !== plan.h || s.frames !== plan.keep.length) return false;
    if (s.delays.some((d, i) => d !== plan.delaysCs[i] * 10)) return false;
    if (gifLoops(out) !== loops) return false;
    let n = 0;
    let last = performance.now();
    const pause = async () => {
      if (performance.now() - last > 30) {
        await yieldNow();
        last = performance.now();
      }
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    };
    for (const _ of walkGif(out, { maxFrames: Infinity, maxPixels: Infinity })) {
      n++;
      await pause();
    }
    if (n !== plan.keep.length) return false;

    const it = strictScan(out);
    let r = it.next();
    for (; !r.done; r = it.next()) await pause();
    return r.value === n;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e;
    return false;
  }
}
