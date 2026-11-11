import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { isIosEnv } from '../packages/core/src/platform.ts';
import { assertDecodable, asMemoryError, hardPixels, isMemoryError, maxPixels, peekSize } from '../packages/core/src/pixelplan.ts';
import { ERR_CODES, REASONS, errCode } from '../packages/core/src/errcode.ts';
import { buildZip, makeZip, makeZipBlob, ZIP_LIMIT_DESKTOP, ZIP_LIMIT_IOS, zipLimit, zipTooBig } from '../packages/core/src/zip.ts';
import { makeLatest } from '../packages/core/src/latest.ts';
import { S as ZIP_S } from '../packages/core/src/zipstrings.ts';

// Decoding limits, iPad in desktop mode, batch ZIPs, place search order and the WebCodecs check.
// Synthetic samples only; no network.
const ROOT = new URL('../', import.meta.url);
const core = (m) => readFileSync(new URL(`packages/core/src/${m}.ts`, ROOT), 'utf8');
const toolPath = (slug) => new URL(`tools/${slug}/main.ts`, ROOT);
const tool = (slug) => readFileSync(toolPath(slug), 'utf8');
const hasTool = (slug) => existsSync(toolPath(slug));
const allTools = readdirSync(new URL('tools/', ROOT)).filter(hasTool);
const IPAD_DESKTOP = ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 5, 'MacIntel'];

test('isIosEnv: iPhone, iPad and iPad in desktop mode count; a real Mac and a touch Windows PC do not', () => {
  assert.equal(isIosEnv('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 5, 'iPhone'), true);
  assert.equal(isIosEnv('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, 'iPad'), true);
  assert.equal(isIosEnv(...IPAD_DESKTOP), true);
  assert.equal(isIosEnv(IPAD_DESKTOP[0], 0, 'MacIntel'), false);
  assert.equal(isIosEnv('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 10, 'Win32'), false);
});
test('image decoding and the video tools use the shared isIOS() instead of their own user-agent check', () => {
  for (const m of ['convert', 'heic']) {
    assert.ok(core(m).includes('isIOS()'), m);
    assert.ok(!/\/iPhone\|iPad\|iPod\/\.test/.test(core(m)), `${m} still has its own user-agent check`);
  }
  for (const s of allTools) assert.ok(!/const isIos = /.test(tool(s)), `${s} still has its own isIos`);
  for (const s of ['compress-gif', 'mov-to-mp4', 'compress-video', 'extract-frames-from-video', 'gif-to-mp4', 'video-to-gif', 'compress-video-to-size'].filter(hasTool)) {
    assert.ok(tool(s).includes("from '@picway-tools/core/platform.ts'"), s);
  }
});

const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
test('pixel limits: the output limit is unchanged and the hard limit is 4 times larger', () => {
  assert.equal(maxPixels(true), 16_777_216);
  assert.equal(maxPixels(false), 120_000_000);
  assert.equal(hardPixels(true), 67_108_864);
});
test('assertDecodable: a 48 MP phone photo is allowed, a much larger image fails with too-big', () => {
  assert.doesNotThrow(() => assertDecodable(8064, 6048, true));
  assert.doesNotThrow(() => assertDecodable(4032, 3024, true));
  assert.doesNotThrow(() => assertDecodable(20000, 20000, false));
  assert.throws(() => assertDecodable(10000, 10000, true), (e) => errCode(e) === 'too-big');
  assert.throws(() => assertDecodable(30000, 20000, false), (e) => errCode(e) === 'too-big');
});
test('peekSize reads width and height from JPG, PNG, GIF, BMP, WebP and HEIC headers', () => {
  const sof = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, 0x17, 0x70, 0x1f, 0x40]; // height 6000, width 8000
  assert.deepEqual(peekSize(Uint8Array.from([...sof, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), [8000, 6000]);
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...be32(12000), ...be32(9000), 8, 6, 0, 0, 0]);
  assert.deepEqual(peekSize(png), [12000, 9000]);
  assert.deepEqual(peekSize(Uint8Array.from([71, 73, 70, 56, 57, 97, 0x40, 0x01, 0xc8, 0, 0, 0])), [320, 200]);
  const bmp = new Uint8Array(30); bmp.set([66, 77]); new DataView(bmp.buffer).setInt32(18, 5000, true); new DataView(bmp.buffer).setInt32(22, -4000, true);
  assert.deepEqual(peekSize(bmp), [5000, 4000]);
  const vp8x = new Uint8Array(30); vp8x.set([...'RIFF'].map((c) => c.charCodeAt(0))); vp8x.set([...'WEBP'].map((c) => c.charCodeAt(0)), 8); vp8x.set([...'VP8X'].map((c) => c.charCodeAt(0)), 12); vp8x.set([0x0f, 0x27, 0], 24); vp8x.set([0xdf, 0x13, 0], 27); // width 9999+1, height 5087+1
  assert.deepEqual(peekSize(vp8x), [10000, 5088]);
  assert.equal(peekSize(Uint8Array.from([1, 2, 3, 4])), null);
  const hs = peekSize(new Uint8Array(readFileSync(new URL('./fixtures/full-range-512.heic', import.meta.url))));
  assert.ok(hs && hs[0] > 0 && hs[1] > 0, `heic ${hs}`);
  const fake = new Uint8Array(40); fake.set([0, 0, 0, 24, ...'ftypheic'].map((c) => (typeof c === 'string' ? c.charCodeAt(0) : c))); fake.set([...'ispe'].map((c) => c.charCodeAt(0)), 20); fake.set(be32(12000), 28); fake.set(be32(9000), 32);
  assert.deepEqual(peekSize(fake), [12000, 9000]);
});
test('an allocation failure becomes the memory error code; other errors are left as they are', () => {
  assert.equal(isMemoryError(new RangeError('Array buffer allocation failed')), true);
  assert.equal(errCode(asMemoryError(new RangeError('x'))), 'memory');
  assert.equal(errCode(asMemoryError(new DOMException('q', 'QuotaExceededError'))), 'memory');
  const plain = new Error('bad file');
  assert.equal(asMemoryError(plain), plain);
  const tooBig = Object.assign(new Error('x'), { code: 'too-big' });
  assert.equal(asMemoryError(tooBig), tooBig);
});
test('convert.ts and heic.ts check the size before decoding and turn decode failures into memory errors', () => {
  assert.ok(/peekSize\(bytes\)[^\n]*assertDecodable/.test(core('convert')));
  assert.ok(core('convert').includes('asMemoryError(e)'));
  assert.ok(/peekSize\(src\)[^\n]*assertDecodable/.test(core('heic')));
  assert.ok(/assertDecodable\(width, height\)/.test(core('heic')));
});
test('every error code has a message in all 4 languages', () => {
  for (const lang of ['en', 'zh-Hans', 'zh-Hant', 'ja']) for (const c of ERR_CODES) assert.ok(REASONS[lang][c], `${lang}.${c}`);
});

const blob = (name, n) => ({ name, blob: new Blob([new Uint8Array(n).fill(name.length)]) });
test('buildZip writes exactly the same bytes as makeZip', async () => {
  const es = [blob('a.jpg', 100), blob('b.jpg', 5000), blob('a.jpg', 7)];
  const now = new Date(2026, 10, 9, 12, 0, 0);
  const old = makeZip(await Promise.all(es.map(async (e) => ({ name: e.name, data: new Uint8Array(await e.blob.arrayBuffer()) }))), now);
  const neu = new Uint8Array(await (await makeZipBlob(es, now)).arrayBuffer());
  assert.deepEqual(neu, old);
  assert.equal((await buildZip(es, { ios: true })).ok, true);
});
test('ZIP total limit: 300 MB on iPhone and iPad, 1.5 GB on a computer; over the limit no file is read', async () => {
  assert.equal(ZIP_LIMIT_IOS, 300 * 1048576);
  assert.equal(ZIP_LIMIT_DESKTOP, 1536 * 1048576);
  assert.equal(zipLimit(true), ZIP_LIMIT_IOS);
  assert.equal(zipTooBig(ZIP_LIMIT_IOS, true), false);
  assert.equal(zipTooBig(ZIP_LIMIT_IOS + 1, true), true);
  assert.equal(zipTooBig(ZIP_LIMIT_IOS + 1, false), false);
  let read = 0;
  const fat = (n) => ({ name: n, blob: { size: 200 * 1048576, arrayBuffer: async () => (read++, new ArrayBuffer(0)) } });
  const r = await buildZip([fat('a'), fat('b')], { ios: true });
  assert.deepEqual([r.ok, r.why, r.total], [false, 'tooBig', 400 * 1048576]);
  assert.equal(read, 0);
  const r2 = await buildZip([fat('a'), fat('b')], { ios: false });
  assert.notEqual(r2.why, 'tooBig');
});
test('a failed ZIP returns fail instead of throwing; a ZIP made stale returns stale', async () => {
  const bad = { name: 'x.jpg', blob: { size: 10, arrayBuffer: async () => { throw new RangeError('oom'); } } };
  const origErr = console.error; console.error = () => {};
  try {
    const r = await buildZip([bad, blob('y.jpg', 3)], { ios: true });
    assert.deepEqual([r.ok, r.why], [false, 'fail']);
  } finally { console.error = origErr; }
  const s = await buildZip([blob('a', 3), blob('b', 3)], { ios: true, alive: () => false });
  assert.deepEqual([s.ok, s.why], [false, 'stale']);
});
test('the batch tools all use zipAndDownload and no longer read every file into memory or call makeZip themselves', () => {
  for (const s of ['compress-image', 'heic-to-jpg', 'image-converter', 'remove-photo-location', 'resize-image', 'extract-frames-from-video'].filter(hasTool)) {
    const t = tool(s);
    assert.ok(t.includes('zipAndDownload('), s);
    assert.ok(!/makeZip\(|makeZipBlob\(/.test(t), `${s} still builds the ZIP itself`);
    assert.ok(!/Promise\.all\(outs\.map/.test(t), `${s} still reads everything into memory`);
  }
  assert.ok(core('zipdl').includes('buildZip('));
});
test('ZIP messages have the same keys and placeholders in all 4 languages', () => {
  const ph = (s) => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const lang of ['zh-Hans', 'zh-Hant', 'ja']) for (const k of Object.keys(ZIP_S.en)) {
    assert.ok(ZIP_S[lang][k], `${lang}.${k}`);
    assert.equal(ph(ZIP_S[lang][k]), ph(ZIP_S.en[k]), `${lang}.${k}`);
  }
});

test('makeLatest: an older request that answers later is no longer current and is aborted', async () => {
  const latest = makeLatest();
  const a = latest.begin();
  assert.equal(a.current(), true);
  const b = latest.begin();
  assert.equal(a.current(), false);
  assert.equal(a.signal.aborted, true);
  assert.equal(b.current(), true);
  assert.equal(b.signal.aborted, false);
  const shown = [];
  const reply = async (tk, text, delay) => { await new Promise((r) => setTimeout(r, delay)); if (tk.current()) shown.push(text); };
  const l2 = makeLatest(); const t1 = l2.begin(); const t2 = l2.begin();
  await Promise.all([reply(t1, 'old', 20), reply(t2, 'new', 1)]);
  assert.deepEqual(shown, ['new']);
});
test('edit photo metadata: place search shows only the latest request', () => {
  const s = tool('edit-photo-metadata');
  assert.ok(s.includes('latest.begin()') && s.includes('signal: ticket.signal'));
  assert.equal((s.match(/ticket\.current\(\)/g) ?? []).length, 2);
});

test('webcodecsOk requires OffscreenCanvas; needCanvas fails as unsupported when scaling has no canvas', async () => {
  const g = globalThis;
  const keep = ['VideoEncoder', 'VideoDecoder', 'EncodedVideoChunk', 'OffscreenCanvas'].map((k) => [k, g[k]]);
  const { webcodecsOk, needCanvas } = await import('../packages/core/src/transcode.ts');
  try {
    for (const k of ['VideoEncoder', 'VideoDecoder', 'EncodedVideoChunk']) g[k] = class {};
    delete g.OffscreenCanvas;
    assert.equal(webcodecsOk(), false);
    g.OffscreenCanvas = class {};
    assert.equal(webcodecsOk(), true);
  } finally { for (const [k, v] of keep) v === undefined ? delete g[k] : (g[k] = v); }
  assert.throws(() => needCanvas(true, null), (e) => e.message.startsWith('encode-unsupported'));
  assert.doesNotThrow(() => needCanvas(false, null));
  assert.doesNotThrow(() => needCanvas(true, {}));
  const t = core('transcode');
  assert.ok(t.includes('needCanvas(scale, ctx)') && t.includes('needCanvas(true, typeof OffscreenCanvas'));
});
