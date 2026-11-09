// Negative control for the network check in e2e.mjs: an extension page that tries to reach
// another site is blocked by the page policy, and the request recorder does see an external
// request made from an ordinary page. Run after npm run build.
import { chromium } from 'playwright-core';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'privacy');
const PROFILE = mkdtempSync(join(tmpdir(), 'pwx-'));
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, args: ['--headless=new', `--disable-extensions-except=${dir}`, `--load-extension=${dir}`] });
const sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const seen = []; ctx.on('request', (r) => seen.push(r.url()));
const errs = [];
const p = await ctx.newPage(); p.on('console', (m) => m.type() === 'error' && errs.push(m.text().slice(0, 140)));
await p.goto(sw.url().replace('background.js', 'app.html'));
const r1 = await p.evaluate(() => fetch('https://picway.app/robots.txt').then(() => 'fetched', (e) => 'blocked: ' + e.message));
const r2 = await p.evaluate(() => new Promise((ok) => { const i = new Image(); i.onload = () => ok('img loaded'); i.onerror = () => ok('img blocked'); i.src = 'https://picway.app/favicon.png'; }));
const fromExt = seen.filter((u) => u.startsWith('https://'));
// control: the same fetch from an ordinary page must show up in the recorder
const q = await ctx.newPage(); await q.goto('about:blank');
await q.evaluate(() => fetch('https://picway.app/robots.txt', { mode: 'no-cors' }).catch(() => {}));
await q.waitForTimeout(1500);
console.log(JSON.stringify({ extFetch: r1, extImg: r2, externalRequestsSeenFromExtPage: fromExt, recorderSawControl: seen.includes('https://picway.app/robots.txt'), cspErrors: errs.filter((e) => /Content Security Policy/.test(e)).length }));
await ctx.close();
rmSync(PROFILE, { recursive: true, force: true }); // the temporary browser profile made above
