import { crc32 } from './zip.ts';

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate');
  const w = cs.writable.getWriter();
  w.write(data as BufferSource);
  w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
const chunk = (type: string, data: Uint8Array) => {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
};

export async function pngSetIcc(png: Uint8Array, icc: Uint8Array, name = 'ICC'): Promise<Uint8Array> {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 8)];
  let p = 8;
  let inserted = false;
  const iccp = chunk('iCCP', Uint8Array.from([...Array.from(name, (c) => c.charCodeAt(0)), 0, 0, ...(await deflate(icc))]));
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    const end = p + 12 + len;
    if (type === 'iCCP' || type === 'sRGB' || type === 'gAMA' || type === 'cHRM') {
      p = end;
      continue;
    }
    parts.push(png.subarray(p, end));
    if (type === 'IHDR' && !inserted) (parts.push(iccp), (inserted = true));
    p = end;
  }
  const out = new Uint8Array(parts.reduce((n, x) => n + x.length, 0));
  let o = 0;
  for (const x of parts) (out.set(x, o), (o += x.length));
  return out;
}

export async function pngGetIcc(png: Uint8Array): Promise<Uint8Array | null> {
  if (png.length < 20 || png[1] !== 0x50 || png[2] !== 0x4e || png[3] !== 0x47) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 12 <= png.length) {
    const len = dv.getUint32(p);
    const type = String.fromCharCode(png[p + 4], png[p + 5], png[p + 6], png[p + 7]);
    if (type === 'IDAT' || type === 'IEND' || p + 12 + len > png.length) return null;
    if (type === 'iCCP') {
      const body = png.subarray(p + 8, p + 8 + len);
      const z = body.indexOf(0);
      if (z < 1 || z + 2 >= body.length) return null;
      try {
        const ds = new DecompressionStream('deflate');
        const w = ds.writable.getWriter();
        w.write(body.subarray(z + 2) as BufferSource).catch(() => {});
        w.close().catch(() => {});
        const out = new Uint8Array(await new Response(ds.readable).arrayBuffer());
        return out.length >= 128 ? out : null;
      } catch {
        return null;
      }
    }
    p += 12 + len;
  }
  return null;
}
