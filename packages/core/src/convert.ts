import { getIcc, getExifTiff, setExif, setIcc } from './jpeg.ts';
import { readHeifMeta } from './isobmff.ts';
import { pngGetIcc, pngSetIcc } from './png.ts';
import { encodeBmp } from './bmp.ts';
import { p3ToSrgbInPlace } from './colour.ts';
import { pngGetExif, pngSetExif, prepareExif, webpGetMeta, webpSetMeta } from './imgmeta.ts';
import { tryLoadDict } from './exif.ts';
import { checkLocation, checkTiffLocation, locationVerdict } from './location.ts';
import { assertDecodable, asMemoryError, maxPixels, peekSize } from './pixelplan.ts'; import { isIOS } from './platform.ts';
import { isAnimated, RAW_EXT, sniffKind, structureError, tiffDataCut, type Kind } from './sniff.ts'; import { orientRGBA } from './orient.ts'; import { coded } from './errcode.ts';

export type OutFormat = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'bmp' | 'tiff';
export const OUT_FORMATS: OutFormat[] = ['jpeg', 'png', 'webp', 'avif', 'gif', 'bmp', 'tiff'];
export const OUT_EXT: Record<OutFormat, string> = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', gif: 'gif', bmp: 'bmp', tiff: 'tif' };
export const OUT_MIME: Record<OutFormat, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff' };
export const IN_ACCEPT = '.heic,.heif,.jpg,.jpeg,.png,.webp,.avif,.gif,.bmp,.tif,.tiff,image/*';

export const LOSSY: OutFormat[] = ['jpeg', 'webp', 'avif'];

export const DEFAULT_QUALITY: Record<OutFormat, number> = { jpeg: 92, png: 100, webp: 85, avif: 60, gif: 100, bmp: 100, tiff: 100 };

export const NEEDS_BACKGROUND: OutFormat[] = ['jpeg', 'bmp'];

export const CARRIES_EXIF: OutFormat[] = ['jpeg', 'png', 'webp'];
export const CARRIES_ICC: OutFormat[] = ['jpeg', 'png', 'webp'];

export interface ConvertOptions {
  format: OutFormat;

  quality: number;

  background: string;
  removeLocation: boolean;
  removeAllExif: boolean;  resize?: (width: number, height: number) => [number, number];  draw?: (ctx: CanvasRenderingContext2D, bitmap: ImageBitmap, w: number, h: number) => void;
}
export interface ConvertResult {
  blob: Blob;
  width: number;
  height: number;
  from: Kind;

  colour: 'p3' | 'other' | 'none';

  colourConverted: boolean;
  hadGps: boolean;

  gpsRemoved: boolean;

  gpsUnsure: boolean;
  exifKept: boolean;

  exifDropped: boolean;

  flattened: boolean;

  gifAlpha: boolean;

  firstFrameOnly: boolean;
  downscaled: boolean;
}

const MAX_PIXELS = maxPixels(isIOS());

const CAP: Record<OutFormat, number> = { jpeg: MAX_PIXELS, png: MAX_PIXELS, webp: MAX_PIXELS, avif: Math.min(MAX_PIXELS, 24_000_000), gif: Math.min(MAX_PIXELS, 40_000_000), bmp: Math.min(MAX_PIXELS, 60_000_000), tiff: Math.min(MAX_PIXELS, 40_000_000) };

const isP3 = (icc: Uint8Array | null) => !!icc && Array.from(icc.subarray(0, 1200), (c) => (c ? String.fromCharCode(c) : '')).join('').includes('Display P3');
const isSrgbProfile = (icc: Uint8Array | null) => !icc || /sRGB/.test(Array.from(icc.subarray(0, 600), (c) => (c ? String.fromCharCode(c) : '')).join(''));

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(coded('unknown', 'encode failed'))), type, q));

interface Decoded {
  kind: Kind;

  make(raw: boolean): Promise<ImageBitmap>;
  icc: Uint8Array | null;
  exifTiff: Uint8Array | null;
  animated: boolean;
}

export function preload(format: OutFormat): void {
  const run = format === 'webp' ? import('@jsquash/webp/encode.js') : format === 'avif' ? import('./avifenc.ts').then((m) => m.loadAvif()) : format === 'gif' ? import('gifenc') : format === 'tiff' ? import('utif') : null;
  run?.catch(() => {});
}

let p3Canvas: boolean | undefined;

function supportsP3Canvas(): boolean {
  return (p3Canvas ??= (document.createElement('canvas').getContext('2d', { colorSpace: 'display-p3' } as CanvasRenderingContext2DSettings)?.getContextAttributes?.().colorSpace ?? 'srgb') === 'display-p3');
}

async function bitmapOf(src: Blob | ImageData, raw = false): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(src, { imageOrientation: 'from-image', colorSpaceConversion: raw ? 'none' : 'default' } as ImageBitmapOptions);
  } catch (e) {
    if (e instanceof TypeError) return await createImageBitmap(src);
    throw e;
  }
}

async function decode(file: File): Promise<Decoded> {
  if (RAW_EXT.test(file.name)) throw coded('raw', 'camera RAW files aren’t supported');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffKind(bytes);
  if (!kind) throw coded('not-image', 'this isn’t an image this tool can read (the file extension may not match what’s inside)');
  const bad = structureError(bytes, kind);
  if (bad) throw coded('damaged', `${bad}, so it can’t be converted`);
  const animated = isAnimated(bytes, kind);
  const size = kind === 'heic' ? null : peekSize(bytes); if (size) assertDecodable(size[0], size[1]);
  let icc: Uint8Array | null = null;
  let exifTiff: Uint8Array | null = null;
  let make: (raw: boolean) => Promise<ImageBitmap>;
  if (kind === 'jpeg') {
    icc = getIcc(bytes);
    exifTiff = getExifTiff(bytes);
  } else if (kind === 'png') {
    icc = await pngGetIcc(bytes);
    exifTiff = pngGetExif(bytes);
  } else if (kind === 'webp') ({ icc, exifTiff } = webpGetMeta(bytes));

  if (kind === 'heic') {
    const meta = readHeifMeta(bytes);
    exifTiff = meta.exifTiff;

    const { convertHeic } = await import('./heic.ts');
    const r = await convertHeic(file, { format: 'png', quality: 1, removeLocation: true, removeAllExif: true });
    icc = await pngGetIcc(new Uint8Array(await r.blob.arrayBuffer()));
    make = (raw) => bitmapOf(r.blob, raw);
  } else if (kind === 'tiff') {
    const UTIF = (await import('utif')).default as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    let ifds; try { ifds = UTIF.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); } catch (e) { throw coded('damaged', `the TIFF structure is damaged (${e})`); }
    const page = ifds?.[0];
    if (!page) throw coded('unreadable', 'the TIFF file has no readable image'); if (tiffDataCut(page, bytes.length)) throw coded('damaged', 'the TIFF data is cut off');
    try { UTIF.decodeImage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), page); } catch (e) { throw coded('unreadable', `this kind of TIFF can’t be read here (${e})`); }
    if (!page.width || !page.height || !page.data) throw coded(page.t256 ? 'unreadable' : 'damaged', 'this kind of TIFF can’t be read here');
    const rgba = new Uint8ClampedArray(UTIF.toRGBA8(page));
    if (rgba.length !== page.width * page.height * 4) throw coded('unreadable', 'this kind of TIFF can’t be read here');
    const o = orientRGBA(rgba, page.width, page.height, Number(page.t274?.[0]) || 1); const img = new ImageData(o.data, o.w, o.h);
    make = () => bitmapOf(img);
  } else {
    make = (raw) => bitmapOf(file, raw);
    if (kind === 'avif') {
     try {
      (await make(false)).close();
     } catch {

      const dec = (await import('@jsquash/avif/decode.js')).default;
      const img = await dec(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      if (!img) throw coded('unreadable', 'the AVIF file can’t be decoded');
      const id = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
      make = () => bitmapOf(id);
     }
    }
  }
  return { kind, make, icc, exifTiff, animated };
}

export async function convertImage(file: File, opt: ConvertOptions): Promise<ConvertResult> {
  const fmt = opt.format;
  const d = await decode(file);

  const hasProfile = !!d.icc && !isSrgbProfile(d.icc);
  const carriesIcc = CARRIES_ICC.includes(fmt);
  const srcP3 = hasProfile && isP3(d.icc);
  const mode: 'plain' | 'p3canvas' | 'raw' | 'rawP3' | 'browser' = !hasProfile ? 'plain' : supportsP3Canvas() ? (srcP3 ? 'p3canvas' : 'browser') : carriesIcc ? 'raw' : srcP3 ? 'rawP3' : 'browser';
  let bitmap: ImageBitmap; try { bitmap = await d.make(mode === 'raw' || mode === 'rawP3'); } catch (e) { throw asMemoryError(e); }
  try {
    if (!bitmap.width || !bitmap.height) throw coded('unreadable', 'the image has no pixels');
    let w = bitmap.width;
    let h = bitmap.height; if (opt.resize) [w, h] = opt.resize(w, h).map((n) => Math.max(1, Math.round(Number.isFinite(n) ? n : 1)));
    let downscaled = false;
    const cap = CAP[fmt];
    const dimCap = fmt === 'webp' ? 16383 : 65535;
    let k = 1;
    if (w * h > cap) k = Math.sqrt(cap / (w * h));
    if (Math.max(w, h) * k > dimCap) k = dimCap / Math.max(w, h);
    if (k < 1) (w = Math.max(1, Math.floor(w * k)), (h = Math.max(1, Math.floor(h * k))), (downscaled = true));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { colorSpace: mode === 'p3canvas' ? 'display-p3' : 'srgb' } as CanvasRenderingContext2DSettings)!;
    if (opt.resize) ctx.imageSmoothingQuality = 'high'; if (opt.draw) (ctx.save(), opt.draw(ctx, bitmap, w, h), ctx.restore()); else ctx.drawImage(bitmap, 0, 0, w, h);

    let flattened = false;
    let gifAlpha = false;
    if (NEEDS_BACKGROUND.includes(fmt) || fmt === 'gif') {
      const px = ctx.getImageData(0, 0, w, h).data;
      let any = false;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 255) { any = true; break; }
      if (any && NEEDS_BACKGROUND.includes(fmt)) {
        flattened = true;
        ctx.globalCompositeOperation = 'destination-over';
        ctx.fillStyle = /^#[0-9a-f]{6}$/i.test(opt.background) ? opt.background : '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
      }
      gifAlpha = any && fmt === 'gif';
    }

    const q = Math.min(1, Math.max(0.3, opt.quality));
    let out: Uint8Array;
    let cached: ImageData | null = null;
    const pixels = () => {
      if (cached) return cached;
      cached = ctx.getImageData(0, 0, w, h, { colorSpace: mode === 'p3canvas' ? 'display-p3' : 'srgb' } as ImageDataSettings);
      if ((mode === 'p3canvas' || mode === 'rawP3') && !carriesIcc) p3ToSrgbInPlace(cached.data);
      return cached;
    };
    if (fmt === 'jpeg') out = new Uint8Array(await (await toBlob(canvas, 'image/jpeg', q)).arrayBuffer());
    else if (fmt === 'png') out = new Uint8Array(await (await toBlob(canvas, 'image/png')).arrayBuffer());
    else if (fmt === 'webp') {
      const encode = (await import('@jsquash/webp/encode.js')).default;
      out = new Uint8Array(await encode(pixels(), { quality: Math.round(q * 100) }));
    } else if (fmt === 'avif') {
      out = await (await import('./avifenc.ts')).encodeAvif(pixels(), Math.round(q * 100));
    } else if (fmt === 'gif') {
      const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
      const px = pixels().data;
      const palette = quantize(px, 256, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(px, palette, 'rgba4444');
      const ti = gifAlpha ? palette.findIndex((c: number[]) => c.length > 3 && c[3] === 0) : -1;
      const gif = GIFEncoder();
      gif.writeFrame(index, w, h, ti >= 0 ? { palette, transparent: true, transparentIndex: ti } : { palette });
      gif.finish();
      out = gif.bytes();
    } else if (fmt === 'bmp') out = encodeBmp(pixels().data, w, h);
    else {
      const UTIF = (await import('utif')).default as any; // eslint-disable-line @typescript-eslint/no-explicit-any
      out = new Uint8Array(UTIF.encodeImage(new Uint8Array(pixels().data.buffer), w, h));
    }
    if (!out.length) throw coded('unknown', 'encode failed');

    const icc = carriesIcc && (mode === 'p3canvas' || mode === 'raw') ? d.icc : null;
    const colour: ConvertResult['colour'] = icc ? (isP3(icc) ? 'p3' : 'other') : 'none';
    const colourConverted = hasProfile && !icc;
    const carriesExif = CARRIES_EXIF.includes(fmt);
    const hadGps = prepareExif(d.exifTiff, { removeLocation: true, removeAllExif: true }, w, h).hadGps;
    const ex = prepareExif(carriesExif ? d.exifTiff : null, opt, w, h);
    let exifKept = false;
    if (fmt === 'jpeg') {
      out = setExif(out, ex.tiff);
      out = setIcc(out, icc);
      exifKept = !!ex.tiff;
    } else if (fmt === 'png') {
      if (icc) out = await pngSetIcc(out, icc, isP3(icc) ? 'Display P3' : 'ICC');
      if (ex.tiff) (out = pngSetExif(out, ex.tiff)), (exifKept = true);
    } else if (fmt === 'webp') {
      if (icc || ex.tiff) out = webpSetMeta(out, { icc, exif: ex.tiff });
      exifKept = !!ex.tiff;
    }

    const check = fmt === 'jpeg' ? checkLocation(out) : checkTiffLocation(fmt === 'png' ? pngGetExif(out) : fmt === 'webp' ? webpGetMeta(out).exifTiff : null);
    const loc = locationVerdict(hadGps, opt.removeLocation || opt.removeAllExif || !carriesExif, check, !!d.exifTiff && !tryLoadDict(d.exifTiff));
    return {
      blob: new Blob([out as BlobPart], { type: OUT_MIME[fmt] }),
      width: w,
      height: h,
      from: d.kind,
      colour,
      colourConverted,
      hadGps: loc.hadGps,
      gpsRemoved: loc.gpsRemoved,
      gpsUnsure: loc.gpsUnsure,
      exifKept,
      exifDropped: !!d.exifTiff && !carriesExif && !opt.removeAllExif,
      flattened,
      gifAlpha,
      firstFrameOnly: d.animated,
      downscaled,
    };
  } finally {
    bitmap.close();
  }
}

export function fitPixelCap(fmt: OutFormat, w: number, h: number): [number, number, boolean] {
  const dimCap = fmt === 'webp' ? 16383 : 65535;
  let k = 1;
  if (w * h > CAP[fmt]) k = Math.sqrt(CAP[fmt] / (w * h));
  if (Math.max(w, h) * k > dimCap) k = dimCap / Math.max(w, h);
  return k < 1 ? [Math.max(1, Math.floor(w * k)), Math.max(1, Math.floor(h * k)), true] : [w, h, false];
}
