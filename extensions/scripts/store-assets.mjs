// Store images for every extension, written to store/<id>/:
//   screenshot-<n>.png   1280x800, the real extension page after running a tool on sample photos
//   promo-440x280.png    small promotional tile (Chrome Web Store and Edge Add-ons)
//   logo-300.png         Edge Add-ons extension logo (300x300)
//   icon-128.png         Chrome Web Store store icon
//
//   node scripts/store-assets.mjs --browser <chromium | path> --samples <dir>
// The samples folder must hold the photos named below (any JPG/WebP photos will do).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { SOURCE } from '../build.config.mjs';
import { GROUPS } from '../src/groups.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i < 0 ? d : args[i + 1]; };
const BROWSER = opt('browser', 'chromium');
const SAMPLES = resolve(opt('samples', 'test/samples'));
const s = (f) => join(SAMPLES, f);

// tool, files, buttons to press, and the text the tool shows once it has a result
const SHOTS = {
  compress: [
    { tool: 'compress-image', files: ['landscape-01.webp', 'food-01.webp', 'city-01.webp', 'pet-01.webp'], ready: 'a[download]' },
    { tool: 'compress-video', files: ['h264-aac.mov'], click: ['Compress'], ready: 'a[download]' },
  ],
  convert: [
    { tool: 'heic-to-jpg', files: ['gps-p3.heic'], ready: 'a[download]' },
    { tool: 'image-converter', select: 'jpeg', files: ['landscape-02.webp', 'food-02.webp', 'travel-01.webp'], ready: 'a[download]' },
    { tool: 'mov-to-mp4', files: ['h264-aac.mov'], click: ['Convert to MP4'], ready: 'a[download]' },
  ],
  privacy: [
    { tool: 'remove-photo-location', files: ['gps-p3-rot6.jpg'], ready: 'a[download]' },
    { tool: 'edit-photo-metadata', files: ['gps-p3-rot6.jpg'], ready: 'button', result: 'fieldset' },
  ],
  edit: [
    { tool: 'photo-collage', files: ['landscape-03.webp', 'food-03.webp', 'city-02.webp', 'pet-02.webp'], ready: 'canvas, img', result: '.tl-actions, canvas' },
    { tool: 'crop-image', files: ['landscape-04.webp'], ready: 'canvas' },
    { tool: 'photo-border', files: ['travel-02.webp'], ready: 'canvas, img' },
  ],
};

const dirs = GROUPS.map((g) => resolve('dist', g.id));
const PROFILE = mkdtempSync(join(tmpdir(), 'pwx-'));
const ctx = await chromium.launchPersistentContext(PROFILE, {
  ...(BROWSER === 'chromium' ? {} : { executablePath: BROWSER }),
  headless: false,
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  args: ['--headless=new', `--disable-extensions-except=${dirs.join(',')}`, `--load-extension=${dirs.join(',')}`],
});
const sw = [...ctx.serviceWorkers()];
while (sw.length < dirs.length) sw.push(await ctx.waitForEvent('serviceworker'));
const ids = {};
for (const w of sw) ids[await w.evaluate(() => chrome.runtime.getManifest().name)] = new URL(w.url()).host;

for (const g of GROUPS) {
  const out = resolve('store', g.id);
  mkdirSync(out, { recursive: true });
  let n = 0;
  for (const shot of SHOTS[g.id]) {
    const page = await ctx.newPage();
    await page.goto(`chrome-extension://${ids[g.name]}/app.html#${shot.tool}`);
    const tool = page.locator(`#panel-${shot.tool} [data-tool]`);
    await tool.locator('input[type=file]').first().waitFor({ state: 'attached' });
    if (shot.select) await tool.locator(`select:has(option[value="${shot.select}"])`).first().selectOption(shot.select);
    await tool.locator('input[type=file]').first().setInputFiles(shot.files.map(s));
    for (const c of shot.click ?? []) await tool.getByRole('button', { name: c, exact: true }).first().click();
    await tool.locator(shot.ready).first().waitFor({ state: 'visible', timeout: 120000 });
    await page.waitForTimeout(1500);
    // scroll so the result (the last matching element) sits near the bottom of the view
    await page.evaluate((sel) => {
      const all = document.querySelectorAll(sel);
      const last = all[all.length - 1];
      if (!last) return;
      const r = last.getBoundingClientRect();
      window.scrollBy(0, Math.max(0, r.bottom - window.innerHeight + 60));
    }, `#panel-${shot.tool} [data-tool] ${shot.result ?? shot.ready}`);
    await page.screenshot({ path: join(out, `screenshot-${++n}.png`) });
    await page.close();
  }

  // small promotional tile: its own page, so nothing from the tool pages carries over
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 440, height: 280 });
  const icon = readFileSync(join(dirs[GROUPS.indexOf(g)], 'icons', 'icon-128.png')).toString('base64');
  const [first, ...rest] = g.name.split(' ');
  await page.setContent(`<!doctype html><html style="margin:0;height:280px;overflow:hidden"><head><meta charset="utf-8"></head>
    <body style="margin:0;width:440px;height:280px;overflow:hidden;display:flex;align-items:center;gap:22px;padding:0 30px;box-sizing:border-box;background:linear-gradient(135deg,#f5f5f7,#e6ecfb);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1d1d1f">
      <img src="data:image/png;base64,${icon}" width="96" height="96" style="flex:none;border-radius:22px">
      <div style="display:grid;gap:8px">
        <div style="font-size:15px;font-weight:600;color:#1a57e0">${first}</div>
        <div style="font-size:25px;font-weight:700;line-height:1.15;letter-spacing:-0.2px">${rest.join(' ').replace('&', '&amp;')}</div>
        <div style="font-size:14px;line-height:1.35;color:#4a4a4f">${g.purpose}</div>
      </div></body></html>`, { waitUntil: 'load' });
  await page.screenshot({ path: join(out, 'promo-440x280.png') });
  await page.close();

  execFileSync('sips', ['-s', 'format', 'png', '-z', '300', '300', SOURCE.icon, '--out', join(out, 'logo-300.png')], { stdio: 'ignore' });
  copyFileSync(join(dirs[GROUPS.indexOf(g)], 'icons', 'icon-128.png'), join(out, 'icon-128.png'));
  console.log(g.id, `${n} screenshots`);
}
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true }); // the temporary browser profile made above
