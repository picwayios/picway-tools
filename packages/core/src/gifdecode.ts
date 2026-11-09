export interface GifFrame {

  rgba: Uint8ClampedArray;

  delay: number;
}
export interface Gif {
  width: number;
  height: number;
  frames: GifFrame[];

  loops: number;

  hasAlpha: boolean;
}
export interface DecodeLimits {

  maxFrames: number;

  maxPixels: number;
}
export const GIF_LIMITS: DecodeLimits = { maxFrames: 1500, maxPixels: 400_000_000 };

export const isGif = (b: Uint8Array) => b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 && (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61;

export const playDelay = (centis: number) => (centis <= 1 ? 100 : centis * 10);

function lzw(data: Uint8Array, minSize: number, count: number): Uint8Array {
  const out = new Uint8Array(count);
  const clear = 1 << minSize;
  const eoi = clear + 1;
  const prefix = new Int32Array(4096);
  const suffix = new Uint8Array(4096);
  const len = new Uint16Array(4096);
  for (let i = 0; i < clear; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    len[i] = 1;
  }
  let size = minSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let bits = 0;
  let acc = 0;
  let op = 0;
  const emit = (code: number) => {

    const l = len[code];
    let p = op + l - 1;
    let c = code;
    while (c >= 0 && p >= op) {
      if (p < count) out[p] = suffix[c];
      p--;
      c = prefix[c];
    }
    op += l;
  };
  const first = (code: number) => {
    let c = code;
    while (prefix[c] >= 0) c = prefix[c];
    return suffix[c];
  };
  for (let i = 0; i < data.length && op < count; i++) {
    acc |= data[i] << bits;
    bits += 8;
    while (bits >= size && op < count) {
      const code = acc & ((1 << size) - 1);
      acc >>>= size;
      bits -= size;
      if (code === clear) {
        size = minSize + 1;
        next = eoi + 1;
        prev = -1;
        continue;
      }
      if (code === eoi) return out;
      if (prev < 0) {
        if (code >= next) return out;
        emit(code);
        prev = code;
        continue;
      }
      if (code < next) {
        emit(code);
        if (next < 4096) {
          prefix[next] = prev;
          suffix[next] = first(code);
          len[next] = len[prev] + 1;
          next++;
        }
      } else if (code === next && next < 4096) {
        prefix[next] = prev;
        suffix[next] = first(prev);
        len[next] = len[prev] + 1;
        next++;
        emit(code);
      } else return out;
      prev = code;
      if (next === 1 << size && size < 12) size++;
    }
  }
  return out;
}

export function decodeGif(bytes: Uint8Array, limits: DecodeLimits = GIF_LIMITS): Gif {
  const frames: GifFrame[] = [];
  const it = walkGif(bytes, limits);
  for (let r = it.next(); ; r = it.next()) {
    if (r.done) return { ...r.value, frames };
    frames.push({ rgba: r.value.rgba.slice(), delay: r.value.delay });
  }
}

export interface GifHead {
  width: number;
  height: number;
  loops: number;
  hasAlpha: boolean;
}

export function* walkGif(bytes: Uint8Array, limits: DecodeLimits = GIF_LIMITS): Generator<{ rgba: Uint8ClampedArray; delay: number; index: number }, GifHead> {
  if (!isGif(bytes)) throw new Error('not-gif');
  let p = 6;
  const u16 = () => {
    if (p + 2 > bytes.length) throw new Error('truncated');
    const v = bytes[p] | (bytes[p + 1] << 8);
    p += 2;
    return v;
  };
  const u8 = () => {
    if (p >= bytes.length) throw new Error('truncated');
    return bytes[p++];
  };
  const width = u16();
  const height = u16();
  if (!width || !height) throw new Error('bad-size');
  const flags = u8();
  const bgIndex = u8();
  u8();
  const readTable = (n: number) => {
    if (p + n * 3 > bytes.length) throw new Error('truncated');
    const t = bytes.subarray(p, p + n * 3);
    p += n * 3;
    return t;
  };
  const global = flags & 0x80 ? readTable(1 << ((flags & 7) + 1)) : null;

  const bg = global && bgIndex * 3 + 2 < global.length ? [global[bgIndex * 3], global[bgIndex * 3 + 1], global[bgIndex * 3 + 2], 255] : null;
  const canvas = new Uint8ClampedArray(width * height * 4);

  const fillRect = (x0: number, y0: number, w: number, h: number, c: number[] | null) => {
    const x1 = Math.min(width, x0 + w);
    for (let y = y0; y < Math.min(height, y0 + h); y++) {
      if (!c) canvas.fill(0, (y * width + x0) * 4, (y * width + x1) * 4);
      else for (let x = x0; x < x1; x++) canvas.set(c, (y * width + x) * 4);
    }
  };
  let count = 0;
  let loops = 1;
  let gce = { delay: 0, transparent: -1, disposal: 0 };
  let hasAlpha = false;
  const subBlocks = () => {
    const parts: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const n = u8();
      if (!n) break;
      if (p + n > bytes.length) throw new Error('truncated');
      parts.push(bytes.subarray(p, p + n));
      total += n;
      p += n;
    }
    const all = new Uint8Array(total);
    let o = 0;
    for (const x of parts) {
      all.set(x, o);
      o += x.length;
    }
    return all;
  };
  while (p < bytes.length) {
    const tag = u8();
    if (tag === 0x3b) break;
    if (tag === 0x21) {
      const label = u8();
      if (label === 0xf9) {
        const blk = subBlocks();
        if (blk.length >= 4) gce = { disposal: (blk[0] >> 2) & 7, delay: blk[1] | (blk[2] << 8), transparent: blk[0] & 1 ? blk[3] : -1 };
      } else if (label === 0xff) {
        const blk = subBlocks();
        const id = String.fromCharCode(...blk.subarray(0, 11));
        if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && blk.length >= 14 && blk[11] === 1) loops = blk[12] | (blk[13] << 8);
      } else subBlocks();
      continue;
    }
    if (tag !== 0x2c) throw new Error('bad-block');
    const fx = u16();
    const fy = u16();
    const fw = u16();
    const fh = u16();
    const f = u8();
    const table = f & 0x80 ? readTable(1 << ((f & 7) + 1)) : global;
    const interlaced = !!(f & 0x40);
    const minSize = u8();
    if (minSize < 1 || minSize > 11 || fw * fh > 4 * width * height) throw new Error('bad-lzw');
    const data = subBlocks();
    if (!table) throw new Error('no-palette');
    if (count >= limits.maxFrames || (count + 1) * width * height > limits.maxPixels) throw new Error('too-many-frames');
    const idx = lzw(data, minSize, fw * fh);
    if (count === 0) {
      const start = gce.transparent >= 0 ? null : bg;
      if (start) fillRect(0, 0, width, height, start);
      else if (fx > 0 || fy > 0 || fx + fw < width || fy + fh < height) hasAlpha = true;
    }
    const before = gce.disposal === 3 ? canvas.slice() : null;
    const rowOf = (r: number) => {
      if (!interlaced) return r;
      const a = Math.ceil(fh / 8);
      const b = Math.ceil((fh - 4) / 8);
      const c = Math.ceil((fh - 2) / 4);
      if (r < a) return r * 8;
      if (r < a + b) return (r - a) * 8 + 4;
      if (r < a + b + c) return (r - a - b) * 4 + 2;
      return (r - a - b - c) * 2 + 1;
    };
    for (let r = 0; r < fh; r++) {
      const y = fy + rowOf(r);
      if (y >= height) continue;
      for (let x = 0; x < fw; x++) {
        const cx = fx + x;
        if (cx >= width) continue;
        const ci = idx[r * fw + x];
        if (ci === gce.transparent) continue;
        if (ci * 3 + 2 >= table.length) continue;
        const o = (y * width + cx) * 4;
        canvas[o] = table[ci * 3];
        canvas[o + 1] = table[ci * 3 + 1];
        canvas[o + 2] = table[ci * 3 + 2];
        canvas[o + 3] = 255;
      }
    }
    if (gce.transparent >= 0) hasAlpha = true;
    yield { rgba: canvas, delay: playDelay(gce.delay), index: count++ };

    if (gce.disposal === 2) {
      const to = gce.transparent >= 0 ? null : bg;
      fillRect(fx, fy, fw, fh, to);
      if (!to) hasAlpha = true;
    } else if (gce.disposal === 3 && before) canvas.set(before);
    gce = { delay: 0, transparent: -1, disposal: 0 };
  }
  if (!count) throw new Error('no-frames');
  return { width, height, loops, hasAlpha };
}

export function scanGif(bytes: Uint8Array): { width: number; height: number; frames: number; loops: number; delays: number[] } {
  if (!isGif(bytes)) throw new Error('not-gif');
  const at = (i: number) => {
    if (i >= bytes.length) throw new Error('truncated');
    return bytes[i];
  };
  const width = at(6) | (at(7) << 8);
  const height = at(8) | (at(9) << 8);
  let p = 13;
  if (at(10) & 0x80) p += 3 * (1 << ((at(10) & 7) + 1));
  const skipSub = () => {
    for (let n = at(p++); n; n = at(p++)) p += n;
  };
  let frames = 0;
  let loops = 1;
  let delay = 0;
  const delays: number[] = [];
  for (;;) {
    const t = at(p++);
    if (t === 0x3b) break;
    if (t === 0x21) {
      const label = at(p++);
      if (label === 0xf9 && at(p) >= 4) delay = at(p + 2) | (at(p + 3) << 8);
      if (label === 0xff && at(p) === 11 && String.fromCharCode(...bytes.subarray(p + 1, p + 12)) === 'NETSCAPE2.0' && at(p + 12) >= 3 && at(p + 13) === 1) loops = at(p + 14) | (at(p + 15) << 8);
      skipSub();
      continue;
    }
    if (t !== 0x2c) throw new Error('bad-block');
    const f = at(p + 8);
    p += 9;
    if (f & 0x80) p += 3 * (1 << ((f & 7) + 1));
    p++;
    skipSub();
    frames++;
    delays.push(playDelay(delay));
    delay = 0;
  }
  return { width, height, frames, loops, delays };
}
