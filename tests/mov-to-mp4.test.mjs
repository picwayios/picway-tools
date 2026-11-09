import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { createFile, MP4BoxBuffer } from 'mp4box';
import { BlobSink } from '../packages/core/src/blobsink.ts';
import { edtsBox, moovInfo, patchEdits, sourceEdits, topBox, withEditLists } from '../packages/core/src/editlist.ts';
import { containerOf, copyKind, probeCopy, remux, verifyOutput, verifyRemux } from '../packages/core/src/remux.ts';
import { planEncode } from '../packages/core/src/videoplan.ts';
import { matrixOf, open, sameTurn, shiftScaled } from '../packages/core/src/transcode.ts';

const FX = new URL('./fixtures/video/', import.meta.url);
const fx = (name) => new File([readFileSync(new URL(name, FX))], name);
const opts = () => ({ signal: new AbortController().signal, onProgress: () => {} });

async function samplesOf(blob) {
  const mp4 = createFile();
  const out = { info: null, video: [], audio: [], mp4 };
  mp4.onReady = (info) => {
    out.info = info;
    for (const t of info.tracks) mp4.setExtractionOptions(t.id, t.type, { nbSamples: 100000 });
    mp4.start();
  };
  mp4.onSamples = (id, type, samples) => {
    const list = type === 'video' || out.info.videoTracks.some((t) => t.id === id) ? out.video : out.audio;
    for (const s of samples) list.push({ dts: s.dts / s.timescale, cts: s.cts / s.timescale, key: s.is_sync, size: s.size, hash: createHash('sha1').update(s.data).digest('hex') });
  };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await blob.arrayBuffer(), 0));
  mp4.flush();
  return out;
}
const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

test('BlobSink: sequential writes, rewriting the start, writes across chunks, and out-of-order writes produce output byte-identical to writing into one big array', async () => {
  const ref = new Uint8Array(64);
  const sink = new BlobSink();
  const put = (bytes, pos) => {
    const d = Uint8Array.from(bytes);
    ref.set(d, pos);
    sink.write(d, pos);
  };
  put([1, 2, 3, 4, 5, 6, 7, 8], 0);
  put([9, 9, 9, 9, 9, 9, 9, 9, 9, 9], 8);
  put([7, 7, 7, 7], 30);
  put([0xaa, 0xbb], 2);
  put([0xcc, 0xdd, 0xee, 0xff], 6);
  put([0x11], 31);
  const got = new Uint8Array(await sink.toBlob('x/y').arrayBuffer());
  assert.equal(sink.size, 34);
  assert.deepEqual([...got], [...ref.subarray(0, 34)]);
});

test('containerOf: MOV / MP4 / not a video; copyKind only accepts H.264 and HEVC', async () => {
  assert.equal(await containerOf(fx('h264-aac.mov')), 'mov');
  assert.equal(await containerOf(fx('h264.mp4')), 'mp4');
  assert.equal(await containerOf(fx('not-video.mov')), null);
  assert.equal(copyKind('avc1.64001e'), 'avc');
  assert.equal(copyKind('hvc1.1.6.L60.90'), 'hevc');
  assert.equal(copyKind('dvh1.08.04'), 'hevc');
  assert.equal(copyKind('apcn'), null);
  assert.equal(copyKind('apco'), null);
});

for (const [name, audio] of [['h264-aac.mov', true], ['hevc-aac.mov', true], ['h264-pcm.mov', false], ['h264-silent.mov', false], ['h264.mp4', false]]) {
  test(`remux ${name}: frame count, codec and per-frame timing (including B-frame order) match the original, audio ${audio ? 'kept as is' : 'none'}, output is MP4`, async () => {
    const src = fx(name);
    const r = await remux(src, opts());
    assert.ok(await verifyRemux(r), 'verifyRemux');
    const a = await samplesOf(src);
    const b = await samplesOf(r.blob);
    assert.equal(b.video.length, a.video.length);
    assert.equal(b.info.videoTracks[0].codec.slice(0, 4), a.info.videoTracks[0].codec.slice(0, 4));
    const t0a = a.video[0].dts;
    const t0b = b.video[0].dts;
    for (let i = 0; i < a.video.length; i++) {
      assert.ok(Math.abs(b.video[i].cts - t0b - (a.video[i].cts - t0a)) < 0.002, `frame ${i} display time`);
      assert.equal(b.video[i].key, a.video[i].key, `frame ${i} keyframe flag`);
      assert.equal(b.video[i].size, a.video[i].size, `frame ${i} data size`);
      assert.equal(b.video[i].hash, a.video[i].hash, `frame ${i} data byte-identical`);
    }
    assert.equal(b.info.audioTracks.length, audio ? 1 : 0);
    if (audio) {
      assert.equal(b.audio.length, a.audio.length);
      const a0 = a.audio[0].dts;
      const b0 = b.audio[0].dts;
      for (let i = 0; i < a.audio.length; i++) {
        assert.ok(Math.abs(b.audio[i].cts - b0 - (a.audio[i].cts - a0)) < 0.001, `audio segment ${i} time`);
        assert.equal(b.audio[i].hash, a.audio[i].hash, `audio segment ${i} data byte-identical`);
      }
    }

    for (const [ta, tb, la, lb] of [[a.info.videoTracks[0], b.info.videoTracks[0], a.video, b.video], ...(audio ? [[a.info.audioTracks[0], b.info.audioTracks[0], a.audio, b.audio]] : [])]) {
      const ea = sourceEdits(a.mp4.getTrackById(ta.id), a.info.timescale, ta.timescale, la[0].dts * ta.timescale);
      const eb = sourceEdits(b.mp4.getTrackById(tb.id), b.info.timescale, tb.timescale, lb[0].dts * tb.timescale);
      assert.equal(eb.length, ea.length, `${ta.type ?? ''} edit list entry count`);
      ea.forEach((e, i) => {
        assert.ok(Math.abs(eb[i].segment - e.segment) < 0.002, `segment ${i} length ${eb[i].segment} vs ${e.segment}`);
        assert.ok(Math.abs(eb[i].mediaTime - e.mediaTime) < 0.001, `segment ${i} media start ${eb[i].mediaTime} vs ${e.mediaTime}`);
        assert.equal(eb[i].rate, e.rate);
      });
    }

    assert.ok(Math.abs(b.info.duration / b.info.timescale - a.info.duration / a.info.timescale) < 0.01, `mvhd duration ${b.info.duration / b.info.timescale} vs ${a.info.duration / a.info.timescale}`);
    const tk = (i, t) => t.movie_duration / i.timescale;
    assert.ok(Math.abs(tk(b.info, b.info.videoTracks[0]) - tk(a.info, a.info.videoTracks[0])) < 0.01, `video tkhd duration ${tk(b.info, b.info.videoTracks[0])} vs ${tk(a.info, a.info.videoTracks[0])}`);
    const head = new Uint8Array(await r.blob.slice(0, 12).arrayBuffer());
    assert.equal(String.fromCharCode(...head.subarray(4, 8)), 'ftyp');
    assert.notEqual(String.fromCharCode(...head.subarray(8, 12)), 'qt  ');
    assert.equal(await containerOf(r.blob), 'mp4');
  });
}

test('remux keeps portrait rotation; location and date metadata from the MOV are not written to the new file', async () => {
  const src = fx('h264-aac.mov');
  assert.ok(readFileSync(new URL('h264-aac.mov', FX)).includes('ISO6709'), 'the sample itself carries a location');
  const r = await remux(src, opts());
  assert.equal(r.meta.rotation !== 0, true, 'the sample itself is rotated');
  const b = await samplesOf(r.blob);
  const m = b.info.videoTracks[0].matrix;
  const rot = ((Math.round((Math.atan2(m[1] / 65536, m[0] / 65536) * 180) / Math.PI / 90) * 90) % 360 + 360) % 360;
  assert.equal(rot, r.meta.rotation);
  const bytes = Buffer.from(await r.blob.arrayBuffer());
  assert.ok(!bytes.includes('ISO6709'), 'location was not carried over');
  assert.ok(!bytes.includes('creationdate'), 'date key was not carried over');
});

test('edit list: the generated elst can be read back by mp4box, trak / moov lengths match after inserting into moov, tracks that already have edts are not inserted again', async () => {
  const r = await remux(fx('h264-silent.mov'), opts());
  const m = await topBox(r.blob, 'moov');
  assert.ok(m && m.at + m.size === r.blob.size, 'moov at end of file');
  const moov = new Uint8Array(await r.blob.slice(m.at).arrayBuffer());
  const info = moovInfo(moov);
  assert.equal(info.tracks.length, 1);
  assert.equal(info.tracks[0].id, 1, 'mp4-muxer video track number is 1');
  const box = edtsBox([{ segment: 1.5, mediaTime: 0.1, rate: 1 }, { segment: 0.25, mediaTime: -1, rate: 1 }], info.movieScale, info.tracks[0].scale);
  assert.equal(box.length, 8 + 16 + 24);

  assert.equal(withEditLists(moov, new Map([[1, [{ segment: 1, mediaTime: 0, rate: 1 }]]])), moov);

  const edts = (() => { for (let p = 0; p + 8 <= moov.length; p++) if (String.fromCharCode(...moov.subarray(p + 4, p + 8)) === 'edts') return p; return -1; })();
  assert.ok(edts > 0, 'the patched file has edts');
  const esz = new DataView(moov.buffer, moov.byteOffset).getUint32(edts);
  const bare = new Uint8Array(moov.length - esz);
  bare.set(moov.subarray(0, edts));
  bare.set(moov.subarray(edts + esz), edts);
  const dv = new DataView(bare.buffer);
  dv.setUint32(0, bare.length);
  const trak = info.tracks[0].at;
  dv.setUint32(trak, dv.getUint32(trak) - esz);
  const patched = withEditLists(bare, new Map([[1, [{ segment: 1.5, mediaTime: 0.1, rate: 1 }, { segment: 0.25, mediaTime: -1, rate: 1 }]]]));
  const blob = new Blob([await r.blob.slice(0, m.at).arrayBuffer(), patched]);
  const s = await samplesOf(blob);
  assert.equal(s.video.length, 60, 'after inserting, all frames can still be read in full');
  const e = sourceEdits(s.mp4.getTrackById(1), s.info.timescale, s.info.videoTracks[0].timescale, 0);
  assert.equal(e.length, 2);
  assert.ok(Math.abs(e[0].segment - 1.5) < 0.002 && Math.abs(e[0].mediaTime - 0.1) < 0.001 && e[1].mediaTime === -1);

  assert.equal(await patchEdits(r.blob, new Map()), r.blob);
  const tail = new Blob([r.blob, new Uint8Array([0, 0, 0, 8, 0x66, 0x72, 0x65, 0x65])]);
  const noEdts = new Blob([await r.blob.slice(0, m.at).arrayBuffer(), bare]);
  await assert.rejects(patchEdits(noEdts, new Map([[3, [{ segment: 1, mediaTime: 0, rate: 1 }]]])), /edit-patch-failed/, 'track number mismatch, nothing patched: throws an error');
  await assert.rejects(patchEdits(tail, new Map([[1, [{ segment: 1, mediaTime: 0, rate: 1 }]]])), /edit-patch-failed/, 'moov not at end: throws an error, does not silently return a file without an edit list');
});

test('audio and video start times: each track start_time read by ffprobe matches the original (B-frame video and AAC preroll aligned by the edit list; runs only if ffmpeg is installed locally)', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
  const st = (p) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim().split('\n').map((l) => l.replace(/,$/, ''));
  try {
    for (const name of ['h264-aac.mov', 'hevc-aac.mov', 'h264-silent.mov', 'h264.mp4']) {
      const r = await remux(fx(name), opts());
      const p = join(dir, name + '.mp4');
      writeFileSync(p, Buffer.from(await r.blob.arrayBuffer()));
      assert.deepEqual(st(p), st(fileURLToPath(new URL(name, FX))), name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ProRes cannot go into MP4 unchanged: reads the header first and reports copy-unsupported and the codec name; not a video: reports not-mp4', async () => {
  await assert.rejects(probeCopy(fx('prores.mov')), /copy-unsupported:ap/);
  await assert.rejects(probeCopy(fx('not-video.mov')), /not-mp4/);
  assert.equal((await probeCopy(fx('hevc-aac.mov'))).hevc, true);
  await assert.rejects(remux(fx('not-video.mov'), opts()), /not-mp4/);
});

test('cancel: when the signal is already aborted, throws AbortError and returns no result', async () => {
  const c = new AbortController();
  c.abort();
  await assert.rejects(remux(fx('h264-aac.mov'), { signal: c.signal, onProgress: () => {} }), (e) => e.name === 'AbortError');
});

test('verifyRemux: a frame count mismatch or an empty file fails the check', async () => {
  const r = await remux(fx('h264-aac.mov'), opts());
  assert.equal(await verifyRemux({ ...r, frames: r.frames - 1 }), false);
  assert.equal(await verifyRemux({ ...r, blob: new Blob([]) }), false);
  assert.equal(await verifyRemux({ ...r, blob: r.blob.slice(0, 2000) }), false);

  const ok = { kind: 'avc', w: r.meta.w, h: r.meta.h, frames: r.srcFrames, turn: r.meta.rotationMatrix };
  assert.equal(await verifyOutput(r.blob, ok), true);
  assert.equal(await verifyOutput(r.blob, { ...ok, frames: r.srcFrames + 1 }), false, 'missing frames');
  assert.equal(await verifyOutput(r.blob, { ...ok, frames: r.srcFrames - 1 }), false, 'extra frames also fail (re-encoding the same frames gives a one-to-one match)');
  assert.equal(await verifyOutput(r.blob, { ...ok, kind: 'hevc' }), false, 'wrong codec');
  assert.equal(await verifyOutput(r.blob, { ...ok, w: r.meta.w + 2 }), false, 'wrong size');
  assert.equal(await verifyOutput(r.blob, { ...ok, turn: null }), false, 'wrong display orientation (original rotated 90°, a non-rotated one is rejected)');
});

const MIRRORS = [
  ['h264-hflip.mp4', [-1, 0, 0, 1]],
  ['h264-vflip.mov', [1, 0, 0, -1]],
  ['h264-rot90-hflip.mov', [0, -1, -1, 0]],
];
for (const [name, abcd] of MIRRORS) {
  test(`mirror ${name}: copy keeps the full display matrix as-is, and the check also looks at display orientation`, async () => {
    const r = await remux(fx(name), opts());
    const turn = (m) => [m[0], m[1], m[3], m[4]];
    assert.deepEqual(turn(r.meta.rotationMatrix), abcd, 'matrix read from the original');
    const { meta } = await open(new File([r.blob], 'out.mp4'), false);
    assert.deepEqual(turn(meta.rotationMatrix), abcd, 'the new file’s matrix matches the original (not rotated 180°)');
    assert.equal(await verifyRemux(r), true);
    const ok = { kind: 'avc', w: r.meta.w, h: r.meta.h, frames: r.srcFrames, turn: r.meta.rotationMatrix };
    assert.equal(await verifyOutput(r.blob, { ...ok, turn: null }), false, 'feeding in a non-mirrored file must fail the check');
    assert.equal(await verifyOutput(r.blob, { ...ok, turn: [-1, 0, 0, 0, -1, 0, 0, 0, 1] }), false, 'feeding in a 180° rotated file must fail the check');
  });
}

test('mirror: the display matrix read by ffmpeg, and the first frame after applying the matrix, match the original pixel for pixel (runs only if ffmpeg is installed locally)', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
  try {
    for (const [name] of MIRRORS) {
      const src = fileURLToPath(new URL(name, FX));
      const r = await remux(fx(name), opts());
      const p = join(dir, name + '.mp4');
      writeFileSync(p, Buffer.from(await r.blob.arrayBuffer()));
      const dm = (f) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream_side_data=displaymatrix', '-of', 'csv=p=0', f], { encoding: 'utf8' }).replace(/\s+/g, ' ').trim();
      assert.equal(dm(p), dm(src), `${name} display matrix`);
      const first = (f) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
      const a = first(src);
      const b = first(p);
      assert.ok(a.length > 0 && a.equals(b), `${name} first frame once upright`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('convert re-encode preset: HEVC to H.264 bitrate is higher than the original (same picture needs more bitrate), H.264 source bitrate not lowered, cap 40 Mbps', () => {
  const hevc = planEncode({ w: 1920, h: 1080, bitrate: 10_000_000, fps: 30, hevc: true }, 'convert', 0);
  assert.equal(hevc.bitrate, 16_000_000);
  assert.deepEqual([hevc.w, hevc.h], [1920, 1080]);
  assert.equal(planEncode({ w: 3840, h: 2160, bitrate: 45_000_000, fps: 60, hevc: true }, 'convert', 0).bitrate, 40_000_000);
  assert.ok(planEncode({ w: 1920, h: 1080, bitrate: 8_000_000, fps: 30, hevc: false }, 'convert', 0).bitrate >= 8_000_000);

  assert.equal(planEncode({ w: 1920, h: 1080, bitrate: 10_000_000, fps: 30, hevc: true }, 'balanced', 0).bitrate, 9_000_000);
});

test('ffmpeg can fully decode the remuxed file (runs only if ffmpeg is installed locally)', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
  try {
    for (const name of ['h264-aac.mov', 'hevc-aac.mov', 'h264-pcm.mov', 'h264-silent.mov', 'h264.mp4']) {
      const r = await remux(fx(name), opts());
      const p = join(dir, name + '.mp4');
      writeFileSync(p, Buffer.from(await r.blob.arrayBuffer()));

      const run = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', p, '-f', 'null', '-'], { encoding: 'utf8' });
      assert.equal(run.status, 0, name);
      assert.equal(run.stderr.trim(), '', name);
      const n = execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', p], { encoding: 'utf8' }).trim().replace(/,$/, '');
      assert.equal(n, '60', name);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('large file (generated with ffmpeg at runtime, over 16 MB, moov at the end, read in 8 MB chunks across several reads): frame count, per-frame bytes and audio segment count match the original, ffmpeg decodes without errors', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-big-'));
  try {
    const p = join(dir, 'big.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4,noise=alls=20:allf=t', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-qp', '0', '-bf', '0', '-c:a', 'aac', '-shortest', '-f', 'mov', p]);
    const src = new File([readFileSync(p)], 'big.mov');
    assert.ok(src.size > 16 * 1024 * 1024, `sample ${src.size} bytes`);
    let calls = 0;
    const r = await remux(src, { signal: new AbortController().signal, onProgress: () => calls++ });
    assert.ok(calls >= 3, 'read in chunks at least three times');
    assert.ok(await verifyRemux(r));
    const a = await samplesOf(src);
    const b = await samplesOf(r.blob);
    assert.equal(b.video.length, 120);
    assert.deepEqual(b.video.map((x) => x.hash), a.video.map((x) => x.hash));
    assert.equal(b.audio.length, a.audio.length);
    const o = join(dir, 'big.mp4');
    writeFileSync(o, Buffer.from(await r.blob.arrayBuffer()));
    const run = spawnSync('ffmpeg', ['-v', 'error', '-xerror', '-i', o, '-f', 'null', '-'], { encoding: 'utf8' });
    assert.equal(run.status, 0);
    assert.equal(run.stderr.trim(), '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('re-encoded files on iPhone / iPad are held in memory: H.264 is not offered when the estimated size is over 300 MB (convertTooBig in mov-to-mp4.ts uses this)', async () => {
  const { LIMIT_IOS, convertBytes, estimateBytes } = await import('../packages/core/src/videoplan.ts');

  const big = { w: 3840, h: 2160, bitrate: 40_000_000, fps: 60, hevc: true, duration: 90 };
  assert.equal(convertBytes(big), estimateBytes(planEncode(big, 'convert', 0), 90));
  assert.ok(convertBytes(big) > LIMIT_IOS, `${convertBytes(big)}`);
  assert.ok(convertBytes({ ...big, duration: 20 }) < LIMIT_IOS, 'a 20-second video of the same kind is allowed');

  const hd = { w: 1920, h: 1080, bitrate: 10_000_000, fps: 30, hevc: true };
  assert.ok(convertBytes({ ...hd, duration: 120 }) < LIMIT_IOS);
  assert.ok(convertBytes({ ...hd, duration: 180 }) > LIMIT_IOS);
  assert.equal(estimateBytes({ bitrate: 8_000_000 }, 10), Math.ceil((8_256_000 * 10) / 8));
});

test('ProRes is recognized by name without reading the whole file: with moov at the end, skip the whole mdat to the position mp4box asks for (mdat grows to 40 MB, only the start and moov are read)', async () => {
  const raw = readFileSync(new URL('prores.mov', FX));

  assert.equal(raw.toString('latin1', 32, 36), 'mdat');
  const mdatSize = raw.readUInt32BE(28);
  const pad = Buffer.alloc(40 * 1024 * 1024);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(mdatSize + pad.length, 0);
  head.write('mdat', 4, 'latin1');
  const f = new File([raw.subarray(0, 28), head, pad, raw.subarray(36)], 'big-prores.mov');
  const slice = f.slice.bind(f);
  let read = 0;
  f.slice = (a = 0, b = f.size) => {
    read += Math.min(b, f.size) - a;
    return slice(a, b);
  };
  await assert.rejects(probeCopy(f), /copy-unsupported:ap/);
  assert.ok(read < 20 * 1024 * 1024, `read ${read} bytes`);
});

test('cancel midway: stops halfway through reading, throws AbortError, returns no result', async () => {
  const c = new AbortController();
  const pad = Buffer.alloc(20 * 1024 * 1024);
  pad.writeUInt32BE(pad.length, 0);
  pad.write('free', 4, 'latin1');
  const big = new File([readFileSync(new URL('h264-aac.mov', FX)), pad], 'x.mov');
  let calls = 0;
  await assert.rejects(remux(big, { signal: c.signal, onProgress: () => { if (++calls === 1) c.abort(); } }), (e) => e.name === 'AbortError');
  assert.equal(calls, 1, 'no further reads after abort');
});

test('trimmed clip (elst segment length shorter than media duration): edit list and file header durations both match the original (runs only if ffmpeg is installed locally)', { skip: !ffmpegOk && 'ffmpeg not installed' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'picway-test-cut-'));
  try {
    const p = join(dir, 'cut.mov');
    execFileSync('ffmpeg', ['-v', 'error', '-ss', '0.5', '-t', '1', '-i', fileURLToPath(new URL('h264-aac.mov', FX)), '-c', 'copy', '-f', 'mov', p]);
    const src = new File([readFileSync(p)], 'cut.mov');
    const r = await remux(src, opts());
    assert.ok(await verifyRemux(r));
    const a = await samplesOf(src);
    const b = await samplesOf(r.blob);
    assert.ok(Math.abs(b.info.duration / b.info.timescale - a.info.duration / a.info.timescale) < 0.01, `mvhd ${b.info.duration / b.info.timescale} vs ${a.info.duration / a.info.timescale}`);
    for (const k of ['videoTracks', 'audioTracks']) {
      const ta = a.info[k][0];
      const tb = b.info[k][0];
      assert.ok(Math.abs(tb.movie_duration / b.info.timescale - ta.movie_duration / a.info.timescale) < 0.01, `${k} tkhd ${tb.movie_duration / b.info.timescale} vs ${ta.movie_duration / a.info.timescale}`);
    }
    const o = join(dir, 'cut.mp4');
    writeFileSync(o, Buffer.from(await r.blob.arrayBuffer()));

    const st = (f) => execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration', '-of', 'csv=p=0', f], { encoding: 'utf8' }).trim().split('\n').map((l) => l.split(',').filter(Boolean));
    const [so, sp] = [st(o), st(p)];
    assert.equal(so.length, sp.length);
    so.forEach((row, i) => {
      assert.equal(row[0], sp[i][0]);
      for (const k of [1, 2]) assert.ok(Math.abs(Number(row[k]) - Number(sp[i][k])) < 0.002, `${row[0]} ${k === 1 ? 'start' : 'duration'} ${row[k]} vs ${sp[i][k]}`);
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('matrixOf / shiftScaled / sameTurn: fixed-point conversion, an all-zero matrix counts as no matrix; translation scales per axis (at 90° the x axis follows the encoded height); only rotation / mirror parts are compared', () => {
  const Q = 65536, W = 2 ** 30;
  assert.deepEqual(matrixOf([-Q, 0, 0, 0, Q, 0, 160 * Q, 0, W]), [-1, 0, 0, 0, 1, 0, 160, 0, 1]);
  assert.equal(matrixOf([0, 0, 0, 0, 0, 0, 0, 0, 0]), null);
  assert.equal(matrixOf(undefined), null);
  assert.deepEqual(shiftScaled([-1, 0, 0, 0, 1, 0, 1001, 0, 1], 800 / 1001, 800 / 1000), [-1, 0, 0, 0, 1, 0, 800, 0, 1]);
  assert.deepEqual(shiftScaled([0, 1, 0, -1, 0, 0, 1000, 0, 1], 800 / 1001, 800 / 1000), [0, 1, 0, -1, 0, 0, 800, 0, 1]);
  assert.equal(sameTurn(null, [1, 0, 0, 0, 1, 0, 0, 0, 1]), true);
  assert.equal(sameTurn([-1, 0, 0, 0, 1, 0, 160, 0, 1], [-1, 0, 0, 0, 1, 0, 0, 0, 1]), true, 'translation is not compared');
  assert.equal(sameTurn([-1, 0, 0, 0, 1, 0, 0, 0, 1], [-1, 0, 0, 0, -1, 0, 0, 0, 1]), false, 'a horizontal mirror is not the same as a 180° turn');
});
