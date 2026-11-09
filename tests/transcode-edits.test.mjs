import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFile, ISOFile, MP4BoxBuffer } from 'mp4box';
import { planAudio, planVideo, visibleWindows } from '../packages/core/src/editwindow.ts';
import { withEditLists } from '../packages/core/src/editlist.ts';
import { transcode } from '../packages/core/src/transcode.ts';

const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const ff = (...a) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...a]);
const probeJson = (p, args) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-of', 'json', ...args, p]).toString());

function installStubs() {
  const log = { decoded: [], encoded: [], framesOpen: 0, maxOpen: 0 };
  globalThis.EncodedVideoChunk = class { constructor(i) { Object.assign(this, i); this.byteLength = i.data.byteLength; } copyTo(d) { d.set(this.data); } };
  globalThis.VideoFrame = class {
    constructor(src, init) { this.timestamp = init.timestamp; this.duration = init.duration ?? null; log.framesOpen++; log.maxOpen = Math.max(log.maxOpen, log.framesOpen); }
    close() { log.framesOpen--; }
  };
  globalThis.VideoDecoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor(i) { this.out = i.output; this.pending = []; this.state = 'unconfigured'; this.decodeQueueSize = 0; }
    configure() { this.state = 'configured'; }

    decode(chunk) { if (chunk.type === 'key') this.drain(); this.pending.push(chunk); log.decoded.push({ ts: chunk.timestamp, type: chunk.type }); }
    drain() { for (const c of this.pending.sort((a, b) => a.timestamp - b.timestamp)) { const f = new VideoFrame(null, { timestamp: c.timestamp, duration: c.duration }); this.out(f); } this.pending = []; }
    async flush() { this.drain(); }
    close() { this.state = 'closed'; }
  };
  globalThis.VideoEncoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor(i) { this.out = i.output; this.first = true; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure(c) { this.cfg = c; this.state = 'configured'; }
    encode(frame, o) {
      log.encoded.push({ ts: frame.timestamp, key: !!o?.keyFrame });
      const data = new Uint8Array([0, 0, 0, 4, 0x65, 1, 2, 3]);
      const chunk = new EncodedVideoChunk({ type: o?.keyFrame ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration ?? 33333, data });
      this.out(chunk, this.first ? { decoderConfig: { codec: this.cfg.codec, codedWidth: this.cfg.width, codedHeight: this.cfg.height, description: AVCC } } : undefined);
      this.first = false;
    }
    async flush() {}
    close() { this.state = 'closed'; }
  };
  return log;
}

const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);

async function readOut(blob) {
  const mp4 = createFile();
  const out = { video: [], audio: [], info: null };
  mp4.onReady = (info) => { out.info = info; for (const t of info.tracks) mp4.setExtractionOptions(t.id, t.type, { nbSamples: 1e6 }); mp4.start(); };
  mp4.onSamples = (id, _t, samples) => { const isV = out.info.videoTracks.some((t) => t.id === id); for (const s of samples) (isV ? out.video : out.audio).push({ cts: s.cts / s.timescale, dur: s.duration / s.timescale }); };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await blob.arrayBuffer(), 0));
  mp4.flush();
  return out;
}
const run = async (path, extra = {}) => {
  const log = installStubs();
  const bytes = readFileSync(path);
  const r = await transcode(new File([bytes], 'x.mp4'), { preset: 'balanced', maxLong: 0, signal: new AbortController().signal, onProgress: () => {}, ...extra });
  return { log, r, out: await readOut(r.blob) };
};

function makeSources() {
  const cols = ['red', 'green', 'blue', 'yellow', 'white', 'magenta', 'cyan', 'orange'];
  const v = cols.map((c, i) => `color=c=${c}:s=320x240:r=30:d=0.25[v${i}]`).join(';');
  const a = cols.map((_, i) => `sine=f=${440 * (i + 1)}:d=0.25:r=44100[a${i}]`).join(';');
  const vc = cols.map((_, i) => `[v${i}]`).join('') + `concat=n=8:v=1:a=0[v]`;
  const ac = cols.map((_, i) => `[a${i}]`).join('') + `concat=n=8:v=0:a=1[a]`;
  ff('-filter_complex', `${v};${a};${vc};${ac}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-g', '30', '-bf', '2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', join(dir, 'src.mp4'));

  ff('-ss', '1.6', '-i', join(dir, 'src.mp4'), '-t', '0.9', '-c', 'copy', join(dir, 'trim.mp4'));
}
if (ffmpegOk) makeSources();
const visibleVideoFrames = (p) => Number(probeJson(p, ['-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames']).streams[0].nb_read_frames);
const rawVideoSamples = (p) => Number(probeJson(p, ['-count_packets', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_packets']).streams[0].nb_read_packets);
const audioDuration = (p) => Number(probeJson(p, ['-select_streams', 'a:0', '-show_entries', 'stream=duration']).streams[0].duration);
const T = { skip: ffmpegOk ? false : 'no ffmpeg' };

test('sample precondition: trim.mp4 contains hidden leading frames (raw sample count > visible frame count)', T, () => {
  const vis = visibleVideoFrames(join(dir, 'trim.mp4'));
  const raw = rawVideoSamples(join(dir, 'trim.mp4'));
  assert.ok(raw - vis >= 8, `raw ${raw} samples, ${vis} visible frames; the trimmed part should be cut off`);
});

test('trimmed video transcode outputs only the elst visible range (frame count = ffprobe visible frames, starting at 0, with no trimmed-off frames)', T, async () => {
  const p = join(dir, 'trim.mp4');
  const want = visibleVideoFrames(p);
  const { log, out } = await run(p);
  assert.equal(log.encoded.length, want, `encoded ${log.encoded.length} frames, visible range is ${want} frames`);
  assert.equal(out.video.length, want);
  assert.equal(log.encoded[0].ts, 0, 'first frame at 0');
  const ts = log.encoded.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), 'timestamps increase');
  assert.ok(Math.abs(ts.at(-1) / 1e6 + 1 / 30 - want / 30) < 0.01, 'frame intervals are continuous; total length = visible frames / 30');
  assert.ok(log.decoded.length > want, 'trimmed leading frames are decoded only as references, not output');
  assert.equal(log.framesOpen, 0, 'all decoded frames are closed');
});

test('audio copies only samples in the visible range (total duration matches the visible range, not the whole track)', T, async () => {
  const p = join(dir, 'trim.mp4');
  const want = audioDuration(p);
  const { out } = await run(p);
  const aTotal = out.audio.reduce((n, s) => n + s.dur, 0);
  const rawTotal = Number(probeJson(p, ['-count_packets', '-select_streams', 'a:0', '-show_entries', 'stream=nb_read_packets']).streams[0].nb_read_packets) * 1024 / 44100;
  assert.ok(Math.abs(aTotal - want) < 0.05, `audio ${aTotal.toFixed(3)} s, visible range ${want.toFixed(3)} s`);
  assert.ok(rawTotal - aTotal > 0.15, `original audio track ${rawTotal.toFixed(3)} s, trimmed part not brought back`);
});

test('Result.frames = output video frame count = ffprobe visible frames (the caller mov-to-mp4 uses it to verify output; previously it was checked against the total sample count of the original, so trimmed MOVs failed validation)', T, async () => {
  for (const name of ['trim.mp4', 'src.mp4']) {
    const { r, out } = await run(join(dir, name));
    assert.equal(r.frames, visibleVideoFrames(join(dir, name)), name);
    assert.equal(out.video.length, r.frames, name);
  }
});

function patchElstMediaTime(bytes, trackIndex, mediaTime) {
  const out = Uint8Array.from(bytes);
  let seen = -1;
  for (let i = 4; i + 28 < out.length; i++) {
    if (out[i] === 0x65 && out[i + 1] === 0x6c && out[i + 2] === 0x73 && out[i + 3] === 0x74 && ++seen === trackIndex) {
      new DataView(out.buffer).setInt32(i + 16, mediaTime);
      return out;
    }
  }
  throw new Error('no elst');
}
const runBytes = async (bytes) => {
  const log = installStubs();
  const r = await transcode(new File([bytes], 'x.mp4'), { preset: 'balanced', maxLong: 0, signal: new AbortController().signal, onProgress: () => {} });
  return { log, r, out: await readOut(r.blob) };
};

test('edge case: the elst range contains no frames at all, so report edit-unsupported and do not output an empty video', T, async () => {
  await assert.rejects(runBytes(patchElstMediaTime(readFileSync(join(dir, 'trim.mp4')), 0, 2_000_000)), /edit-unsupported/);
});

test('edge case: no samples in the visible audio range, so do not declare an empty audio track; video output proceeds as usual', T, async () => {
  const { log, out, r } = await runBytes(patchElstMediaTime(readFileSync(join(dir, 'trim.mp4')), 1, 2_000_000_000));
  assert.equal(log.encoded.length, visibleVideoFrames(join(dir, 'trim.mp4')));
  assert.equal(out.audio.length, 0);
  assert.equal(out.info.audioTracks.length, 0, 'output has no audio track');
  assert.ok(r.frames > 0);
});

test('page source anchor: the mov-to-mp4 re-encode path checks frame count with r.frames instead of the original nb_samples', () => {
  const src = readFileSync(new URL('../tools/mov-to-mp4/main.ts', import.meta.url), 'utf8');
  assert.match(src, /const srcFrames = r\.frames;/);
  assert.doesNotMatch(src, /videoTracks\[0\]\.nb_samples/);
});

test('control: an untrimmed video (src.mp4) behaves the same: all frames, all audio', T, async () => {
  const p = join(dir, 'src.mp4');
  const { log, out } = await run(p);
  assert.equal(log.encoded.length, visibleVideoFrames(p));
  assert.equal(out.video.length, visibleVideoFrames(p));
  assert.ok(Math.abs(out.audio.reduce((n, s) => n + s.dur, 0) - audioDuration(p)) < 0.06);

  const packets = Number(probeJson(p, ['-count_packets', '-select_streams', 'a:0', '-show_entries', 'stream=nb_read_packets']).streams[0].nb_read_packets);
  assert.equal(out.audio.length, packets, `audio samples ${out.audio.length} / original ${packets}`);
  assert.ok(out.audio.every((s, i, a) => i === 0 || Math.abs(s.cts - (a[i - 1].cts + a[i - 1].dur)) < 1e-3), 'audio sample timestamps are continuous');
});

test('fragmented MP4 (fMP4): the sample table is only complete after reading later fragments; do not filter by table, transcode as usual (no crash, no lost samples)', T, async () => {
  ff('-i', join(dir, 'src.mp4'), '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov', join(dir, 'frag.mp4'));
  const { log, out } = await run(join(dir, 'frag.mp4'));
  assert.equal(log.encoded.length, visibleVideoFrames(join(dir, 'src.mp4')));
  assert.ok(out.audio.length > 80);
});

function injectElst(bytes, entries) {
  const size = new DataView(bytes.buffer, bytes.byteOffset).getUint32(0);
  const ftyp = bytes.subarray(0, size);
  const moovSize = new DataView(bytes.buffer, bytes.byteOffset + size).getUint32(0);
  const moov = bytes.subarray(size, size + moovSize);
  const next = withEditLists(moov, new Map([[1, entries]]));
  const out = new Uint8Array(bytes.length - moov.length + next.length);
  out.set(ftyp, 0); out.set(next, size); out.set(bytes.subarray(size + moovSize), size + next.length);
  return out;
}
test('fragmented MP4 with a trimmed elst (gap segments / multiple segments): report edit-unsupported and do not silently bring trimmed content back; a single offset-type elst is allowed', T, async () => {
  ff('-i', join(dir, 'src.mp4'), '-c', 'copy', '-movflags', 'frag_keyframe+empty_moov', join(dir, 'frag.mp4'));
  const frag = new Uint8Array(readFileSync(join(dir, 'frag.mp4')));
  await assert.rejects(runBytes(injectElst(frag, [{ segment: 0.5, mediaTime: -1, rate: 1 }, { segment: 1.0, mediaTime: 0.5, rate: 1 }])), /edit-unsupported/);
  await assert.rejects(runBytes(injectElst(frag, [{ segment: 0.5, mediaTime: 0, rate: 1 }, { segment: 0.5, mediaTime: 1, rate: 1 }])), /edit-unsupported/);
  const { log } = await runBytes(injectElst(frag, [{ segment: 2, mediaTime: 0.0667, rate: 1 }]));
  assert.equal(log.encoded.length, 64, 'single offset-type elst: transcode the whole file as usual');
});

test('visibleWindows / planVideo / planAudio: multiple segments, gap segments, open-GOP leading frames, unsupported cases', () => {

  assert.equal(visibleWindows(undefined, 1000, 30), null);
  assert.equal(visibleWindows([], 1000, 30), null);

  const w = visibleWindows([{ segment_duration: 1000, media_time: 30 }, { segment_duration: 500, media_time: -1 }, { segment_duration: 1000, media_time: 120 }], 1000, 30);
  assert.deepEqual(w.map((x) => [x.start, x.end, x.out]), [[30, 60, 0], [120, 150, 1.5]]);

  const samples = Array.from({ length: 200 }, (_, i) => ({ cts: i, dts: i, duration: 1, is_sync: i % 10 === 0 }));
  const p = planVideo(samples, w, 30);
  assert.equal(p.out.size, 60);
  assert.equal(p.out.get(Math.round(30 * 1e6 / 30)), 0);
  assert.equal(p.out.get(Math.round(120 * 1e6 / 30)), 1.5e6);
  assert.equal(p.feed[29], 0); assert.equal(p.feed[30], 1); assert.equal(p.feed[59], 1); assert.equal(p.feed[60], 0);
  assert.equal(p.feed[119], 0); assert.equal(p.feed[120], 1); assert.equal(p.feed[149], 1); assert.equal(p.feed[150], 0);

  const mid = planVideo(samples, visibleWindows([{ segment_duration: 500, media_time: 45 }], 1000, 30), 30);
  assert.equal(mid.feed[39], 0); assert.equal(mid.feed[40], 1); assert.equal(mid.feed[44], 1);
  assert.equal(mid.out.size, 15);
  assert.equal(mid.out.has(Math.round(44 * 1e6 / 30)), false, 'frame 44 is only used as a reference');

  const asmp = Array.from({ length: 100 }, (_, i) => ({ cts: i * 1024, dts: i * 1024, duration: 1024, is_sync: true }));
  const keep = planAudio(asmp, visibleWindows([{ segment_duration: 1000, media_time: 10240 + 300 }], 1000, 44100), 44100);
  const idx = [...keep.keys()];

  assert.equal(idx[0], 9, 'preroll samples');
  assert.equal(keep.get(9), 0);
  assert.equal(keep.get(10), Math.round(1024 / 44100 * 1e6), 'continuous from the preroll samples on');
  assert.ok(Math.abs((idx.length - 1) * 1024 / 44100 - 1.0) < 0.03);

  const neg = planAudio(Array.from({ length: 10 }, (_, i) => ({ cts: i * 1024, dts: i * 1024, duration: 1024, is_sync: true })), visibleWindows([{ segment_duration: 100, media_time: 2112 }], 1000, 44100), 44100);
  assert.equal(neg.get(1), 0, 'sample 2 is the first one kept, sample 1 is preroll, continuous from 0');
  assert.equal(neg.get(2), Math.round(1024 / 44100 * 1e6));
  assert.ok([...neg.values()].every((t) => t >= 0), 'no negative timestamps');

  const gap = planAudio(Array.from({ length: 10 }, (_, i) => ({ cts: i * 1024, dts: i * 1024, duration: 1024, is_sync: true })), visibleWindows([{ segment_duration: 500, media_time: -1 }, { segment_duration: 100, media_time: 2112 }], 1000, 44100), 44100);
  assert.equal(gap.get(1), 500000);

  const head = planAudio(Array.from({ length: 10 }, (_, i) => ({ cts: i * 1024, dts: i * 1024, duration: 1024, is_sync: true })), visibleWindows([{ segment_duration: 100, media_time: 0 }], 1000, 44100), 44100);
  assert.equal(head.get(0), 0);

  assert.equal(visibleWindows([{ segment_duration: 1234, media_time: 0 }, { segment_duration: 1000, media_time: 54419 }], 1000, 44100).length, 2);

  assert.throws(() => visibleWindows([{ segment_duration: 1000, media_time: 300 }, { segment_duration: 1000, media_time: 0 }], 1000, 30), /edit-unsupported/);
  assert.throws(() => visibleWindows([{ segment_duration: 1000, media_time: -1 }], 1000, 30), /edit-unsupported/);
  assert.throws(() => visibleWindows([{ segment_duration: 1000, media_time: 0, media_rate_integer: 0 }], 1000, 30), /edit-unsupported/);
  assert.throws(() => visibleWindows([{ segment_duration: 1000, media_time: 0 }, { segment_duration: 1000, media_time: 10 }], 1000, 30), /edit-unsupported/);
});

test('open GOP: when leading frames that display earlier come after a sync sample, step back one more sync sample', () => {

  const s = [];
  for (let i = 0; i < 8; i++) s.push({ cts: i, dts: i, duration: 1, is_sync: i === 0 });
  s.push({ cts: 10, dts: 8, duration: 1, is_sync: true }, { cts: 8, dts: 9, duration: 1, is_sync: false }, { cts: 9, dts: 10, duration: 1, is_sync: false }, { cts: 13, dts: 11, duration: 1, is_sync: false });
  const p = planVideo(s, visibleWindows([{ segment_duration: 1000, media_time: 8 }], 1000, 1), 1);
  assert.equal(p.feed[0], 1, 'decode from sync sample 0 before it so leading frames have references');
  assert.equal(p.feed[8], 1);
});

test('long audio track: AAC samples are released as processing progresses (after each file chunk is fed, the sample bytes mp4box holds stay small and reach 0 at the end)', T, async () => {

  ff('-f', 'lavfi', '-i', 'color=c=blue:s=160x120:r=5:d=400', '-f', 'lavfi', '-i', 'anoisesrc=d=400:c=pink:r=44100:a=0.2', '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-ac', '2', '-t', '400', join(dir, 'long.mp4'));
  const p = join(dir, 'long.mp4');
  const audioBytes = readFileSync(p).length;
  const peaks = [];
  let inst = null;
  const origStart = ISOFile.prototype.start;
  const origAppend = ISOFile.prototype.appendBuffer;
  ISOFile.prototype.start = function (...a) { inst ??= this; return origStart.apply(this, a); };

  ISOFile.prototype.appendBuffer = function (...a) { if (inst === this) peaks.push(this.samplesDataSize); return origAppend.apply(this, a); };
  try {
    await run(p);
  } finally {
    ISOFile.prototype.start = origStart;
    ISOFile.prototype.appendBuffer = origAppend;
  }
  const left = inst.samplesDataSize;
  assert.ok(audioBytes > 1e7, `sample file ${audioBytes} bytes`);
  assert.equal(left, 0, `at the end mp4box still holds ${left} bytes of sample data (86 AAC samples, 16080 bytes, were never released)`);
  assert.ok(peaks.length >= 2, `file should be fed in more than two chunks (${peaks.length})`);
  assert.ok(Math.max(0, ...peaks) < audioBytes * 0.05, `peak between chunks ${Math.max(0, ...peaks)} bytes, whole audio track ${audioBytes} bytes`);
});

const startTimes = async (blob, name) => {
  const p = join(dir, name);
  writeFileSync(p, Buffer.from(await blob.arrayBuffer()));
  const j = probeJson(p, ['-show_entries', 'stream=codec_type,start_time,duration']);
  const by = (t) => j.streams.find((s) => s.codec_type === t);
  return { v: Number(by('video')?.start_time), a: by('audio') ? Number(by('audio').start_time) : null, vd: Number(by('video')?.duration) };
};
function makeOffsetSources() {
  const lav = ['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=2', '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=44100'];
  const enc = ['-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac'];

  ff('-itsoffset', '0.5', ...lav.slice(0, 4), ...lav.slice(4), ...enc, join(dir, 'vlate.mov'));

  ff(...lav.slice(0, 4), '-itsoffset', '0.5', ...lav.slice(4), ...enc, join(dir, 'alate.mov'));

  ff('-ss', '0.2', '-i', join(dir, 'vlate.mov'), '-c', 'copy', join(dir, 'vlate-cut.mov'));
}
if (ffmpegOk) makeOffsetSources();
const approx = (x, y, msg, tol = 0.04) => assert.ok(Math.abs(x - y) < tol, `${msg}: ${x} vs ${y}`);

test('sample precondition: start offset ffprobe sees in the original (video starts 0.5 s late / audio starts 0.5 s late)', T, () => {
  const s = (p, t) => Number(probeJson(join(dir, p), ['-show_entries', 'stream=codec_type,start_time']).streams.find((x) => x.codec_type === t).start_time);
  approx(s('vlate.mov', 'video') - s('vlate.mov', 'audio'), 0.5, 'vlate');
  approx(s('alate.mov', 'audio') - s('alate.mov', 'video'), 0.5, 'alate');
});

async function elstOf(blob) {
  const mp4 = createFile();
  let info;
  mp4.onReady = (i) => (info = i);
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await blob.arrayBuffer(), 0));
  mp4.flush();
  const one = (t) => (mp4.getTrackById(t.id).edts?.elst?.entries ?? []).map((e) => ({ seg: e.segment_duration / info.timescale, mediaTime: e.media_time }));
  return { v: one(info.videoTracks[0]), a: one(info.audioTracks[0]), total: info.duration / info.timescale };
}
test('video starts 0.5 s after audio (empty edit at the start of the video track): in the output the video still starts 0.5 s after audio, not reset to zero', T, async () => {
  const { r } = await run(join(dir, 'vlate.mov'));
  const t = await startTimes(r.blob, 'o-vlate.mp4');
  approx(t.v - t.a, 0.5, 'video should start 0.5 s after audio');
  const fmt = (q) => Number(probeJson(q, ['-show_entries', 'format=duration']).format.duration);
  approx(fmt(join(dir, 'o-vlate.mp4')), fmt(join(dir, 'vlate.mov')), 'total duration matches the original (including the leading 0.5 s)', 0.02);
  approx(t.a, 0, 'the earliest track starts at 0');
  const el = await elstOf(r.blob);
  assert.equal(el.a.length, 0, 'the earlier track gets no elst');
  assert.equal(el.v.length, 2, 'later track: empty edit + media');
  assert.equal(el.v[0].mediaTime, -1);
  approx(el.v[0].seg, 0.5, 'empty edit is 0.5 s');
  approx(el.v[1].seg, 2.0, 'media edit = full video length, 2 s', 0.012);
  approx(el.total, 2.5, 'mvhd total duration', 0.012);
});

test('audio starts 0.5 s after video: in the output audio still starts 0.5 s after video', T, async () => {
  const { r } = await run(join(dir, 'alate.mov'));
  const t = await startTimes(r.blob, 'o-alate.mp4');
  approx(t.a - t.v, 0.5, 'audio should start 0.5 s after video');
  const fmt = (q) => Number(probeJson(q, ['-show_entries', 'format=duration']).format.duration);
  approx(fmt(join(dir, 'o-alate.mp4')), fmt(join(dir, 'alate.mov')), 'total duration matches the original (including the audio’s leading 0.5 s)', 0.02);
  approx(t.v, 0, 'the earliest track starts at 0');
});

test('empty edit plus trim (video 0.3 s late): relative offset matches the original, first-frame time is correct', T, async () => {
  const p = join(dir, 'vlate-cut.mov');
  const want = probeJson(p, ['-show_entries', 'stream=codec_type,start_time']).streams;
  const w = (ty) => Number(want.find((x) => x.codec_type === ty).start_time);
  const { r, log } = await run(p);
  const t = await startTimes(r.blob, 'o-vlate-cut.mp4');
  approx(t.v - t.a, w('video') - w('audio'), 'start offset matches the original');
  assert.ok(log.encoded.length > 0 && log.encoded[0].ts > 0, 'the first frame sent to the encoder is not at 0 on the movie timeline (it carries the empty-edit position)');
});

test('control: a normal file where both tracks start at 0: start offset still 0', T, async () => {
  const { r } = await run(join(dir, 'src.mp4'));
  const t = await startTimes(r.blob, 'o-plain.mp4');
  approx(t.v, 0, 'video start');
  approx(t.a, 0, 'audio start');
});

test('page source anchor: transcode adds elst to keep the two-track offset; the muxer policy for remux and GIF to MP4 is unchanged', () => {
  const rd = (f) => readFileSync(new URL('../packages/core/src/' + f, import.meta.url), 'utf8');
  assert.match(rd('transcode.ts'), /patchEdits\(blob, new Map\(\[\[lateId, entries\]\]\)\)/, 'transcode with audio: the muxer zeroes each track, and the relative start of the two tracks is kept by adding elst');
  assert.match(rd('remux.ts'), /firstTimestampBehavior: 'offset'/, 'after remux, patchEdits restores the two-track offset from the original elst');
  assert.match(rd('gifmp4.ts'), /firstTimestampBehavior: 'offset'/, 'GIF to MP4 has only one video track, so there is no relative offset to lose');
});

test('lowMemory (write as you go, moov at the end) plus video 0.5 s late: start offset and total duration are preserved the same way', T, async () => {
  const { r } = await run(join(dir, 'vlate.mov'), { lowMemory: true });
  const t = await startTimes(r.blob, 'o-vlate-low.mp4');
  approx(t.v - t.a, 0.5, 'video should start 0.5 s after audio');
  const fmt = (q) => Number(probeJson(q, ['-show_entries', 'format=duration']).format.duration);
  approx(fmt(join(dir, 'o-vlate-low.mp4')), fmt(join(dir, 'vlate.mov')), 'total duration matches the original', 0.02);
});

test('long file (hundreds of thousands of samples) does not overflow the stack: takes the minimum without Math.min(...spread)', () => {
  assert.doesNotMatch(readFileSync(new URL('../packages/core/src/transcode.ts', import.meta.url), 'utf8'), /Math\.min\(\.\.\./);
});

test('two tracks of different lengths (video 0.5 s late, video 1.2 s, audio 2 s): total duration and the end of each track match the original', T, async () => {
  ff('-itsoffset', '0.5', '-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=1.2', '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=44100', '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'vshort.mov'));
  const { r, out: parsed } = await run(join(dir, 'vshort.mov'));
  const t = await startTimes(r.blob, 'o-vshort.mp4');
  const end = (p, ty) => { const s = probeJson(p, ['-show_entries', 'stream=codec_type,start_time,duration']).streams.find((x) => x.codec_type === ty); return Number(s.start_time) + Number(s.duration); };
  const src = join(dir, 'vshort.mov');
  const out = join(dir, 'o-vshort.mp4');
  approx(t.v - t.a, 0.5, 'video should start 0.5 s after audio');
  approx(end(out, 'video'), end(src, 'video'), 'video end', 0.04);
  approx(end(out, 'audio'), end(src, 'audio'), 'audio end', 0.04);

  approx(parsed.info.duration / parsed.info.timescale, 2.0, 'mvhd total duration = audio, 2 s');
});

test('audio 0.5 s late and longer than video (video 1.2 s, audio 2 s): audio end and mvhd total duration match the original', T, async () => {
  ff('-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30:d=1.2', '-itsoffset', '0.5', '-f', 'lavfi', '-i', 'sine=f=440:d=2:r=44100', '-c:v', 'libx264', '-g', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(dir, 'along.mov'));
  const { r } = await run(join(dir, 'along.mov'));
  const t = await startTimes(r.blob, 'o-along.mp4');
  const end = (p, ty) => { const s = probeJson(p, ['-show_entries', 'stream=codec_type,start_time,duration']).streams.find((x) => x.codec_type === ty); return Number(s.start_time) + Number(s.duration); };
  approx(t.a - t.v, 0.5, 'audio should start 0.5 s after video');
  approx(end(join(dir, 'o-along.mp4'), 'audio'), end(join(dir, 'along.mov'), 'audio'), 'audio end', 0.04);
  const el = await elstOf(r.blob);
  assert.equal(el.a.length, 2);
  approx(el.a[1].seg, 2.0, 'audio media edit = full audio length (not the video’s 1.2 s)', 0.04);
});
