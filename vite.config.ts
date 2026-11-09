import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Every folder in tools/ that has an index.html is one tool page.
// Adding a tool means adding a folder; nothing else needs to change here.
const tools = readdirSync(resolve(__dirname, 'tools'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(__dirname, 'tools', d.name, 'index.html')))
  .map((d) => d.name)
  .sort();

// libheif-js (LGPL-3.0) is not bundled. The build copies its ES module, byte for byte as npm
// installed it, to dist/libheif/libheif-bundle.mjs, and the HEIC decoder imports it from there
// when a file needs it. To use another build of libheif-js, replace that one file.
const LIBHEIF = 'libheif-js/libheif-wasm/libheif-bundle.mjs';
const LIBHEIF_OUT = 'libheif/libheif-bundle.mjs';
const libheifAsIs = (): Plugin => ({
  name: 'libheif-as-is',
  apply: 'build',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: LIBHEIF_OUT, source: readFileSync(resolve(__dirname, 'node_modules', LIBHEIF)) });
  },
});

export default defineConfig({
  plugins: [libheifAsIs()],
  base: './',
  define: { __PICWAY_TOOLS__: JSON.stringify(tools) },
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      external: [LIBHEIF],
      output: { paths: { [LIBHEIF]: `../${LIBHEIF_OUT}` } },
      input: {
        index: resolve(__dirname, 'index.html'),
        ...Object.fromEntries(tools.map((t) => [t, resolve(__dirname, 'tools', t, 'index.html')])),
      },
    },
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@jsquash/avif', '@jsquash/webp', 'libheif-js'] },
  server: { host: '127.0.0.1' },
});
