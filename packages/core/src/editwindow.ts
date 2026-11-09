export interface RawEdit {
  segment_duration: number;
  media_time: number;
  media_rate_integer?: number;
  media_rate_fraction?: number;
}

export interface Win {
  start: number;
  end: number;
  out: number;
}
export interface SampleMeta {
  cts: number;
  dts: number;
  duration: number;
  is_sync: boolean;
}

export function visibleWindows(entries: RawEdit[] | undefined, movieScale: number, mediaScale: number): Win[] | null {
  if (!entries?.length) return null;
  const wins: Win[] = [];
  let out = 0;
  for (const e of entries) {
    const seg = e.segment_duration / movieScale;
    const rate = (e.media_rate_integer ?? 1) + (e.media_rate_fraction ?? 0) / 65536;
    if (e.media_time < 0) {
      out += seg;
      continue;
    }
    if (rate !== 1) throw new Error('edit-unsupported');
    wins.push({ start: e.media_time, end: e.segment_duration === 0 ? Infinity : e.media_time + seg * mediaScale, out });
    out += seg;
  }
  if (!wins.length) throw new Error('edit-unsupported');

  for (let i = 1; i < wins.length; i++) if (wins[i].start < wins[i - 1].end - 1) throw new Error('edit-unsupported');
  return wins;
}

export const toUs = (t: number, timescale: number) => Math.round((t * 1e6) / timescale);
const outUs = (w: Win, t: number, timescale: number) => Math.round((w.out + (t - w.start) / timescale) * 1e6);

export interface VideoPlan {

  feed: Uint8Array;

  out: Map<number, number>;
}
export function planVideo(samples: SampleMeta[], wins: Win[], timescale: number): VideoPlan {
  const feed = new Uint8Array(samples.length);
  const out = new Map<number, number>();
  for (const w of wins) {
    let first = -1;
    let last = -1;
    let minCts = Infinity;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      if (s.cts < w.start || s.cts >= w.end) continue;
      out.set(toUs(s.cts, timescale), outUs(w, s.cts, timescale));
      if (first < 0) first = i;
      last = i;
      minCts = Math.min(minCts, s.cts);
    }
    if (first < 0) continue;

    let start = first;
    while (start > 0 && !samples[start].is_sync) start--;
    while (start > 0 && samples[start].cts > minCts) {
      start--;
      while (start > 0 && !samples[start].is_sync) start--;
    }
    for (let i = start; i <= last; i++) feed[i] = 1;
  }
  return { feed, out };
}

export function planAudio(samples: SampleMeta[], wins: Win[], timescale: number): Map<number, number> {
  const keep = new Map<number, number>();
  for (const w of wins) {
    const kept: number[] = [];
    samples.forEach((s, i) => {
      const mid = s.cts + s.duration / 2;
      if (mid >= w.start && mid < w.end) kept.push(i);
    });
    if (!kept.length) continue;
    const first = kept[0];
    const pre = first > 0 && !keep.has(first - 1) ? first - 1 : first;
    const anchor = samples[pre].cts;
    for (let i = pre; i <= kept[kept.length - 1]; i++) if (!keep.has(i)) keep.set(i, Math.round((w.out + (samples[i].cts - anchor) / timescale) * 1e6));
  }
  return keep;
}

export function frameWindows(entries: RawEdit[] | undefined, movieScale: number, mediaScale: number): Win[] | null {
  const wins = visibleWindows(entries, movieScale, mediaScale);
  let shown = false;
  for (const e of entries ?? []) {
    if (e.media_time >= 0) shown = true;
    else if (shown) throw new Error('edit-unsupported');
  }
  return wins;
}

export function frameEditsOk(entries: RawEdit[] | undefined, movieScale: number, mediaScale: number): boolean {
  try {
    frameWindows(entries, movieScale, mediaScale);
    return true;
  } catch {
    return false;
  }
}

export interface GrabFeed {

  from: number;
  to: number;
  feed: Uint8Array;

  show: Map<number, number>;
}

export function grabFeed(samples: SampleMeta[], wins: Win[] | null, timescale: number, startUs: number, endUs: number): GrabFeed | null {
  let feed: Uint8Array;
  let show: Map<number, number>;
  if (wins) ({ feed, out: show } = planVideo(samples, wins, timescale));
  else {
    feed = new Uint8Array(samples.length).fill(1);
    show = new Map(samples.map((s) => [toUs(s.cts, timescale), toUs(s.cts, timescale)]));
  }
  let k = -1;
  let kAt = -Infinity;
  let earliest = -1;
  let earliestAt = Infinity;
  let to = -1;
  for (let i = 0; i < samples.length; i++) {
    const at = show.get(toUs(samples[i].cts, timescale));
    if (at === undefined) continue;
    if (at <= startUs && at > kAt) (k = i), (kAt = at);
    if (at < earliestAt) (earliest = i), (earliestAt = at);
    if (at <= endUs) to = Math.max(to, i);
  }
  if (k < 0) k = earliest;
  if (k < 0) return null;
  to = Math.max(to, k);
  let from = k;
  while (from > 0 && !(samples[from].is_sync && feed[from])) from--;
  while (from < k && !feed[from]) from++;
  return { from, to, feed, show };
}

export function keptAudioBytes(samples: (SampleMeta & { size: number })[], entries: RawEdit[] | undefined, movieScale: number, mediaScale: number): number | null {
  let wins: Win[] | null;
  try {
    wins = visibleWindows(entries, movieScale, mediaScale);
  } catch {
    return null;
  }
  let n = 0;
  if (!wins) for (const s of samples) n += s.size;
  else for (const i of planAudio(samples, wins, mediaScale).keys()) n += samples[i].size;
  return n;
}
