import { dropEmbeddedMeta, dumpDict, hasEmbeddedMeta, loadDict, removeLocation, setGps, writeFields, type ExifDict, type Fields } from './exif.ts';
import { dropExtras, dropXmpIptc, extrasLeft, getExifTiff, hasIptc, hasXmp, setExif } from './jpeg.ts';
import { checkLocation, displayLocation } from './location.ts';
import { tryLoadDict } from './exif.ts';

export class TooLongError extends Error {}
export const MAX_FIELD_CHARS = 1000;

export class LocationLeakError extends Error {
  leaks: string[];
  constructor(leaks: string[]) {
    super(leaks.join('; '));
    this.leaks = leaks;
  }
}

export interface EditPlan {

  clearLoc: boolean;

  pin: { lat: number; lon: number } | null;

  origGps: { lat: number; lon: number } | null;
  patch: Fields;
}

const same = (a: { lat: number; lon: number } | null, b: { lat: number; lon: number } | null) =>
  a === b || (!!a && !!b && Math.abs(a.lat - b.lat) < 6e-7 && Math.abs(a.lon - b.lon) < 6e-7);

export function buildEdited(bytes: Uint8Array, plan: EditPlan): { out: Uint8Array; droppedXmpIptc: boolean; locationUnsure: boolean } {
  const d: ExifDict = loadDict(getExifTiff(bytes));
  const changesLoc = plan.clearLoc || (!!plan.pin && !same(plan.pin, plan.origGps));
  if (plan.clearLoc) removeLocation(d);
  else if (changesLoc && plan.pin) setGps(dropEmbeddedMeta(d), plan.pin.lat, plan.pin.lon);
  writeFields(d, plan.patch);
  let out: Uint8Array;
  try {
    out = setExif(bytes, dumpDict(d));
  } catch (e) {
    if (e instanceof Error && e.message === 'segment too large') throw new TooLongError('too long');
    throw e;
  }
  let droppedXmpIptc = false;
  let locationUnsure = false;
  if (changesLoc) {
    droppedXmpIptc = hasXmp(out) || hasIptc(out) || extrasLeft(out).length > 0 || hasEmbeddedMeta(loadDict(getExifTiff(bytes)));
    out = dropXmpIptc(out);
    out = dropExtras(out);
    const check = checkLocation(out, { strict: true, exif: plan.clearLoc });
    if (check.leaks.length) throw new LocationLeakError(check.leaks);
    locationUnsure = check.unsure.length > 0;
  }
  return { out, droppedXmpIptc, locationUnsure };
}

export function savedProblem(back: { readable: boolean; image: boolean; gps: unknown }, clearLoc: boolean): 'unreadable' | 'image' | 'location' | null {
  if (!back.readable) return 'unreadable';
  if (!back.image) return 'image';
  if (clearLoc && back.gps) return 'location';
  return null;
}

export function origLocationState(bytes: Uint8Array, hasGpsBlock: boolean): 'gps' | 'hidden' | 'unsure' | 'none' {
  if (hasGpsBlock) return 'gps';
  const c = displayLocation(bytes);
  if (c.hidden) return 'hidden';
  const tiff = getExifTiff(bytes);
  if (c.unsure || (tiff && !tryLoadDict(tiff))) return 'unsure';
  return 'none';
}

export const readBackSaysNone = (back: { gps: unknown; hiddenLoc: boolean; locUnsure: boolean }, locationUnsure: boolean): boolean =>
  !back.gps && !locationUnsure && !back.hiddenLoc && !back.locUnsure;
