// Extension page: a tab bar with the tools of this extension. Each tool is mounted the
// first time its tab is opened and stays mounted, so switching tabs keeps its state.
import type { ExtData } from './types';

type Loader = () => Promise<{ mount: (el: HTMLElement) => void }>;

const SITE = 'https://picway.app';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}

/** Inline text from the page data: **bold** and [text](href). Built as DOM nodes, never as HTML. */
function inline(text: string): Node[] {
  const out: Node[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(document.createTextNode(text.slice(last, m.index)));
    if (m[1] !== undefined) out.push(el('strong', {}, m[1]));
    else out.push(el('a', { href: m[3] }, m[2]));
    last = re.lastIndex;
  }
  if (last < text.length) out.push(document.createTextNode(text.slice(last)));
  return out;
}

export function start(data: ExtData, loaders: Record<string, Loader>) {
  const ids = data.tools.map((t) => t.id);
  const tabs = el('div', { class: 'x-tabs', role: 'tablist', 'aria-label': data.name });
  const panels = el('div', { class: 'x-panels' });
  const mounted = new Set<string>();
  const tabBtn: Record<string, HTMLButtonElement> = {};
  const panel: Record<string, HTMLElement> = {};

  for (const t of data.tools) {
    const b = el('button', { type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': `panel-${t.id}`, 'aria-selected': 'false' }, t.name);
    b.addEventListener('click', () => (location.hash = t.id));
    tabBtn[t.id] = b;
    tabs.append(b);

    const host = el('div', { 'data-tool': t.id, 'data-lang': 'en' });
    const steps = el('ol', {}, ...t.steps.map((s) => el('li', { class: 'step' }, el('h3', {}, s.name), el('p', {}, ...inline(s.text)))));
    const p = el('section', { class: 'x-panel', role: 'tabpanel', id: `panel-${t.id}`, 'aria-labelledby': `tab-${t.id}` },
      el('h2', {}, t.name),
      el('p', { class: 'x-benefit' }, t.benefit),
      el('div', { class: 'tool' }, host),
      el('section', { class: 'steps', 'aria-label': 'How to use' }, el('h2', {}, 'How to use'), steps),
      el('p', { class: 'x-web' }, 'This tool is also on the web: ', el('a', { href: `${SITE}/tools/${t.id}/` }, `${t.name} on picway.app`)),
    );
    p.hidden = true;
    panel[t.id] = p;
    panels.append(p);
  }

  const show = () => {
    const want = location.hash.slice(1);
    const id = ids.includes(want) ? want : ids[0];
    for (const x of ids) {
      panel[x].hidden = x !== id;
      tabBtn[x].setAttribute('aria-selected', String(x === id));
      tabBtn[x].tabIndex = x === id ? 0 : -1;
    }
    const t = data.tools.find((x) => x.id === id)!;
    document.title = `${t.name} · ${data.name}`;
    if (!mounted.has(id)) {
      mounted.add(id);
      const host = panel[id].querySelector<HTMLElement>('[data-tool]')!;
      loaders[id]()
        .then((m) => m.mount(host))
        .catch((e) => {
          console.error(e);
          host.textContent = 'This tool couldn’t load. Reload this page.';
        });
    }
  };

  // Arrow keys move between tabs (WAI-ARIA tabs pattern).
  tabs.addEventListener('keydown', (e) => {
    const i = ids.indexOf(location.hash.slice(1) || ids[0]);
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = ids[(Math.max(i, 0) + d + ids.length) % ids.length];
    location.hash = next;
    tabBtn[next].focus();
  });

  // Links inside the tools point at website paths such as /tools/photo-border/.
  // A tool in this extension opens its tab; anything else opens on picway.app in a new tab.
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!a || a.hasAttribute('download')) return;
    const raw = a.getAttribute('href') ?? '';
    if (raw.startsWith('#') || raw.startsWith('blob:')) return;
    e.preventDefault();
    const tool = /^\/tools\/([a-z0-9-]+)\/?$/.exec(raw)?.[1];
    if (tool && ids.includes(tool)) return void (location.hash = tool);
    const url = raw.startsWith('/') ? SITE + raw : raw;
    if (/^https:\/\//.test(url)) window.open(url, '_blank', 'noopener');
  }, true);

  const app = document.getElementById('app')!;
  app.append(tabs, panels);
  window.addEventListener('hashchange', show);
  show();
}
