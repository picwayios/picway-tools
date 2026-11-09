import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import piexif from 'piexifjs';
import { stripAllFromJpeg, stripLocationFromJpeg } from '../packages/core/src/exif.ts';
import { dropJfifThumbs, getIcc } from '../packages/core/src/jpeg.ts';
import { checkLocation } from '../packages/core/src/location.ts';

const FX = new URL('./fixtures/photo/', import.meta.url);
const load = (n) => new Uint8Array(readFileSync(new URL(n, FX)));
const has = (cmd) => { try { execFileSync(cmd, ['-ver'], { stdio: 'ignore' }); return true; } catch { try { execFileSync(cmd, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } } };
const exiftoolOk = has('exiftool');
const ffmpegOk = has('ffmpeg');
const dir = mkdtempSync(join(tmpdir(), 'picway-test-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function head(u8) {
  const out = [];
  for (let p = 2; p + 4 <= u8.length && u8[p] === 0xff; ) {
    const m = u8[p + 1];
    const n = (u8[p + 2] << 8) | u8[p + 3];
    if (m === 0xda) break;
    out.push({ m, body: u8.subarray(p + 4, p + 2 + n), at: p });
    p += 2 + n;
  }
  return out;
}
const ascii = (b, n) => String.fromCharCode(...b.subarray(0, n));

function previews(u8) {
  const left = [];
  for (const s of head(u8)) {
    if (s.m === 0xe0 && ascii(s.body, 5) === 'JFIF\0' && (s.body.length > 14 || s.body[12] * s.body[13] > 0)) left.push('JFIF');
    if (s.m === 0xe0 && ascii(s.body, 5) === 'JFXX\0') left.push('JFXX');
    if (s.m === 0xe1 && ascii(s.body, 6) === 'Exif\0\0') {
      const d = piexif.load(String.fromCharCode(...s.body));
      if (Object.keys(d['1st'] ?? {}).length || d.thumbnail) left.push('EXIF IFD1');
    }
  }
  return left;
}
const decode = (u8, name) => {
  const p = join(dir, name);
  writeFileSync(p, u8);
  return execFileSync('ffmpeg', ['-v', 'error', '-i', p, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
};

const scanData = (u8) => { const h = head(u8); const last = h[h.length - 1]; return u8.subarray(last.at + 4 + last.body.length - 2 + 2); };

test('dropJfifThumbs: JFIF identifier, version, density unit and density kept as-is, preview width and height set to 0, preview pixel bytes removed, segment length 16; main image bytes untouched', () => {
  const src = load('jfif-thumb.jpg');
  const a = head(src).find((s) => s.m === 0xe0);
  assert.deepEqual([a.body[12], a.body[13], a.body.length], [32, 24, 14 + 32 * 24 * 3], 'sample: JFIF with a 32×24 preview');
  const out = dropJfifThumbs(src);
  const b = head(out).find((s) => s.m === 0xe0);
  assert.equal(b.body.length, 14, 'segment length 16 (including the length field)');
  assert.deepEqual(Array.from(b.body.subarray(0, 12)), Array.from(a.body.subarray(0, 12)), 'JFIF\\0, version, unit and density unchanged');
  assert.deepEqual([b.body[12], b.body[13]], [0, 0]);
  assert.deepEqual(Buffer.from(scanData(out)), Buffer.from(scanData(src)), 'main image entropy-coded data identical byte for byte (not re-encoded)');
  assert.equal(out.length, src.length - 32 * 24 * 3);
});

test('strip location, both modes remove everything: previews in JFIF / JFXX / EXIF IFD1 all removed, readback verification (strict + thumbs) passes; main image pixels unchanged', () => {
  for (const name of ['jfif-thumb.jpg', 'thumbs-all.jpg']) {
    const src = load(name);
    for (const [mode, fn] of [['strip location', stripLocationFromJpeg], ['strip all', stripAllFromJpeg]]) {
      const out = fn(src);
      assert.deepEqual(previews(out), [], `${name} ${mode}: an independent reader still sees a preview`);
      assert.deepEqual(checkLocation(out, { strict: true, thumbs: true }), { leaks: [], unsure: [] }, `${name} ${mode}`);
      assert.deepEqual(Buffer.from(scanData(out)), Buffer.from(scanData(src)), `${name} ${mode}: not re-encoded`);
      if (ffmpegOk) assert.deepEqual(decode(out, `o-${name}`), decode(src, `s-${name}`), `${name} ${mode}: main image pixels`);
      if (exiftoolOk) {
        const p = join(dir, `x-${name}`);
        writeFileSync(p, out);
        const t = execFileSync('exiftool', ['-a', '-G1', '-s', p], { encoding: 'utf8' });
        assert.doesNotMatch(t, /Thumbnail(Image|TIFF|Width|Height|Offset|Length)|\[JFXX\]|GPSLatitude/, `${name} ${mode}: exiftool reads ${t.match(/.*Thumbnail.*|.*JFXX.*|.*GPS.*/)?.[0]}`);
      }
    }
  }
});

test('readback verification sees three previews: the original (not cleared) reports JFIF, JFXX and EXIF previews under the thumbs check', () => {
  const c = checkLocation(load('thumbs-all.jpg'), { strict: true, thumbs: true });
  for (const k of ['JFIF preview', 'JFXX preview', 'EXIF preview']) assert.ok(c.leaks.includes(k), `missing ${k}: ${c.leaks}`);

  assert.ok(checkLocation(load('jfif-thumb.jpg'), { strict: true, thumbs: true }).leaks.includes('JFIF preview'));

  assert.ok(!checkLocation(load('jfif-thumb.jpg'), { strict: true }).leaks.includes('JFIF preview'));
});

test('ICC unchanged: a photo with a Display P3 profile plus a JFIF preview, after stripping location the ICC is byte-identical and the preview is gone', () => {
  const p3 = Buffer.from(load('gps-p3-rot6.jpg'));
  const a = head(p3).find((s) => s.m === 0xe0);
  const thumb = Buffer.alloc(8 * 6 * 3, 0x80);
  const app0 = Buffer.concat([Buffer.from([0xff, 0xe0, 0, 16 + thumb.length]), Buffer.from(a.body.subarray(0, 12)), Buffer.from([8, 6]), thumb]);
  const src = new Uint8Array(Buffer.concat([p3.subarray(0, 2), app0, p3.subarray(a.at + 4 + a.body.length)]));
  assert.ok(getIcc(src));
  const out = stripLocationFromJpeg(src);
  assert.deepEqual(Buffer.from(getIcc(out)), Buffer.from(getIcc(src)));
  assert.deepEqual(previews(out), []);
});
