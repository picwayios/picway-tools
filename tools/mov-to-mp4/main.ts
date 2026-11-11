import { transcode, webcodecsOk, type VideoMeta } from '@picway-tools/core/transcode.ts';
import { copyKind, probeCopy, remux, verifyOutput, verifyRemux } from '@picway-tools/core/remux.ts';
import { convertBytes, LIMIT_DESKTOP, LIMIT_IOS } from '@picway-tools/core/videoplan.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT } from '@picway-tools/core/ui.ts';
import { S, S2 } from './strings.ts';

type Mode = 'copy' | 'h264';
import { isIOS as isIos } from '@picway-tools/core/platform.ts';
const dur = (s: number) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`)(Math.round(s));

export const outName = (name: string) => `${baseName(name)}${/\.mp4$/i.test(name) ? '-converted' : ''}.mp4`;

const convertTooBig = (m: VideoMeta) => isIos() && convertBytes(m) > LIMIT_IOS;

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const t2 = makeT(S2, host);
  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const note = h('p', { class: 'tl-note' });
  const out = h('div', {});
  const info = h('p', { class: 'tl-note' });
  const gate = new TaskGate();
  const urls = new UrlBag();
  let file: File | null = null;
  let meta: VideoMeta | null = null;
  let mode: Mode = 'copy';

  const modeSel = h('select', { onchange: () => setMode(modeSel.value as Mode) }, h('option', { value: 'copy' }, t('copy')), h('option', { value: 'h264' }, t('h264')));
  const modeRow = h('label', { class: 'tl-row', hidden: true }, t('video'), modeSel);
  const prog = h('progress', { class: 'tl-progress', max: 100, value: 0, hidden: true });
  const go = h('button', { class: 'tl-btn', disabled: true, onclick: run }, t('start'));
  const stop = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => gate.cancel() }, t('cancel'));

  const idleUi = () => {
    stop.hidden = prog.hidden = true;
    go.disabled = !meta || blocked();
    modeSel.disabled = false;
  };

  const dropResult = () => {
    gate.invalidate();
    urls.revokeAll();
    out.replaceChildren();
    idleUi();
  };

  const blocked = () => !!meta && mode === 'h264' && convertTooBig(meta);
  const explain = () => {
    if (!meta) return void (note.textContent = '');
    const parts = [meta.hevc ? (webcodecsOk() ? t('hevcNote') : t('noEncoder')) : t('avcNote')];
    if (meta.hdr && mode === 'h264') parts.push(t('hdr'));
    if (blocked()) parts.push(t2('convertTooBigIos', { size: fmtBytes(convertBytes(meta)), limit: fmtBytes(LIMIT_IOS) }));
    note.textContent = parts.join(' ');
  };
  function setMode(m: Mode) {
    mode = m;
    modeSel.value = m;
    dropResult();
    msg.textContent = '';
    explain();
  }

  async function pick(f: File) {
    dropResult();
    file = f;
    meta = null;
    idleUi();
    info.textContent = note.textContent = '';
    modeRow.hidden = true;
    const limit = isIos() ? LIMIT_IOS : LIMIT_DESKTOP;
    if (f.size > limit) return void (msg.textContent = t(isIos() ? 'tooBigIos' : 'tooBig', { size: fmtBytes(f.size), limit: fmtBytes(limit) }));
    msg.textContent = t('probing');
    try {
      const m = await probeCopy(f);
      if (file !== f) return;
      if (!copyKind(m.codec)) throw new Error('copy-unsupported:' + m.codec);
      meta = m;
      info.textContent = t('info', { w: m.w, h: m.h, fps: Math.round(m.fps), dur: dur(m.duration), size: fmtBytes(f.size), codec: m.codec });

      modeRow.hidden = !m.hevc || !webcodecsOk();
      mode = m.hevc && webcodecsOk() && !convertTooBig(m) ? 'h264' : 'copy';
      modeSel.value = mode;
      explain();
      msg.textContent = t('keepOpen');
      go.disabled = blocked();
    } catch (e) {
      if (file !== f) return;
      const em = e instanceof Error ? e.message : '';
      msg.textContent = em.startsWith('copy-unsupported') ? t('copyUnsupported', { codec: em.split(':')[1] }) : t('notVideo');
    }
  }

  async function run() {
    const f = file;
    const m = meta;
    if (!f || !m || blocked()) return;
    const task = gate.begin();
    const how = mode;
    urls.revokeAll();
    out.replaceChildren();
    go.disabled = modeSel.disabled = true;
    stop.hidden = prog.hidden = false;
    prog.value = 0;
    msg.textContent = t('working', { pct: 0 });

    const live = () => {
      if (!task.current) throw new DOMException('aborted', 'AbortError');
    };
    const onProgress = (d: number, n: number) => {
      if (!task.current) return;
      prog.value = (d / n) * 100;
      msg.textContent = t('working', { pct: Math.round((d / n) * 100) });
    };
    try {
      let blob: Blob;
      let ok: boolean;
      let audio: { has: boolean; kept: boolean };
      if (how === 'copy') {
        const r = await remux(f, { signal: task.signal, onProgress });
        live();
        msg.textContent = t('checking');
        ok = await verifyRemux(r);
        blob = r.blob;
        audio = { has: r.meta.hasAudio, kept: r.meta.audioKept };
      } else {
        const r = await transcode(f, { preset: 'convert', maxLong: 0, lowMemory: isIos(), signal: task.signal, onProgress });
        live();
        msg.textContent = t('checking');

        const srcFrames = r.frames;
        live();
        ok = await verifyOutput(r.blob, { kind: 'avc', w: r.plan.w, h: r.plan.h, frames: srcFrames, turn: r.meta.rotationMatrix });
        blob = r.blob;
        audio = { has: r.meta.hasAudio, kept: r.meta.audioKept };
      }
      live();
      if (!ok) return void (msg.textContent = t('verifyFail'));
      const name = outName(f.name);
      const url = urls.own(URL.createObjectURL(blob));
      msg.textContent = t('done', { name, size: fmtBytes(blob.size) });
      out.replaceChildren(
        h('video', { src: url, controls: true, playsInline: true, class: 'tl-canvas', preload: 'metadata' }),
        h('p', { class: 'tl-note' }, [audio.has ? t(audio.kept ? 'audioKept' : 'audioDropped') : '', t('metaDropped')].filter(Boolean).join(' ')),
        h('a', { class: 'tl-btn', href: url, download: name }, t('download', { name })));
    } catch (e) {
      if (gate.version !== task.id) return;
      const em = e instanceof Error ? e.message : String(e);
      msg.textContent =
        e instanceof DOMException && e.name === 'AbortError' ? t('cancelled')
        : em.startsWith('decode-unsupported') ? t('decodeFail', { codec: em.split(':')[1] })
        : em.startsWith('encode-unsupported') ? t('encodeFail')
        : em.startsWith('copy-unsupported') ? t('copyUnsupported', { codec: em.split(':')[1] })
        : (console.error(e), t('fail'));
    } finally {
      if (gate.version === task.id) idleUi();
    }
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.mov,.qt,.mp4,.m4v,video/quicktime,video/mp4', onFiles: ([f]) => pick(f) }),
    h('p', { class: 'tl-note' }, t('privacy')),
    info,
    h('div', { class: 'tl-opts' }, modeRow),
    note,
    h('div', { class: 'tl-actions' }, go, stop), prog, msg, out);
}
