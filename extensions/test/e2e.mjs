// End-to-end check of the built extensions (dist/<id>/).
// For every tool: open the extension page, choose the sample file(s), run the tool, save the
// download. With --compare, run the same steps on the tool's page on picway.app in the same
// browser and compare the two outputs. Every request made by the extension is recorded;
// anything that is not chrome-extension:, blob: or data: counts as a failure.
//
//   node test/e2e.mjs --browser <chromium | path to a Chromium binary> --samples <dir> [--compare] [--only id,id] [--dist <build folder>]
//
// Each run uses a new temporary profile and loads the extensions with --load-extension.
// --browser chromium   Playwright's own Chromium. It has no H.264/AAC decoder, so the video
//                      tools are skipped there.
// --browser <path>     Another Chromium build (one with H.264/AAC) for the video tools.
//                      Branded Google Chrome no longer accepts --load-extension.
import { chromium } from 'playwright-core';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { GROUPS } from '../src/groups.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const BROWSER = opt('browser', 'chromium');
const HERE = dirname(fileURLToPath(import.meta.url));
// Sample files: any folder; files are found by name in its subfolders. Inside the tools repo
// the default is its test fixtures.
const SAMPLES = resolve(opt('samples', existsSync(resolve(HERE, '../../tests/fixtures')) ? resolve(HERE, '../../tests/fixtures') : 'test/samples'));
const COMPARE = args.includes('--compare');
const ONLY = opt('only', '')?.split(',').filter(Boolean) ?? [];
const OUT = resolve(opt('out', resolve(HERE, 'out')));
mkdirSync(OUT, { recursive: true });

const s = (name) => {
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isFile() && e.name === name) return p;
      if (e.isDirectory()) { const hit = walk(p); if (hit) return hit; }
    }
    return null;
  };
  const hit = walk(SAMPLES);
  if (!hit) throw new Error(`sample ${name} not found under ${SAMPLES}`);
  return hit;
};
const VIDEO = new Set(['compress-video', 'mov-to-mp4', 'video-to-gif', 'gif-to-mp4']);
// steps: click = button text (exact), fill = [label text, value]; then the result is either a
// download link that appears in the tool (link) or a download started by a button (event).
const CASES = {
  'compress-image': { files: ['gps-p3-rot6.jpg'], result: 'link' },
  'compress-video': { files: ['h264-aac.mov'], steps: [{ click: 'Compress' }], result: 'link' },
  'heic-to-jpg': { files: ['gps-p3.heic'], result: 'link' },
  'image-converter': { files: ['alpha.png'], result: 'link' },
  'mov-to-mp4': { files: ['h264-aac.mov'], steps: [{ click: 'Convert to MP4' }], result: 'link' },
  'video-to-gif': { files: ['h264.mp4'], steps: [{ click: 'Make GIF' }], result: 'link' },
  'gif-to-mp4': { files: ['anim.gif'], steps: [{ click: 'Convert to MP4' }], result: 'link' },
  'remove-photo-location': { files: ['gps-p3-rot6.jpg'], result: 'link' },
  'edit-photo-metadata': { files: ['gps-p3-rot6.jpg'], steps: [{ fill: ['Latitude', '48.858370'] }, { fill: ['Longitude', '2.294481'] }, { fill: ['Make', 'Sample Make'] }], result: { event: 'Save edited photo' } },
  'crop-image': { files: ['gps-p3-rot6.jpg'], steps: [{ click: 'Create image' }], result: 'link' },
  'resize-image': { files: ['gps-p3-rot6.jpg'], result: 'link' },
  'blur-image': { files: ['gps-p3-rot6.jpg'], steps: [{ click: 'Whole image' }, { click: 'Create image' }], result: 'link' },
  'photo-border': { files: ['gps-p3-rot6.jpg'], result: { event: 'Download' } },
  'photo-collage': { files: ['gps-p3-rot6.jpg', 'thumbs-all.jpg'], result: { event: 'Download' } },
};

let PROFILE = '';
async function launch(extDirs) {
  const user = mkdtempSync(join(tmpdir(), 'pwx-'));
  PROFILE = user;
  const list = extDirs.join(',');
  const ctx = await chromium.launchPersistentContext(user, {
    ...(BROWSER === 'chromium' ? {} : { executablePath: BROWSER }),
    headless: false,
    acceptDownloads: true,
    args: ['--headless=new', `--disable-extensions-except=${list}`, `--load-extension=${list}`],
  });
  const sw = [...ctx.serviceWorkers()];
  while (sw.length < extDirs.length) sw.push(await ctx.waitForEvent('serviceworker'));
  const ids = {};
  for (const w of sw) ids[await w.evaluate(() => chrome.runtime.getManifest().name)] = new URL(w.url()).host;
  const open = async (url) => { const p = await ctx.newPage(); await p.goto(url); return p; };
  return { ctx, ids, sw, open };
}

const sha = (b) => createHash('sha256').update(b).digest('hex');
function describe(file) {
  try {
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_name,width,height,nb_frames,duration:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
    return j.streams.map((x) => `${x.codec_name}${x.width ? ` ${x.width}x${x.height}` : ''}${x.nb_frames && x.nb_frames !== 'N/A' ? ` ${x.nb_frames}fr` : ''}`).join(' + ') + ` ${Number(j.format.duration ?? 0).toFixed(2)}s`;
  } catch { return 'unreadable'; }
}
// md5 of the decoded video and audio, to compare outputs whose container headers differ
// (an MP4 stores the time it was written).
function decodedMd5(file) {
  const has = (k) => { try { return execFileSync('ffprobe', ['-v', 'error', '-select_streams', k, '-show_entries', 'stream=index', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim() !== ''; } catch { return false; } };
  const one = (map) => { if (!has(map[2])) return 'no stream'; try { return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', map, '-f', 'md5', '-'], { encoding: 'utf8' }).trim(); } catch { return 'none'; } };
  return { video: one('0:v?'), audio: one('0:a?') };
}

async function runTool(page, scope, c, tag) {
  const tool = page.locator(scope);
  await tool.locator('input[type=file]').first().waitFor({ state: 'attached', timeout: 30000 });
  await tool.locator('input[type=file]').first().setInputFiles(c.files.map(s));
  for (const st of c.steps ?? []) {
    if (st.click) {
      const b = tool.getByRole('button', { name: st.click, exact: true }).first();
      await b.waitFor({ state: 'visible', timeout: 60000 });
      await b.click();
    } else if (st.fill) {
      const f = tool.getByLabel(st.fill[0]).first();
      await f.waitFor({ state: 'visible', timeout: 60000 });
      await f.fill(st.fill[1]);
      await f.dispatchEvent('change');
    }
  }
  let dl;
  if (c.result === 'link') {
    const a = tool.locator('a[download]').first();
    await a.waitFor({ state: 'visible', timeout: 180000 });
    [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), a.click()]);
  } else {
    const b = tool.getByRole('button', { name: c.result.event, exact: true }).first();
    await b.waitFor({ state: 'visible', timeout: 60000 });
    await page.waitForTimeout(500);
    [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), b.click()]);
  }
  const file = join(OUT, `${tag}-${dl.suggestedFilename()}`);
  await dl.saveAs(file);
  const buf = readFileSync(file);
  return { name: dl.suggestedFilename(), bytes: buf.length, sha256: sha(buf), file, info: describe(file) };
}

const results = [];
const groups = GROUPS.filter((g) => g.tools.some((t) => !ONLY.length || ONLY.includes(t)));
const DIST = resolve(opt('dist', resolve(HERE, '..', 'dist')));
const dirs = groups.map((g) => join(DIST, g.id));
const { ctx, ids, sw, open } = await launch(dirs);
const version = ctx.browser()?.version() ?? (await (async () => { const p = await ctx.newPage(); const v = await p.evaluate(() => navigator.userAgent); await p.close(); return v; })());
// every request an extension page makes, including wasm and module loads
const extRequests = [];
const consoleErrors = [];
// context-level listener: Playwright holds new tabs until it is attached, so nothing is missed.
// Requests of the picway.app comparison tab are left out.
let sitePage = null;
ctx.on('request', (r) => {
  let pg = null;
  try { pg = r.frame().page(); } catch {}
  if (sitePage && pg === sitePage) return;
  extRequests.push(r.url());
});
const watch = (p, tool) => {
  p.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${tool}: ${m.text().slice(0, 300)}`); });
  p.on('pageerror', (e) => consoleErrors.push(`${tool}: ${String(e).slice(0, 300)}`));
};

// The toolbar button: run the same code the click handler runs, in each service worker.
const toolbar = {};
for (const w of sw) {
  const name = await w.evaluate(() => chrome.runtime.getManifest().name);
  toolbar[name] = await w.evaluate(async () => {
    const url = chrome.runtime.getURL('app.html');
    const t = await chrome.tabs.create({ url });
    await new Promise((r) => setTimeout(r, 1500));
    const ctxs = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    const hit = ctxs.find((x) => x.tabId === t.id && x.documentUrl.startsWith(url));
    await chrome.tabs.remove(t.id);
    return hit ? 'opens app.html in a tab; getContexts finds it' : 'tab opened but not found by getContexts';
  });
}

sitePage = COMPARE ? await (async () => {
  const p = await ctx.newPage();
  await p.addInitScript(() => Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true }));
  await p.route('**/api/**', (r) => r.abort());
  return p;
})() : null;

for (const g of groups) {
  const id = ids[g.name];
  for (const t of g.tools) {
    if (ONLY.length && !ONLY.includes(t)) continue;
    const c = CASES[t];
    const row = { group: g.id, tool: t, browser: BROWSER, input: c.files.join(' + ') };
    if (BROWSER === 'chromium' && VIDEO.has(t)) { results.push({ ...row, status: 'skipped (no H.264/AAC decoder in this Chromium build)' }); continue; }
    const before = extRequests.length;
    let extPage;
    try {
            extPage = await open(`chrome-extension://${id}/app.html#${t}`);
      watch(extPage, t);
      row.ext = await runTool(extPage, `#panel-${t} [data-tool]`, c, `ext-${t}`);
      row.status = 'ok';
    } catch (e) {
      row.status = 'FAIL';
      row.error = String(e).split('\n')[0];
      await extPage?.screenshot({ path: join(OUT, `fail-ext-${t}.png`), fullPage: true }).catch(() => {});
    }
    await extPage?.close().catch(() => {});
    row.extRequests = extRequests.slice(before);
    if (sitePage && row.status === 'ok') {
      try {
        await sitePage.goto(`https://picway.app/tools/${t}/`, { waitUntil: 'load', timeout: 90000 });
        row.site = await runTool(sitePage, '#tool [data-tool]', c, `site-${t}`);
        if (row.site.sha256 === row.ext.sha256) row.same = 'identical bytes';
        else {
          const a = decodedMd5(row.ext.file), b = decodedMd5(row.site.file);
          row.decoded = { ext: a, site: b };
          row.same = a.video === b.video && a.audio === b.audio ? 'decoded video and audio identical; file bytes differ' : 'different';
        }
      } catch (e) {
        row.site = { error: String(e).split('\n')[0] };
        await sitePage.screenshot({ path: join(OUT, `fail-site-${t}.png`), fullPage: true }).catch(() => {});
      }
    }
    results.push(row);
    console.log(t, row.status, row.ext?.bytes ?? '', row.same ?? '', row.error ?? '');
  }
}
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true }); // the temporary browser profile made above

const outside = [...new Set(results.flatMap((r) => r.extRequests ?? []).filter((u) => !/^(chrome-extension|blob|data):/.test(u)))];
const report = { browser: BROWSER, version, at: new Date().toISOString(), toolbar, results, extensionRequestsTotal: results.reduce((n, r) => n + (r.extRequests?.length ?? 0), 0), requestsOutsideExtension: outside, consoleErrors };
writeFileSync(join(OUT, 'e2e.json'), JSON.stringify(report, null, 2) + '\n');
console.log('requests outside the extension:', outside.length ? outside : 'none');
console.log('console errors:', consoleErrors.length ? consoleErrors : 'none');
console.log('toolbar:', toolbar);
process.exit(results.some((r) => r.status === 'FAIL') || outside.length ? 1 : 0);
