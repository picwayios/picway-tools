export interface FitOptions {

  lo?: number;
  hi?: number;

  steps?: number;

  maxTries?: number; deadline?: number; now?: () => number;

  fixedQuality?: number;

  stop?: () => boolean;
}
export interface FitResult<T> {
  result: T;
  q: number;
  scale: number;

  fits: boolean;
  tries: number;
}
export class FitStopped extends Error {
  constructor() { super('stopped'); }
}
class OutOfTries extends Error {}

export function nextScale(scale: number, size: number, target: number): number {
  const k = Math.sqrt(target / size) * 0.9;
  return Math.max(0.05, scale * Math.min(0.9, k));
}

export async function fitToSize<T extends { size: number }>(make: (q: number, scale: number) => Promise<T>, target: number, o: FitOptions = {}): Promise<FitResult<T>> {
  if (!(target > 0)) throw new Error('target size must be above 0');
  const lo = o.lo ?? 0.3;
  const hi = o.hi ?? 0.95;
  const steps = o.steps ?? 5;
  const maxTries = o.maxTries ?? 14;
  let tries = 0;
  let best: FitResult<T> | null = null;
  let smallest: FitResult<T> | null = null;
  const run = async (q: number, scale: number) => {
    if (o.stop?.()) throw new FitStopped();
    if (tries >= maxTries || (tries > 0 && o.deadline !== undefined && (o.now ?? Date.now)() >= o.deadline)) throw new OutOfTries();
    tries++;
    const r = await make(q, scale);
    if (o.stop?.()) throw new FitStopped();
    const fr = { result: r, q, scale, fits: r.size <= target, tries };
    if (fr.fits && (!best || scale > best.scale || (scale === best.scale && q > best.q))) best = fr;
    if (!smallest || r.size < smallest.result.size) smallest = fr;
    return r.size;
  };

  let scale = 1;
  try {
  for (let round = 0; round < 4 && tries < maxTries; round++) {
    if (o.fixedQuality !== undefined) {
      const size = await run(o.fixedQuality, scale);
      if (size <= target) break;
      scale = nextScale(scale, size, target);
      continue;
    }

    const top = await run(hi, scale);
    if (top <= target) break;
    const bottom = await run(lo, scale);
    if (bottom > target) {
      scale = nextScale(scale, bottom, target);
      continue;
    }
    let a = lo;
    let b = hi;
    for (let i = 0; i < steps && tries < maxTries; i++) {
      const m = Math.round(((a + b) / 2) * 100) / 100;
      if (m <= a || m >= b) break;
      if ((await run(m, scale)) <= target) a = m;
      else b = m;
    }
    break;
  }
  } catch (e) {
    if (!(e instanceof OutOfTries) || !smallest) throw e;
  }
  const out = (best ?? smallest) as unknown as FitResult<T>;
  return { ...out, tries };
}
