import { coded } from './errcode.ts';
import { isIOS } from './platform.ts';

export const maxPixels = (ios: boolean): number => (ios ? 16_777_216 : 120_000_000);

export const HARD_FACTOR = 4;
export const hardPixels = (ios: boolean): number => maxPixels(ios) * HARD_FACTOR;

export function assertDecodable(w: number, h: number, ios: boolean = isIOS()): void {
  if (w > 0 && h > 0 && w * h > hardPixels(ios)) throw coded('too-big', `${w}×${h} is too many pixels to decode here`);
}

const u16 = (u: Uint8Array, p: number) => u[p] | (u[p + 1] << 8);
const be32 = (u: Uint8Array, p: number) => ((u[p] << 24) | (u[p + 1] << 16) | (u[p + 2] << 8) | u[p + 3]) >>> 0;
const le32 = (u: Uint8Array, p: number) => (u[p] | (u[p + 1] << 8) | (u[p + 2] << 16) | (u[p + 3] << 24)) >>> 0;
const tag = (u: Uint8Array, p: number, s: string) => s.length + p <= u.length && [...s].every((c, i) => u[p + i] === c.charCodeAt(0));

export function peekSize(u: Uint8Array): [number, number] | null {
  if (u[0] === 0xff && u[1] === 0xd8) {
    let p = 2;
    while (p + 9 < u.length) {
      if (u[p] !== 0xff) { p++; continue; }
      const m = u[p + 1];
      if (m === 0xff) { p++; continue; }
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [(u[p + 7] << 8) | u[p + 8], (u[p + 5] << 8) | u[p + 6]];
      p += 2 + ((u[p + 2] << 8) | u[p + 3]);
    }
    return null;
  }
  if (tag(u, 1, 'PNG') && u.length >= 24) return [be32(u, 16), be32(u, 20)];
  if (tag(u, 0, 'GIF8') && u.length >= 10) return [u16(u, 6), u16(u, 8)];
  if (tag(u, 0, 'BM') && u.length >= 26) return [le32(u, 18) | 0, Math.abs(le32(u, 22) | 0)];
  if (tag(u, 0, 'RIFF') && tag(u, 8, 'WEBP')) {
    if (tag(u, 12, 'VP8X') && u.length >= 30) return [1 + (u[24] | (u[25] << 8) | (u[26] << 16)), 1 + (u[27] | (u[28] << 8) | (u[29] << 16))];
    if (tag(u, 12, 'VP8 ') && u.length >= 30) return [u16(u, 26) & 0x3fff, u16(u, 28) & 0x3fff];
    if (tag(u, 12, 'VP8L') && u.length >= 25 && u[20] === 0x2f) { const b = le32(u, 21); return [(b & 0x3fff) + 1, ((b >>> 14) & 0x3fff) + 1]; }
    return null;
  }
  if (tag(u, 4, 'ftyp')) {

    let best: [number, number] | null = null;
    for (let p = 0; p + 20 <= u.length; p++) {
      if (u[p] === 0x69 && tag(u, p, 'ispe')) {
        const w = be32(u, p + 8);
        const h = be32(u, p + 12);
        if (w > 0 && h > 0 && (!best || w * h > best[0] * best[1])) best = [w, h];
      }
    }
    return best;
  }
  return null;
}

export function isMemoryError(e: unknown): boolean {
  const x = e as { name?: unknown; message?: unknown } | null;
  const name = String(x?.name ?? '');
  const msg = String(x?.message ?? e ?? '');
  return name === 'RangeError' || name === 'QuotaExceededError' || /out of memory|memory access|allocation|array buffer allocation|Invalid typed array length|not enough memory/i.test(msg);
}

export function asMemoryError(e: unknown): unknown {
  if (typeof (e as { code?: unknown } | null)?.code === 'string') return e;
  return isMemoryError(e) ? coded('memory', `ran out of memory: ${e instanceof Error ? e.message : String(e)}`) : e;
}
