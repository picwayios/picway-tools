import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// libheif-js is LGPL-3.0. The build must ship it as one unmodified, replaceable file
// (see THIRD_PARTY_NOTICES.md), not bundled or minified into the app's own chunks.
const ROOT = new URL('../', import.meta.url).pathname;
const out = mkdtempSync(join(tmpdir(), 'picway-test-'));
process.on('exit', () => rmSync(out, { recursive: true, force: true }));

test('build copies libheif-js unchanged to libheif/libheif-bundle.mjs and loads it from there', () => {
  execFileSync(join(ROOT, 'node_modules/.bin/vite'), ['build', '--logLevel', 'error', '--outDir', out, '--emptyOutDir'], { cwd: ROOT, stdio: 'pipe' });
  const shipped = readFileSync(join(out, 'libheif/libheif-bundle.mjs'));
  const npm = readFileSync(join(ROOT, 'node_modules/libheif-js/libheif-wasm/libheif-bundle.mjs'));
  assert.ok(shipped.equals(npm), 'dist/libheif/libheif-bundle.mjs is byte-identical to the npm file');
  const chunks = readdirSync(join(out, 'assets')).filter((f) => f.endsWith('.js'));
  const importers = chunks.filter((f) => readFileSync(join(out, 'assets', f), 'utf8').includes('../libheif/libheif-bundle.mjs'));
  assert.ok(importers.length >= 1, 'some chunk imports ../libheif/libheif-bundle.mjs');
  const bundled = chunks.filter((f) => readFileSync(join(out, 'assets', f), 'utf8').includes('heif_get_version'));
  assert.deepEqual(bundled, [], 'no libheif code is bundled into the app chunks');
});
