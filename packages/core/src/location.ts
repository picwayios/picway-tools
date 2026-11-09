import { embeddedXmp, getGps, hasEmbeddedMeta, hasGps, tryLoadDict, type ExifDict } from './exif.ts';
import { extrasLeft, exifSegs, exifTiffs, hasIptc, hasXmp, imageEnd, jfifThumbsLeft, metadataText, walkJpeg, xmpTexts } from './jpeg.ts';

const XMP_LOCATION = /GPS(?:Latitude|Longitude|Altitude|Position|Version|Map|Coordinates)|exif:GPS|photoshop:(?:City|State|Country|Location)|Iptc4xmp(?:Core|Ext):(?:Location|CountryCode|City|Sublocation|ProvinceState|CountryName|LocationShown|LocationCreated)/i;

export interface LeakOptions {

  exif?: boolean;

  strict?: boolean;

  thumbs?: boolean;
}

export interface LocationCheck {

  leaks: string[];

  unsure: string[];
}

function tiffLeaks(d: ExifDict, opt: LeakOptions, out: string[]) {
  if (opt.exif !== false && (hasGps(d) || getGps(d))) out.push('EXIF GPS');
  const x = embeddedXmp(d);
  if (x !== null && XMP_LOCATION.test(x)) out.push('EXIF XMP location');
  else if (opt.strict && hasEmbeddedMeta(d)) out.push('EXIF XMP/IPTC');
}

export function checkLocation(jpeg: Uint8Array, opt: LeakOptions = {}): LocationCheck {
  try {
    return checkOnce(jpeg, opt);
  } catch {
    return { leaks: [], unsure: ['file structure'] };
  }
}
function checkOnce(jpeg: Uint8Array, opt: LeakOptions): LocationCheck {
  const leaks: string[] = [];
  const unsure: string[] = [];
  let walk;
  try {
    walk = walkJpeg(jpeg);
  } catch {
    return { leaks, unsure: ['not a JPEG'] };
  }
  if (!walk.complete) unsure.push('file structure');
  for (const tiff of exifTiffs(jpeg)) {
    const d = tryLoadDict(tiff);
    if (!d) {
      unsure.push('EXIF');
      continue;
    }
    tiffLeaks(d, opt, leaks);
    if (opt.thumbs && (Object.keys(d['1st'] ?? {}).length > 0 || d.thumbnail)) leaks.push('EXIF preview');
  }
  if (opt.thumbs) leaks.push(...jfifThumbsLeft(jpeg));
  const xmp = xmpTexts(jpeg);
  if (xmp.some((x) => XMP_LOCATION.test(x))) leaks.push('XMP location');
  else if (opt.strict && hasXmp(jpeg)) leaks.push('XMP');
  if (opt.strict && hasIptc(jpeg)) leaks.push('IPTC');
  if (opt.strict) leaks.push(...extrasLeft(jpeg));

  if (!leaks.length && XMP_LOCATION.test(metadataText(jpeg))) leaks.push('location text');
  return { leaks: [...new Set(leaks)], unsure };
}

export const locationLeaks = (jpeg: Uint8Array, opt: LeakOptions = {}): string[] => checkLocation(jpeg, opt).leaks;

export function checkTiffLocation(tiff: Uint8Array | null, opt: LeakOptions = {}): LocationCheck {
  const leaks: string[] = [];
  if (!tiff) return { leaks, unsure: [] };
  const d = tryLoadDict(tiff);
  if (!d) return { leaks, unsure: ['EXIF'] };
  tiffLeaks(d, opt, leaks);
  return { leaks, unsure: [] };
}

export const dictHasLocation = (d: ExifDict): boolean => !!getGps(d) || XMP_LOCATION.test(embeddedXmp(d) ?? '');

export function locationVerdict(hadGps: boolean, removalRequested: boolean, check: LocationCheck, sourceUnreadable = false): { hadGps: boolean; gpsRemoved: boolean; gpsUnsure: boolean } {
  if (check.leaks.length) return { hadGps: true, gpsRemoved: false, gpsUnsure: false };
  if (check.unsure.length) return { hadGps, gpsRemoved: false, gpsUnsure: true };

  if (sourceUnreadable) return removalRequested ? { hadGps: true, gpsRemoved: true, gpsUnsure: false } : { hadGps, gpsRemoved: false, gpsUnsure: true };
  return { hadGps, gpsRemoved: hadGps && removalRequested, gpsUnsure: false };
}

export function displayLocation(jpeg: Uint8Array): { hidden: boolean; unsure: boolean } {
  try {
    const c = checkLocation(jpeg, { exif: false });
    let hidden = c.leaks.length > 0;
    let unsure = c.unsure.length > 0;
    const firstScan = walkJpeg(jpeg).scans[0]?.sos.start ?? Infinity;
    exifSegs(jpeg).forEach(({ tiff, start }, i) => {
      const d = tryLoadDict(tiff);
      if (!d) return;

      if ((i > 0 || start > firstScan) && (hasGps(d) || getGps(d))) hidden = true;
      if (d['0th']?.[33723] !== undefined || d['0th']?.[34377] !== undefined) unsure = true;
    });
    if (hasIptc(jpeg)) unsure = true;
    const end = imageEnd(jpeg);
    if (end < jpeg.length && hasBytes(jpeg.subarray(end), EXIF_HEAD)) unsure = true;
    return { hidden, unsure: unsure && !hidden };
  } catch {
    return { hidden: false, unsure: true };
  }
}

const EXIF_HEAD = Uint8Array.of(0x45, 0x78, 0x69, 0x66, 0, 0);
function hasBytes(hay: Uint8Array, needle: Uint8Array): boolean {
  for (let i = hay.indexOf(needle[0]); i >= 0 && i + needle.length <= hay.length; i = hay.indexOf(needle[0], i + 1)) {
    let ok = true;
    for (let j = 1; j < needle.length && ok; j++) ok = hay[i + j] === needle[j];
    if (ok) return true;
  }
  return false;
}
