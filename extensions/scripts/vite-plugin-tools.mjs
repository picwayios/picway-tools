// Vite plugin used by the extension build.
// 1. Bare imports (e.g. 'gifenc') inside TOOLS_SRC resolve from this repo's node_modules,
//    so the source checkout doesn't need its own install.
// 2. Offline edits for the extension build. The website version of "Edit photo metadata"
//    can show an OpenStreetMap map and search place names; both send requests to
//    OpenStreetMap. The extensions make no network requests, so here the map is replaced
//    by an inert stand-in and the map and place-search controls are left out of the page.
//    Coordinates can still be typed or pasted. Every edit must match exactly once, or the
//    build stops, so a change in the source can't slip through unnoticed.
// 3. libheif-js (LGPL-3.0) is not bundled: the import points at libheif/libheif-bundle.mjs in
//    the extension, and the build copies the npm package's file there unchanged, so it can be
//    replaced with another build of libheif-js.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ANCHOR = resolve(here, '..', 'package.json');

const LIBHEIF = 'libheif-js/libheif-wasm/libheif-bundle.mjs';
export const LIBHEIF_OUT = 'libheif/libheif-bundle.mjs';

const OFFLINE_MAP = '\0picway-offline-map';
const OFFLINE_MAP_CODE = `
export class TileMap {
  constructor() { this.el = document.createElement('div'); this.el.hidden = true; }
  enable() {}
  get enabled() { return false; }
  setCenter() {}
  setPin() {}
}
`;

const EDITS = {
  'edit-photo-metadata': [
    // map + its notes, and the place search row, are not added to the page
    ["          mapBox,\n          map.el,\n          attribP,\n          h('p', { class: 'tl-note' }, t('mapNote')),\n", ''],
    ["          h('div', { class: 'tl-row' }, h('label', { class: 'tl-row' }, t('search'), qIn), h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: search }, t('searchGo'))),\n          results,\n", ''],
    // place search can no longer be reached; keep no request in the code either
    ["await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' } })", "await Promise.reject(new Error('offline'))"],
    ["h('a', { href: 'https://www.openstreetmap.org/copyright', rel: 'noopener' }, t('attrib'))", "t('attrib')"],
  ],
};

// edit-photo-metadata page script: src/tools/edit-photo-metadata.ts or tools/edit-photo-metadata/main.ts
const toolOf = (id) => id.match(/[\\/]src[\\/]tools[\\/]([a-z0-9-]+)\.ts$|[\\/]tools[\\/]([a-z0-9-]+)[\\/]main\.ts$/)?.slice(1).find(Boolean);
const isMapImport = (source) => source === './lib/map.ts' || source === '@picway-tools/core/map.ts';

export function toolsPlugin(toolsSrc, coreDir) {
  const root = resolve(toolsSrc) + sep;
  const applied = [];
  const libheif = { file: null };
  return {
    name: 'picway-tools',
    enforce: 'pre',
    async resolveId(source, importer, opts) {
      if (!importer || !importer.startsWith(root)) return null;
      if (source === LIBHEIF) {
        libheif.file = (await this.resolve(source, ANCHOR, { ...opts, skipSelf: true }))?.id ?? null;
        if (!libheif.file) throw new Error(`can't find ${LIBHEIF}`);
        return { id: `/${LIBHEIF_OUT}`, external: 'absolute' };
      }
      if (isMapImport(source) && toolOf(importer) === 'edit-photo-metadata') return OFFLINE_MAP;
      if (source.startsWith('@picway-tools/core/')) return resolve(coreDir, source.slice('@picway-tools/core/'.length));
      if (source.startsWith('.') || source.startsWith('/') || source.startsWith('\0')) return null;
      return this.resolve(source, ANCHOR, { ...opts, skipSelf: true });
    },
    load(id) {
      return id === OFFLINE_MAP ? OFFLINE_MAP_CODE : null;
    },
    transform(code, id) {
      if (!id.startsWith(root)) return null;
      const name = toolOf(id);
      const edits = name && EDITS[name];
      if (!edits) return null;
      let out = code;
      for (const [from, to] of edits) {
        const n = out.split(from).length - 1;
        if (n !== 1) throw new Error(`offline edit for ${name} matched ${n} times (expected 1): ${from.slice(0, 60)}…`);
        out = out.replace(from, () => to);
      }
      applied.push(name);
      return { code: out, map: null };
    },
    api: { applied, libheif },
  };
}
