import { readHeifMeta, type HeifMeta } from './isobmff.ts'; import { coded } from './errcode.ts'; import { assertDecodable, asMemoryError, maxPixels, peekSize } from './pixelplan.ts'; import { isIOS } from './platform.ts';
import { finalizeOutput } from './postprocess.ts';

export interface ConvertOptions {
  format: 'jpeg' | 'png';

  quality: number;

  removeLocation: boolean;

  removeAllExif: boolean;
}
export interface ConvertResult {
  blob: Blob;
  width: number;
  height: number;
  path: 'native' | 'library';

  colour: 'p3' | 'other' | 'none';
  hadGps: boolean;

  gpsRemoved: boolean;

  gpsUnsure: boolean;
  exifKept: boolean;

  downscaled: boolean;
}

export const HEIC_ACCEPT = '.heic,.heif,image/heic,image/heif';

const ascii = (u: Uint8Array, a: number, b: number) => String.fromCharCode(...u.subarray(a, b));

export async function looksHeif(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  return ascii(head, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|heim|heis|mif1|msf1)/.test(ascii(head, 8, 12));
}

const isP3 = (icc: Uint8Array | null) => !!icc && Array.from(icc.subarray(0, 1200), (c) => (c ? String.fromCharCode(c) : '')).join('').includes('Display P3');
const MAX_PIXELS = maxPixels(isIOS());

async function nativeDecode(file: Blob): Promise<HTMLImageElement | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    if (img.naturalWidth > 0) return img;
    URL.revokeObjectURL(url);
    return null;
  } catch {
    URL.revokeObjectURL(url);
    return null;
  }
}

async function decodeWithLibheif(file: File): Promise<{ width: number; height: number; image: ImageData }> {
  // @ts-expect-error untyped module path
  const factory = (await import('libheif-js/libheif-wasm/libheif-bundle.mjs')).default as () => Promise<LibheifModule>;
  const lib = await factory();
  const imgs = new lib.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  if (!imgs.length) throw coded('unreadable', 'no image found in this HEIC file');
  const im = imgs[0];
  const width = im.get_width();
  const height = im.get_height();
  assertDecodable(width, height);
  let image: ImageData; try { image = new ImageData(width, height); } catch (e) { throw asMemoryError(e); }
  try { await new Promise<void>((res, rej) => im.display(image, (r: unknown) => (r ? res() : rej(coded('unreadable', 'HEIC decode failed'))))); } catch (e) { throw asMemoryError(e); }
  return { width, height, image };
}
interface LibheifModule {
  HeifDecoder: new () => { decode(buf: Uint8Array): { get_width(): number; get_height(): number; display(target: ImageData, cb: (r: unknown) => void): void }[] };
}
const toBlob = (c: HTMLCanvasElement, type: string, q: number) => new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(coded('unknown', 'encode failed'))), type, q));

export async function convertHeic(file: File, opt: ConvertOptions): Promise<ConvertResult> {
  const src = new Uint8Array(await file.arrayBuffer());
  const meta: HeifMeta = readHeifMeta(src);
  const peek = peekSize(src); if (peek) assertDecodable(peek[0], peek[1]);
  const mime = opt.format === 'png' ? 'image/png' : 'image/jpeg';
  let out: Uint8Array;
  let width = 0;
  let height = 0;
  let path: ConvertResult['path'] = 'native';
  let p3Canvas = false;
  let downscaled = false;

  const img = await nativeDecode(file);
  if (img) {
    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (w * h > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (w * h));
      (w = Math.floor(w * k)), (h = Math.floor(h * k));
      downscaled = true;
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const wantP3 = isP3(meta.icc);
    const ctx = canvas.getContext('2d', wantP3 ? { colorSpace: 'display-p3' } : undefined)!;
    p3Canvas = wantP3 && (ctx.getContextAttributes?.().colorSpace ?? 'srgb') === 'display-p3';
    try { ctx.drawImage(img, 0, 0, w, h); } finally { URL.revokeObjectURL(img.src); }
    out = new Uint8Array(await (await toBlob(canvas, mime, opt.quality)).arrayBuffer());
    (width = w), (height = h);
  } else {
    path = 'library';

    const decoded = await decodeWithLibheif(file);
    ({ width, height } = decoded);
    const canvas = document.createElement('canvas');
    let w = width;
    let h = height;
    if (w * h > MAX_PIXELS) {
      const k = Math.sqrt(MAX_PIXELS / (w * h));
      (w = Math.floor(w * k)), (h = Math.floor(h * k));
      downscaled = true;
    }
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    if (downscaled) {
      const bmp = await createImageBitmap(decoded.image);
      ctx.drawImage(bmp, 0, 0, w, h);
      bmp.close();
    } else ctx.putImageData(decoded.image, 0, 0);
    out = new Uint8Array(await (await toBlob(canvas, mime, opt.quality)).arrayBuffer());
    (width = w), (height = h);
  }

  let icc: Uint8Array | null = null;
  if (meta.icc && (path === 'library' || p3Canvas)) icc = meta.icc;
  const colour: ConvertResult['colour'] = icc ? (isP3(icc) ? 'p3' : 'other') : 'none';

  const fin = await finalizeOutput(out, meta, opt, width, height, icc, colour === 'p3' ? 'Display P3' : 'ICC');
  const { gpsRemoved, hadGps, gpsUnsure, exifKept } = fin;
  out = fin.bytes;
  return { blob: new Blob([out as BlobPart], { type: mime }), width, height, path, colour, hadGps, gpsRemoved, gpsUnsure, exifKept, downscaled };
}
