export interface EditEntry {

  segment: number;

  mediaTime: number;
  rate: number;
}

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
    if (size < 8) return -1;
    if (tag(b, p) === type) return p;
    p += size;
  }
  return -1;
}

export function moovInfo(moov: Uint8Array): { movieScale: number; tracks: { id: number; scale: number; at: number }[] } {
  const end = u32(moov, 0);
  const mvhd = child(moov, 8, end, 'mvhd');
  if (mvhd < 0) throw new Error('no-mvhd');
  const movieScale = u32(moov, mvhd + (moov[mvhd + 8] === 1 ? 28 : 20));
  const tracks: { id: number; scale: number; at: number }[] = [];
  for (let p = 8; p + 8 <= end; p += u32(moov, p)) {
    if (u32(moov, p) < 8) break;
    if (tag(moov, p) !== 'trak') continue;
    const tEnd = p + u32(moov, p);
    const tkhd = child(moov, p + 8, tEnd, 'tkhd');
    const mdia = child(moov, p + 8, tEnd, 'mdia');
    const mdhd = mdia < 0 ? -1 : child(moov, mdia + 8, mdia + u32(moov, mdia), 'mdhd');
    if (tkhd < 0 || mdhd < 0) continue;
    const id = u32(moov, tkhd + (moov[tkhd + 8] === 1 ? 28 : 20));
    const scale = u32(moov, mdhd + (moov[mdhd + 8] === 1 ? 28 : 20));
    tracks.push({ id, scale, at: p });
  }
  return { movieScale, tracks };
}

export function edtsBox(entries: EditEntry[], movieScale: number, mediaScale: number): Uint8Array {
  const elstSize = 16 + entries.length * 12;
  const out = new Uint8Array(8 + elstSize);
  put32(out, 0, out.length);
  out.set([0x65, 0x64, 0x74, 0x73], 4);
  put32(out, 8, elstSize);
  out.set([0x65, 0x6c, 0x73, 0x74], 12);
  put32(out, 16, 0);
  put32(out, 20, entries.length);
  entries.forEach((e, i) => {
    const o = 24 + i * 12;
    put32(out, o, Math.round(e.segment * movieScale));
    put32(out, o + 4, e.mediaTime < 0 ? 0xffffffff : Math.round(e.mediaTime * mediaScale));
    put32(out, o + 8, Math.round(e.rate * 65536) >>> 0);
  });
  return out;
}

export function withEditLists(moov: Uint8Array, edits: Map<number, EditEntry[]>): Uint8Array {
  const { movieScale, tracks } = moovInfo(moov);
  const parts: Uint8Array[] = [];
  let last = 8;
  let added = 0;
  const grow: { at: number; by: number }[] = [];
  const patched = new Set<number>();
  for (const t of tracks) {
    const e = edits.get(t.id);
    const tEnd = t.at + u32(moov, t.at);
    if (!e?.length || child(moov, t.at + 8, tEnd, 'edts') >= 0) continue;
    const tkhd = child(moov, t.at + 8, tEnd, 'tkhd');
    const cut = tkhd + u32(moov, tkhd);
    const box = edtsBox(e, movieScale, t.scale);
    parts.push(moov.subarray(last, cut), box);
    last = cut;
    added += box.length;
    grow.push({ at: t.at, by: box.length });
    patched.add(t.id);
  }
  if (!added) return moov;
  parts.push(moov.subarray(last));
  const out = new Uint8Array(moov.length + added);
  out.set(moov.subarray(0, 8), 0);
  let o = 8;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  put32(out, 0, out.length);

  let shift = 0;
  for (const g of grow) {
    const at = g.at + shift;
    put32(out, at, u32(out, at) + g.by);
    shift += g.by;
  }

  let movieDur = 0;
  for (const t of moovInfo(out).tracks) {
    const tkhd = child(out, t.at + 8, t.at + u32(out, t.at), 'tkhd');
    const at = tkhd + (out[tkhd + 8] === 1 ? 36 : 28);
    const e = edits.get(t.id);
    if (e && patched.has(t.id)) writeDur(out, at, out[tkhd + 8] === 1, e.reduce((n, x) => n + Math.round(x.segment * movieScale), 0));
    movieDur = Math.max(movieDur, readDur(out, at, out[tkhd + 8] === 1));
  }
  const mvhd = child(out, 8, out.length, 'mvhd');
  writeDur(out, mvhd + (out[mvhd + 8] === 1 ? 32 : 24), out[mvhd + 8] === 1, movieDur);
  return out;
}

const readDur = (b: Uint8Array, at: number, wide: boolean) => (wide ? u32(b, at) * 2 ** 32 + u32(b, at + 4) : u32(b, at));
function writeDur(b: Uint8Array, at: number, wide: boolean, v: number) {
  if (wide) {
    put32(b, at, Math.floor(v / 2 ** 32));
    put32(b, at + 4, v % 2 ** 32);
  } else put32(b, at, Math.min(v, 0xffffffff));
}

export function sourceEdits(trak: { edts?: { elst?: { entries?: { segment_duration: number; media_time: number; media_rate_integer?: number; media_rate_fraction?: number }[] } } }, movieScale: number, mediaScale: number, firstDts: number): EditEntry[] {
  const list = trak.edts?.elst?.entries ?? [];
  return list.map((e) => ({
    segment: e.segment_duration / movieScale,

    mediaTime: e.media_time < 0 ? -1 : Math.max(0, (e.media_time - firstDts) / mediaScale),
    rate: (e.media_rate_integer ?? 1) + (e.media_rate_fraction ?? 0) / 65536,
  }));
}

export async function topBox(blob: Blob, type: string): Promise<{ at: number; size: number } | null> {
  for (let p = 0; p + 8 <= blob.size; ) {
    const h = new Uint8Array(await blob.slice(p, p + 16).arrayBuffer());
    let size = u32(h, 0);
    if (size === 1) size = u32(h, 8) * 2 ** 32 + u32(h, 12);
    else if (size === 0) size = blob.size - p;
    if (size < 8) return null;
    if (tag(h, 0) === type) return { at: p, size };
    p += size;
  }
  return null;
}

export async function patchEdits(blob: Blob, edits: Map<number, EditEntry[]>): Promise<Blob> {
  if (![...edits.values()].some((e) => e.length)) return blob;
  const m = await topBox(blob, 'moov');
  if (!m || m.at + m.size !== blob.size) throw new Error('edit-patch-failed');
  const moov = new Uint8Array(await blob.slice(m.at).arrayBuffer());
  const next = withEditLists(moov, edits);
  if (next === moov) throw new Error('edit-patch-failed');
  return new Blob([blob.slice(0, m.at), next as BlobPart], { type: blob.type });
}
