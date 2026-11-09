import piexif from 'piexifjs';
import { dropExtras, dropJfifThumbs, dropXmpIptc, getExifTiff, setExif } from './jpeg.ts';

const toBin = (u8: Uint8Array) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return s;
};
const fromBin = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

const OFFSET_TAGS = { OffsetTime: 36880, OffsetTimeOriginal: 36881, OffsetTimeDigitized: 36882 } as const;
for (const [name, tag] of Object.entries(OFFSET_TAGS)) piexif.TAGS.Exif[tag] ??= { name, type: 'Ascii' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ExifDict = any;

export function loadDict(tiff: Uint8Array | null): ExifDict {
  if (tiff) {
    try {
      const d = piexif.load('Exif\0\0' + toBin(tiff));
      return d;
    } catch {

    }
  }
  return { '0th': {}, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null };
}

export const dumpDict = (d: ExifDict): Uint8Array => fromBin(piexif.dump(d)).subarray(6);

export function tryLoadDict(tiff: Uint8Array): ExifDict | null {
  try {
    return piexif.load('Exif\0\0' + toBin(tiff));
  } catch {
    return null;
  }
}

export const hasGps = (d: ExifDict) => Object.keys(d.GPS ?? {}).length > 0;

export const EMBEDDED_META_TAGS = [700, 33723, 34377] as const;

export function embeddedXmp(d: ExifDict): string | null {
  const v = d?.['0th']?.[700];
  if (v === undefined || v === null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v) || v instanceof Uint8Array) return Array.from(v as ArrayLike<number>, (c) => String.fromCharCode(c)).join('');
  return String(v);
}

export const hasEmbeddedMeta = (d: ExifDict) => EMBEDDED_META_TAGS.some((t) => d?.['0th']?.[t] !== undefined);

export function dropEmbeddedMeta(d: ExifDict): ExifDict {
  for (const t of EMBEDDED_META_TAGS) delete d['0th']?.[t];
  return d;
}

export function removeLocation(d: ExifDict): ExifDict {
  d.GPS = {};
  d['1st'] = {};
  d.thumbnail = null;
  dropEmbeddedMeta(d);
  return d;
}

export function normalizeAfterRender(d: ExifDict, width: number, height: number): ExifDict {
  d['0th'][piexif.ImageIFD.Orientation] = 1;
  d.Exif[piexif.ExifIFD.PixelXDimension] = width;
  d.Exif[piexif.ExifIFD.PixelYDimension] = height;
  d['1st'] = {};
  d.thumbnail = null;
  return d;
}

export function stripLocationFromJpeg(jpeg: Uint8Array): Uint8Array {
  const tiff = getExifTiff(jpeg);
  const out = tiff ? setExif(jpeg, dumpDict(removeLocation(loadDict(tiff)))) : jpeg;
  return dropJfifThumbs(dropExtras(dropXmpIptc(out)));
}

export const stripAllFromJpeg = (jpeg: Uint8Array): Uint8Array => {

  const o = loadDict(getExifTiff(jpeg))['0th']?.[piexif.ImageIFD.Orientation];
  const keep = typeof o === 'number' && o > 1 && o <= 8 ? dumpDict({ '0th': { [piexif.ImageIFD.Orientation]: o }, Exif: {}, GPS: {}, Interop: {}, '1st': {}, thumbnail: null }) : null;
  return dropJfifThumbs(dropExtras(dropXmpIptc(setExif(jpeg, keep))));
};

export const toRational = (deg: number): [[number, number], [number, number], [number, number]] => {
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = Math.round(((a - d) * 60 - m) * 60 * 10000);
  return [[d, 1], [m, 1], [s, 10000]];
};

export function setGps(d: ExifDict, lat: number, lon: number): ExifDict {
  d.GPS = {
    ...Object.fromEntries(Object.entries(d.GPS ?? {}).filter(([k]) => !PLACE_BOUND_GPS.includes(Number(k)))),
    [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
    [piexif.GPSIFD.GPSLatitudeRef]: lat < 0 ? 'S' : 'N',
    [piexif.GPSIFD.GPSLatitude]: toRational(lat),
    [piexif.GPSIFD.GPSLongitudeRef]: lon < 0 ? 'W' : 'E',
    [piexif.GPSIFD.GPSLongitude]: toRational(lon),
  };
  return d;
}
const dms = (r: [number, number][]) => r[0][0] / r[0][1] + r[1][0] / r[1][1] / 60 + r[2][0] / r[2][1] / 3600;
export function getGps(d: ExifDict): { lat: number; lon: number } | null {
  const g = d.GPS ?? {};
  const la = g[piexif.GPSIFD.GPSLatitude];
  const lo = g[piexif.GPSIFD.GPSLongitude];
  if (!la || !lo) return null;
  const lat = dms(la) * (g[piexif.GPSIFD.GPSLatitudeRef] === 'S' ? -1 : 1);
  const lon = dms(lo) * (g[piexif.GPSIFD.GPSLongitudeRef] === 'W' ? -1 : 1);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

export interface Fields {
  make?: string;
  model?: string;
  artist?: string;
  description?: string;
  copyright?: string;
  dateTimeOriginal?: string;
  offset?: string;
}
export function readFields(d: ExifDict): Fields {
  const s = (v: unknown) => (typeof v === 'string' ? dec(v.replace(/\0+$/, '')) : undefined);
  return {
    make: s(d['0th'][piexif.ImageIFD.Make]),
    model: s(d['0th'][piexif.ImageIFD.Model]),
    artist: s(d['0th'][piexif.ImageIFD.Artist]),
    description: s(d['0th'][piexif.ImageIFD.ImageDescription]),
    copyright: s(d['0th'][piexif.ImageIFD.Copyright]),
    dateTimeOriginal: s(d.Exif[piexif.ExifIFD.DateTimeOriginal]),
    offset: s(d.Exif[OFFSET_TAGS.OffsetTimeOriginal]),
  };
}

const enc = (v: string) => Array.from(new TextEncoder().encode(v), (b) => String.fromCharCode(b)).join('');
const dec = (v: string) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(v, (c) => c.charCodeAt(0)));
  } catch {
    return v;
  }
};
const put = (obj: Record<number, unknown>, tag: number, v: string | undefined) => {
  if (v === undefined) return;
  if (v === '') delete obj[tag];
  else obj[tag] = enc(v);
};

export function writeFields(d: ExifDict, f: Fields): ExifDict {
  put(d['0th'], piexif.ImageIFD.Make, f.make);
  put(d['0th'], piexif.ImageIFD.Model, f.model);
  put(d['0th'], piexif.ImageIFD.Artist, f.artist);
  put(d['0th'], piexif.ImageIFD.ImageDescription, f.description);
  put(d['0th'], piexif.ImageIFD.Copyright, f.copyright);
  if (f.dateTimeOriginal !== undefined) {
    put(d.Exif, piexif.ExifIFD.DateTimeOriginal, f.dateTimeOriginal);
    put(d.Exif, piexif.ExifIFD.DateTimeDigitized, f.dateTimeOriginal);
    put(d['0th'], piexif.ImageIFD.DateTime, f.dateTimeOriginal);
    for (const t of [piexif.ExifIFD.SubSecTimeOriginal, piexif.ExifIFD.SubSecTimeDigitized, piexif.ExifIFD.SubSecTime]) delete d.Exif[t];
  }
  if (f.offset !== undefined) {
    put(d.Exif, OFFSET_TAGS.OffsetTimeOriginal, f.offset);
    put(d.Exif, OFFSET_TAGS.OffsetTimeDigitized, f.offset);
    put(d.Exif, OFFSET_TAGS.OffsetTime, f.offset);
  }
  return d;
}

const PLACE_BOUND_GPS: number[] = [
  piexif.GPSIFD.GPSAltitudeRef, piexif.GPSIFD.GPSAltitude, piexif.GPSIFD.GPSDOP,
  piexif.GPSIFD.GPSSpeedRef, piexif.GPSIFD.GPSSpeed, piexif.GPSIFD.GPSTrackRef, piexif.GPSIFD.GPSTrack,
  piexif.GPSIFD.GPSImgDirectionRef, piexif.GPSIFD.GPSImgDirection, piexif.GPSIFD.GPSAreaInformation,
  piexif.GPSIFD.GPSDestLatitudeRef, piexif.GPSIFD.GPSDestLatitude, piexif.GPSIFD.GPSDestLongitudeRef, piexif.GPSIFD.GPSDestLongitude,
  piexif.GPSIFD.GPSDestBearingRef, piexif.GPSIFD.GPSDestBearing, piexif.GPSIFD.GPSDestDistanceRef, piexif.GPSIFD.GPSDestDistance,
];
