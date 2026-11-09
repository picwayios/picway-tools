import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

// A missing semicolon between two declarations is not a CSS syntax error: the browser reads
// both lines as one value and silently drops it (for example color-scheme, so form controls
// stop following dark mode). This checks every declaration block in the shared stylesheets.
export function declarationProblems(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(["'])(?:\\.|(?!\1).)*\1/g, '""');
  const problems = [];
  for (const m of src.matchAll(/\{([^{}]*)\}/g)) {
    let at = m.index + 1;
    for (const decl of m[1].split(';')) {
      const line = src.slice(0, at + decl.length - decl.trimStart().length).split('\n').length;
      at += decl.length + 1;
      const d = decl.trim();
      if (!d) continue;
      if (!/^-{0,2}[a-zA-Z][\w-]*\s*:/.test(d)) problems.push(`line ${line}: not a declaration: ${d.slice(0, 60)}`);
      else if (/\n\s*-{0,2}[a-zA-Z][\w-]*\s*:/.test(d)) problems.push(`line ${line}: missing semicolon: ${d.replace(/\s+/g, ' ').slice(0, 80)}`);
    }
  }
  return problems;
}

const sheets = readdirSync(new URL('../web/', import.meta.url)).filter((f) => f.endsWith('.css'));

test('shared stylesheets: every declaration ends with a semicolon', () => {
  assert.ok(sheets.length > 0);
  for (const f of sheets) assert.deepEqual(declarationProblems(readFileSync(new URL(`../web/${f}`, import.meta.url), 'utf8')), [], f);
});

test('the check catches a missing semicolon (negative control)', () => {
  const bad = ':root {\n  --font-sans: Arial, sans-serif\n  color-scheme: light dark;\n}';
  assert.equal(declarationProblems(bad).length, 1);
  assert.deepEqual(declarationProblems(bad.replace('sans-serif\n', 'sans-serif;\n')), []);
});

test('dark mode: :root declares color-scheme so form controls follow the system', () => {
  const css = readFileSync(new URL('../web/tool.css', import.meta.url), 'utf8');
  assert.match(css, /:root\s*\{[^}]*color-scheme:\s*light dark;/);
});
