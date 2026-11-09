import { ArrayBufferTarget, Muxer, StreamTarget } from 'mp4-muxer';
import { BlobSink } from './blobsink.ts';
import { walkGif } from './gifdecode.ts';
import { cropOnly, flatten, frameTimes, keyFrames, planGifMp4, type GifMp4Plan } from './gifmp4plan.ts';
import { patchLastDuration, sampleDurations, tailMoov } from './sttsfix.ts';
import { open } from './transcode.ts';

export interface GifMp4Options {

  maxLong: number;

  passes: number;

  bg: [number, number, number];

  lowMemory?: boolean;
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}
export interface GifMp4Result {
  blob: Blob;
  plan: GifMp4Plan;

  frames: number;
}

const yieldNow = () => new Promise<void>((r) => { const c = new MessageChannel(); c.port1.onmessage = () => r(); c.port2.postMessage(0); });

export async function gifToMp4(bytes: Uint8Array, head: { width: number; height: number; delays: number[] }, o: GifMp4Options): Promise<GifMp4Result> {
  const plan = planGifMp4({ width: head.width, height: head.height, delays: head.delays, maxLong: o.maxLong, passes: o.passes });
  const cfg: VideoEncoderConfig = { codec: plan.codec, width: plan.w, height: plan.h, bitrate: plan.bitrate, framerate: plan.fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  if (!(await VideoEncoder.isConfigSupported(cfg)).supported) throw new Error('encode-unsupported:' + plan.codec);
  let failure: unknown = null;
  const abort = () => {
    if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  };
  const sink = o.lowMemory ? new BlobSink() : null;
  const muxer = new Muxer({
    target: sink ? new StreamTarget({ onData: (d, p) => sink.write(d, p), chunked: true }) : new ArrayBufferTarget(),
    video: { codec: 'avc', width: plan.w, height: plan.h },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  const encoder = new VideoEncoder({
    output: (chunk, m) => {
      if (failure) return;
      try {
        muxer.addVideoChunk(chunk, m);
      } catch (e) {
        failure = e;
      }
    },
    error: (e) => (failure = e),
  });
  const { ts, dur } = frameTimes(head.delays, o.passes);
  const key = keyFrames(ts);
  const total = ts.length;
  let n = 0;
  try {
    encoder.configure(cfg);
    const gw = head.width;
    const gh = head.height;
    const flat = new Uint8ClampedArray(gw * gh * 4);
    const img = new ImageData(flat, gw, gh);
    const src = new OffscreenCanvas(gw, gh);
    const sctx = src.getContext('2d');

    const crop = cropOnly(plan.w, plan.h, gw, gh);
    const dst = plan.w !== gw || plan.h !== gh ? new OffscreenCanvas(plan.w, plan.h) : null;
    const dctx = dst?.getContext('2d') ?? null;
    if (!sctx || (dst && !dctx)) throw new Error('canvas');
    if (dctx) dctx.imageSmoothingQuality = 'high';
    for (let p = 0; p < Math.max(1, Math.floor(o.passes)); p++) {
      const it = walkGif(bytes, { maxFrames: Infinity, maxPixels: Infinity });
      for (let r = it.next(); !r.done; r = it.next()) {
        abort();
        if (n >= total) throw new Error('frame-count');
        flatten(r.value.rgba, flat, o.bg);
        sctx.putImageData(img, 0, 0);
        if (dctx) {
          if (crop) dctx.drawImage(src, 0, 0);
          else dctx.drawImage(src, 0, 0, plan.w, plan.h);
        }
        const vf = new VideoFrame(dst ?? src, { timestamp: ts[n], duration: dur[n] });
        try {
          try { encoder.encode(vf, { keyFrame: key[n] }); } catch (e) { throw failure ?? e; }
        } finally {
          vf.close();
        }
        n++;
        while (encoder.encodeQueueSize > 8) {
          await new Promise<void>((r) => { const t = setTimeout(r, 4); encoder.addEventListener('dequeue', () => (clearTimeout(t), r()), { once: true }); });
          abort();
        }
        if (n % 8 === 0) {
          o.onProgress(n, total);
          await yieldNow();
        }
      }
    }
    if (n !== total) throw new Error('frame-count');
    await encoder.flush();
    abort();
    muxer.finalize();
  } finally {
    try { if (encoder.state !== 'closed') encoder.close(); } catch {  }
  }
  o.onProgress(total, total);
  const raw = sink ? sink.toBlob('video/mp4') : new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
  return { blob: await patchLastDuration(raw), plan, frames: n };
}

export async function verifyGifMp4(out: Blob, plan: GifMp4Plan, lastUs: number, durUs: number[]): Promise<boolean> {
  if (!out.size || plan.frames < 1) return false;
  try {
    const { info, meta } = await open(out as File, false);
    const v = info.videoTracks[0];
    const s = sampleDurations((await tailMoov(out)).moov);
    const sum = s.reduce((a, x) => a + x, 0);
    const tableOk = s.length === plan.frames && Math.abs(sum - plan.durationUs / 1e6) <= 0.05 && Math.abs(s[s.length - 1] - lastUs / 1e6) <= 0.005;
    return /^avc1/.test(meta.codec) && v.nb_samples === plan.frames && meta.w === plan.w && meta.h === plan.h && Math.abs(meta.duration - plan.durationUs / 1e6) <= 0.05 && tableOk && durUs.length === s.length && s.every((x, i) => Math.abs(x - durUs[i] / 1e6) <= 0.005);
  } catch (e) {
    console.error(e);
    return false;
  }
}
