import UPNG from 'upng-js';
import { pngGetIcc, pngSetIcc } from './png.ts';
import { pngGetExif, pngSetExif } from './imgmeta.ts';

const isP3 = (icc: Uint8Array) => Array.from(icc.subarray(0, 1200), (c) => (c ? String.fromCharCode(c) : '')).join('').includes('Display P3');

export interface PngRepack {
  png: Uint8Array;
  width: number;
  height: number;

  paletted: boolean;
}

export async function repackPng(src: Uint8Array, colors: number): Promise<PngRepack> {
  const buf = (src.byteOffset === 0 && src.byteLength === src.buffer.byteLength ? src.buffer : src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength)) as ArrayBuffer;
  const img = UPNG.decode(buf);
  if (!img?.width || !img?.height) throw new Error('the PNG has no pixels');
  const rgba = UPNG.toRGBA8(img)[0] as ArrayBuffer;
  if (rgba.byteLength !== img.width * img.height * 4) throw new Error('this kind of PNG can’t be read here');
  const c = Math.max(0, Math.min(256, Math.round(colors)));
  let out = new Uint8Array(UPNG.encode([rgba], img.width, img.height, c));
  const icc = await pngGetIcc(src);
  if (icc) out = await pngSetIcc(out, icc, isP3(icc) ? 'Display P3' : 'ICC');
  const exif = pngGetExif(src);
  if (exif) out = pngSetExif(out, exif);
  return { png: out, width: img.width, height: img.height, paletted: out[25] === 3 };
}
