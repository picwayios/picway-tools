import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createFile, MP4BoxBuffer } from 'mp4box';
import { makeReorder, reorderDepth } from '../packages/core/src/reorder.ts';
import { transcode } from '../packages/core/src/transcode.ts';

// Some WebKit builds output decoded H.264 frames with B-frames in decode order instead of
// display order. These tests cover the reorder buffer, transcode() with a decoder stub that
// behaves that way, and the failure path when the muxer rejects a chunk.

// One unit = one frame. Decode order I0 P3 B1 B2 P6 B4 B5 ... has display times 0 3 1 2 6 4 5 ...
const DECODE_ORDER = [0, 3, 1, 2, 6, 4, 5, 9, 7, 8];
test('reorderDepth: 0 without B-frames, 1 for I P B B, 2 for pyramid B-frames, looks back at most cap frames', () => {
  assert.equal(reorderDepth([0, 1, 2, 3, 4]), 0);
  assert.equal(reorderDepth([]), 0);
  assert.equal(reorderDepth(DECODE_ORDER), 1);
  assert.equal(reorderDepth([0, 4, 2, 1, 3, 8, 6, 5, 7]), 2);
  assert.equal(reorderDepth([0, 5, 4, 3, 2, 1]), 4, 'worst case: fully reversed');
  assert.equal(reorderDepth([0, 9, 8, 7, 6, 5, 4, 3, 2, 1], 3), 3, 'frames beyond cap are not counted');
});
test('makeReorder: decode-order input comes out in display order, with no frame lost when depth is enough', () => {
  for (const order of [DECODE_ORDER, [0, 4, 2, 1, 3, 8, 6, 5, 7]]) {
    const out = [];
    const r = makeReorder((x) => out.push(x.timestamp), reorderDepth(order));
    for (const t of order) r.push({ timestamp: t });
    r.flush();
    assert.deepEqual(out, [...order].sort((a, b) => a - b));
  }
  const small = [];
  const r0 = makeReorder((x) => small.push(x.timestamp), 0);
  for (const t of DECODE_ORDER) r0.push({ timestamp: t });
  assert.notDeepEqual(small, [...DECODE_ORDER].sort((a, b) => a - b), 'control: depth 0 passes the order through unchanged');
});
test('makeReorder: depth 0 passes frames straight through', () => {
  const out = [];
  const r = makeReorder((x) => out.push(x.timestamp), 0);
  r.push({ timestamp: 1 });
  assert.deepEqual(out, [1]);
});
test('makeReorder: depth only grows; drop() takes the frames not yet released', () => {
  const out = [];
  const r = makeReorder((x) => out.push(x.timestamp), 1);
  r.depth = 0;
  assert.equal(r.depth, 1);
  r.depth = 3;
  assert.equal(r.depth, 3);
  r.push({ timestamp: 5 }); r.push({ timestamp: 4 });
  assert.deepEqual(out, []);
  assert.deepEqual(r.drop().map((x) => x.timestamp), [4, 5]);
  r.flush();
  assert.deepEqual(out, []);
});

const ffmpegOk = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const T = { skip: ffmpegOk ? false : 'no ffmpeg' };
const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
const SRC = join(dir, 'bframes.mp4');
const NFRAMES = 60;
if (ffmpegOk) execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'mandelbrot=s=160x120:r=30', '-frames:v', String(NFRAMES), '-c:v', 'libx264', '-bf', '2', '-g', '30', '-crf', '23', '-pix_fmt', 'yuv420p', SRC]);

const AVCC = Uint8Array.from([1, 0x64, 0, 0x28, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x28, 1, 0, 2, 0x68, 0xee]);
// mode 'decode-order': the decoder outputs each frame as soon as it gets it (the WebKit behaviour);
// mode 'display-order': the decoder outputs in display order, as the WebCodecs spec says.
function installStubs(mode, encoderOut = (chunk) => chunk) {
  const log = { encoded: [], open: 0, uncaught: [] };
  globalThis.EncodedVideoChunk = class { constructor(i) { Object.assign(this, i); this.byteLength = i.data.byteLength; } copyTo(d) { d.set(this.data); } };
  globalThis.VideoFrame = class {
    constructor(_src, init) { this.timestamp = init.timestamp; this.duration = init.duration ?? null; log.open++; }
    close() { log.open--; }
  };
  globalThis.VideoDecoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor(i) { this.out = i.output; this.pending = []; this.state = 'unconfigured'; this.decodeQueueSize = 0; }
    configure() { this.state = 'configured'; }
    decode(c) {
      if (mode === 'decode-order') return void this.out(new VideoFrame(null, { timestamp: c.timestamp, duration: c.duration }));
      if (c.type === 'key') this.drain();
      this.pending.push(c);
    }
    drain() { for (const c of this.pending.sort((a, b) => a.timestamp - b.timestamp)) this.out(new VideoFrame(null, { timestamp: c.timestamp, duration: c.duration })); this.pending = []; }
    async flush() { this.drain(); }
    close() { this.state = 'closed'; }
  };
  globalThis.VideoEncoder = class {
    static async isConfigSupported() { return { supported: true }; }
    constructor(i) { this.out = i.output; this.first = true; this.state = 'unconfigured'; this.encodeQueueSize = 0; }
    configure(c) { this.cfg = c; this.state = 'configured'; }
    encode(frame, o) {
      log.encoded.push(frame.timestamp);
      const chunk = new EncodedVideoChunk({ type: o?.keyFrame ? 'key' : 'delta', timestamp: frame.timestamp, duration: frame.duration ?? 33333, data: new Uint8Array([0, 0, 0, 4, 0x65, 1, 2, 3]) });
      try {
        this.out(encoderOut(chunk), this.first ? { decoderConfig: { codec: this.cfg.codec, codedWidth: this.cfg.width, codedHeight: this.cfg.height, description: AVCC } } : undefined);
      } catch (e) {
        log.uncaught.push(e);
      }
      this.first = false;
    }
    async flush() {}
    close() { this.state = 'closed'; }
  };
  return log;
}
const run = (extra = {}) => transcode(new File([readFileSync(SRC)], 'x.mp4'), { preset: 'balanced', maxLong: 0, signal: new AbortController().signal, onProgress: () => {}, ...extra });
async function countSamples(blob) {
  const mp4 = createFile();
  let n = 0, info = null;
  mp4.onReady = (i) => { info = i; mp4.setExtractionOptions(i.videoTracks[0].id, null, { nbSamples: 1e6 }); mp4.start(); };
  mp4.onSamples = (_id, _u, s) => { n += s.length; };
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await blob.arrayBuffer(), 0));
  mp4.flush();
  return { n, info };
}

test('fixture: the generated clip really has B-frames (display order differs from decode order)', T, async () => {
  const mp4 = createFile();
  const cts = [];
  mp4.onReady = (i) => { mp4.setExtractionOptions(i.videoTracks[0].id, null, { nbSamples: 1e6 }); mp4.start(); };
  mp4.onSamples = (_id, _u, s) => cts.push(...s.map((x) => x.cts));
  mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(readFileSync(SRC).buffer.slice(0), 0));
  mp4.flush();
  assert.equal(cts.length, NFRAMES);
  assert.ok(reorderDepth(cts) >= 1, 'some frames must be decoded later but shown earlier');
});

test('decoder outputs in decode order: the encoder gets increasing timestamps, every frame, and the file has every frame', T, async () => {
  const log = installStubs('decode-order');
  const r = await run();
  assert.equal(log.encoded.length, NFRAMES);
  assert.deepEqual(log.encoded, [...log.encoded].sort((a, b) => a - b), 'timestamps sent to the encoder increase');
  assert.equal(new Set(log.encoded).size, NFRAMES, 'no duplicates');
  assert.equal(r.frames, NFRAMES);
  assert.equal((await countSamples(r.blob)).n, NFRAMES, 'output frame count equals the source frame count');
  assert.equal(log.open, 0, 'every frame is closed, including those left in the buffer');
  assert.equal(log.uncaught.length, 0, 'the muxer rejected no chunk');
});

test('decoder outputs in display order: the result is the same as above', T, async () => {
  const a = installStubs('decode-order');
  const ra = await run();
  const b = installStubs('display-order');
  const rb = await run();
  assert.deepEqual(a.encoded, b.encoded);
  assert.equal(ra.blob.size, rb.blob.size);
  assert.equal(b.open, 0);
});

test('muxer rejects a chunk whose timestamp goes back: transcode fails instead of returning a file with missing frames', T, async () => {
  const log = installStubs('display-order', (chunk) => { chunk.timestamp = chunk.timestamp % 3 ? chunk.timestamp : 0; return chunk; });
  await assert.rejects(run(), /monotonically increasing|Timestamps/);
  assert.ok(log.uncaught.length === 0, 'transcode catches the error itself; it does not escape the output callback');
});

const ROOT = new URL('../', import.meta.url).pathname;
const toolDirs = readdirSync(join(ROOT, 'tools')).filter((d) => existsSync(join(ROOT, 'tools', d, 'main.ts')));
test('tool UI text never suggests using the PicWay app now (all languages)', () => {
  for (const d of toolDirs) {
    for (const f of ['main.ts', 'strings.ts']) {
      const p = join(ROOT, 'tools', d, f);
      if (!existsSync(p)) continue;
      const bad = readFileSync(p, 'utf8').match(/PicWay app|PicWay App|PicWay アプリ|PicWay 应用|拾映 ?App|拾映 ?アプリ/g);
      assert.equal(bad, null, `tools/${d}/${f}: ${bad}`);
    }
  }
});
test('compress video checks the output (frame count, size, rotation) before offering it, in all 4 languages', () => {
  const page = readFileSync(join(ROOT, 'tools/compress-video/main.ts'), 'utf8');
  assert.match(page, /verifyOutput\(r\.blob, \{ kind: 'avc', w: r\.plan\.w, h: r\.plan\.h, frames: r\.frames, turn: r\.meta\.rotationMatrix \}\)/);
  assert.match(page, /if \(!ok\) return void \(msg\.textContent = t\('verifyFail'\)\)/);
  const all = page + readFileSync(join(ROOT, 'tools/compress-video/strings.ts'), 'utf8');
  assert.equal(all.match(/checking: '/g).length, 4);
  assert.equal(all.match(/verifyFail: '/g).length, 4);
});
test('compress video README privacy section uses the same sentence as the other video tools', () => {
  const sentence = 'This page has no server that receives your video.';
  const sec = readFileSync(join(ROOT, 'tools/compress-video/README.md'), 'utf8').split('## Privacy')[1].split('\n## ')[0];
  assert.ok(sec.includes(sentence));
  assert.ok(readFileSync(join(ROOT, 'tools/video-to-gif/README.md'), 'utf8').includes(sentence), 'video-to-gif wording changed; keep them in sync');
});
