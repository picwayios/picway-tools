import { dumpDict, loadDict, normalizeAfterRender, removeLocation, tryLoadDict } from './exif.ts';
import { pngGetExif } from './imgmeta.ts';
import { checkLocation, checkTiffLocation, dictHasLocation, locationVerdict } from './location.ts';
import type { HeifMeta } from './isobmff.ts';
import { setExif, setIcc } from './jpeg.ts';
import { pngSetIcc } from './png.ts';

export interface PostOptions {
  format: 'jpeg' | 'png';
  removeLocation: boolean;
  removeAllExif: boolean;
}

export async function finalizeOutput(
  bytes: Uint8Array,
  meta: Pick<HeifMeta, 'exifTiff'>,
  opt: PostOptions,
  width: number,
  height: number,
  icc: Uint8Array | null,
  iccName = 'ICC',
): Promise<{ bytes: Uint8Array; hadGps: boolean; gpsRemoved: boolean; gpsUnsure: boolean; exifKept: boolean }> {
  let out = bytes;
  const dict = loadDict(meta.exifTiff);
  const hadGps = dictHasLocation(dict);
  let exifKept = false;
  if (opt.format === 'jpeg') {
    if (opt.removeAllExif || !meta.exifTiff) out = setExif(out, null);
    else {
      normalizeAfterRender(dict, width, height);
      if (opt.removeLocation) {
        removeLocation(dict);
      }
      out = setExif(out, dumpDict(dict));
      exifKept = true;
    }
    out = setIcc(out, icc);
  } else {

    if (icc) out = await pngSetIcc(out, icc, iccName);
  }

  const removal = opt.format !== 'jpeg' || opt.removeAllExif || opt.removeLocation || !meta.exifTiff;
  const loc = locationVerdict(hadGps, removal, opt.format === 'jpeg' ? checkLocation(out) : checkTiffLocation(pngGetExif(out)), !!meta.exifTiff && !tryLoadDict(meta.exifTiff));
  return { bytes: out, hadGps: loc.hadGps, gpsRemoved: loc.gpsRemoved, gpsUnsure: loc.gpsUnsure, exifKept };
}
