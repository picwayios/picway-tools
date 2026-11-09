export function encodeBmp(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const dataSize = rowBytes * height;
  const out = new Uint8Array(54 + dataSize);
  const dv = new DataView(out.buffer);
  out[0] = 0x42;
  out[1] = 0x4d;
  dv.setUint32(2, out.length, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, width, true);
  dv.setInt32(22, height, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, dataSize, true);
  dv.setInt32(38, 2835, true);
  dv.setInt32(42, 2835, true);
  for (let y = 0; y < height; y++) {
    let o = 54 + (height - 1 - y) * rowBytes;
    let s = y * width * 4;
    for (let x = 0; x < width; x++, s += 4) {
      out[o++] = rgba[s + 2];
      out[o++] = rgba[s + 1];
      out[o++] = rgba[s];
    }
  }
  return out;
}
