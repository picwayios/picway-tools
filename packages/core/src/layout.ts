export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function gridLayout(n: number, W: number, ratio: number, gap: number): { W: number; H: number; cells: Rect[] } {
  const H = Math.round(W / ratio);
  let best = { cols: 1, score: Infinity };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (W - gap * (cols + 1)) / cols;
    const ch = (H - gap * (rows + 1)) / rows;
    if (cw <= 0 || ch <= 0) continue;

    const score = Math.abs(Math.log(cw / ch)) + (cols * rows - n) * 0.15;
    if (score < best.score) best = { cols, score };
  }
  const cols = best.cols;
  const rows = Math.ceil(n / cols);
  const cw = (W - gap * (cols + 1)) / cols;
  const ch = (H - gap * (rows + 1)) / rows;
  const cells: Rect[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const inRow = r === rows - 1 ? n - cols * (rows - 1) : cols;
    const c = i - r * cols;
    const offset = ((cols - inRow) * (cw + gap)) / 2;
    cells.push({ x: Math.round(gap + offset + c * (cw + gap)), y: Math.round(gap + r * (ch + gap)), w: Math.round(cw), h: Math.round(ch) });
  }
  return { W, H, cells };
}

export const MAX_SIDE = 32767;

export function stripLayout(sizes: { w: number; h: number }[], W: number, gap: number, maxPixels = 16_000_000): { W: number; H: number; rects: Rect[]; scaled: boolean; thin: number[]; huge: boolean } {
  const build = (w: number) => {
    let y = 0;
    const thin: number[] = [];
    const rects = sizes.map((s, i) => {
      const raw = (s.h * w) / s.w;
      if (raw < 0.5) thin.push(i);
      const h = Math.max(1, Math.round(raw));
      const r = { x: 0, y, w, h };
      y += h + gap;
      return r;
    });
    return { rects, thin, H: Math.max(0, y - gap) };
  };
  let w = W;
  let b = build(w);
  let scaled = false;
  if (w * b.H > maxPixels) {
    w = Math.max(64, Math.floor(w * Math.sqrt(maxPixels / (w * b.H))));
    b = build(w);
    scaled = true;
  }
  return { W: w, H: b.H, rects: b.rects, scaled, thin: b.thin, huge: w * b.H > maxPixels || b.H > MAX_SIDE };
}

export const fitVisible = (f: { dw: number; dh: number }) => f.dw >= 1 && f.dh >= 1;

export type BorderStyle = 'even' | 'polaroid' | 'square' | 'portrait45';

export function borderLayout(w: number, h: number, style: BorderStyle, pct: number): { W: number; H: number; x: number; y: number } {
  const m = Math.max(Math.round((Math.min(w, h) * pct) / 100), style === 'polaroid' && pct > 0 ? POLAROID_MIN : 0);
  if (style === 'even') return { W: w + 2 * m, H: h + 2 * m, x: m, y: m };
  if (style === 'polaroid') return { W: w + 2 * m, H: h + m + Math.round(m * 3.5), x: m, y: m };
  const r = style === 'square' ? 1 : 4 / 5;
  let W = w + 2 * m;
  let H = h + 2 * m;
  if (W / H < r) W = Math.round(H * r);
  else H = Math.round(W / r);
  return { W, H, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) };
}

export function fitRect(src: { w: number; h: number }, dst: Rect, mode: 'cover' | 'contain'): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  if (mode === 'cover') {
    const k = Math.max(dst.w / src.w, dst.h / src.h);
    const sw = dst.w / k;
    const sh = dst.h / k;
    return { sx: (src.w - sw) / 2, sy: (src.h - sh) / 2, sw, sh, dx: dst.x, dy: dst.y, dw: dst.w, dh: dst.h };
  }
  const k = Math.min(dst.w / src.w, dst.h / src.h);
  const dw = src.w * k;
  const dh = src.h * k;
  return { sx: 0, sy: 0, sw: src.w, sh: src.h, dx: dst.x + (dst.w - dw) / 2, dy: dst.y + (dst.h - dh) / 2, dw, dh };
}

export const POLAROID_MIN = 12;
