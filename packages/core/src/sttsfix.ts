const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const tag = (b: Uint8Array, o: number) => String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]);
const put32 = (b: Uint8Array, o: number, v: number) => {
  b[o] = (v >>> 24) & 255;
  b[o + 1] = (v >>> 16) & 255;
  b[o + 2] = (v >>> 8) & 255;
  b[o + 3] = v & 255;
};
function child(b: Uint8Array, from: number, to: number, type: string): number {
  for (let p = from; p + 8 <= to; ) {
    const size = u32(b, p);
    if (size < 8 || p + size > to) return -1;
    if (tag(b, p) === type) return p;
    p += size;
  }
  return -1;
}

function locate(moov: Uint8Array) {
  if (tag(moov, 0) !== 'moov') throw new Error('stts-fix-failed');
  const path = ['moov', 'trak', 'mdia'];
  const at = [0];
  let p = 0;
  for (const t of path.slice(1)) {
    p = child(moov, p + 8, p + u32(moov, p), t);
    if (p < 0) throw new Error('stts-fix-failed');
    at.push(p);
  }
  const mdia = p;
  const mdhd = child(moov, mdia + 8, mdia + u32(moov, mdia), 'mdhd');
  const minf = child(moov, mdia + 8, mdia + u32(moov, mdia), 'minf');
  const stbl = minf < 0 ? -1 : child(moov, minf + 8, minf + u32(moov, minf), 'stbl');
  const stts = stbl < 0 ? -1 : child(moov, stbl + 8, stbl + u32(moov, stbl), 'stts');
  if (mdhd < 0 || stts < 0) throw new Error('stts-fix-failed');
  const v1 = moov[mdhd + 8] === 1;
  const timescale = v1 ? u32(moov, mdhd + 28) : u32(moov, mdhd + 20);
  const total = v1 ? u32(moov, mdhd + 32) * 2 ** 32 + u32(moov, mdhd + 36) : u32(moov, mdhd + 24);
  const n = u32(moov, stts + 12);
  if (!n || u32(moov, stts) !== 16 + n * 8) throw new Error('stts-fix-failed');
  return { at, minf, stbl, stts, timescale, total, n };
}

export function sampleDurations(moov: Uint8Array): number[] {
  const { stts, timescale, n } = locate(moov);
  const out: number[] = [];
  for (let i = 0; i < n; i++) for (let k = u32(moov, stts + 16 + i * 8); k > 0; k--) out.push(u32(moov, stts + 20 + i * 8) / timescale);
  return out;
}

export function fixLastSampleDuration(moov: Uint8Array): Uint8Array {
  const { at, minf, stbl, stts, total, n } = locate(moov);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += u32(moov, stts + 16 + i * 8) * u32(moov, stts + 20 + i * 8);
  const lastAt = stts + 16 + (n - 1) * 8;
  const lastCount = u32(moov, lastAt);
  const lastDelta = u32(moov, lastAt + 4);
  const want = total - (sum - lastDelta);
  if (want === lastDelta) return moov;
  if (want <= 0 || !lastCount) throw new Error('stts-fix-failed');
  if (lastCount === 1) {
    const out = moov.slice();
    put32(out, lastAt + 4, want);
    return out;
  }

  const out = new Uint8Array(moov.length + 8);
  out.set(moov.subarray(0, lastAt + 8), 0);
  put32(out, lastAt, lastCount - 1);
  put32(out, lastAt + 8, 1);
  put32(out, lastAt + 12, want);
  out.set(moov.subarray(lastAt + 8), lastAt + 16);
  put32(out, stts + 12, n + 1);
  for (const box of [...at, minf, stbl, stts]) put32(out, box, u32(moov, box) + 8);
  return out;
}

export async function tailMoov(blob: Blob): Promise<{ at: number; moov: Uint8Array }> {
  for (let p = 0; p + 8 <= blob.size; ) {
    const h = new Uint8Array(await blob.slice(p, p + 16).arrayBuffer());
    let size = u32(h, 0);
    if (size === 1) size = u32(h, 8) * 2 ** 32 + u32(h, 12);
    else if (size === 0) size = blob.size - p;
    if (size < 8) break;
    if (tag(h, 0) === 'moov') {
      if (p + size !== blob.size) break;
      return { at: p, moov: new Uint8Array(await blob.slice(p).arrayBuffer()) };
    }
    p += size;
  }
  throw new Error('stts-fix-failed');
}

export async function patchLastDuration(blob: Blob): Promise<Blob> {
  const { at, moov } = await tailMoov(blob);
  const next = fixLastSampleDuration(moov);
  return next === moov ? blob : new Blob([blob.slice(0, at), next as BlobPart], { type: blob.type });
}
