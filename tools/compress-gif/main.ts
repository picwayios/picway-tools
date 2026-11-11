import { scanGif, walkGif } from '@picway-tools/core/gifdecode.ts';
import { GIF_LEVELS, GIF_SIZES, GIF_STEPS, compressGif, planGifCompress, verifyGifCompress, type GifLevel, type Resize } from '@picway-tools/core/gifcompress.ts';
import { gifLoops } from '@picway-tools/core/gifpack.ts';
import { GIF_LIMIT_DESKTOP, GIF_LIMIT_IOS, GIF_MAX_PIXELS } from '@picway-tools/core/gifmp4plan.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT, tick } from '@picway-tools/core/ui.ts';
import { S } from './strings.ts';

import { isIOS as isIos } from '@picway-tools/core/platform.ts';
const secs = (ms: number) => (Math.round(ms / 100) / 10).toFixed(1);
const canvas = (w: number, hh: number) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, hh) : Object.assign(document.createElement('canvas'), { width: w, height: hh }));

function makeResize(): Resize {
  let src: OffscreenCanvas | HTMLCanvasElement | null = null;
  let dst: OffscreenCanvas | HTMLCanvasElement | null = null;
  return (rgba, gw, gh, w, hh) => {
    src ??= canvas(gw, gh);
    dst ??= canvas(w, hh);
    (src.getContext('2d') as CanvasRenderingContext2D).putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, gw, gh), 0, 0);
    const c = dst.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    c.clearRect(0, 0, w, hh);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, w, hh);
    return c.getImageData(0, 0, w, hh).data;
  };
}

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const out = h('div', {});
  const info = h('p', { class: 'tl-note' });
  const gate = new TaskGate();
  const urls = new UrlBag();
  let file: File | null = null;
  let gif: { bytes: Uint8Array; width: number; height: number; delays: number[] } | null = null;
  const opt: { maxLong: number; step: number; level: GifLevel } = { maxLong: 0, step: 1, level: 'medium' };

  const prog = h('progress', { class: 'tl-progress', max: 100, value: 0, hidden: true });
  const go = h('button', { class: 'tl-btn', disabled: true, onclick: run }, t('go'));
  const stop = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => gate.cancel() }, t('cancel'));
  const idleUi = () => {
    stop.hidden = prog.hidden = true;
    go.disabled = !gif;
    for (const c of controls) c.disabled = false;
  };

  const dropResult = () => {
    gate.invalidate();
    urls.revokeAll();
    out.replaceChildren();
    idleUi();
  };
  const changed = <K extends keyof typeof opt>(k: K, v: (typeof opt)[K]) => {
    opt[k] = v;
    dropResult();
    if (gif) msg.textContent = t('keepOpen');
  };
  const sizeSel = h('select', { onchange: () => changed('maxLong', Number(sizeSel.value)) }, ...GIF_SIZES.map((n) => h('option', { value: String(n), selected: n === opt.maxLong }, n ? t('sN', { n }) : t('sOrig'))));
  const levelSel = h('select', { onchange: () => changed('level', levelSel.value as GifLevel) }, ...(['light', 'medium', 'heavy'] as const).map((k) => h('option', { value: k, selected: k === opt.level }, t(k))));
  const stepSel = h('select', { onchange: () => changed('step', Number(stepSel.value)) }, ...GIF_STEPS.map((n) => h('option', { value: String(n), selected: n === opt.step }, n === 1 ? t('fAll') : t('fN', { n }))));
  const controls: HTMLSelectElement[] = [sizeSel, levelSel, stepSel];

  async function pick(f: File) {
    dropResult();
    file = f;
    gif = null;
    idleUi();
    info.textContent = '';
    const limit = isIos() ? GIF_LIMIT_IOS : GIF_LIMIT_DESKTOP;
    if (f.size > limit) return void (msg.textContent = t(isIos() ? 'tooBigIos' : 'tooBig', { size: fmtBytes(f.size), limit: fmtBytes(limit) }));
    msg.textContent = t('probing');
    let bytes: Uint8Array;
    let s: ReturnType<typeof scanGif>;
    try {
      bytes = new Uint8Array(await f.arrayBuffer());
      if (file !== f) return;
      s = scanGif(bytes);
      gifLoops(bytes);
      if (s.width * s.height <= GIF_MAX_PIXELS) walkGif(bytes).next();
    } catch (e) {
      if (file !== f) return;
      console.error(e);
      return void (msg.textContent = t('notGif'));
    }
    if (s.width * s.height > GIF_MAX_PIXELS) return void (msg.textContent = t('tooManyPixels', { w: s.width, h: s.height }));
    gif = { bytes, width: s.width, height: s.height, delays: s.delays };
    info.textContent = s.frames < 2 ? t('infoStill', { w: s.width, h: s.height, size: fmtBytes(f.size) }) : t('info', { w: s.width, h: s.height, n: s.frames, dur: secs(s.delays.reduce((a, d) => a + d, 0)), size: fmtBytes(f.size) });
    msg.textContent = t('keepOpen');
    go.disabled = false;
  }

  async function run() {
    const f = file;
    const g = gif;
    if (!f || !g) return;
    const o = { ...opt };
    const plan = planGifCompress({ width: g.width, height: g.height, delays: g.delays, maxLong: o.maxLong, step: o.step, ...GIF_LEVELS[o.level] });
    if (g.delays.length > 1 && plan.keep.length < 2) return void (msg.textContent = t('tooFew', { n: o.step }));
    const task = gate.begin();
    urls.revokeAll();
    out.replaceChildren();
    go.disabled = true;
    for (const c of controls) c.disabled = true;
    stop.hidden = prog.hidden = false;
    prog.value = 0;
    msg.textContent = t('working', { pct: 0 });
    const live = () => {
      if (!task.current) throw new DOMException('aborted', 'AbortError');
    };
    try {
      const bytes = await compressGif(g.bytes, g, plan, {
        stopAt: f.size,
        resize: makeResize(),
        signal: task.signal,
        onProgress: (d, total) => {
          if (!task.current) return;
          prog.value = (d / total) * 100;
          msg.textContent = t('working', { pct: Math.round((d / total) * 100) });
        },
      });
      live();
      if (bytes.length >= f.size) return void (msg.textContent = t('notSmaller', { size: fmtBytes(f.size) }));
      msg.textContent = t('checking'); await tick(); live();

      const ok = await verifyGifCompress(bytes, plan, gifLoops(g.bytes), task.signal);
      live();
      if (!ok) return void (msg.textContent = t('verifyFail'));
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' });
      const name = `${baseName(f.name)}-compressed.gif`;
      const url = urls.own(URL.createObjectURL(blob));
      const pct = Math.floor((1 - blob.size / f.size) * 100);
      msg.textContent = t(pct < 1 ? 'doneLittle' : 'done', { w: plan.w, h: plan.h, before: fmtBytes(f.size), after: fmtBytes(blob.size), pct });
      out.replaceChildren(
        h('img', { class: 'tl-canvas', src: url, width: plan.w, height: plan.h, alt: '' }),
        h('a', { class: 'tl-btn', href: url, download: name }, t('download', { name })));
    } catch (e) {
      if (gate.version !== task.id) return;
      const em = e instanceof Error ? e.message : String(e);
      msg.textContent =
        e instanceof DOMException && e.name === 'AbortError' ? t('cancelled')
        : em === 'not-smaller' ? t('notSmaller', { size: fmtBytes(f.size) }) : /^(not-gif|truncated|bad-block|bad-lzw|bad-size|no-palette|no-frames)$/.test(em) ? (console.error(e), t('notGif'))
        : (console.error(e), t('fail'));
    } finally {
      if (gate.version === task.id) idleUi();
    }
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.gif,image/gif', onFiles: ([f]) => pick(f) }),
    h('p', { class: 'tl-note' }, t('privacy')),
    info,
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('size'), sizeSel),
      h('label', { class: 'tl-row' }, t('level'), levelSel),
      h('label', { class: 'tl-row' }, t('frames'), stepSel)),
    h('div', { class: 'tl-actions' }, go, stop), prog, msg, out);
}
