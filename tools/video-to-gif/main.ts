import { webcodecsOk, type VideoMeta } from '@picway-tools/core/transcode.ts';
import { probeFrames } from '@picway-tools/core/remux.ts';
import { grabFrames } from '@picway-tools/core/framegrab.ts';
import { GIF_MAX_SECONDS, planGif } from '@picway-tools/core/gifplan.ts';
import { GifWriter } from '@picway-tools/core/gifwrite.ts';
import { scanGif } from '@picway-tools/core/gifdecode.ts';
import { LIMIT_DESKTOP, LIMIT_IOS } from '@picway-tools/core/videoplan.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT } from '@picway-tools/core/ui.ts';
import { S } from './strings.ts';

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
const dur = (s: number) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`)(Math.round(s));
const LENGTHS = [2, 3, 5, 8, 10, 15, GIF_MAX_SECONDS];
const FPS = [10, 15, 5];
const WIDTHS = [480, 320, 640, 0];

const BIG = 8 * 1024 * 1024;
const fmtSec = (s: number) => (Math.round(s * 10) / 10).toString();

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  if (!webcodecsOk()) {
    host.replaceChildren(h('p', { class: 'tl-msg is-error' }, t('noSupport')));
    return;
  }
  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const out = h('div', {});
  const info = h('p', { class: 'tl-note' });
  const gate = new TaskGate();
  const urls = new UrlBag();
  let file: File | null = null;
  let meta: VideoMeta | null = null;
  const opt = { start: 0, length: 3, fps: 10, width: 480, repeat: 0 };

  const prog = h('progress', { class: 'tl-progress', max: 100, value: 0, hidden: true });
  const go = h('button', { class: 'tl-btn', disabled: true, onclick: run }, t('go'));
  const stop = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => gate.cancel() }, t('cancel'));
  const idleUi = () => {
    stop.hidden = prog.hidden = true;
    go.disabled = !meta;
    for (const c of controls) c.disabled = false;
  };

  const dropResult = () => {
    gate.invalidate();
    urls.revokeAll();
    out.replaceChildren();
    idleUi();
  };
  const changed = (k: keyof typeof opt, v: number) => {
    opt[k] = v;
    dropResult();
    if (meta) msg.textContent = t('keepOpen');
  };
  const sel = (k: keyof typeof opt, opts: [number, string][]) =>
    h('select', { onchange: (e: Event) => changed(k, Number((e.target as HTMLSelectElement).value)) }, ...opts.map(([v, l]) => h('option', { value: String(v), selected: v === opt[k] }, l)));
  const from = h('input', { type: 'number', min: 0, step: 0.1, value: '0', inputMode: 'decimal', onchange: () => changed('start', Math.max(0, Number(from.value) || 0)) });
  const lenSel = sel('length', LENGTHS.map((n) => [n, t('sec', { n })]));
  const fpsSel = sel('fps', FPS.map((n) => [n, t('fpsN', { n })]));
  const wSel = sel('width', WIDTHS.map((n) => [n, n ? t('wN', { n }) : t('wOrig')]));
  const loopSel = sel('repeat', [[0, t('loopForever')], [-1, t('loopOnce')]]);
  const controls: (HTMLSelectElement | HTMLInputElement)[] = [from, lenSel, fpsSel, wSel, loopSel];

  async function pick(f: File) {
    dropResult();
    file = f;
    meta = null;
    idleUi();
    info.textContent = '';
    from.value = '0';
    opt.start = 0;
    const limit = isIos() ? LIMIT_IOS : LIMIT_DESKTOP;
    if (f.size > limit) return void (msg.textContent = t(isIos() ? 'tooBigIos' : 'tooBig', { size: fmtBytes(f.size), limit: fmtBytes(limit) }));
    msg.textContent = t('probing');
    try {
      const m = await probeFrames(f);
      if (file !== f) return;
      meta = m;
      info.textContent = t('info', { w: m.w, h: m.h, fps: Math.round(m.fps), dur: dur(m.duration), size: fmtBytes(f.size), codec: m.codec });
      from.max = String(Math.max(0, Math.floor(m.duration * 10) / 10));
      msg.textContent = t('keepOpen');
      go.disabled = false;
    } catch (e) {
      if (file !== f) return;
      const em = e instanceof Error ? e.message : '';
      msg.textContent = em === 'edit-unsupported' ? t('editUnsupported') : em.startsWith('copy-unsupported:') ? t('unsupported', { codec: em.split(':')[1] }) : t('notVideo');
    }
  }

  async function run() {
    const f = file;
    const m = meta;
    if (!f || !m) return;
    const task = gate.begin();
    const o = { ...opt };
    const plan = planGif({ w: m.w, h: m.h, rotation: m.rotation, duration: m.duration, start: o.start, length: o.length, fps: o.fps, width: o.width });
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
      const gif = new GifWriter({ width: plan.w, height: plan.h, repeat: o.repeat, colors: 256, alpha: false, tolerance: 6 });
      const n = await grabFrames(f, plan, m.rotationMatrix, (rgba, i) => gif.add(rgba, plan.delays[i]), {
        signal: task.signal,
        onProgress: (d, total) => {
          if (!task.current) return;
          prog.value = (d / total) * 100;
          msg.textContent = t('working', { pct: Math.round((d / total) * 100) });
        },
      });
      live();
      msg.textContent = t('checking');
      const bytes = gif.finish();

      let ok = false;
      try {
        const s = scanGif(bytes);
        ok = n === plan.times.length && s.frames === plan.times.length && s.width === plan.w && s.height === plan.h && s.loops === (o.repeat < 0 ? 1 : o.repeat);
      } catch (e) {
        console.error(e);
        ok = false;
      }
      live();
      if (!ok) return void (msg.textContent = t('verifyFail'));
      const blob = new Blob([bytes as BlobPart], { type: 'image/gif' });
      const name = `${baseName(f.name)}.gif`;
      const url = urls.own(URL.createObjectURL(blob));
      msg.textContent = t('done', { from: fmtSec(plan.start), to: fmtSec(plan.end), w: plan.w, h: plan.h, n: plan.times.length, size: fmtBytes(blob.size) });
      out.replaceChildren(
        h('img', { src: url, alt: '', class: 'tl-canvas', width: plan.w, height: plan.h }),
        h('p', { class: 'tl-note' }, [blob.size > BIG ? t('big', { size: fmtBytes(blob.size) }) : '', m.hasAudio ? t('noSound') : ''].filter(Boolean).join(' ')),
        h('a', { class: 'tl-btn', href: url, download: name }, t('download', { name })));
    } catch (e) {
      if (gate.version !== task.id) return;
      const em = e instanceof Error ? e.message : String(e);
      msg.textContent =
        e instanceof DOMException && e.name === 'AbortError' ? t('cancelled')
        : em.startsWith('decode-unsupported') ? t('decodeFail', { codec: em.split(':')[1] }) : em === 'edit-unsupported' ? t('editUnsupported')
        : (console.error(e), t('fail'));
    } finally {
      if (gate.version === task.id) idleUi();
    }
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.mp4,.mov,.m4v,video/mp4,video/quicktime', onFiles: ([f]) => pick(f) }),
    h('p', { class: 'tl-note' }, t('privacy')),
    info,
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('from'), from),
      h('label', { class: 'tl-row' }, t('length'), lenSel),
      h('label', { class: 'tl-row' }, t('fps'), fpsSel),
      h('label', { class: 'tl-row' }, t('width'), wSel),
      h('label', { class: 'tl-row' }, t('loop'), loopSel)),
    h('div', { class: 'tl-actions' }, go, stop), prog, msg, out);
}
