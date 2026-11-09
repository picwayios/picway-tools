export interface Segment {
  marker: number;

  start: number;

  end: number;
}

const SOI = 0xd8;
const SOS = 0xda;

export function segments(u8: Uint8Array): Segment[] {
  const w = walkJpeg(u8);
  if (!w.complete && !w.scans.length && w.error?.startsWith('bad JPEG marker')) throw new Error(w.error);
  return w.segs;
}

const hasHeader = (u8: Uint8Array, seg: Segment, head: string) => {
  const o = seg.start + 4;
  for (let i = 0; i < head.length; i++) if (u8[o + i] !== head.charCodeAt(i)) return false;
  return true;
};
const isExif = (u8: Uint8Array, s: Segment) => s.marker === 0xe1 && hasHeader(u8, s, 'Exif\0\0');
const XMP_HEAD = 'http://ns.adobe.com/xap/1.0/\0';
const XMP_EXT_HEAD = 'http://ns.adobe.com/xmp/extension/\0';
const isXmp = (u8: Uint8Array, s: Segment) => s.marker === 0xe1 && (hasHeader(u8, s, XMP_HEAD) || hasHeader(u8, s, XMP_EXT_HEAD));
const isIptc = (u8: Uint8Array, s: Segment) => s.marker === 0xed && hasHeader(u8, s, 'Photoshop 3.0\0');
const isIcc = (u8: Uint8Array, s: Segment) => s.marker === 0xe2 && hasHeader(u8, s, 'ICC_PROFILE\0');

export function getExifTiff(u8: Uint8Array): Uint8Array | null {
  const s = segments(u8).find((x) => isExif(u8, x));
  return s ? u8.slice(s.start + 10, s.end) : null;
}

export function getIcc(u8: Uint8Array): Uint8Array | null {
  const parts = segments(u8)
    .filter((x) => isIcc(u8, x))
    .map((x) => ({ seq: u8[x.start + 16], data: u8.slice(x.start + 18, x.end) }))
    .sort((a, b) => a.seq - b.seq);
  if (!parts.length) return null;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.data.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p.data, o), (o += p.data.length));
  return out;
}

const seg = (marker: number, payload: Uint8Array): Uint8Array => {
  const len = payload.length + 2;
  if (len > 0xffff) throw new Error('segment too large');
  const out = new Uint8Array(len + 2);
  out[0] = 0xff;
  out[1] = marker;
  out[2] = len >> 8;
  out[3] = len & 0xff;
  out.set(payload, 4);
  return out;
};
const ascii = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const cat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

export function iccSegments(icc: Uint8Array): Uint8Array[] {
  const CHUNK = 65519 - 14;
  const n = Math.max(1, Math.ceil(icc.length / CHUNK));
  const out: Uint8Array[] = [];
  for (let i = 0; i < n; i++) out.push(seg(0xe2, cat(ascii('ICC_PROFILE\0'), Uint8Array.of(i + 1, n), icc.subarray(i * CHUNK, (i + 1) * CHUNK))));
  return out;
}
export const exifSegment = (tiff: Uint8Array) => seg(0xe1, cat(ascii('Exif\0\0'), tiff));

export function rewrite(u8: Uint8Array, opts: { dropExif?: boolean; dropIcc?: boolean; dropXmp?: boolean; dropIptc?: boolean; dropExtras?: boolean; trimTail?: boolean; insert?: Uint8Array[] }): Uint8Array {
  const segs = segments(u8);
  const drop = segs.filter((s) => (opts.dropExif && isExif(u8, s)) || (opts.dropIcc && isIcc(u8, s)) || (opts.dropXmp && isXmp(u8, s)) || (opts.dropIptc && isIptc(u8, s)) || (opts.dropExtras && isExtra(u8, s)));
  const jfif = segs.find((s) => s.marker === 0xe0 && s.start < (walkJpeg(u8).scans[0]?.sos.start ?? Infinity));
  const at = jfif ? jfif.end : 2;
  const parts: Uint8Array[] = [];
  let p = 0;

  const cuts = [...drop.map((s) => ({ a: s.start, b: s.end, ins: false })), { a: at, b: at, ins: true }].sort((x, y) => x.a - y.a || Number(y.ins) - Number(x.ins));
  for (const c of cuts) {
    if (c.a > p) parts.push(u8.subarray(p, c.a));
    if (c.ins) parts.push(...(opts.insert ?? []));
    p = Math.max(p, c.b);
  }
  parts.push(u8.subarray(p, opts.trimTail ? Math.max(p, imageEnd(u8)) : undefined));
  return cat(...parts);
}

export const setExif = (u8: Uint8Array, tiff: Uint8Array | null) => rewrite(u8, { dropExif: true, insert: tiff ? [exifSegment(tiff)] : [] });

export const setIcc = (u8: Uint8Array, icc: Uint8Array | null) => rewrite(u8, { dropIcc: true, insert: icc ? iccSegments(icc) : [] });

export const dropXmpIptc = (u8: Uint8Array) => rewrite(u8, { dropXmp: true, dropIptc: true });

export const hasXmpIptc = (u8: Uint8Array) => segments(u8).some((s) => isXmp(u8, s) || isIptc(u8, s));

export function xmpTexts(u8: Uint8Array): string[] {
  return segments(u8)
    .filter((s) => isXmp(u8, s))
    .map((s) => Array.from(u8.subarray(s.start + 4, s.end), (c) => String.fromCharCode(c)).join(''));
}
export const hasIptc = (u8: Uint8Array) => segments(u8).some((s) => isIptc(u8, s));
export const hasXmp = (u8: Uint8Array) => segments(u8).some((s) => isXmp(u8, s));

const isExtra = (u8: Uint8Array, s: Segment) => {
  const m = s.marker;
  if (m === 0xfe) return true;
  if (m === 0xe0) return !hasHeader(u8, s, 'JFIF\0');
  if (m === 0xe1) return !isExif(u8, s) && !isXmp(u8, s);
  if (m === 0xe2) return !isIcc(u8, s);
  if (m === 0xed) return !isIptc(u8, s);
  if (m === 0xee) return !hasHeader(u8, s, 'Adobe');
  return m >= 0xe3 && m <= 0xef;
};

export function imageEnd(u8: Uint8Array): number {
  const n = u8.length;
  let p = 2;
  while (p + 1 < n) {
    if (u8[p] !== 0xff) return n;
    const m = u8[p + 1];
    if (m === 0xff) { p++; continue; }
    if (m === 0xd9) return p + 2;
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) { p += 2; continue; }
    if (p + 4 > n) return n;
    p += 2 + ((u8[p + 2] << 8) | u8[p + 3]);
    if (m !== SOS) continue;

    while (p + 1 < n && !(u8[p] === 0xff && u8[p + 1] !== 0 && !(u8[p + 1] >= 0xd0 && u8[p + 1] <= 0xd7))) p++;
  }
  return n;
}

export const dropExtras = (u8: Uint8Array) => rewrite(u8, { dropExtras: true, trimTail: true });

export function extrasLeft(u8: Uint8Array): string[] {
  const out: string[] = [];
  const segs = segments(u8);
  if (segs.some((s) => s.marker === 0xfe)) out.push('COM');
  if (segs.some((s) => s.marker !== 0xfe && isExtra(u8, s))) out.push('APPn');
  if (imageEnd(u8) < u8.length) out.push('trailing data');
  return out;
}

export function jpegImageProblem(u8: Uint8Array): string | null {
  let w: JpegWalk;
  try {
    w = walkJpeg(u8);
  } catch {
    return 'not a JPEG';
  }
  if (!w.complete) return w.error ?? 'incomplete';
  if (!w.scans.length) return 'no image data';
  const first = w.scans[0].sos.start;
  const sof = w.segs.find((s) => s.start < first && s.marker >= 0xc0 && s.marker <= 0xcf && s.marker !== 0xc4 && s.marker !== 0xc8 && s.marker !== 0xcc);
  if (!sof || sof.end - sof.start < 11) return 'no frame header';
  const h = (u8[sof.start + 5] << 8) | u8[sof.start + 6];
  const wd = (u8[sof.start + 7] << 8) | u8[sof.start + 8];
  if (!h || !wd) return 'zero size';
  if (!w.scans.some((s) => s.dataEnd - s.sos.end > 2)) return 'empty scan';
  return null;
}
export const looksLikeJpegImage = (u8: Uint8Array): boolean => jpegImageProblem(u8) === null;

export const exifTiffs = (u8: Uint8Array): Uint8Array[] => exifSegs(u8).map((x) => x.tiff);

export const exifSegs = (u8: Uint8Array): { tiff: Uint8Array; start: number }[] => segments(u8).filter((x) => isExif(u8, x)).map((x) => ({ tiff: u8.slice(x.start + 10, x.end), start: x.start }));

export function metadataText(u8: Uint8Array): string {
  const w = walkJpeg(u8);
  const parts: string[] = [];
  const add = (a: number, b: number) => {
    for (let i = a; i < b; i += 0x8000) parts.push(String.fromCharCode(...u8.subarray(i, Math.min(b, i + 0x8000))));
  };
  for (const s of w.segs) if (!isExif(u8, s)) add(s.start, s.end);
  for (const s of w.scans) add(s.sos.start, s.sos.end);
  if (w.complete) add(w.eoi + 2, u8.length);
  return parts.join('\n');
}

export interface JpegWalk {

  segs: Segment[];

  scans: { sos: Segment; dataEnd: number }[];

  eoi: number;

  complete: boolean;

  error: string | null;

  len: number;
}

const walked = new WeakMap<Uint8Array, JpegWalk>();
export function walkJpeg(u8: Uint8Array): JpegWalk {
  const hit = walked.get(u8);
  if (hit && hit.len === u8.length) return hit;
  const w = walkOnce(u8);
  walked.set(u8, w);
  return w;
}
function walkOnce(u8: Uint8Array): JpegWalk {
  if (u8.length < 2 || u8[0] !== 0xff || u8[1] !== SOI) throw new Error('not a JPEG');
  const n = u8.length;
  const segs: Segment[] = [];
  const scans: JpegWalk['scans'] = [];
  const stop = (error: string): JpegWalk => ({ segs, scans, eoi: -1, complete: false, error, len: n });
  let p = 2;
  for (;;) {
    if (p + 2 > n) return stop('truncated at ' + p);
    if (u8[p] !== 0xff) return stop('bad JPEG marker at ' + p);
    let m = u8[p + 1];
    while (m === 0xff) {
      p++;
      if (p + 2 > n) return stop('truncated at ' + p);
      m = u8[p + 1];
    }
    if (m === 0xd9) return { segs, scans, eoi: p, complete: true, error: null, len: n };
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      p += 2;
      continue;
    }
    if (m === 0x00 || m === SOI) return stop('bad JPEG marker at ' + p);
    if (p + 4 > n) return stop('truncated at ' + p);
    const len = (u8[p + 2] << 8) | u8[p + 3];
    if (len < 2 || p + 2 + len > n) return stop('segment overruns the file at ' + p);
    const s = { marker: m, start: p, end: p + 2 + len };
    if (m !== SOS) {
      segs.push(s);
      p = s.end;
      continue;
    }

    let q = s.end;
    while (q + 1 < n && !(u8[q] === 0xff && u8[q + 1] !== 0 && !(u8[q + 1] >= 0xd0 && u8[q + 1] <= 0xd7))) q++;
    scans.push({ sos: s, dataEnd: q + 1 < n ? q : n });
    if (q + 1 >= n) return stop('scan data runs to the end of the file');
    p = q;
  }
}

const isJfif = (u8: Uint8Array, s: Segment) => s.marker === 0xe0 && hasHeader(u8, s, 'JFIF\0');
const isJfxx = (u8: Uint8Array, s: Segment) => s.marker === 0xe0 && hasHeader(u8, s, 'JFXX\0');

const jfifThumb = (u8: Uint8Array, s: Segment) => isJfif(u8, s) && s.end - s.start >= 18 && (s.end - s.start > 18 || u8[s.start + 16] * u8[s.start + 17] > 0);

export function dropJfifThumbs(u8: Uint8Array): Uint8Array {
  const hit = segments(u8).filter((s) => jfifThumb(u8, s));
  if (!hit.length) return u8;
  const parts: Uint8Array[] = [];
  let p = 0;
  for (const s of hit) {
    parts.push(u8.subarray(p, s.start));
    const fixed = new Uint8Array(18);
    fixed.set([0xff, 0xe0, 0, 16]);
    fixed.set(u8.subarray(s.start + 4, s.start + 16), 4);
    parts.push(fixed);
    p = s.end;
  }
  parts.push(u8.subarray(p));
  return cat(...parts);
}

export function jfifThumbsLeft(u8: Uint8Array): string[] {
  const segs = segments(u8);
  const out: string[] = [];
  if (segs.some((s) => jfifThumb(u8, s))) out.push('JFIF preview');
  if (segs.some((s) => isJfxx(u8, s))) out.push('JFXX preview');
  return out;
}
