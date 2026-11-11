import { webcodecsOk } from '@picway-tools/core/transcode.ts';
import { scanGif, walkGif } from '@picway-tools/core/gifdecode.ts';
import { gifToMp4, verifyGifMp4 } from '@picway-tools/core/gifmp4.ts';
import { GIF_LIMIT_DESKTOP, GIF_LIMIT_IOS, GIF_MAX_PIXELS, MP4_MAX_FRAMES, frameTimes } from '@picway-tools/core/gifmp4plan.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT } from '@picway-tools/core/ui.ts';
import { S } from './strings.ts';

import { isIOS as isIos } from '@picway-tools/core/platform.ts';
const SIZES = [0, 1080, 720, 480];
const PASSES = [1, 2, 3, 5, 10];
const BGS: Record<string, [number, number, number]> = { white: [255, 255, 255], black: [0, 0, 0] };
const secs = (ms: number) => (Math.round(ms / 100) / 10).toFixed(1);

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
  let gif: { bytes: Uint8Array; width: number; height: number; delays: number[] } | null = null;
  const opt = { maxLong: 0, passes: 1, bg: 'white' };

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
  const sizeSel = h('select', { onchange: () => changed('maxLong', Number(sizeSel.value)) }, ...SIZES.map((n) => h('option', { value: String(n), selected: n === opt.maxLong }, n ? t('sN', { n }) : t('sOrig'))));
  const passSel = h('select', { onchange: () => changed('passes', Number(passSel.value)) }, ...PASSES.map((n) => h('option', { value: String(n), selected: n === opt.passes }, n === 1 ? t('passOnce') : t('passN', { n }))));
  const bgSel = h('select', { onchange: () => changed('bg', bgSel.value) }, h('option', { value: 'white', selected: true }, t('bgWhite')), h('option', { value: 'black' }, t('bgBlack')));
  const controls: HTMLSelectElement[] = [sizeSel, passSel, bgSel];

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
      if (s.width * s.height <= GIF_MAX_PIXELS) walkGif(bytes).next();
    } catch (e) {
      if (file !== f) return;
      console.error(e);
      return void (msg.textContent = t('notGif'));
    }
    if (s.width * s.height > GIF_MAX_PIXELS) return void (msg.textContent = t('tooManyPixels', { w: s.width, h: s.height }));
    if (s.frames < 2) return void (msg.textContent = t('still'));
    gif = { bytes, width: s.width, height: s.height, delays: s.delays };
    info.textContent = t('info', { w: s.width, h: s.height, n: s.frames, dur: secs(s.delays.reduce((a, d) => a + d, 0)), size: fmtBytes(f.size) });
    msg.textContent = t('keepOpen');
    go.disabled = false;
  }

  async function run() {
    const f = file;
    const g = gif;
    if (!f || !g) return;
    const o = { ...opt };
    const want = g.delays.length * o.passes;
    if (want > MP4_MAX_FRAMES) return void (msg.textContent = t('tooLong', { n: want, max: MP4_MAX_FRAMES }));
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
      const r = await gifToMp4(g.bytes, g, {
        maxLong: o.maxLong,
        passes: o.passes,
        bg: BGS[o.bg] ?? BGS.white,
        lowMemory: isIos(),
        signal: task.signal,
        onProgress: (d, total) => {
          if (!task.current) return;
          prog.value = (d / total) * 100;
          msg.textContent = t('working', { pct: Math.round((d / total) * 100) });
        },
      });
      live();
      msg.textContent = t('checking');

      const ok = r.frames === want && (await verifyGifMp4(r.blob, r.plan, Math.round(g.delays[g.delays.length - 1] * 1000), frameTimes(g.delays, o.passes).dur));
      live();
      if (!ok) return void (msg.textContent = t('verifyFail'));
      const name = `${baseName(f.name)}.mp4`;
      const url = urls.own(URL.createObjectURL(r.blob));
      msg.textContent = t('done', { w: r.plan.w, h: r.plan.h, n: r.plan.frames, dur: secs(r.plan.durationUs / 1000), size: fmtBytes(r.blob.size) });
      out.replaceChildren(
        h('video', { muted: true, playsInline: true, loop: true, autoplay: true, controls: true, class: 'tl-canvas', width: r.plan.w, height: r.plan.h, src: url }),
        h('p', { class: 'tl-note' }, t('noSound')),
        h('a', { class: 'tl-btn', href: url, download: name }, t('download', { name })));
    } catch (e) {
      if (gate.version !== task.id) return;
      const em = e instanceof Error ? e.message : String(e);
      msg.textContent =
        e instanceof DOMException && e.name === 'AbortError' ? t('cancelled')
        : em.startsWith('encode-unsupported') ? t('encodeFail')
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
      h('label', { class: 'tl-row' }, t('passes'), passSel),
      h('label', { class: 'tl-row' }, t('bg'), bgSel)),
    h('div', { class: 'tl-actions' }, go, stop), prog, msg, out);
}
