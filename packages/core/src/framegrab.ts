import { MP4BoxBuffer } from 'mp4box';
import { descriptionOf, open } from './transcode.ts';
import { framesBefore, type GifPlan } from './gifplan.ts';
import { frameWindows, grabFeed } from './editwindow.ts';
type AnyBox = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CHUNK = 8 * 1024 * 1024;

export function drawTurned(ctx: OffscreenCanvasRenderingContext2D, frame: CanvasImageSource, turn: ArrayLike<number> | null, w: number, h: number) {
  const [a, b, c, d] = turn ? [turn[0], turn[1], turn[3], turn[4]].map(Math.round) : [1, 0, 0, 1];
  const dw = a === 0 ? h : w;
  const dh = a === 0 ? w : h;
  ctx.setTransform(a, b, c, d, Math.max(0, -a) * dw + Math.max(0, -c) * dh, Math.max(0, -b) * dw + Math.max(0, -d) * dh);
  ctx.drawImage(frame, 0, 0, dw, dh);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

export async function grabFrames(
  file: File,
  plan: Pick<GifPlan, 'w' | 'h' | 'times' | 'end'>,
  turn: ArrayLike<number> | null,
  onFrame: (rgba: Uint8ClampedArray, index: number) => void,
  o: {
    signal: AbortSignal;
    onProgress: (done: number, total: number) => void;

    onCanvas?: (canvas: OffscreenCanvas, indices: number[]) => void;

    busy?: () => boolean;

    queue?: number;
  },
): Promise<number> {
  const { mp4, info } = await open(file, true);
  const v = info.videoTracks[0];
  const description = descriptionOf(mp4, v.id);
  const cfg: VideoDecoderConfig = { codec: v.codec, codedWidth: v.video.width, codedHeight: v.video.height, ...(description ? { description } : {}) };
  if (!(await VideoDecoder.isConfigSupported(cfg)).supported) throw new Error('decode-unsupported:' + v.codec);

  const trak: AnyBox = mp4.getTrackById(v.id);
  const samples: AnyBox[] = trak.samples ?? [];
  const scale = v.timescale as number;

  const g = grabFeed(samples, frameWindows(trak.edts?.elst?.entries, info.timescale || 1, scale), scale, plan.times[0], plan.end * 1e6);
  if (!g) throw new Error('edit-unsupported');

  const canvas = new OffscreenCanvas(plan.w, plan.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D;
  const total = plan.times.length;
  let next = 0;
  let prev: VideoFrame | null = null;
  let failure: unknown = null;
  const emit = (frame: VideoFrame, n: number) => {
    if (!n) return;
    drawTurned(ctx, frame, turn, plan.w, plan.h);
    if (o.onCanvas) o.onCanvas(canvas, Array.from({ length: n }, () => next++));
    else {
      const rgba = ctx.getImageData(0, 0, plan.w, plan.h).data;
      for (let k = 0; k < n; k++) onFrame(rgba, next++);
    }
    o.onProgress(next, total);
  };
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const ts = g.show.get(frame.timestamp);
        if (ts === undefined || next >= total || failure || o.signal.aborted) return void frame.close();
        if (!prev) emit(frame, framesBefore(plan.times, next, ts));
        else emit(prev, framesBefore(plan.times, next, ts));
        prev?.close();
        prev = frame;
      } catch (e) {
        failure = e;
        frame.close();
      }
    },
    error: (e) => (failure = e),
  });
  try {
    decoder.configure(cfg);
  } catch (e) {
    decoder.close();
    throw e;
  }
  const abort = () => {
    if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  };
  const wait = () => new Promise((r) => setTimeout(r, 4));
  const queue: AnyBox[] = [];
  let done = false;

  const drain = async () => {
    while (queue.length && !done && next < total) {
      const s = queue.shift();
      const send = s.number >= g.from && s.number <= g.to && g.feed[s.number] === 1;
      if (send) {
        abort();
        try {
          decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: Math.round((s.cts * 1e6) / scale), duration: Math.round((s.duration * 1e6) / scale), data: s.data }));
        } catch (e) {
          for (let i = 0; i < 12 && !failure && !o.signal.aborted; i++) await wait();
          throw o.signal.aborted ? new DOMException('aborted', 'AbortError') : failure instanceof Error ? failure : e;
        }
      }
      mp4.releaseUsedSamples(v.id, s.number + 1);
      if (s.number >= g.to) done = true;
      if (!send) continue;
      while (decoder.decodeQueueSize > (o.queue ?? 8) || o.busy?.()) {
        await wait();
        abort();
      }
    }
  };
  try {
    mp4.onSamples = (_id: number, _u: unknown, s: AnyBox[]) => queue.push(...s);
    mp4.setExtractionOptions(v.id, null, { nbSamples: 50 });
    mp4.start();
    let pos = 0;
    while (pos < file.size && !done && next < total) {
      abort();
      const ab = await file.slice(pos, pos + CHUNK).arrayBuffer();
      mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
      pos += ab.byteLength;
      await drain();
    }
    mp4.flush();
    await drain();
    abort();
    await decoder.flush();
    abort();
    if (prev && next < total) emit(prev, total - next);
  } finally {
    (prev as VideoFrame | null)?.close();
    try { if (decoder.state !== 'closed') decoder.close(); } catch {  }
  }
  return next;
}
