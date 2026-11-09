import { readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Every folder in tools/ that has an index.html is one tool page.
// Adding a tool means adding a folder; nothing else needs to change here.
const tools = readdirSync(resolve(__dirname, 'tools'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(resolve(__dirname, 'tools', d.name, 'index.html')))
  .map((d) => d.name)
  .sort();

export default defineConfig({
  base: './',
  define: { __PICWAY_TOOLS__: JSON.stringify(tools) },
  build: {
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
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
