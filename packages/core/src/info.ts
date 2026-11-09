import exifr from 'exifr/dist/lite.esm.mjs';
import { hasHeifMeta, readHeifMeta } from './isobmff.ts';
import { hasXmpIptc, looksLikeJpegImage } from './jpeg.ts';
import { displayLocation } from './location.ts';

export interface InfoRow {
  key: string;
  value: string;
}
export interface PhotoInfo {
  gps: { lat: number; lon: number } | null;
  altitude: number | null;

  rows: InfoRow[];

  more: number;

  xmpIptc: boolean;

  readable: boolean;

  image: boolean;

  hiddenLoc: boolean;

  locUnsure: boolean;
}

const SHOW = ['Make', 'Model', 'LensModel', 'Software', 'DateTimeOriginal', 'OffsetTimeOriginal', 'ExposureTime', 'FNumber', 'ISO', 'FocalLength', 'ImageDescription', 'Artist', 'Copyright', 'Orientation'] as const;

const fmt = (v: unknown): string => {
  if (v instanceof Date) return v.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  if (typeof v === 'number') return String(Math.round(v * 10000) / 10000);
  if (Array.isArray(v)) return v.join(', ');
  if (v instanceof Uint8Array) return `${v.length} bytes`;
  return String(v);
};

const isHeif = (u8: Uint8Array) => u8.length > 12 && String.fromCharCode(...u8.subarray(4, 8)) === 'ftyp';

const jpegHeadersOk = (u8: Uint8Array): boolean => {
  if (u8.length < 4 || u8[0] !== 0xff || u8[1] !== 0xd8) return false;
  let p = 2;
  while (p + 4 <= u8.length) {
    if (u8[p] !== 0xff) return false;
    const m = u8[p + 1];
    if (m === 0xda || m === 0xd9) return true;
    if (m === 0xff) { p++; continue; }
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2 || p + 2 + len > u8.length) return false;
    p += 2 + len;
  }
  return false;
};

const jpegAround = (tiff: Uint8Array): Uint8Array => {
  const len = tiff.length + 8;
  if (len > 0xffff) throw new Error('exif too large');
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff, 0xff, 0xd9]);
};

export async function readInfo(bytes: Uint8Array): Promise<PhotoInfo> {
  let all: Record<string, unknown> = {};
  let readable = true;
  try {
    let src = bytes;
    if (isHeif(bytes)) {
      if (!hasHeifMeta(bytes)) throw new Error('no meta');
      const hm = readHeifMeta(bytes);
      if (hm.truncated) throw new Error('truncated');
      const tiff = hm.exifTiff;
      src = tiff ? jpegAround(tiff) : new Uint8Array(0);
    }
    if (src.length) all = ((await exifr.parse(src, { tiff: true, exif: true, gps: true, ifd0: true, ifd1: false, interop: false, xmp: false, icc: false, iptc: false, makerNote: false, userComment: false, translateValues: true, reviveValues: false, mergeOutput: true })) ?? {}) as Record<string, unknown>;
    if (!isHeif(bytes) && !jpegHeadersOk(bytes)) throw new Error('bad jpeg');
  } catch {
    readable = false;
  }
  const lat = all.latitude as number | undefined;
  const lon = all.longitude as number | undefined;
  const gps = typeof lat === 'number' && typeof lon === 'number' && Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
  const rows: InfoRow[] = [];
  for (const k of SHOW) if (all[k] !== undefined && all[k] !== '') rows.push({ key: k, value: fmt(all[k]) });
  const shown = new Set<string>([...SHOW, 'latitude', 'longitude']);
  const more = Object.keys(all).filter((k) => !shown.has(k) && !k.startsWith('GPS')).length;
  let xmpIptc = false;
  let hiddenLoc = false;
  let locUnsure = false;
  try {
    xmpIptc = hasXmpIptc(bytes);
    if (!isHeif(bytes)) {
      const c = displayLocation(bytes);
      hiddenLoc = c.hidden;
      locUnsure = c.unsure;
    }
  } catch {

  }
  let image = false;
  try {
    image = isHeif(bytes) ? readable && hasHeifMeta(bytes) && !readHeifMeta(bytes).truncated : looksLikeJpegImage(bytes);
  } catch {

  }
  return { gps, altitude: typeof all.GPSAltitude === 'number' ? (all.GPSAltitude as number) : null, rows, more, xmpIptc, readable, image, hiddenLoc, locUnsure };
}
