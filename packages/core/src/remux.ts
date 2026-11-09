import { createFile, MP4BoxBuffer } from 'mp4box';
import { Muxer, StreamTarget } from 'mp4-muxer';
import { BlobSink } from './blobsink.ts';
import { patchEdits, sourceEdits, type EditEntry } from './editlist.ts';
import { aacConfig, descriptionOf, open, probe, sameTurn, type DisplayMatrix, type VideoMeta } from './transcode.ts';

type AnyBox = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const CHUNK = 8 * 1024 * 1024;

export const copyKind = (codec: string): 'avc' | 'hevc' | null => (/^(avc1|avc3)/.test(codec) ? 'avc' : /^(hvc1|hev1|dvh1|dvhe)/.test(codec) ? 'hevc' : null);

export async function containerOf(file: Blob): Promise<'mov' | 'mp4' | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const tag = (o: number) => String.fromCharCode(...b.subarray(o, o + 4));
  if (b.length < 12) return null;
  if (tag(4) === 'ftyp') return tag(8) === 'qt  ' ? 'mov' : 'mp4';
  return ['moov', 'mdat', 'wide', 'free', 'skip'].includes(tag(4)) ? 'mov' : null;
}

export async function probeCopy(file: File): Promise<VideoMeta> {
  try {
    return await probe(file);
  } catch (e) {
    if (!(e instanceof Error) || e.message !== 'no-video') throw e;
    const mp4: AnyBox = createFile();
    let info: AnyBox = null;
    mp4.onReady = (i: unknown) => (info = i);

    for (let pos = 0; !info && pos < file.size; ) {
      const ab = await file.slice(pos, pos + CHUNK).arrayBuffer();
      const next = mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
      pos = typeof next === 'number' && next > pos ? next : pos + ab.byteLength;
    }
    const other = (info?.tracks ?? []).find((t: AnyBox) => t.type !== 'audio' && /^ap(4h|4x|cn|cs|co|ch)/.test(t.codec ?? ''));
    throw other ? new Error('copy-unsupported:' + other.codec) : e;
  }
}

export interface RemuxResult {
  blob: Blob;
  meta: VideoMeta;

  frames: number;
  srcFrames: number;
}

export async function remux(file: File, o: { signal: AbortSignal; onProgress: (done: number, total: number) => void }): Promise<RemuxResult> {
  const { mp4, info, meta } = await open(file, true);
  const v = info.videoTracks[0];
  const kind = copyKind(v.codec);
  if (!kind) throw new Error('copy-unsupported:' + v.codec);
  const a = meta.audioKept ? info.audioTracks[0] : undefined;
  const sink = new BlobSink();
  const muxer = new Muxer({
    target: new StreamTarget({ onData: (data, pos) => sink.write(data, pos), chunked: true }),
    video: { codec: kind, width: v.video.width, height: v.video.height, rotation: meta.rotationMatrix ?? 0 },
    ...(a ? { audio: { codec: 'aac' as const, numberOfChannels: a.audio.channel_count, sampleRate: a.audio.sample_rate } } : {}),
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  const description = descriptionOf(mp4, v.id);
  const videoMeta: EncodedVideoChunkMetadata = { decoderConfig: { codec: v.codec, codedWidth: v.video.width, codedHeight: v.video.height, ...(description ? { description } : {}) } };
  const asc = a ? aacConfig(mp4, a.id) : undefined;
  const audioMeta: EncodedAudioChunkMetadata | undefined = a ? { decoderConfig: { codec: a.codec, numberOfChannels: a.audio.channel_count, sampleRate: a.audio.sample_rate, ...(asc ? { description: asc } : {}) } } : undefined;
  const us = (t: number, scale: number) => Math.round((t * 1e6) / scale);

  const vq: AnyBox[] = [];
  const aq: AnyBox[] = [];
  mp4.onSamples = (id: number, _u: unknown, samples: AnyBox[]) => (id === v.id ? vq : aq).push(...samples);
  mp4.setExtractionOptions(v.id, null, { nbSamples: 100 });
  if (a) mp4.setExtractionOptions(a.id, null, { nbSamples: 100 });
  mp4.start();

  let frames = 0;
  let firstAudio = true;
  let vDts0: number | undefined;
  let aDts0: number | undefined;
  const drain = () => {

    while (vq.length) {
      const s = vq.shift();
      const cts = us(s.cts, s.timescale);
      vDts0 ??= s.dts;
      muxer.addVideoChunkRaw(new Uint8Array(s.data), s.is_sync ? 'key' : 'delta', cts, us(s.duration, s.timescale), frames === 0 ? videoMeta : undefined, cts - us(s.dts, s.timescale));
      frames++;
      mp4.releaseUsedSamples(v.id, s.number + 1);
    }
    while (aq.length) {
      const s = aq.shift();
      aDts0 ??= s.cts;
      muxer.addAudioChunkRaw(new Uint8Array(s.data), s.is_sync ? 'key' : 'delta', us(s.cts, s.timescale), us(s.duration, s.timescale), firstAudio ? audioMeta : undefined);
      firstAudio = false;
      if (a) mp4.releaseUsedSamples(a.id, s.number + 1);
    }
  };
  let pos = 0;
  while (pos < file.size) {
    if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const ab = await file.slice(pos, pos + CHUNK).arrayBuffer();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(ab, pos));
    pos += ab.byteLength;
    drain();
    o.onProgress(pos, file.size);
  }
  mp4.flush();
  drain();
  if (o.signal.aborted) throw new DOMException('aborted', 'AbortError');
  muxer.finalize();

  const edits = new Map<number, EditEntry[]>();
  const elstOf = (id: number, scale: number, dts0: number | undefined) => (dts0 === undefined ? [] : sourceEdits(mp4.getTrackById(id) ?? {}, info.timescale, scale, dts0));
  edits.set(1, elstOf(v.id, v.timescale, vDts0));
  if (a) edits.set(2, elstOf(a.id, a.timescale, aDts0));
  const blob = await patchEdits(sink.toBlob('video/mp4'), edits);
  return { blob, meta, frames, srcFrames: v.nb_samples };
}

export async function verifyOutput(out: Blob, want: { kind: 'avc' | 'hevc'; w: number; h: number; frames: number; turn: DisplayMatrix | null }): Promise<boolean> {
  if (!out.size || want.frames < 1) return false;
  try {
    const { info, meta } = await open(out as File, false);
    const n = info.videoTracks[0].nb_samples;
    return n === want.frames && copyKind(meta.codec) === want.kind && meta.w === want.w && meta.h === want.h && sameTurn(meta.rotationMatrix, want.turn);
  } catch {
    return false;
  }
}
export const verifyRemux = (r: RemuxResult) =>
  r.frames === r.srcFrames ? verifyOutput(r.blob, { kind: copyKind(r.meta.codec) ?? 'avc', w: r.meta.w, h: r.meta.h, frames: r.srcFrames, turn: r.meta.rotationMatrix }) : Promise.resolve(false);

export async function probeFrames(file: File): Promise<VideoMeta> {
  const m = await probeCopy(file);
  if (!m.frameEdits) throw new Error('edit-unsupported');
  return m;
}
