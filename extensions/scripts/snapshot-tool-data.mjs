// Only needed when the card text changes on the website. Copies each tool's English card name, one-line benefit and steps from the website sources
// into src/tool-data.json, so the build no longer needs the website content files.
//   TOOLS_SRC=<website checkout> node scripts/snapshot-tool-data.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GROUPS } from '../src/groups.mjs';

let parseYaml;
try { ({ parse: parseYaml } = await import('yaml')); } catch { throw new Error('This script needs the yaml package: npm install --no-save yaml'); }
const src = resolve(process.env.TOOLS_SRC ?? readFileSync('tools-src.local', 'utf8').split('\n')[0].trim());
const out = {};
for (const id of GROUPS.flatMap((g) => [...g.tools, ...g.later]).sort()) {
  const fm = readFileSync(`${src}/src/collections/tools/en/${id}.md`, 'utf8').match(/^---\n([\s\S]*?)\n---/);
  const d = parseYaml(fm[1]);
  if (d.toolId !== id) throw new Error(`${id}: toolId is ${d.toolId}`);
  out[id] = { name: d.card.name, benefit: d.card.benefit, steps: d.steps.map((s) => ({ name: s.name, text: s.text })) };
}
writeFileSync('src/tool-data.json', JSON.stringify(out, null, 2) + '\n');
console.log(Object.keys(out).length, 'tools');
