import { BlobSink } from './blobsink.ts';
import { createFile, DataStream, Endianness, MP4BoxBuffer } from 'mp4box';
import { ArrayBufferTarget, Muxer, StreamTarget } from 'mp4-muxer';
import { patchEdits, type EditEntry } from './editlist.ts';
import { frameEditsOk, keptAudioBytes, planAudio, planVideo, toUs, visibleWindows } from './editwindow.ts';
import { hasHiddenAudio, planEncode, type Plan, type Preset } from './videoplan.ts';

export interface VideoMeta {
  w: number;
  h: number;
  fps: number;
  duration: number;
  bitrate: number;
  codec: string;
  hevc: boolean;

  hdr: boolean;
  rotation: number;
  hasAudio: boolean;
  audioKept: boolean;

  audioBitrate: number;

  fragmented: boolean;
}
export interface Result {
  blob: Blob;

  frames: number;
  plan: Plan;
  meta: VideoMeta;

  audioOut: boolean;
}
export const webcodecsOk = () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined' && typeof EncodedVideoChunk !== 'undefined';

const CHUNK = 8 * 1024 * 1024;
type AnyBox = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export function descriptionOf(mp4: AnyBox, trackId: number): Uint8Array | undefined {
  const trak = mp4.getTrackById(trackId);
  for (const entry of trak.mdia.minf.stbl.stsd.entries) {
    const box = entry.avcC ?? entry.hvcC ?? entry.vpcC ?? entry.av1C;
    if (box) {
      const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
      box.write(stream);
      return new Uint8Array(stream.buffer as ArrayBuffer, 8);
    }
  }
  return undefined;
}

export function aacConfig(mp4: AnyBox, trackId: number): Uint8Array | undefined {
  const trak = mp4.getTrackById(trackId);
  const esds = trak.mdia.minf.stbl.stsd.entries[0]?.esds;
  const find = (d: AnyBox): Uint8Array | undefined => {
    if (!d) return undefined;
    if (d.tag === 5 && d.data) return new Uint8Array(d.data);
    for (const c of d.descs ?? []) {
      const r = find(c);
      if (r) return r;
    }
    return undefined;
  };
  return find(esds?.esd);
}
const rotationOf = (m?: ArrayLike<number>) => {
  if (!m) return 0;
  const a = m[0] / 65536;
  const b = m[1] / 65536;
  return ((Math.round((Math.atan2(b, a) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
};

export async function probe(file: File): Promise<VideoMeta> {
  const { meta } = await open(file, false);
  return meta;
}

export async function open(file: File, keepFeeding: boolean) {
  const mp4: AnyBox = createFile();
  let info: AnyBox = null;
  let err: unknown = null;
  mp4.onError = (e: unknown) => (err = e);
  mp4.onReady = (i: unknown) => (info = i);
  let pos = 0;
  while (!info && !err && pos < file.size) {
    const ab = await file.slice(pos, pos + CHUNK).arrayBuffer();
    const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
    pos = typeof next === 'number' && next > pos ? next : pos + ab.byteLength;
  }
  if (err || !info) throw new Error('not-mp4');
  const v = info.videoTracks[0];
  if (!v) throw new Error('no-video');
  const a = info.audioTracks[0];
  const codec: string = v.codec;
  const secs = (info.duration ?? 0) / (info.timescale || 1);
  const meta: VideoMeta = {
    w: v.video.width,
    h: v.video.height,
    fps: secs > 0 ? v.nb_samples / (v.duration / v.timescale) : 30,
    duration: secs,
    bitrate: v.bitrate || (secs > 0 ? Math.round((file.size * 8) / secs) : 0),
    codec,
    hevc: /^(hvc1|hev1|dvh1|dvhe)/.test(codec),
    hdr: /^(dvh1|dvhe)/.test(codec) || /^(hvc1|hev1)\.2\./.test(codec),
    rotation: rotationOf(v.matrix), rotationMatrix: matrixOf(v.matrix),
    hasAudio: !!a || hasHiddenAudio(info.tracks),
    audioKept: !!a && /^mp4a\.40\./.test(a.codec),
    audioBitrate: a && /^mp4a\.40\./.test(a.codec) ? (Number.isFinite(a.bitrate) && a.bitrate > 0 ? a.bitrate : 256_000) : 0,
    fragmented: !!info.isFragmented,
    frameEdits: frameEditsOk(mp4.getTrackById(v.id)?.edts?.elst?.entries, info.timescale || 1, v.timescale || 1),
    audioBytes: a && /^mp4a\.40\./.test(a.codec) && !info.isFragmented ? keptAudioBytes(mp4.getTrackById(a.id)?.samples ?? [], mp4.getTrackById(a.id)?.edts?.elst?.entries, info.timescale || 1, a.timescale || 1) : null,
  };
  return { mp4, info, meta, pos: keepFeeding ? 0 : pos };
}

export interface Options {
  preset: Preset;
  maxLong: number;

  lowMemory?: boolean;

  bitrate?: number;

  bitrateMode?: 'constant' | 'variable';
  signal: AbortSignal;
  onProgress: (done: number, total: number) => void;
}
export async function transcode(file: File, o: Options): Promise<Result> {
  const { mp4, info, meta } = await open(file, true);
  const v = info.videoTracks[0];
  const a0 = meta.audioKept ? info.audioTracks[0] : undefined;
  const base = planEncode({ w: meta.w, h: meta.h, bitrate: meta.bitrate, fps: meta.fps, hevc: meta.hevc }, o.preset, o.maxLong);
  const plan = o.bitrate && o.bitrate > 0 ? { ...base, bitrate: Math.round(o.bitrate) } : base;
  const description = descriptionOf(mp4, v.id);
  const decCfg: VideoDecoderConfig = { codec: v.codec, codedWidth: v.video.width, codedHeight: v.video.height, ...(description ? { description } : {}) };
  if (!(await VideoDecoder.isConfigSupported(decCfg)).supported) throw new Error('decode-unsupported:' + v.codec);
  const encBase: VideoEncoderConfig = { codec: plan.codec, width: plan.w, height: plan.h, bitrate: plan.bitrate, framerate: plan.fps, avc: { format: 'avc' }, latencyMode: 'quality' };
  let encCfg = encBase;
  if (o.bitrateMode) {
    const want: VideoEncoderConfig = { ...encBase, bitrateMode: o.bitrateMode };
    if ((await VideoEncoder.isConfigSupported(want).catch(() => ({ supported: false }))).supported) encCfg = want;
  }
  if (!(await VideoEncoder.isConfigSupported(encCfg)).supported) throw new Error('encode-unsupported:' + plan.codec);

  const movieScale = info.timescale || 1;
  const trackOf = (id: number, timescale: number) => {
    const trak = mp4.getTrackById(id);
    const samples: AnyBox[] = trak?.samples ?? [];
    const entries = trak?.edts?.elst?.entries;

    if (info.isFragmented) {
      if (entries && (entries.length > 1 || entries.some((e: AnyBox) => e.media_time < 0))) throw new Error('edit-unsupported');
      return null;
    }
    const wins = visibleWindows(entries, movieScale, timescale);
    return wins && samples.length > 0 ? { wins, samples } : null;
  };
  const vt = trackOf(v.id, v.timescale);
  const vPlan = vt ? planVideo(vt.samples, vt.wins, v.timescale) : null;
  const at = a0 ? trackOf(a0.id, a0.timescale) : null;
  const aPlan = at && a0 ? planAudio(at.samples, at.wins, a0.timescale) : null;
  if (vPlan && vPlan.out.size === 0) throw new Error('edit-unsupported');
  const a = aPlan && aPlan.size === 0 ? undefined : a0;

  const firstOut = (m: Map<number, number> | null, id: number, scale: number) => {
    let r = Infinity;
    if (m) for (const x of m.values()) r = Math.min(r, x);
    else for (const x of mp4.getTrackById(id)?.samples ?? []) r = Math.min(r, toUs(x.cts, scale));
    return Number.isFinite(r) ? r : 0;
  };
  const vStart = firstOut(vPlan?.out ?? null, v.id, v.timescale);
  const aStart = a ? firstOut(aPlan, a.id, a.timescale) : 0;
  const lead = a && !info.isFragmented && (vPlan || aPlan) ? vStart - aStart : 0;
  const skew = Math.abs(lead) >= 1000;
  let vEnd = 0;
  let aEnd = 0;
  const sink = o.lowMemory ? new BlobSink() : null;
  const muxer = new Muxer({
    target: sink ? new StreamTarget({ onData: (d, p) => sink.write(d, p), chunked: true }) : new ArrayBufferTarget(),
    video: { codec: 'avc', width: plan.w, height: plan.h, rotation: meta.rotationMatrix ? shiftScaled(meta.rotationMatrix, plan.w / meta.w, plan.h / meta.h) : 0 },
    ...(a ? { audio: { codec: 'aac' as const, numberOfChannels: a.audio.channel_count, sampleRate: a.audio.sample_rate } } : {}),
    fastStart: sink || skew ? false : 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  const asc = a ? aacConfig(mp4, a.id) : undefined;
  const audioMeta: EncodedAudioChunkMetadata | undefined = a ? { decoderConfig: { codec: a.codec, numberOfChannels: a.audio.channel_count, sampleRate: a.audio.sample_rate, ...(asc ? { description: asc } : {}) } } : undefined;
  let audioFirst = true;

  let failure: unknown = null;
  const encoder = new VideoEncoder({ output: (chunk, m) => muxer.addVideoChunk(chunk, m), error: (e) => (failure = e) });
  encoder.configure(encCfg);
  const scale = plan.w !== meta.w || plan.h !== meta.h;
  const canvas = scale ? new OffscreenCanvas(plan.w, plan.h) : null;
  const ctx = canvas?.getContext('2d') ?? null;
  let framesOut = 0;
  const total = vPlan ? vPlan.out.size : (v.nb_samples as number);
  const decoder = new VideoDecoder({
    output: (frame) => {

      const outTs = vPlan ? vPlan.out.get(frame.timestamp) : frame.timestamp;
      if (outTs === undefined) return frame.close();
      vEnd = Math.max(vEnd, outTs + (frame.duration ?? Math.round(1e6 / plan.fps)));
      let f = frame;
      try {
        if (ctx && canvas) {
          ctx.drawImage(frame, 0, 0, plan.w, plan.h);
          f = new VideoFrame(canvas, { timestamp: outTs, duration: frame.duration ?? undefined });
        } else if (outTs !== frame.timestamp) f = new VideoFrame(frame, { timestamp: outTs, duration: frame.duration ?? undefined });
        encoder.encode(f, { keyFrame: framesOut % Math.max(1, Math.round(plan.fps * 2)) === 0 });
      } catch (e) {
        failure = e;
      } finally {
        if (f !== frame) f.close();
        frame.close();
        framesOut++;
        if (framesOut % 8 === 0) o.onProgress(Math.min(framesOut, total), total);
      }
    },
    error: (e) => (failure = e),
  });
  decoder.configure(decCfg);

  const vq: AnyBox[] = [];
  const aq: AnyBox[] = [];
  mp4.onSamples = (id: number, _u: unknown, samples: AnyBox[]) => (id === v.id ? vq : aq).push(...samples);
  mp4.setExtractionOptions(v.id, null, { nbSamples: 100 });
  if (a) mp4.setExtractionOptions(a.id, null, { nbSamples: 100 });
  mp4.start();

  const wait = () => new Promise((r) => setTimeout(r, 4));
  const abort = () => {
    if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
    if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  };
  const drain = async () => {
    while (aq.length) {
      const s = aq.shift();
      const ts = aPlan ? aPlan.get(s.number) : toUs(s.cts, s.timescale);
      if (ts !== undefined) {
        aEnd = Math.max(aEnd, ts + toUs(s.duration, s.timescale));
        muxer.addAudioChunkRaw(new Uint8Array(s.data), s.is_sync ? 'key' : 'delta', ts, toUs(s.duration, s.timescale), audioFirst ? audioMeta : undefined);
        audioFirst = false;
      }

      mp4.releaseUsedSamples(a.id, s.number + 1);
    }
    while (vq.length) {
      abort();
      while (decoder.decodeQueueSize > 12 || encoder.encodeQueueSize > 12) {
        await wait();
        abort();
      }
      const s = vq.shift();
      if (!vPlan || vPlan.feed[s.number]) decoder.decode(new EncodedVideoChunk({ type: s.is_sync ? 'key' : 'delta', timestamp: toUs(s.cts, s.timescale), duration: toUs(s.duration, s.timescale), data: s.data }));
      mp4.releaseUsedSamples(v.id, s.number + 1);
    }
  };
  try {

    let pos = 0;
    while (pos < file.size) {
      abort();
      const ab = await file.slice(pos, pos + CHUNK).arrayBuffer();
      mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
      pos += ab.byteLength;
      await drain();
    }
    mp4.flush();
    await drain();
    await decoder.flush();
    await encoder.flush();
    abort();
    muxer.finalize();
  } finally {
    try { if (decoder.state !== 'closed') decoder.close(); } catch {  }
    try { if (encoder.state !== 'closed') encoder.close(); } catch {  }
  }
  o.onProgress(total, total);
  let blob = sink ? sink.toBlob('video/mp4') : new Blob([(muxer.target as ArrayBufferTarget).buffer], { type: 'video/mp4' });
  if (skew) {

    const lateId = lead > 0 ? 1 : 2;
    const mediaSecs = (lead > 0 ? vEnd - vStart : aEnd - aStart) / 1e6;
    const entries: EditEntry[] = [{ segment: Math.abs(lead) / 1e6, mediaTime: -1, rate: 1 }, { segment: mediaSecs, mediaTime: 0, rate: 1 }];
    blob = await patchEdits(blob, new Map([[lateId, entries]]));
  }
  return { blob, frames: total, plan, meta, audioOut: !!a };
}

export type DisplayMatrix = [number, number, number, number, number, number, number, number, number];
export interface VideoMeta {

  rotationMatrix: DisplayMatrix | null;

  frameEdits: boolean;

  audioBytes: number | null;
}

export const matrixOf = (m?: ArrayLike<number>): DisplayMatrix | null =>
  m && m.length >= 9 && (m[0] || m[1] || m[3] || m[4]) ? [m[0] / 65536, m[1] / 65536, m[2] / 2 ** 30, m[3] / 65536, m[4] / 65536, m[5] / 2 ** 30, m[6] / 65536, m[7] / 65536, m[8] / 2 ** 30] : null;

export const shiftScaled = (m: DisplayMatrix, kw: number, kh: number): DisplayMatrix => {
  const turned = Math.abs(m[0]) < 0.5;
  return [m[0], m[1], m[2], m[3], m[4], m[5], m[6] * (turned ? kh : kw), m[7] * (turned ? kw : kh), m[8]];
};

export const sameTurn = (x: DisplayMatrix | null, y: DisplayMatrix | null) => {
  const p = x ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const q = y ?? [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return [0, 1, 3, 4].every((i) => Math.abs(p[i] - q[i]) < 1e-3);
};
