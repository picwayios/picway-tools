export interface GifPlanIn {

  w: number;
  h: number;

  rotation: number;

  duration: number;

  start: number;

  length: number;
  fps: number;

  width: number;
}
export interface GifPlan {

  w: number;
  h: number;

  times: number[];

  delays: number[];

  start: number;
  end: number;
}

export const GIF_MAX_SECONDS = 20;
export const GIF_MAX_FRAMES = 300;
export const GIF_MAX_SIDE = 800;

export function planGif(src: GifPlanIn): GifPlan {
  const turned = src.rotation === 90 || src.rotation === 270;
  const vw = turned ? src.h : src.w;
  const vh = turned ? src.w : src.h;
  const wantW = Math.min(src.width > 0 ? src.width : vw, vw, GIF_MAX_SIDE, Math.floor((GIF_MAX_SIDE * vw) / vh));
  const w = Math.max(1, Math.round(wantW));
  const h = Math.max(1, Math.min(GIF_MAX_SIDE, Math.round((w * vh) / vw)));
  const dur = Math.max(0, src.duration);
  const start = Math.min(Math.max(0, src.start), Math.max(0, dur - 0.05));
  const end = Math.min(dur, start + Math.min(Math.max(0.1, src.length), GIF_MAX_SECONDS));
  const fps = Math.min(Math.max(1, src.fps), 30);
  const n = Math.max(1, Math.min(GIF_MAX_FRAMES, Math.round((end - start) * fps)));
  const step = (end - start) / n;
  const times: number[] = [];
  const delays: number[] = [];
  let shown = 0;
  for (let i = 0; i < n; i++) {
    times.push(Math.round((start + i * step) * 1e6));
    const due = Math.round(((i + 1) * step) * 100);
    const d = Math.max(2, due - shown);
    delays.push(d);
    shown += d;
  }
  return { w, h, times, delays, start, end };
}

export function framesBefore(times: number[], from: number, ts: number): number {
  let n = 0;
  while (from + n < times.length && times[from + n] < ts) n++;
  return n;
}
