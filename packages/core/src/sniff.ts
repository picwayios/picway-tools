import { looksLikeJpegImage } from './jpeg.ts';

export type Kind = 'jpeg' | 'png' | 'webp' | 'avif' | 'gif' | 'bmp' | 'tiff' | 'heic';

const ascii = (u: Uint8Array, a: number, b: number) => String.fromCharCode(...u.subarray(a, Math.min(b, u.length)));
const u32be = (u: Uint8Array, p: number) => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;
const u32le = (u: Uint8Array, p: number) => (u[p] | (u[p + 1] << 8) | (u[p + 2] << 16) | (u[p + 3] << 24)) >>> 0;

export function sniffKind(u: Uint8Array): Kind | null {
  if (u.length < 12) return null;
  if (u[0] === 0xff && u[1] === 0xd8 && u[2] === 0xff) return 'jpeg';
  if (u[0] === 0x89 && ascii(u, 1, 4) === 'PNG' && u[4] === 0x0d && u[5] === 0x0a && u[6] === 0x1a && u[7] === 0x0a) return 'png';
  if (ascii(u, 0, 4) === 'RIFF' && ascii(u, 8, 12) === 'WEBP') return 'webp';
  if (ascii(u, 0, 4) === 'GIF8' && (u[4] === 0x37 || u[4] === 0x39) && u[5] === 0x61) return 'gif';
  if (u[0] === 0x42 && u[1] === 0x4d) return 'bmp';
  if ((u[0] === 0x49 && u[1] === 0x49 && u[2] === 0x2a && u[3] === 0) || (u[0] === 0x4d && u[1] === 0x4d && u[2] === 0 && u[3] === 0x2a)) return 'tiff';
  if (ascii(u, 4, 8) === 'ftyp') {
    const brands = ascii(u, 8, 12) + ' ' + ftypCompat(u);
    if (/\b(avif|avis)\b/.test(brands)) return 'avif';
    if (/\b(heic|heix|hevc|hevx|heim|heis|mif1|msf1)\b/.test(brands)) return 'heic';
  }
  return null;
}
function ftypCompat(u: Uint8Array): string {
  const size = Math.min(u32be(u, 0), u.length, 256);
  const out: string[] = [];
  for (let p = 16; p + 4 <= size; p += 4) out.push(ascii(u, p, p + 4));
  return out.join(' ');
}

export const RAW_EXT = /\.(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|raf|orf|rw2|pef|srw|3fr|erf|kdc|mrw|mef|x3f|raw|iiq|arq|rwl|dcr|mos|gpr|ptx|fff|rwz|dcs|kc2|bay|cap|dc2|ari|r3d|eip|cs1)$/i;

export function structureError(u: Uint8Array, kind: Kind): string | null {
  try {
    if (kind === 'jpeg') {
      if (!looksLikeJpegImage(u)) return 'the JPEG data is incomplete';

      const walked = eoiFound(u);
      if (walked !== null) return walked ? null : 'the JPEG data is cut off';
      let found = false; const start = scanStart(u);
      for (let p = u.length - 2; p >= start; p--) if (u[p] === 0xff && u[p + 1] === 0xd9) { found = true; break; }
      return found ? null : 'the JPEG data is cut off';
    }
    if (kind === 'png') {
      if (ascii(u, 12, 16) !== 'IHDR' || u32be(u, 16) === 0 || u32be(u, 20) === 0) return 'the PNG header is damaged';
      let p = 8;
      let idat = false;
      while (p + 12 <= u.length) {
        const len = u32be(u, p);
        const type = ascii(u, p + 4, p + 8);
        if (p + 12 + len > u.length) return 'the PNG data is cut off';
        if (type === 'IDAT') idat = true;
        if (type === 'IEND') return idat ? null : 'the PNG has no image data';
        p += 12 + len;
      }
      return 'the PNG data is cut off';
    }
    if (kind === 'webp') {
      const riff = u32le(u, 4) + 8;
      return riff > u.length || riff < 20 ? 'the WebP data is cut off' : null;
    }
    if (kind === 'gif') {
      if (u[u.length - 1] !== 0x3b) return 'the GIF data is cut off';
      return u[6] + (u[7] << 8) > 0 && u[8] + (u[9] << 8) > 0 ? null : 'the GIF header is damaged';
    }
    if (kind === 'bmp') {
      const size = u32le(u, 2);
      const off = u32le(u, 10);
      const hdr = u32le(u, 14);
      if (hdr < 12 || off >= u.length || off < 14 + hdr) return 'the BMP header is damaged';
      return size > u.length ? 'the BMP data is cut off' : null;
    }
    if (kind === 'avif' || kind === 'heic') {

      let p = 0;
      let hasMdat = false;
      while (p + 8 <= u.length) {
        let size = u32be(u, p);
        const type = ascii(u, p + 4, p + 8);
        if (size === 1) size = u32be(u, p + 12) + u32be(u, p + 8) * 4294967296;
        else if (size === 0) size = u.length - p;
        if (size < 8 || p + size > u.length) return `the ${kind.toUpperCase()} data is cut off`;
        if (type === 'mdat') hasMdat = true;
        p += size;
      }
      return hasMdat ? null : `the ${kind.toUpperCase()} data is incomplete`;
    }
    if (kind === 'tiff') return null;
    return null;
  } catch {
    return 'the file structure is damaged';
  }
}

function scanStart(u: Uint8Array): number {
  let p = 2;
  while (p + 4 <= u.length && u[p] === 0xff) {
    const m = u[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    const len = (u[p + 2] << 8) | u[p + 3];
    if (len < 2) return 2;
    if (m === 0xda) return p + 2 + len;
    p += 2 + len;
  }
  return 2;
}

function eoiFound(u: Uint8Array): boolean | null {
  let p = scanStart(u);
  if (p <= 2) return null;
  const n = u.length;
  while (p + 1 < n) {
    if (u[p] !== 0xff) { p++; continue; }
    const m = u[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
    if (m === 0xd9) return true;
    if (p + 4 > n) return false;
    const len = (u[p + 2] << 8) | u[p + 3];
    if (len < 2) return null;
    p += 2 + len;
  }
  return false;
}

export function tiffDataCut(page: Record<string, unknown>, n: number): boolean {
  const off = (page.t273 ?? page.t324) as number[] | undefined;
  const len = (page.t279 ?? page.t325) as number[] | undefined;
  if (!Array.isArray(off) || !Array.isArray(len) || !off.length || off.length !== len.length) return true;
  return off.some((o, i) => !(o >= 0 && len[i] >= 0 && o + len[i] <= n));
}

export function isAnimated(u: Uint8Array, kind: Kind): boolean {
  try {
    if (kind === 'gif') return countGifFrames(u) > 1;
    if (kind === 'webp') {
      let p = 12;
      while (p + 8 <= u.length) {
        const t = ascii(u, p, p + 4);
        if (t === 'ANIM' || t === 'ANMF') return true;
        p += 8 + u32le(u, p + 4) + (u32le(u, p + 4) & 1);
      }
      return false;
    }
    if (kind === 'png') {
      let p = 8;
      while (p + 12 <= u.length) {
        const t = ascii(u, p + 4, p + 8);
        if (t === 'acTL') return true;
        if (t === 'IDAT' || t === 'IEND') return false;
        p += 12 + u32be(u, p);
      }
      return false;
    }
    if (kind === 'avif') return /\bavis\b/.test(ascii(u, 8, 12) + ' ' + ftypCompat(u));
  } catch {

  }
  return false;
}

export function countGifFrames(u: Uint8Array): number {
  let p = 13;
  const flags = u[10];
  if (flags & 0x80) p += 3 * (1 << ((flags & 7) + 1));
  let frames = 0;
  const skipSub = () => {
    while (p < u.length && u[p] !== 0) p += u[p] + 1;
    p++;
  };
  while (p < u.length) {
    const b = u[p++];
    if (b === 0x3b) break;
    if (b === 0x21) {
      p++;
      skipSub();
    } else if (b === 0x2c) {
      frames++;
      const lf = u[p + 8];
      p += 9;
      if (lf & 0x80) p += 3 * (1 << ((lf & 7) + 1));
      p++;
      skipSub();
    } else break;
  }
  return frames;
}
