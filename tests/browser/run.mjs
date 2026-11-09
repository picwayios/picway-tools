// Browser test: opens every tool page from the built site (dist/), feeds it a sample file,
// presses the button that starts the work, and saves what the page offers for download.
//
//   npm run build && npm run test:browser
//   node tests/browser/run.mjs --compare <other-build-dir>   # same flow on a second build, compare bytes
//   node tests/browser/run.mjs --screenshots docs/screenshots  # also save a screenshot per tool
//   node tests/browser/run.mjs --browser webkit --only compress-video  # WebKit has H.264; Playwright’s Chromium does not
//
// Needs a browser that playwright-core can launch (npx playwright-core install chromium webkit).
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, webkit } from 'playwright-core';
import { CASES } from './cases.mjs';

const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const ROOT = resolve(new URL('../..', import.meta.url).pathname);
const FIX = join(ROOT, 'tests/fixtures');
const OUT = resolve(opt('--out') ?? join(ROOT, 'test-results/browser'));
const only = opt('--only')?.split(',');
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
function serve(dir) {
  return new Promise((ok) => {
    const s = createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let f = join(dir, p);
      if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
      if (!f.startsWith(dir) || !existsSync(f)) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream', 'cross-origin-opener-policy': 'same-origin' });
      res.end(readFileSync(f));
    }).listen(0, '127.0.0.1', () => ok({ server: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
// MP4 headers (mvhd, tkhd, mdhd) carry the time the file was written. Two runs a few
// seconds apart differ only there, so the comparison zeroes those fields first.
const mp4Times = (b) => {
  const c = Buffer.from(b);
  for (const box of ['mvhd', 'tkhd', 'mdhd']) {
    for (let i = c.indexOf(box); i >= 4; i = c.indexOf(box, i + 4)) {
      const v = c[i + 4];
      c.fill(0, i + 8, i + 8 + (v === 1 ? 16 : 8));
    }
  }
  return c;
};
const shaCmp = (b, fmt) => sha(fmt === 'mp4' ? mp4Times(b) : b);
const magic = (b) => {
  const h = b.subarray(0, 12);
  if (h[0] === 0xff && h[1] === 0xd8) return 'jpeg';
  if (h[0] === 0x89 && h[1] === 0x50) return 'png';
  if (h.toString('latin1', 0, 4) === 'RIFF' && h.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (h.toString('latin1', 0, 3) === 'GIF') return 'gif';
  if (h.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (h[0] === 0x50 && h[1] === 0x4b) return 'zip';
  return 'unknown';
};

async function runOne(browser, base, c, label, shotDir) {
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 900, height: 1200 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${base}/tools/${c.slug}/`, { waitUntil: 'load' });
  const tool = page.locator('[data-tool]');
  const files = [];
  const grab = async (trigger) => {
    const [d] = await Promise.all([page.waitForEvent('download', { timeout: c.timeout ?? 60000 }), trigger()]);
    const p = await d.path();
    const bytes = readFileSync(p);
    files.push({ name: d.suggestedFilename(), bytes });
  };
  try {
    await tool.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 20000 });
    await tool.locator('input[type=file]').first().setInputFiles(c.files.map((f) => join(FIX, f)));
    if (c.before) await c.before(page, tool);
    if (c.start) {
      const btn = tool.getByRole('button', { name: c.start, exact: true });
      await btn.waitFor({ timeout: 30000 });
      await page.waitForFunction((el) => !el.disabled, await btn.elementHandle(), { timeout: 30000 });
      await btn.click();
    }
    if (c.download === 'button') {
      const btn = tool.getByRole('button', { name: c.downloadName ?? 'Download', exact: true });
      await btn.waitFor({ timeout: c.timeout ?? 60000 });
      await page.waitForFunction((el) => !el.disabled, await btn.elementHandle(), { timeout: c.timeout ?? 60000 });
      await grab(() => btn.click());
    } else {
      const link = tool.locator('a[download]').first();
      await link.waitFor({ timeout: c.timeout ?? 60000 });
      await grab(() => link.click());
    }
  } catch (e) {
    errors.push(String(e).split('\n')[0]);
    const msg = await tool.locator('.tl-msg, .tl-err, .is-error').allTextContents().catch(() => []);
    if (msg.length) errors.push('page says: ' + msg.filter(Boolean).join(' | '));
  }
  if (shotDir) {
    mkdirSync(shotDir, { recursive: true });
    await page.locator('.tool').screenshot({ path: join(shotDir, `${c.slug}.png`) }).catch(() => {});
  }
  await ctx.close();
  return { label, errors, files: files.map((f) => ({ name: f.name, size: f.bytes.length, format: magic(f.bytes), sha256: sha(f.bytes), sha256Cmp: shaCmp(f.bytes, magic(f.bytes)) })), raw: files };
}

const dist = join(ROOT, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Run npm run build first.');
const a = await serve(dist);
const cmpDir = opt('--compare') && resolve(opt('--compare'));
const b = cmpDir ? await serve(cmpDir) : null;
const engine = opt('--browser') === 'webkit' ? webkit : chromium;
const browser = await engine.launch({ headless: true });
const report = [];
let failed = 0;
for (const c of CASES.filter((x) => !only || only.includes(x.slug))) {
  const r = await runOne(browser, a.url, c, 'this build', opt('--screenshots') && resolve(opt('--screenshots')));
  const row = { slug: c.slug, input: c.files, expect: c.expect, ours: { files: r.files, errors: r.errors } };
  for (const f of r.raw) writeFileSync(join(OUT, `${c.slug}--${f.name}`), f.bytes);
  let ok = r.files.length > 0 && r.files.every((f) => f.format === c.expect) && r.errors.length === 0;
  if (b) {
    const o = await runOne(browser, b.url, c, 'compare build', null);
    for (const f of o.raw) writeFileSync(join(OUT, `${c.slug}--compare--${f.name}`), f.bytes);
    row.compare = { files: o.files, errors: o.errors };
    row.sameBytes = r.files.length > 0 && r.files.length === o.files.length && r.files.every((f, i) => f.sha256Cmp === o.files[i].sha256Cmp);
    row.identical = row.sameBytes && r.files.every((f, i) => f.sha256 === o.files[i].sha256);
    ok = ok && row.sameBytes;
  }
  row.ok = ok;
  if (!ok) failed++;
  report.push(row);
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${c.slug}: ${r.files.map((f) => `${f.name} ${f.format} ${f.size} B`).join(', ') || 'no output'}${b ? (row.identical ? ' | byte-identical to compare build' : row.sameBytes ? ' | identical to compare build except MP4 write times' : ' | differs from compare build') : ''}${r.errors.length ? ' | ' + r.errors.join(' | ') : ''}`);
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
a.server.close();
b?.server.close();
console.log(`${report.length - failed}/${report.length} tools passed. Details: ${join(OUT, 'report.json')}`);
process.exitCode = failed ? 1 : 0;
