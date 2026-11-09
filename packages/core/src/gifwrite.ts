import * as G from 'gifenc';

const lib = ((G as unknown as { GIFEncoder?: unknown }).GIFEncoder ? G : (G as unknown as { default: typeof G }).default) as typeof G;
const { applyPalette, GIFEncoder, quantize } = lib;

export interface WriterOptions {
  width: number;
  height: number;

  repeat: number;

  colors: number;

  alpha: boolean;

  tolerance?: number;
}

export class GifWriter {
  private enc = GIFEncoder();
  private shown: Uint8ClampedArray | null = null;
  private n = 0;
  private o: WriterOptions;
  constructor(o: WriterOptions) {
    this.o = o;
  }

  get frames() {
    return this.n;
  }

  add(rgba: Uint8ClampedArray, delayCs: number) {
    const { width: w, height: h, colors, alpha } = this.o;
    if (rgba.length !== w * h * 4) throw new Error('frame-size');
    const delay = Math.max(2, Math.round(delayCs)) * 10;
    const first = this.n === 0;
    const repeat = this.o.repeat;
    if (alpha) {
      const palette = quantize(rgba, colors, { format: 'rgba4444', oneBitAlpha: true });
      const index = applyPalette(rgba, palette, 'rgba4444');
      const t = palette.findIndex((c) => c[3] === 0);
      this.enc.writeFrame(index, w, h, { palette, delay, repeat, dispose: 2, ...(t >= 0 ? { transparent: true, transparentIndex: t } : {}) });
    } else if (first || !this.shown) {
      const palette = quantize(rgba, colors);
      this.enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay, repeat, dispose: 1 });
      this.shown = rgba.slice();
    } else {

      const tol = this.o.tolerance ?? 0;
      const shown = this.shown;
      const changed = new Uint8Array(w * h);
      let k = 0;
      for (let i = 0, p = 0; p < w * h; p++, i += 4) {
        const d = Math.abs(rgba[i] - shown[i]) + Math.abs(rgba[i + 1] - shown[i + 1]) + Math.abs(rgba[i + 2] - shown[i + 2]);
        if (d > tol) {
          changed[p] = 1;
          k++;
        }
      }
      if (k === w * h || k === 0) {

        const palette = quantize(rgba, colors);
        this.enc.writeFrame(applyPalette(rgba, palette), w, h, { palette, delay, repeat, dispose: 1 });
        shown.set(rgba);
      } else {
        const sub = new Uint8ClampedArray(k * 4);
        for (let p = 0, j = 0; p < w * h; p++) if (changed[p]) sub.set(rgba.subarray(p * 4, p * 4 + 4), (j++) * 4);
        const palette = quantize(sub, Math.max(2, colors - 1));
        const t = palette.length;
        palette.push([0, 0, 0]);
        const idx = applyPalette(rgba, palette.slice(0, t));
        for (let p = 0; p < w * h; p++) {
          if (!changed[p]) idx[p] = t;
          else shown.set(rgba.subarray(p * 4, p * 4 + 3), p * 4);
        }
        this.enc.writeFrame(idx, w, h, { palette, delay, repeat, dispose: 1, transparent: true, transparentIndex: t });
      }
    }
    this.n++;
  }

  finish(): Uint8Array {
    this.enc.finish();
    return this.enc.bytes();
  }
}
