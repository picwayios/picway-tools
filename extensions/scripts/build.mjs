// Builds every extension into dist/<id>/ and a store upload zip into dist/<id>.zip.
//   npm run build                  all extensions
//   npm run build -- compress      one extension
//   INCLUDE_LATER=1 npm run build  also include tools listed under `later` (local tries only)
import { build } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ICON, LAYOUT, SOURCE, TOOL_DATA, TOOLS_SRC } from '../build.config.mjs';
import { GROUPS, SITE } from '../src/groups.mjs';
import { toolsPlugin } from './vite-plugin-tools.mjs';
import { LISTINGS } from '../store/listings.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GEN = join(ROOT, '.gen');
const DIST = resolve(ROOT, process.env.OUT_DIR ?? 'dist'); // OUT_DIR: build somewhere else, e.g. for INCLUDE_LATER tries
const VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
const LATER = process.env.INCLUDE_LATER === '1';
const FIXED_TIME = new Date('2026-01-01T00:00:00Z');
const only = process.argv.slice(2);

const CSP = [
  "script-src 'self' 'wasm-unsafe-eval'",
  "object-src 'none'",
  "connect-src 'self' blob: data:",
  "img-src 'self' blob: data:",
  "media-src 'self' blob: data:",
  "font-src 'self'",
  "worker-src 'self'", // MV3 rejects blob: here; no tool starts a worker from a blob
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

const DATA = JSON.parse(readFileSync(TOOL_DATA, 'utf8'));
function toolData(id) {
  const d = DATA[id];
  if (!d) throw new Error(`${id} is missing from src/tool-data.json (run scripts/snapshot-tool-data.mjs)`);
  if (!existsSync(SOURCE.page(id))) throw new Error(`${id}: no page script at ${SOURCE.page(id)}`);
  return { id, ...d };
}

/** The shared tool CSS: a whole file, or one block of it. */
function toolCss() {
  const src = readFileSync(SOURCE.css.file, 'utf8');
  if (!SOURCE.css.block) return src;
  const m = src.match(SOURCE.css.block);
  if (!m) throw new Error('shared tool CSS not found');
  return m[1].replace(/\/\*[\s\S]*?\*\//g, '').trim() + '\n';
}

function icons(outDir) {
  mkdirSync(join(outDir, 'icons'), { recursive: true });
  for (const n of [16, 32, 48, 128]) {
    execFileSync('sips', ['-s', 'format', 'png', '-z', String(n), String(n), ICON, '--out', join(outDir, 'icons', `icon-${n}.png`)], { stdio: 'ignore' });
  }
}

const BACKGROUND = `// Clicking the toolbar button opens the tools page, or brings it to the front if it is already open.
const PAGE = 'app.html';
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL(PAGE);
  try {
    const [open] = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    if (open && open.tabId >= 0 && open.documentUrl && open.documentUrl.startsWith(url)) {
      await chrome.tabs.update(open.tabId, { active: true });
      await chrome.windows.update(open.windowId, { focused: true });
      return;
    }
  } catch (e) {
    // fall through and open a new tab
  }
  await chrome.tabs.create({ url });
});
`;

function manifest(g, desc) {
  return {
    manifest_version: 3,
    name: g.name,
    short_name: g.short,
    version: VERSION,
    description: desc,
    author: 'PicWay',
    homepage_url: `${SITE}/tools/`,
    minimum_chrome_version: '116',
    icons: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    action: { default_title: `Open ${g.name}`, default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' } },
    background: { service_worker: 'background.js' },
    content_security_policy: { extension_pages: CSP },
  };
}

/** Folder of an installed npm package, looked up from this folder upwards (works inside a workspace). */
function pkgDir(name) {
  for (let d = ROOT; ; d = dirname(d)) {
    const p = join(d, 'node_modules', name);
    if (existsSync(join(p, 'package.json'))) return p;
    if (dirname(d) === d) throw new Error(`package ${name} is not installed`);
  }
}

/** License texts of the npm packages that end up in the bundle, taken from each package. */
function noticesFromPackages(pkgs) {
  const parts = ['Third-party software in this extension', '======================================', ''];
  for (const name of [...pkgs].sort()) {
    const dir = pkgDir(name);
    const pj = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const lic = readdirSync(dir).find((f) => /^(licen[cs]e|copying)/i.test(f));
    parts.push(`${name} ${pj.version} (${pj.license ?? 'see below'})`, pj.homepage ?? (typeof pj.repository === 'string' ? pj.repository : pj.repository?.url) ?? '', '');
    parts.push(lic ? readFileSync(join(dir, lic), 'utf8').trim() : 'No license file in the package; license field: ' + (pj.license ?? 'none'), '', '----', '');
  }
  return parts.join('\n');
}

/** In the tools repo: the same notices as its THIRD_PARTY_NOTICES.md and licenses/, for the
 *  packages this extension bundles. A bundled package missing from that file stops the build. */
function noticesFromRepo(pkgs) {
  const md = readFileSync(join(TOOLS_SRC, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const plain = (c) => c.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').trim();
  const entries = [];
  for (const line of md.split('\n')) {
    if (!line.startsWith('|') || /^\|\s*(Package|-)/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    const files = [...cells[cells.length - 1].matchAll(/\]\((licenses\/[^)]+)\)/g)].map((m) => m[1]);
    if (cells[0].startsWith('↳')) {
      entries.at(-1).sub.push({ text: plain(cells[0].slice(1)), license: cells[2], files });
      continue;
    }
    const names = [...cells[0].matchAll(/\[([^\]]+)\]/g), ...cells[0].matchAll(/\(([a-z0-9@/._-]+)\)/g)].map((m) => m[1].toLowerCase());
    entries.push({ names, title: plain(cells[0]), version: cells[1], license: cells[2], usedFor: cells[3], files, sub: [] });
  }
  const used = [...pkgs].sort().map((p) => {
    const e = entries.find((x) => x.names.includes(p));
    if (!e) throw new Error(`${p} is bundled but not listed in THIRD_PARTY_NOTICES.md`);
    return e;
  });
  const lgpl = md.match(/## About the LGPL-3\.0 part\n([\s\S]*?)(?=\n## |$)/)?.[1].trim();
  const out = ['Third-party software in this extension', '======================================', '',
    'This extension is MIT-licensed (LICENSE.txt). It includes the open-source libraries below, each under its own license.', ''];
  for (const e of [...new Set(used)]) {
    out.push(`${e.title} ${e.version}: ${e.license}. Used for ${e.usedFor}.`);
    for (const x of e.sub) out.push(`  - ${x.text}: ${x.license}`);
  }
  if (used.some((e) => e.names.includes('libheif-js')) && lgpl) out.push('', 'About the LGPL-3.0 part', '-----------------------', plain(lgpl));
  for (const f of [...new Set([...new Set(used)].flatMap((e) => [...e.files, ...e.sub.flatMap((x) => x.files)]))]) {
    out.push('', '', `==== ${f} ====`, '', readFileSync(join(TOOLS_SRC, f), 'utf8').trim());
  }
  return out.join('\n') + '\n';
}

const notices = (pkgs) => (LAYOUT === 'tools-repo' ? noticesFromRepo(pkgs) : noticesFromPackages(pkgs));

const sha256 = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');

const css = toolCss();
console.log(`tool sources: ${LAYOUT} layout`);
const results = [];
for (const g of GROUPS) {
  if (only.length && !only.includes(g.id)) continue;
  const ids = [...g.tools, ...(LATER ? g.later : [])];
  const data = { id: g.id, name: g.name, purpose: g.purpose, tools: ids.map(toolData) };
  const gen = join(GEN, g.id);
  rmSync(gen, { recursive: true, force: true });
  mkdirSync(gen, { recursive: true });
  writeFileSync(join(gen, 'tool.css'), css);
  writeFileSync(join(gen, 'data.json'), JSON.stringify(data, null, 2));
  const rel = (p) => './' + relative(gen, p).split('\\').join('/');
  writeFileSync(join(gen, 'main.ts'), [
    `import './tool.css';`,
    `import '${rel(join(ROOT, 'src/shell/shell.css'))}';`,
    `import { start } from '${rel(join(ROOT, 'src/shell/main.ts'))}';`,
    `import data from './data.json';`,
    `start(data, {`,
    ...ids.map((id) => `  '${id}': () => import(${JSON.stringify(rel(SOURCE.page(id)))}),`),
    `});`,
    '',
  ].join('\n'));
  writeFileSync(join(gen, 'app.html'), `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${g.name}</title>
<link rel="icon" href="icons/icon-32.png">
</head>
<body>
<div class="x-wrap">
<header class="x-head"><img src="icons/icon-128.png" alt=""><div><h1>${g.name}</h1><p>${g.purpose} Your files are processed inside your browser, and this extension has no server that receives them.</p></div></header>
<main id="app"></main>
<footer class="x-foot">
<p>Made by <a href="${SITE}/">PicWay</a>. PicWay is an iPhone app for sorting photos by swiping. It isn’t on the App Store yet.</p>
<p><a href="${SITE}/privacy/">Privacy</a> · <a href="third-party-notices.txt">Open-source licenses</a></p>
</footer>
</div>
<script type="module" src="./main.ts"></script>
</body>
</html>
`);

  const out = join(DIST, g.id);
  rmSync(out, { recursive: true, force: true });
  const pkgs = new Set();
  const plugin = toolsPlugin(TOOLS_SRC, SOURCE.core);
  await build({
    root: gen,
    base: './',
    logLevel: 'warn',
    configFile: false,
    publicDir: false,
    plugins: [plugin, {
      name: 'collect-packages',
      moduleParsed(info) {
        const m = info.id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//);
        if (m) pkgs.add(m[1]);
      },
    }],
    // The source checkout's tsconfig extends a framework config that isn't installed here;
    // give esbuild the few options it needs directly.
    esbuild: { legalComments: 'none', tsconfigRaw: JSON.stringify({ compilerOptions: { target: 'ES2022', useDefineForClassFields: true, verbatimModuleSyntax: true } }) },
    worker: { format: 'es' },
    build: {
      outDir: out,
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      sourcemap: false,
      rollupOptions: { input: join(gen, 'app.html') },
      chunkSizeWarningLimit: 20000,
    },
  });
  // Files that Vite copies by URL (wasm) are not reported by moduleParsed; add their packages too.
  {
    for (const f of readdirSync(join(out, 'assets'))) {
      if (/^avif_enc/.test(f) || /^avif_dec/.test(f)) pkgs.add('@jsquash/avif');
      if (/^webp_enc/.test(f) || /^webp_dec/.test(f)) pkgs.add('@jsquash/webp');
    }
  }
  icons(out);
  writeFileSync(join(out, 'background.js'), BACKGROUND);
  const desc = LISTINGS[g.id].shortDescription;
  if (desc.length > 132) throw new Error(`${g.id}: short description is ${desc.length} characters (max 132)`);
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest(g, desc), null, 2) + '\n');
  writeFileSync(join(out, 'third-party-notices.txt'), notices(pkgs));
  copyFileSync(existsSync(join(ROOT, 'LICENSE')) ? join(ROOT, 'LICENSE') : join(TOOLS_SRC, 'LICENSE'), join(out, 'LICENSE.txt')); // in the tools repo: its root LICENSE

  const zip = join(DIST, `${g.id}.zip`);
  rmSync(zip, { force: true });
  // Same input, same zip: fixed file times and a sorted file list.
  const files = [];
  const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p) : files.push(relative(out, p)); } };
  walk(out);
  files.sort();
  for (const f of files) utimesSync(join(out, f), FIXED_TIME, FIXED_TIME);
  execFileSync('zip', ['-X', '-q', '-D', zip, ...files], { cwd: out });
  const size = statSync(zip).size;
  results.push({ id: g.id, name: g.name, tools: ids, zip: relative(ROOT, zip), bytes: size, sha256: sha256(zip), packages: [...pkgs].sort(), edits: plugin.api.applied });
}
writeFileSync(join(DIST, 'build.json'), JSON.stringify(results, null, 2) + '\n');
for (const r of results) console.log(`${r.id}: ${r.tools.length} tools, ${(r.bytes / 1048576).toFixed(2)} MB, sha256 ${r.sha256}`);
