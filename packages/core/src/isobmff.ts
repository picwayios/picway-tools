export interface HeifMeta {

  icc: Uint8Array | null;

  exifTiff: Uint8Array | null;

  rotation: number;
  mirror: 'h' | 'v' | null;

  truncated?: boolean;

  nclx: { primaries: number; transfer: number; matrix: number } | null;
}

interface Box {
  type: string;
  start: number;
  bodyStart: number;
  end: number;
}

function boxes(u8: Uint8Array, from: number, to: number): Box[] {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const out: Box[] = [];
  let p = from;
  while (p + 8 <= to) {
    let size = dv.getUint32(p);
    const type = String.fromCharCode(u8[p + 4], u8[p + 5], u8[p + 6], u8[p + 7]);
    let head = 8;
    if (size === 1) {
      size = Number(dv.getBigUint64(p + 8));
      head = 16;
    } else if (size === 0) size = to - p;
    if (size < head || p + size > to) break;
    out.push({ type, start: p, bodyStart: p + head, end: p + size });
    p += size;
  }
  return out;
}

export function readHeifMeta(u8: Uint8Array): HeifMeta {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const res: HeifMeta = { icc: null, exifTiff: null, rotation: 0, mirror: null, nclx: null };
  const meta = boxes(u8, 0, u8.length).find((b) => b.type === 'meta');
  if (!meta) return res;
  const kids = boxes(u8, meta.bodyStart + 4, meta.end);

  const pitm = kids.find((b) => b.type === 'pitm');
  const primary = pitm ? (u8[pitm.bodyStart] === 0 ? dv.getUint16(pitm.bodyStart + 4) : dv.getUint32(pitm.bodyStart + 4)) : null;
  const iprp = kids.find((b) => b.type === 'iprp');
  if (iprp) {
    const inner = boxes(u8, iprp.bodyStart, iprp.end);
    const ipco = inner.find((b) => b.type === 'ipco');
    const ipma = inner.find((b) => b.type === 'ipma');
    const props = ipco ? boxes(u8, ipco.bodyStart, ipco.end) : [];
    let wanted: number[] | null = null;
    if (ipma && primary !== null) {
      const ver = u8[ipma.bodyStart];
      const flags = (u8[ipma.bodyStart + 1] << 16) | (u8[ipma.bodyStart + 2] << 8) | u8[ipma.bodyStart + 3];
      const n = dv.getUint32(ipma.bodyStart + 4);
      let q = ipma.bodyStart + 8;
      for (let i = 0; i < n; i++) {
        const id = ver < 1 ? dv.getUint16(q) : dv.getUint32(q);
        q += ver < 1 ? 2 : 4;
        const cnt = u8[q++];
        const list: number[] = [];
        for (let k = 0; k < cnt; k++) {
          if (flags & 1) (list.push(dv.getUint16(q) & 0x7fff), (q += 2));
          else list.push(u8[q++] & 0x7f);
        }
        if (id === primary) wanted = list;
      }
    }
    props.forEach((b, i) => {
      if (wanted && !wanted.includes(i + 1)) return;
      if (b.type === 'colr') {
        const kind = String.fromCharCode(...u8.subarray(b.bodyStart, b.bodyStart + 4));
        if ((kind === 'prof' || kind === 'rICC') && !res.icc) res.icc = u8.slice(b.bodyStart + 4, b.end);
        else if (kind === 'nclx') res.nclx = { primaries: dv.getUint16(b.bodyStart + 4), transfer: dv.getUint16(b.bodyStart + 6), matrix: dv.getUint16(b.bodyStart + 8) };
      } else if (b.type === 'irot') res.rotation = (u8[b.bodyStart] & 3) * 90;
      else if (b.type === 'imir') res.mirror = (u8[b.bodyStart] & 1) === 0 ? 'v' : 'h';
    });
  }

  const iinf = kids.find((b) => b.type === 'iinf');
  const iloc = kids.find((b) => b.type === 'iloc');
  if (iinf && iloc) {
    let exifId: number | null = null;
    const ver = u8[iinf.bodyStart];
    for (const infe of boxes(u8, iinf.bodyStart + (ver === 0 ? 6 : 8), iinf.end)) {
      if (infe.type !== 'infe') continue;
      const v = u8[infe.bodyStart];
      if (v < 2) continue;
      const id = v === 2 ? dv.getUint16(infe.bodyStart + 4) : dv.getUint32(infe.bodyStart + 4);
      const o = infe.bodyStart + (v === 2 ? 8 : 10);
      if (String.fromCharCode(...u8.subarray(o, o + 4)) === 'Exif') exifId = id;
    }
    if (exifId !== null) {
      const lv = u8[iloc.bodyStart];
      let q = iloc.bodyStart + 4;
      const offSize = u8[q] >> 4;
      const lenSize = u8[q] & 15;
      const baseSize = u8[q + 1] >> 4;
      const idxSize = lv === 1 || lv === 2 ? u8[q + 1] & 15 : 0;
      q += 2;
      const rd = (size: number) => {
        let v = 0;
        for (let i = 0; i < size; i++) v = v * 256 + u8[q++];
        return v;
      };
      const count = lv < 2 ? (q += 2, dv.getUint16(q - 2)) : (q += 4, dv.getUint32(q - 4));
      for (let i = 0; i < count; i++) {
        const id = lv < 2 ? (q += 2, dv.getUint16(q - 2)) : (q += 4, dv.getUint32(q - 4));
        if (lv === 1 || lv === 2) q += 2;
        q += 2;
        const base = rd(baseSize);
        const ec = (q += 2, dv.getUint16(q - 2));
        for (let k = 0; k < ec; k++) {
          if (idxSize) rd(idxSize);
          const off = rd(offSize);
          const len = rd(lenSize);
          if (id === exifId && k === 0) {
            if (base + off + len > u8.length) res.truncated = true;
            else {
            const item = u8.subarray(base + off, base + off + len);
            const skip = 4 + ((item[0] << 24) | (item[1] << 16) | (item[2] << 8) | item[3]);
            if (skip < item.length) res.exifTiff = item.slice(skip);
            }
          }
        }
      }
    }
  }
  return res;
}

export const hasHeifMeta = (u8: Uint8Array): boolean => boxes(u8, 0, u8.length).some((b) => b.type === 'meta');
