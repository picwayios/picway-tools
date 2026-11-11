import { exportWithSnapshot } from '@picway-tools/core/exportsnap.ts';
import { exportCanvas, loadImage, makeCanvas, type Loaded } from '@picway-tools/core/image.ts';
import { Intake, type Failure } from '@picway-tools/core/collagestate.ts';
import { fitRect, fitVisible, gridLayout, stripLayout } from '@picway-tools/core/layout.ts';
import { dropzone, h, makeT, type Strings } from '@picway-tools/core/ui.ts'; import { clearOffer, offerDownload } from '@picway-tools/core/offer.ts'; import { EXTRA } from './strings.ts'; import { capOf, overCap, usedItems } from '@picway-tools/core/collagecap.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose photos or screenshots',
    hint: 'JPG, PNG, WebP or HEIC. Up to 30 in a long strip, 20 in a collage.',
    mode: 'Layout',
    grid: 'Collage',
    strip: 'Long strip (top to bottom)',
    ratio: 'Shape',
    gap: 'Gap',
    bg: 'Background',
    fit: 'Photos',
    cover: 'Fill the cell (crops)',
    contain: 'Fit whole photo',
    format: 'Save as',
    quality: 'JPG quality',
    up: 'Move up',
    down: 'Move down',
    remove: 'Remove',
    download: 'Download',
    clear: 'Clear',
    limit: 'Only the first {n} photos were added.', limitGrid: 'A collage uses only the first {n} photos; the rest stay in the list and are used in a long strip.',
    loadFail: 'Couldn’t open {name}.',
    summary: 'Added {ok}, failed {bad}.',
    retry: 'Retry',
    dismiss: 'Dismiss',
    tooThin: '{name} is too wide and short to place in this layout. Remove it, or try another layout.',
    tooBig: 'This strip is too large for the browser. Remove some photos.',
    scaled: 'The strip was scaled down to fit the browser’s size limit.',
    size: '{w}×{h} px',
    note: 'The picture is made without camera or location info.',
    empty: 'Add at least 2 photos.',
  },
  'zh-Hans': {
    pick: '选择照片或长截图',
    hint: '支持 JPG、PNG、WebP、HEIC。长图最多 30 张，拼图最多 20 张。',
    mode: '版式',
    grid: '拼图',
    strip: '长图（从上到下）',
    ratio: '形状',
    gap: '间距',
    bg: '背景',
    fit: '照片',
    cover: '铺满格子（会裁剪）',
    contain: '完整放入',
    format: '保存为',
    quality: 'JPG 质量',
    up: '上移',
    down: '下移',
    remove: '移除',
    download: '下载',
    clear: '清空',
    limit: '只添加了前 {n} 张。', limitGrid: '拼图只用前 {n} 张，其余留在列表里，换成长图时仍会用上。',
    loadFail: '没能打开 {name}。',
    summary: '成功 {ok} 张，失败 {bad} 张。',
    retry: '重试',
    dismiss: '移除',
    tooThin: '{name} 太扁（或太窄），放进当前版式后不足 1 像素。请移除它，或换个版式。',
    tooBig: '这张长图超出浏览器能画的尺寸，请移除一些照片。',
    scaled: '长图为适应浏览器的尺寸上限做了缩小。',
    size: '{w}×{h} 像素',
    note: '生成的图片不带相机和位置信息。',
    empty: '至少添加 2 张照片。',
  },
};

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const intake = new Intake<Loaded, File>();
  const st = { mode: 'grid', ratio: 1, gap: 12, bg: '#ffffff', fit: 'cover' as 'cover' | 'contain', format: 'jpeg' as 'jpeg' | 'png', quality: 0.92 };
  const sel = (opts: [string, string][], on: (v: string) => void) => {
    const s = h('select', { onchange: () => on(s.value) }, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  const out = h('canvas', { class: 'tl-canvas' });

  const failBox = h('div', { class: 'tl-note', role: 'status' });
  const info = h('p', { class: 'tl-note', role: 'status' });
  const list = h('ul', { class: 'tl-list' });
  let limitNote = ''; const overNote = () => (overCap(intake.items.length, st.mode) ? t('limitGrid', { n: overCap(intake.items.length, st.mode) }) : '');
  const got = h('span', { class: 'tl-got' });
  const dl = h('button', { class: 'tl-btn', disabled: true, onclick: async () => {
    const r = render(), owner = intake.items;
    if (!r || r.problem) return;
    const snap = { format: st.format, name: st.mode === 'strip' ? 'long-strip' : 'collage' }, quality = st.quality;
    await exportWithSnapshot(snap, (s) => exportCanvas(r.canvas, s.format, quality, r.icc), () => owner === intake.items, (b, name) => void offerDownload({ slot: got, blob: b, name, label: `${t('download')} ${name}`, auto: true }));
  } }, t('download'));
  const ratioRow = h('label', { class: 'tl-row' }, t('ratio'), sel([['1', '1:1'], ['0.8', '4:5'], ['0.75', '3:4'], ['0.5625', '9:16']], (v) => ((st.ratio = Number(v)), draw())));
  const fitRow = h('label', { class: 'tl-row' }, t('fit'), sel([['cover', t('cover')], ['contain', t('contain')]], (v) => ((st.fit = v as 'cover' | 'contain'), draw())));
  const modeSel = sel([['grid', t('grid')], ['strip', t('strip')]], (v) => ((st.mode = v), (limitNote = ''), (ratioRow.hidden = fitRow.hidden = v === 'strip'), draw()));
  const gap = h('input', { type: 'range', min: '0', max: '60', value: '12', oninput: () => ((st.gap = Number(gap.value)), draw()) });
  const bg = h('input', { type: 'color', value: '#ffffff', oninput: () => ((st.bg = bg.value), draw()) });
  const fmt = sel([['jpeg', 'JPG'], ['png', 'PNG']], (v) => (st.format = v as 'jpeg' | 'png'));

  function render(): { canvas: HTMLCanvasElement; icc: Uint8Array | null; W: number; H: number; scaled: boolean; problem: string | null } | null {
    const items = usedItems(intake.items, st.mode);
    if (items.length < 2) return null;
    const p3 = items.every((i) => i.p3);
    const icc = p3 ? items[0].icc : null;
    const { W, H, place, scaled, problem } = plan();
    if (problem) return { canvas: out, icc: null, W, H, scaled, problem };
    const c = makeCanvas(W, H, p3);
    c.ctx.fillStyle = st.bg;
    c.ctx.fillRect(0, 0, W, H);
    items.forEach((it, i) => {
      const f = fitRect({ w: it.bmp.width, h: it.bmp.height }, place[i], st.mode === 'strip' ? 'contain' : st.fit);
      c.ctx.drawImage(it.bmp, f.sx, f.sy, f.sw, f.sh, f.dx, f.dy, f.dw, f.dh);
    });
    return { canvas: c.canvas, icc: c.p3 ? icc : null, W, H, scaled, problem: null };
  }

  function plan(): { W: number; H: number; place: { x: number; y: number; w: number; h: number }[]; scaled: boolean; problem: string | null } {
    const items = usedItems(intake.items, st.mode);
    if (st.mode === 'strip') {
      const base = Math.min(1080, Math.max(...items.map((i) => i.bmp.width)));
      const l = stripLayout(items.map((i) => ({ w: i.bmp.width, h: i.bmp.height })), base, st.gap);
      const problem = l.thin.length ? t('tooThin', { name: items[l.thin[0]].name }) : l.huge ? t('tooBig') : null;
      return { W: l.W, H: l.H, place: l.rects, scaled: l.scaled, problem };
    }
    const l = gridLayout(items.length, 1080, st.ratio, st.gap);
    let problem: string | null = null;
    if (st.fit === 'contain') {
      const bad = items.findIndex((it, i) => !fitVisible(fitRect({ w: it.bmp.width, h: it.bmp.height }, l.cells[i], 'contain')));
      if (bad >= 0) problem = t('tooThin', { name: items[bad].name });
    }
    return { W: l.W, H: l.H, place: l.cells, scaled: false, problem };
  }
  function drawFailures() {
    const fs = intake.failures;
    if (!fs.length) return failBox.replaceChildren();
    failBox.replaceChildren(
      h('p', {}, t('summary', { ok: intake.items.length, bad: fs.length })),
      ...fs.map((f) => h('p', { class: 'tl-item' }, h('span', { class: 'tl-name' }, t('loadFail', { name: f.name })),
        h('span', { class: 'tl-actions' },
          h('button', { class: 'tl-btn tl-btn--ghost', onclick: () => { intake.dismissFailure(f); void add([f.file]); } }, t('retry')),
          h('button', { class: 'tl-btn tl-btn--ghost', onclick: () => { intake.dismissFailure(f); drawFailures(); } }, t('dismiss'))))));
  }
  let refocus: { i: number; d: number } | null = null;
  function draw() {
    const items = intake.items;
    list.replaceChildren(...items.map((it, i) => {
      const move = (d: number) => () => { const j = i + d; if (j < 0 || j >= items.length) return; [items[i], items[j]] = [items[j], items[i]]; refocus = { i: j, d }; draw(); };
      return h('li', { class: 'tl-item' }, h('span', { class: 'tl-name' }, `${i + 1}. ${it.name}`),
        h('span', { class: 'tl-status' }, h('span', { class: 'tl-actions' },
          h('button', { class: 'tl-btn tl-btn--ghost', 'aria-label': t('up'), onclick: move(-1) }, '↑'),
          h('button', { class: 'tl-btn tl-btn--ghost', 'aria-label': t('down'), onclick: move(1) }, '↓'),
          h('button', { class: 'tl-btn tl-btn--ghost', onclick: () => { const [gone] = items.splice(i, 1); gone.bmp.close(); draw(); } }, t('remove')))));
    }));
    if (refocus) {
      (list.children[refocus.i]?.querySelectorAll('.tl-actions button')[refocus.d < 0 ? 0 : 1] as HTMLElement | undefined)?.focus();
      refocus = null;
    }
    drawFailures();
    const r = render();
    dl.disabled = !r || !!r.problem;
    if (!r) {
      out.width = out.height = 0;
      info.textContent = [limitNote, overNote(), t('empty')].filter(Boolean).join(' ');
      return;
    }
    if (r.problem) {
      out.width = out.height = 0;
      info.textContent = [limitNote, overNote(), r.problem].filter(Boolean).join(' ');
      return;
    }
    out.width = r.W;
    out.height = r.H;
    out.getContext('2d')!.drawImage(r.canvas, 0, 0);
    info.textContent = [limitNote, overNote(), r.scaled ? t('scaled') : '', t('size', { w: r.W, h: r.H }) + '.', t('note')].filter(Boolean).join(' ');
  }
  async function add(files: File[]) {
    const cap = capOf(st.mode);
    const ticket = intake.reserve(cap, files.length);
    limitNote = files.length > ticket.n ? t('limit', { n: cap }) : '';
    const batch = files.slice(0, ticket.n);
    for (const f of batch) {
      let it: Loaded | null = null;
      try {
        it = await loadImage(f);
      } catch {
        it = null;
      }
      if (!intake.settle(ticket, it, it ? undefined : ({ file: f, name: f.name } as Failure<File>))) {
        it?.bmp.close();
        return;
      }
      draw();
    }
    draw();
  }
  function clearAll() {
    for (const it of intake.clear()) it.bmp.close();
    limitNote = '';
    draw();
  }
  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: 'image/*,.heic,.heif', multiple: true, onFiles: add }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('mode'), modeSel), ratioRow, fitRow,
      h('label', { class: 'tl-row' }, t('gap'), gap), h('label', { class: 'tl-row' }, t('bg'), bg),
      h('label', { class: 'tl-row' }, t('format'), fmt)),
    list, failBox, out, info,
    h('div', { class: 'tl-actions' }, dl, got, h('button', { class: 'tl-btn tl-btn--ghost', onclick: clearAll }, t('clear'))));
  draw();
}
