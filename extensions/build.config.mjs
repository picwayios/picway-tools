// Where the tool code comes from: the one setting to change when the sources move.
// TOOLS_SRC is a checkout that holds the tools' page scripts (each exports mount(el)) and the
// shared tool CSS. Two layouts are recognised:
//   tools repo:  tools/<id>/main.ts, web/tool.css, processing code in packages/core/src
//                (imported as @picway-tools/core/<file>)
//   website:     src/tools/<id>.ts, src/tools/lib/, CSS in the tool page template
// Set it with the TOOLS_SRC environment variable, or put the path on the first line of a file
// named tools-src.local next to this file (that file is not committed). Inside the tools repo
// (this folder at <repo>/extensions) it defaults to the repo root.
// Card names, steps (src/tool-data.json) and the icon (assets/) are kept in this folder.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const local = resolve(here, 'tools-src.local');
const parent = resolve(here, '..');
const raw = process.env.TOOLS_SRC
  ?? (existsSync(local) ? readFileSync(local, 'utf8').split('\n')[0].trim() : '')
  ?? '';
const root = raw ? resolve(here, raw) : existsSync(resolve(parent, 'packages/core/src')) ? parent : '';
if (!root) throw new Error('Set TOOLS_SRC (or tools-src.local) to the checkout that holds the tool sources.');
export const TOOLS_SRC = root;

const toolsRepo = existsSync(resolve(root, 'packages/core/src'));
export const LAYOUT = toolsRepo ? 'tools-repo' : 'website';
export const SOURCE = toolsRepo
  ? {
      page: (id) => `${root}/tools/${id}/main.ts`,
      css: { file: `${root}/web/tool.css` },
      core: `${root}/packages/core/src`,
    }
  : {
      page: (id) => `${root}/src/tools/${id}.ts`,
      css: { file: `${root}/src/components/templates/ToolTemplate.astro`, block: /<style is:global>([\s\S]*?)<\/style>/ },
      core: `${root}/src/tools/lib`,
    };
export const ICON = resolve(here, 'assets/icon-1024.png');
export const TOOL_DATA = resolve(here, 'src/tool-data.json');
