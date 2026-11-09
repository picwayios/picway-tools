import { applyRegions, BLUR_ACCEPT, blurImage, MODES, outName, rectFrom, scaleRect, type BlurOptions, type BlurResult, type Level, type Mode } from '@picway-tools/core/blur.ts';
import type { Rect } from '@picway-tools/core/crop.ts';
import { convertImage, OUT_EXT, preload } from '@picway-tools/core/convert.ts';
import { resizeFormatFor, Unsupported, type ResizeChoice } from '@picway-tools/core/resize.ts';
import { pctChange } from '@picway-tools/core/compress.ts';
import { sniffKind, type Kind } from '@picway-tools/core/sniff.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { dropzone, fmtBytes, h, makeT, tick } from '@picway-tools/core/ui.ts'; import { errCode, REASONS } from '@picway-tools/core/errcode.ts';
import { S } from './strings.ts';

const NAMES: Record<string, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', heic: 'HEIC', bmp: 'BMP', tiff: 'TIFF', gif: 'GIF' };

const PREVIEW = 1600;

const TAG: Record<Mode, string> = { mosaic: 'pixelated', blur: 'blurred', box: 'redacted' };

const MIN_DRAG = 4;

export function mount(host: HTMLElement) {
  const t = makeT(S, host); const why = (e: unknown) => (console.warn(e), makeT(REASONS, host)(errCode(e)));
  const opt = { format: 'same' as ResizeChoice, background: '#ffffff', mode: 'mosaic' as Mode, level: 2 as Level };
  let file: File | null = null;
  let srcKind: Kind | null = null;
  let sw = 0;
  let sh = 0;
  let pv: ImageBitmap | null = null;
  let regions: Rect[] = [];
  let loadGen = 0;
  let gen = 0;
  let busy = false; let running: Promise<unknown> = Promise.resolve();
  const urls = new UrlBag();

  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const canvas = h('canvas', { style: 'display:block;max-width:100%;max-height:70vh;width:auto;height:auto;cursor:crosshair' });
  const marks = h('div', { style: 'position:absolute;inset:0;pointer-events:none' });
  const draft = h('div', { hidden: true, style: 'position:absolute;box-sizing:border-box;border:2px dashed #fff;outline:1px solid rgba(0,0,0,.6);pointer-events:none' });
  const stage = h('div', { role: 'group', 'aria-label': t('stage'), style: 'position:relative;display:inline-block;justify-self:start;max-width:100%;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:8px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px' }, canvas, marks, draft);
  const btn = (label: string, on: () => void) => h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: on }, label);
  const count = h('p', { class: 'tl-note', 'aria-live': 'polite' });
  const result = h('div', { class: 'tl-status', style: 'display:grid;gap:4px;justify-items:start' });
  const create = h('button', { type: 'button', class: 'tl-btn', onclick: () => void make() }, t('create'));
  const undo = btn(t('undo'), () => setRegions(regions.slice(0, -1)));
  const clear = btn(t('clear'), () => setRegions([]));
  const pct = (n: number, of: number) => `${(n / of) * 100}%`;

  function invalidate() {
    gen++;
    urls.revokeAll();
    result.replaceChildren();
  }
  const syncButtons = () => ((create.disabled = busy || !file || !regions.length), (undo.disabled = clear.disabled = !regions.length));

  function draw() {
    syncButtons();
    count.textContent = regions.length ? t('count', { n: regions.length }) : t('none');
    if (!pv) return;
    canvas.width = pv.width;
    canvas.height = pv.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(pv, 0, 0);
    applyRegions(ctx, pv.width, pv.height, regions.map((r) => scaleRect(r, sw, sh, pv!.width, pv!.height)), opt.mode, opt.level);
    marks.replaceChildren(...regions.map((r) => h('div', { 'data-area': '', style: `position:absolute;box-sizing:border-box;border:1px dashed rgba(255,255,255,.9);outline:1px solid rgba(0,0,0,.5);left:${pct(r.x, sw)};top:${pct(r.y, sh)};width:${pct(r.w, sw)};height:${pct(r.h, sh)}` })));
  }
  function setRegions(next: Rect[]) {
    regions = next;
    invalidate();
    draw();
  }

  let drag: { x: number; y: number; id: number } | null = null;
  const toImg = (e: PointerEvent): [number, number, number] => {
    const b = canvas.getBoundingClientRect();
    return [((e.clientX - b.left) * sw) / b.width, ((e.clientY - b.top) * sh) / b.height, sw / b.width];
  };
  stage.addEventListener('pointerdown', (e) => {
    if (!pv || e.button !== 0) return;
    e.preventDefault();
    const [x, y] = toImg(e);
    drag = { x, y, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = toImg(e);
    const r = rectFrom(drag.x, drag.y, x, y, sw, sh);
    draft.hidden = !r;
    if (r) Object.assign(draft.style, { left: pct(r.x, sw), top: pct(r.y, sh), width: pct(r.w, sw), height: pct(r.h, sh) });
  });
  const end = (e: PointerEvent, keep: boolean) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y, k] = toImg(e);
    const r = rectFrom(drag.x, drag.y, x, y, sw, sh);
    drag = null;
    draft.hidden = true;
    if (keep && r && r.w >= MIN_DRAG * k && r.h >= MIN_DRAG * k) setRegions([...regions, r]);
  };
  stage.addEventListener('pointerup', (e) => end(e, true));
  stage.addEventListener('pointercancel', (e) => end(e, false)); stage.addEventListener('lostpointercapture', (e) => end(e, false));

  const modeSel = h('select', { onchange: () => ((opt.mode = modeSel.value as Mode), (levelSel.disabled = opt.mode === 'box'), invalidate(), draw()) }, ...MODES.map((m) => h('option', { value: m }, t(m))));
  const levelSel = h('select', { onchange: () => ((opt.level = Number(levelSel.value) as Level), invalidate(), draw()) }, h('option', { value: '1' }, t('l1')), h('option', { value: '2', selected: true }, t('l2')), h('option', { value: '3' }, t('l3')));
  const fmt = h('select', { onchange: () => (onFormat(), invalidate()) },
    h('option', { value: 'same' }, t('same')), h('option', { value: 'jpeg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'), h('option', { value: 'webp' }, 'WebP'));
  const bgIn = h('input', { type: 'color', value: '#ffffff', onchange: () => ((opt.background = bgIn.value), invalidate()) });
  const bgRow = h('label', { class: 'tl-row' }, t('background'), bgIn);
  function onFormat() {
    opt.format = fmt.value as ResizeChoice;
    bgRow.hidden = opt.format === 'webp' || opt.format === 'png' || (opt.format === 'same' && (srcKind === 'png' || srcKind === 'webp' || srcKind === 'avif'));
    if (opt.format === 'webp') preload('webp');
  }

  const editor = h('div', { class: 'tl-opts', hidden: true },
    h('div', { class: 'tl-row' }, h('label', {}, t('mode'), ' ', modeSel), h('label', {}, t('level'), ' ', levelSel)),
    h('div', { class: 'tl-actions' }, btn(t('whole'), () => setRegions([{ x: 0, y: 0, w: sw, h: sh }])), undo, clear),
    stage,
    count,
    h('label', { class: 'tl-row' }, t('format'), fmt),
    bgRow,
    h('p', { class: 'tl-note' }, t('note')),
    h('div', { class: 'tl-actions' }, create),
    result);

  async function open(f: File) {
    const my = ++loadGen; const prev = running; let done = () => {}; running = new Promise<void>((r) => (done = r));
    invalidate();
    editor.hidden = true;
    pv?.close();
    pv = null;
    file = null;
    msg.textContent = t('opening');
    try {
      await prev; if (my !== loadGen) return; if (f.size > 200 * 1048576) throw new TooBig();
      const kind = sniffKind(new Uint8Array(await f.slice(0, 4096).arrayBuffer()));
      if (!resizeFormatFor(kind, 'same')) throw new Unsupported('gif');
      await tick(); if (my !== loadGen) return;
      let w = 0;
      let hh = 0;
      const dec = convertImage(f, { format: 'png', quality: 1, background: '#ffffff', removeLocation: true, removeAllExif: true, resize: (a, b) => { (w = a), (hh = b); const k = Math.min(1, PREVIEW / Math.max(a, b)); return [a * k, b * k]; } }).then((r) => (my === loadGen ? createImageBitmap(r.blob) : null));
      const bmp = await dec;
      if (!bmp || my !== loadGen) return bmp?.close();
      (file = f), (pv = bmp), (sw = w), (sh = hh), (srcKind = kind);
      regions = [];
      onFormat();
      msg.textContent = '';
      editor.hidden = false;
      draw();
    } catch (e) {
      if (my !== loadGen) return;
      msg.textContent = e instanceof TooBig ? t('tooBig') : e instanceof Unsupported ? t('gif') : t('fail', { e: why(e) });
    } finally {
      done(); syncButtons();
    }
  }

  async function make() {
    if (!file || !regions.length) return;
    const my = ++gen;
    busy = true;
    syncButtons();
    urls.revokeAll();
    const o: BlurOptions = { regions: regions.map((r) => ({ ...r })), mode: opt.mode, level: opt.level, srcWidth: sw, srcHeight: sh, format: opt.format, background: opt.background };
    const f = file;
    result.replaceChildren(t('working'));
    try {
      const job = running.then(() => blurImage(f, o)); running = job.then(() => undefined, () => undefined);
      const r = await job;
      if (my !== gen) return;
      if (!r.blob.size) throw new Error('empty result');
      show(f, r, o);
    } catch (e) {
      if (my !== gen) return;
      result.replaceChildren(h('span', { class: 'tl-err' }, e instanceof Unsupported ? t('gif') : t('failSave', { e: why(e) })));
    } finally {
      busy = false;
      syncButtons();
    }
  }
  function show(f: File, r: BlurResult, o: BlurOptions) {
    const name = outName(TAG[o.mode], OUT_EXT[r.format], new Date());
    const url = urls.own(URL.createObjectURL(r.blob));
    const notes = [
      r.downscaled ? `${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height}` : `${r.width}×${r.height}`,
      `${fmtBytes(f.size)} → ${fmtBytes(r.blob.size)} (${pctChange(f.size, r.blob.size)})`,
      `${NAMES[r.from] ?? r.from.toUpperCase()} → ${NAMES[r.format]}`,
      t('exifOut'),
      r.colour === 'p3' ? t('colP3') : r.colourConverted ? t('colSrgb') : '',
      r.flattened ? t('flat') : '',
      r.downscaled ? t('down') : '',
      r.firstFrameOnly ? t('first') : '',
    ].filter(Boolean);
    result.replaceChildren(h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`), h('small', {}, notes.join(' · ')));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: BLUR_ACCEPT, passAll: true, onFiles: (fs) => void open(fs[0]) }),
    msg,
    editor,
  );
  onFormat();
  draw();
}

class TooBig extends Error {}
