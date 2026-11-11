import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { gifStartPastEnd, planGif } from '../packages/core/src/gifplan.ts';
import { judgeJpgPng } from '../packages/core/src/heicgate.ts';

// Visible download links, HEIC to JPG checking the content, Video to GIF start and width,
// and smaller fixes. Logic is tested in Node; the page code is guarded by source anchors.
const ROOT = new URL('../', import.meta.url);
const core = (m) => readFileSync(new URL(`packages/core/src/${m}.ts`, ROOT), 'utf8');
const toolPath = (slug, f = 'main.ts') => new URL(`tools/${slug}/${f}`, ROOT);
const tool = (slug, f) => readFileSync(toolPath(slug, f), 'utf8');
const hasTool = (slug) => existsSync(toolPath(slug));
const allTools = readdirSync(new URL('tools/', ROOT)).filter((d) => hasTool(d));
const fx = (n) => new Uint8Array(readFileSync(new URL(`./fixtures/photo/${n}`, import.meta.url)));
const judge = (u) => judgeJpgPng(u.subarray(0, 512), async () => u);

test('HEIC to JPG: a complete JPG is reported as already a JPG', async () => {
  assert.equal(await judge(fx('gps-p3-rot6.jpg')), 'already');
});
test('HEIC to JPG: a .jpg with only a JPEG header is damaged, not already a JPG', async () => {
  const fake = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  assert.equal(await judge(fake), 'damaged');
});
test('HEIC to JPG: a truncated JPG is damaged', async () => {
  const j = fx('gps-p3-rot6.jpg');
  assert.equal(await judge(j.subarray(0, Math.floor(j.length / 2))), 'damaged');
});
test('HEIC to JPG: a complete PNG is already fine, a truncated PNG is damaged', async () => {
  const be = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
  const chunk = (type, data) => [...be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
  const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', [...be(2), ...be(2), 8, 2, 0, 0, 0]), ...chunk('IDAT', [1, 2, 3, 4]), ...chunk('IEND', [])]);
  assert.equal(await judge(png), 'already');
  assert.equal(await judge(png.subarray(0, png.length - 14)), 'damaged');
});
test('HEIC to JPG: HEIC and unknown content pass on to the HEIC check, whatever the file extension', async () => {
  assert.equal(await judge(fx('gps-p3.heic')), 'pass');
  assert.equal(await judge(new TextEncoder().encode('hello this is plain text renamed .jpg')), 'pass');
  assert.equal(await judge(new Uint8Array(0)), 'pass');
});
test('HEIC to JPG page judges by content, not by isJpgPng(f) on the file name', () => {
  const s = tool('heic-to-jpg');
  assert.match(s, /judgeJpgPng\(/);
  assert.doesNotMatch(s, /if \(isJpgPng\(f\)\)/);
  assert.match(s, /makeT\(REASONS, host\)\('damaged'\)/);
});

test('Video to GIF: a start at or past the end (or less than 0.1 s before it) counts as out of range', () => {
  assert.equal(gifStartPastEnd(10, 3), true);
  assert.equal(gifStartPastEnd(3, 3), true);
  assert.equal(gifStartPastEnd(2.95, 3), true);
  assert.equal(gifStartPastEnd(2.8, 3), false);
  assert.equal(gifStartPastEnd(0, 3), false);
  assert.equal(gifStartPastEnd(0, 0.05), true);
});
test('Video to GIF control: planGif clamps an out-of-range start to 1 frame, which is why the page stops it first', () => {
  const p = planGif({ w: 640, h: 360, rotation: 0, duration: 3, start: 10, length: 3, fps: 10, width: 480 });
  assert.equal(p.times.length, 1);
});
test('Video to GIF: a width larger than the video is not enlarged (plan.w is smaller than the chosen width)', () => {
  const p = planGif({ w: 360, h: 640, rotation: 0, duration: 3, start: 0, length: 3, fps: 10, width: 480 });
  assert.equal(p.w, 360);
  assert.ok(p.w < 480);
});
test('Video to GIF page: choosing a video keeps the start time, the start is checked first, and the width note is shown', () => {
  const s = tool('video-to-gif');
  assert.doesNotMatch(s, /from\.value = '0'/);
  assert.doesNotMatch(s, /opt\.start = 0;/);
  assert.match(s, /if \(gifStartPastEnd\(opt\.start, m\.duration\)\) return void/);
  assert.match(s, /plan\.w < o\.width \? t\('widthCap'/);
  const str = tool('video-to-gif', 'strings.ts');
  for (const k of ['startPast', 'widthCap']) assert.equal((str.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length, 4, `${k} in all 4 languages`);
});

function fakeDom() {
  class El {
    constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this.textContent = ''; this.clicks = 0; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
    replaceChildren(...k) { this.children = k.filter(Boolean); }
    append(...k) { this.children.push(...k); }
    click() { this.clicks++; const ev = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; for (const f of this.listeners.click ?? []) f(ev); return ev; }
  }
  globalThis.document = { createElement: (t) => new El(t), documentElement: { lang: 'en' } };
  return El;
}
test('offerDownload puts the link in the tool area with the file name and size, auto-clicks that link, and replaces the previous one', async () => {
  const El = fakeDom();
  const { offerDownload, clearOffer } = await import('../packages/core/src/offer.ts');
  const slot = new El('span');
  const a = offerDownload({ slot, blob: new Blob([new Uint8Array(2048)]), name: 'x-edited.jpg', label: 'Download x-edited.jpg', auto: true });
  assert.equal(slot.children[0], a, 'the link is in the slot, not on the body');
  assert.equal(a.attrs.download, 'x-edited.jpg');
  assert.match(a.attrs.href, /^blob:/);
  assert.equal(a.children[0], 'Download x-edited.jpg');
  assert.match(slot.children[1].children[0], /2 KB/);
  assert.equal(a.clicks, 1, 'the automatic download clicks this visible link');
  const b = offerDownload({ slot, blob: new Blob(['y']), name: 'y.jpg', label: 'Download y.jpg' });
  assert.equal(b.clicks, 0, 'no automatic click without auto');
  assert.notEqual(slot.children[0], a);
  clearOffer(slot);
  assert.equal(slot.children.length, 0);
});
test('offerDownload: when the result is stale, clicking the link does not download the old file and removes the link', async () => {
  const El = fakeDom();
  const { offerDownload } = await import('../packages/core/src/offer.ts');
  const slot = new El('span');
  let ok = true;
  const a = offerDownload({ slot, blob: new Blob(['zip']), name: 'a.zip', label: 'Download a.zip', valid: () => ok });
  assert.equal(a.click().defaultPrevented, false);
  ok = false;
  assert.equal(a.click().defaultPrevented, true);
  assert.equal(slot.children.length, 0);
});
test('edit metadata, photo border, collage and batch ZIPs give a visible link instead of only a scripted click', () => {
  for (const s of ['edit-photo-metadata', 'photo-border', 'photo-collage']) {
    const t = tool(s);
    assert.doesNotMatch(t, /downloadBlob\(|, downloadBlob\)/, s);
    assert.match(t, /offerDownload\(/, s);
    assert.match(t, /tl-actions' \}, [^\n]*\bgot\b/, `${s}: the link slot is in the tool area`);
  }
  const z = core('zipdl');
  assert.doesNotMatch(z, /downloadBlob/);
  assert.match(z, /offerDownload\(/);
  for (const s of ['compress-image', 'heic-to-jpg', 'image-converter', 'remove-photo-location', 'resize-image']) assert.match(tool(s), /clearZipOffer\(msg\)/, s);
});
test('no tool calls downloadBlob any more; only its definition is left', () => {
  assert.match(core('ui'), /export function downloadBlob/);
  for (const s of allTools) assert.doesNotMatch(tool(s).replace(/^import .*$/gm, ''), /downloadBlob/, s);
});

test('the "not a photo" hint links to Image converter, not Photo border', () => {
  for (const s of ['edit-photo-metadata', 'remove-photo-location']) {
    const t = tool(s);
    assert.match(t, /toolHref\('image-converter'\)/, s);
    assert.doesNotMatch(t, /toolHref\('photo-border'\)/, s);
    assert.equal((t.match(/\bnotPhotoOnly:/g) ?? []).length, 2, `${s}: en and zh-Hans`);
    assert.equal((t.match(/\bgoConv:/g) ?? []).length, 2, s);
  }
});
test('Remove photo location: "more fields" is a sentence, not something that looks like an expand button', () => {
  const s = tool('remove-photo-location');
  assert.doesNotMatch(s, /\+ \{n\} more fields/);
  assert.match(s, /more: 'Also in the file, not listed here: \{n\} more\./);
});
test('Edit photo metadata: the date field has a 4-digit-year min and max', () => {
  assert.match(tool('edit-photo-metadata'), /type: 'datetime-local', step: '1', min: '1900-01-01T00:00:00', max: '9999-12-31T23:59:59'/);
});
test('a <label> no longer holds both an input and a button (time zone, pick a moment)', () => {
  assert.doesNotMatch(tool('edit-photo-metadata'), /h\('label', \{ class: 'tl-row' \}, t\('tz'\), tzIn, h\('button'/);
  if (hasTool('extract-frames-from-video')) {
    const s = tool('extract-frames-from-video');
    assert.doesNotMatch(s, /h\('label', \{ class: 'tl-row' \}, t\('at'\), at, addAt\)/);
    assert.match(s, /h\('label', \{ class: 'tl-row' \}, t\('at'\), at\), addAt\)/);
  }
});
test('heic.ts releases the object URL when the size is 0 and when drawing fails', () => {
  const s = core('heic');
  assert.match(s, /if \(img\.naturalWidth > 0\) return img;\n\s+URL\.revokeObjectURL\(url\);/);
  assert.match(s, /try \{ ctx\.drawImage\(img, 0, 0, w, h\); \} finally \{ URL\.revokeObjectURL\(img\.src\); \}/);
});
