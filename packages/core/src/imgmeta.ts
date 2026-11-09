import { crc32 } from './zip.ts';

const ascii = (u: Uint8Array, a: number, b: number) => String.fromCharCode(...u.subarray(a, b));
const u32le = (u: Uint8Array, p: number) => (u[p] | (u[p + 1] << 8) | (u[p + 2] << 16) | (u[p + 3] << 24)) >>> 0;
const put32le = (u: Uint8Array, p: number, v: number) => (u[p] = v & 255, u[p + 1] = (v >> 8) & 255, u[p + 2] = (v >> 16) & 255, u[p + 3] = (v >>> 24) & 255);
const cat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

interface RiffChunk {
  type: string;
  start: number;

  end: number;
  body: Uint8Array;
}
function riffChunks(u: Uint8Array): RiffChunk[] {
  const out: RiffChunk[] = [];
  let p = 12;
  while (p + 8 <= u.length) {
    const len = u32le(u, p + 4);
    const bodyEnd = p + 8 + len;
    if (bodyEnd > u.length) break;
    out.push({ type: ascii(u, p, p + 4), start: p, end: Math.min(u.length, bodyEnd + (len & 1)), body: u.subarray(p + 8, bodyEnd) });
    p = bodyEnd + (len & 1);
  }
  return out;
}
const riffChunk = (type: string, body: Uint8Array) => {
  const out = new Uint8Array(8 + body.length + (body.length & 1));
  for (let i = 0; i < 4; i++) out[i] = type.charCodeAt(i);
  put32le(out, 4, body.length);
  out.set(body, 8);
  return out;
};

export function webpGetMeta(u: Uint8Array): { icc: Uint8Array | null; exifTiff: Uint8Array | null } {
  let icc: Uint8Array | null = null;
  let exifTiff: Uint8Array | null = null;
  try {
    for (const c of riffChunks(u)) {
      if (c.type === 'ICCP' && c.body.length >= 128) icc = c.body.slice();
      if (c.type === 'EXIF' && c.body.length > 8) exifTiff = (ascii(c.body, 0, 6) === 'Exif\0\0' ? c.body.subarray(6) : c.body).slice();
    }
  } catch {

  }
  return { icc, exifTiff };
}

export function webpSetMeta(u: Uint8Array, meta: { icc?: Uint8Array | null; exif?: Uint8Array | null }): Uint8Array {
  const chunks = riffChunks(u);
  const image = chunks.filter((c) => c.type !== 'VP8X' && c.type !== 'ICCP' && c.type !== 'EXIF' && c.type !== 'XMP ');
  const vp8x = chunks.find((c) => c.type === 'VP8X');
  let width: number;
  let height: number;
  let alpha = false;
  let anim = false;
  if (vp8x) {
    const b = vp8x.body;
    alpha = !!(b[0] & 0x10);
    anim = !!(b[0] & 0x02);
    width = 1 + (b[4] | (b[5] << 8) | (b[6] << 16));
    height = 1 + (b[7] | (b[8] << 8) | (b[9] << 16));
  } else {
    const c = image.find((x) => x.type === 'VP8 ' || x.type === 'VP8L');
    if (!c) throw new Error('not a WebP image');
    if (c.type === 'VP8L') {
      const v = c.body[1] | (c.body[2] << 8) | (c.body[3] << 16) | (c.body[4] << 24);
      width = 1 + (v & 0x3fff);
      height = 1 + ((v >>> 14) & 0x3fff);
      alpha = !!((v >>> 28) & 1);
    } else {
      width = (c.body[6] | (c.body[7] << 8)) & 0x3fff;
      height = (c.body[8] | (c.body[9] << 8)) & 0x3fff;
    }
    if (image.some((x) => x.type === 'ALPH')) alpha = true;
  }
  const flags = (meta.icc ? 0x20 : 0) | (alpha ? 0x10 : 0) | (meta.exif ? 0x08 : 0) | (anim ? 0x02 : 0);
  const head = new Uint8Array(10);
  head[0] = flags;
  head[4] = (width - 1) & 255;
  head[5] = ((width - 1) >> 8) & 255;
  head[6] = ((width - 1) >> 16) & 255;
  head[7] = (height - 1) & 255;
  head[8] = ((height - 1) >> 8) & 255;
  head[9] = ((height - 1) >> 16) & 255;
  const parts: Uint8Array[] = [riffChunk('VP8X', head)];
  if (meta.icc) parts.push(riffChunk('ICCP', meta.icc));
  for (const c of image) parts.push(u.subarray(c.start, c.end));
  if (meta.exif) parts.push(riffChunk('EXIF', meta.exif));
  const body = cat(parts);
  const out = new Uint8Array(12 + body.length);
  out.set(u.subarray(0, 12));
  out.set(body, 12);
  put32le(out, 4, out.length - 8);
  return out;
}

const u32be = (u: Uint8Array, p: number) => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;

export function pngGetExif(png: Uint8Array): Uint8Array | null {
  let p = 8;
  while (p + 12 <= png.length) {
    const len = u32be(png, p);
    const type = ascii(png, p + 4, p + 8);
    if (p + 12 + len > png.length || type === 'IEND') return null;
    if (type === 'eXIf') return len > 8 ? png.slice(p + 8, p + 8 + len) : null;
    p += 12 + len;
  }
  return null;
}

export function pngSetExif(png: Uint8Array, tiff: Uint8Array): Uint8Array {
  const body = new Uint8Array(12 + tiff.length);
  const dv = new DataView(body.buffer);
  dv.setUint32(0, tiff.length);
  for (let i = 0; i < 4; i++) body[4 + i] = 'eXIf'.charCodeAt(i);
  body.set(tiff, 8);
  dv.setUint32(8 + tiff.length, crc32(body.subarray(4, 8 + tiff.length)));
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  let done = false;
  while (p + 12 <= png.length) {
    const len = u32be(png, p);
    const type = ascii(png, p + 4, p + 8);
    const end = p + 12 + len;
    if (type === 'eXIf') {
      p = end;
      continue;
    }
    if (type === 'IDAT' && !done) (parts.push(body), (done = true));
    parts.push(png.subarray(p, end));
    p = end;
  }
  return cat(parts);
}

import { dumpDict, loadDict, normalizeAfterRender, removeLocation as dropGps } from './exif.ts';
import { dictHasLocation } from './location.ts';

export function prepareExif(
  tiff: Uint8Array | null,
  o: { removeLocation: boolean; removeAllExif: boolean },
  width: number,
  height: number,
): { tiff: Uint8Array | null; hadGps: boolean; gpsRemoved: boolean } {
  if (!tiff) return { tiff: null, hadGps: false, gpsRemoved: false };
  const dict = loadDict(tiff);
  const hadGps = dictHasLocation(dict);
  if (o.removeAllExif) return { tiff: null, hadGps, gpsRemoved: hadGps };
  normalizeAfterRender(dict, width, height);
  if (o.removeLocation) dropGps(dict);
  return { tiff: dumpDict(dict), hadGps, gpsRemoved: o.removeLocation && hadGps };
}
