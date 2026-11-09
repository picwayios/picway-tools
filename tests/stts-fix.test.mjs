import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { createFile, MP4BoxBuffer } from 'mp4box';
import { fixLastSampleDuration, patchLastDuration, sampleDurations } from '../packages/core/src/sttsfix.ts';

const AVCC = new Uint8Array([1, 0x64, 0, 0x1e, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1e, 1, 0, 4, 0x68, 0xee, 0x3c, 0x80]);

function mux(durUs) {
  const target = new ArrayBufferTarget();
  const m = new Muxer({ target, video: { codec: 'avc', width: 16, height: 16 }, fastStart: false, firstTimestampBehavior: 'offset' });
  let t = 0;
  durUs.forEach((d, i) => {
    m.addVideoChunkRaw(new Uint8Array([0, 0, 0, 1, 0x65, i]), i === 0 ? 'key' : 'delta', t, d, i === 0 ? { decoderConfig: { codec: 'avc1.64001e', codedWidth: 16, codedHeight: 16, description: AVCC } } : undefined);
    t += d;
  });
  m.finalize();
  return new Uint8Array(target.buffer);
}

function readBack(bytes) {
  const f = createFile();
  let info = null;
  f.onReady = (i) => (info = i);
  f.appendBuffer(MP4BoxBuffer.fromArrayBuffer(bytes.slice().buffer, 0));
  f.flush();
  const v = info.videoTracks[0];
  return { durs: sampleDurations(moovOf(bytes).moov).map((x) => Math.round(x * 1e6)), track: Math.round((v.duration * 1e6) / v.timescale), n: v.nb_samples };
}
const moovOf = (b) => {
  for (let p = 0; p < b.length; ) {
    const size = ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0;
    if (String.fromCharCode(...b.subarray(p + 4, p + 8)) === 'moov') return { at: p, moov: b.subarray(p, p + size) };
    p += size;
  }
  return null;
};
const patch = (b) => {
  const { at, moov } = moovOf(b);
  const next = fixLastSampleDuration(moov.slice());
  const out = new Uint8Array(at + next.length);
  out.set(b.subarray(0, at));
  out.set(next, at);
  return out;
};

for (const [name, durs] of [
  ['last frame longer than the one before (GIF holds the last frame 0.2 s)', [50_000, 120_000, 100_000, 200_000]],
  ['last frame shorter than the one before, after a long run of equal ones', [40_000, 40_000, 300_000, 100_000, 20_000, 100_000, 500_000, 60_000]],
  ['a long run apart from the last two equal frames', [100_000, 100_000, 100_000, 100_000, 30_000]],
  ['only the last entry, with a single frame, needs a fix', [100_000, 200_000, 300_000]],
]) {
  test(`stts patch: ${name}`, () => {
    const raw = mux(durs);
    const before = readBack(raw);
    assert.equal(before.track, durs.reduce((a, d) => a + d, 0), 'mdhd duration is already correct');
    assert.notEqual(before.durs.at(-1), durs.at(-1), 'before patching, the last frame copies the previous frame’s delta (the mp4-muxer approach; if it changes this test, this test should change too)');
    const after = readBack(patch(raw));
    assert.deepEqual(after.durs, durs, 'per-frame durations match what was written');
    assert.equal(after.n, durs.length);
  });
}

test('stts patch: when all durations are equal, returns the input unchanged (no copy, no modification)', () => {
  const raw = mux([100_000, 100_000, 100_000]);
  const { moov } = moovOf(raw);
  assert.equal(fixLastSampleDuration(moov), moov);
  assert.deepEqual(readBack(raw).durs, [100_000, 100_000, 100_000]);
});

test('patchLastDuration: patches the moov at the end of a Blob; throws when moov is not at the end or the input is not MP4', async () => {
  const raw = mux([50_000, 120_000, 100_000, 200_000]);
  const fixed = new Uint8Array(await (await patchLastDuration(new Blob([raw]))).arrayBuffer());
  assert.deepEqual(readBack(fixed).durs, [50_000, 120_000, 100_000, 200_000]);
  const { at, moov } = moovOf(raw);
  const front = new Uint8Array(raw.length);
  front.set(moov, 0);
  front.set(raw.subarray(0, at), moov.length);
  await assert.rejects(patchLastDuration(new Blob([front])), /stts-fix-failed/);
  await assert.rejects(patchLastDuration(new Blob([new TextEncoder().encode('not an mp4 file at all')])), /stts-fix-failed/);
});
