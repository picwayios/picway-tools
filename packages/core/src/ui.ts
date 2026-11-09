export type Lang = 'en' | 'zh-Hans' | 'zh-Hant' | 'ja';

export type Strings<K extends string> = { en: Record<K, string> } & Partial<Record<Exclude<Lang, 'en'>, Record<K, string>>>;

export const langOf = (host?: HTMLElement): Lang => {
  const l = host?.dataset.lang ?? document.documentElement.lang ?? 'en';
  if (/^zh-(hant|tw|hk|mo)/i.test(l)) return 'zh-Hant';
  if (l.startsWith('zh')) return 'zh-Hans';
  return l.startsWith('ja') ? 'ja' : 'en';
};

export function makeT<K extends string>(strings: Strings<K>, host?: HTMLElement) {
  const dict = strings[langOf(host)] ?? strings.en;
  return (k: K, vars: Record<string, string | number> = {}) => dict[k].replace(/\{(\w+)\}/g, (_, v) => String(vars[v] ?? ''));
}

type Child = Node | string | null | undefined | false;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k in e && k !== 'list') (e as unknown as Record<string, unknown>)[k] = v;
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids) if (c) e.append(c);
  return e;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function dropzone(opts: { label: string; hint?: string; accept: string; multiple?: boolean; passAll?: boolean; onFiles: (files: File[]) => void }): HTMLElement {
  const exts = opts.accept.split(',').map((x) => x.trim().toLowerCase());
  const ok = (f: File) => opts.passAll || exts.some((x) => (x.startsWith('.') ? f.name.toLowerCase().endsWith(x) : x.endsWith('/*') ? f.type.startsWith(x.slice(0, -1)) : f.type === x));
  const input = h('input', { type: 'file', accept: opts.accept, multiple: !!opts.multiple, class: 'tl-file' });
  const root = h('label', { class: 'tl-drop' }, h('strong', {}, opts.label), opts.hint ? h('span', {}, opts.hint) : null, input);
  input.addEventListener('change', () => {
    const fs = Array.from(input.files ?? []);
    input.value = '';
    if (fs.length) opts.onFiles(opts.multiple ? fs : fs.slice(0, 1));
  });
  for (const ev of ['dragenter', 'dragover']) root.addEventListener(ev, (e) => (e.preventDefault(), root.classList.add('is-over')));
  for (const ev of ['dragleave', 'drop']) root.addEventListener(ev, () => root.classList.remove('is-over'));
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    const fs = Array.from((e as DragEvent).dataTransfer?.files ?? []).filter(ok);
    if (fs.length) opts.onFiles(opts.multiple ? fs : fs.slice(0, 1));
  });
  return root;
}

import { toolLink } from './toolpages.ts';

export const toolHref = (id: string) => toolLink(id);

export class Hint extends Error {
  constructor(message: string, public links: [text: string, href: string][]) { super(message); }
}
export function hintNodes(e: Hint): Node[] {
  return [h('span', {}, e.message), h('span', { class: 'tl-links' }, ...e.links.filter(([, href]) => href).flatMap(([text, href], i) => [i ? ' · ' : ' ', h('a', { href }, text)]))];
}
export const isJpgPng = (f: File) => /^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/i.test(f.name);

export const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));
