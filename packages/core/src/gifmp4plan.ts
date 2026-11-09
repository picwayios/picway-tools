export interface GifMp4In {
  width: number;
  height: number;

  delays: number[];

  maxLong: number;

  passes: number;
}
export interface GifMp4Plan {
  w: number;
  h: number;
  codec: string;
  bitrate: number;

  fps: number;

  frames: number;

  durationUs: number;
}

export const MP4_MAX_SIDE = 1920;

export const MP4_MAX_FRAMES = 9000;

export const GIF_LIMIT_IOS = 100 * 1024 * 1024;
export const GIF_LIMIT_DESKTOP = 500 * 1024 * 1024;

export const GIF_MAX_PIXELS = 4096 * 4096;

export const KEY_EVERY_US = 2_000_000;

const evenDown = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

export function planGifMp4(src: GifMp4In): GifMp4Plan {
  const long = Math.max(src.width, src.height);
  const cap = Math.min(src.maxLong > 0 ? src.maxLong : MP4_MAX_SIDE, MP4_MAX_SIDE);
  const fit = (n: number) => (long > cap ? Math.floor((n * cap) / long) : n);
  const w = evenDown(fit(src.width));
  const h = evenDown(fit(src.height));
  const passes = Math.max(1, Math.floor(src.passes));
  const oneUs = src.delays.reduce((a, d) => a + Math.round(d * 1000), 0);
  const durationUs = oneUs * passes;
  const frames = src.delays.length * passes;
  const fps = Math.min(Math.max(durationUs > 0 ? frames / (durationUs / 1e6) : 10, 1), 60);

  const bitrate = Math.round(Math.min(Math.max(w * h * fps * 0.2, 600_000), 20_000_000));

  const fs = Math.ceil(w / 16) * Math.ceil(h / 16);
  const mbps = fs * Math.ceil(fps);
  const level = mbps <= 245_760 && fs <= 8192 ? 0x28 : mbps <= 522_240 && fs <= 8704 ? 0x2a : mbps <= 983_040 ? 0x33 : 0x34;
  return { w, h, codec: `avc1.6400${level.toString(16)}`, bitrate, fps, frames, durationUs };
}

export function frameTimes(delays: number[], passes: number): { ts: number[]; dur: number[] } {
  const ts: number[] = [];
  const dur: number[] = [];
  let ms = 0;
  for (let p = 0; p < Math.max(1, Math.floor(passes)); p++) {
    for (const d of delays) {
      const a = Math.round(ms * 1000);
      ms += d;
      ts.push(a);
      dur.push(Math.round(ms * 1000) - a);
    }
  }
  return { ts, dur };
}

export function keyFrames(ts: number[], every = KEY_EVERY_US): boolean[] {
  let last = -Infinity;
  return ts.map((t) => {
    if (t - last >= every) {
      last = t;
      return true;
    }
    return false;
  });
}

export function flatten(rgba: Uint8ClampedArray, out: Uint8ClampedArray, bg: [number, number, number]) {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) {
      out[i] = bg[0];
      out[i + 1] = bg[1];
      out[i + 2] = bg[2];
    } else if (out !== rgba) {
      out[i] = rgba[i];
      out[i + 1] = rgba[i + 1];
      out[i + 2] = rgba[i + 2];
    }
    out[i + 3] = 255;
  }
}

export const cropOnly = (w: number, h: number, gw: number, gh: number) => (w !== gw || h !== gh) && w <= gw && h <= gh && w >= gw - 1 && h >= gh - 1;
