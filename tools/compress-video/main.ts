import { probe, transcode, webcodecsOk, type VideoMeta } from '@picway-tools/core/transcode.ts'; import { verifyOutput } from '@picway-tools/core/remux.ts';
import { displaySize, LIMIT_DESKTOP, LIMIT_IOS, resultDetail, type Preset } from '@picway-tools/core/videoplan.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT, type Strings } from '@picway-tools/core/ui.ts'; import { EXTRA } from './strings.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose a video',
    hint: 'MOV or MP4 from your iPhone or camera. One video at a time.',
    quality: 'Quality',
    balanced: 'Balanced: smaller, still sharp',
    smaller: 'Smallest: for sending over chat or email',
    res: 'Resolution',
    keep: 'Keep the original size',
    r1080: 'At most 1080p',
    r720: 'At most 720p',
    start: 'Compress',
    cancel: 'Cancel',
    probing: 'Reading the video…',
    info: '{w}×{h}, {fps} fps, {dur}, {size}, {codec}',
    working: 'Compressing… {pct}%',
    done: 'Done: {from} → {to} ({pct}% smaller).',
    bigger: 'This video is already small: the result ({to}) is larger than the original ({from}). We suggest keeping the original. You can also try “Smallest” or a lower resolution.', biggerMin: 'This video is already small: the result ({to}) is larger than the original ({from}) even with “Smallest”. We suggest keeping the original.', downloadLarger: 'Download the larger file anyway',
    download: 'Download {name}',
    noSupport: 'This browser can’t compress video here: it lacks the WebCodecs video tools. Try Safari on iPhone with iOS 16.4 or later, or an up-to-date Chrome or Edge on a computer.',
    tooBigIos: 'This video is {size}. On iPhone and iPad this page handles videos up to {limit}, because the result is held in memory. Use a smaller clip.',
    tooBig: 'This video is {size}. This page handles videos up to {limit}.',
    notVideo: 'This isn’t an MP4 or MOV video this page can read.',
    decodeFail: 'This browser can’t decode this video’s format ({codec}). Try Safari, or Chrome on a Mac with an up-to-date system.',
    encodeFail: 'This browser can’t encode H.264 at this size. Choose a lower resolution.',
    audioDropped: 'The audio isn’t AAC, so the result has no sound.',
    audioKept: 'The sound is copied as it is, not re-encoded.', audioNone: 'The original has no sound, so the result has none either.', resChange: 'Resolution: {fw}×{fh} → {tw}×{th}.',
    hdr: 'This looks like an HDR (10-bit) video. The result is a standard 8-bit video, so colors can look flatter.',
    fail: 'Compression stopped because of an error in this browser. Try again, or try another browser.',
    cancelled: 'Cancelled.', privacy: 'The video is processed inside your browser, and this page has no server that receives it.', checking: 'Checking the result…', verifyFail: 'The result didn’t check out (wrong frame count, width and height, or orientation), so there’s nothing to download. Try again, or try another browser.',
    keepOpen: 'Keep this tab open while it works.',
  },
  'zh-Hans': {
    pick: '选择一个视频',
    hint: 'iPhone 或相机拍的 MOV、MP4。一次一个视频。',
    quality: '质量',
    balanced: '均衡：更小，画面仍然清晰',
    smaller: '最小：用于聊天或邮件发送',
    res: '分辨率',
    keep: '保持原尺寸',
    r1080: '最高 1080p',
    r720: '最高 720p',
    start: '开始压缩',
    cancel: '取消',
    probing: '正在读取视频…',
    info: '{w}×{h}，{fps} 帧/秒，{dur}，{size}，{codec}',
    working: '正在压缩… {pct}%',
    done: '完成：{from} → {to}（小了 {pct}%）。',
    bigger: '这个视频已经很小：压缩后（{to}）反而比原视频（{from}）大。建议保留原视频。也可以试试“最小”或更低的分辨率。', biggerMin: '这个视频已经很小：即使选“最小”，压缩后（{to}）也比原视频（{from}）大。建议保留原视频。', downloadLarger: '仍然下载这个更大的文件',
    download: '下载 {name}',
    noSupport: '这个浏览器在这里不能压缩视频：缺少 WebCodecs 视频工具。请用 iOS 16.4 及以上的 iPhone Safari，或电脑上最新的 Chrome、Edge。',
    tooBigIos: '这个视频有 {size}。在 iPhone 和 iPad 上本页最多处理 {limit} 的视频，因为结果要放在内存里。请换小一点的片段。',
    tooBig: '这个视频有 {size}。本页最多处理 {limit} 的视频。',
    notVideo: '这不是本页能读取的 MP4 或 MOV 视频。',
    decodeFail: '这个浏览器解不了这个视频的格式（{codec}）。试试 Safari，或系统较新的 Mac 上的 Chrome。',
    encodeFail: '这个浏览器在这个尺寸下不能编码 H.264。请选更低的分辨率。',
    audioDropped: '音频不是 AAC，结果没有声音。',
    audioKept: '声音原样复制，没有重新编码。', audioNone: '原视频没有声音，结果也没有。', resChange: '分辨率：{fw}×{fh} → {tw}×{th}。',
    hdr: '这看起来是 HDR（10 位）视频。结果是标准 8 位视频，颜色可能显得更平。',
    fail: '压缩中断了：浏览器处理时出错。请再试一次，或换个浏览器。',
    cancelled: '已取消。', privacy: '视频在你的浏览器里处理，本页没有接收它的服务器。', checking: '正在检查结果…', verifyFail: '结果没通过检查（帧数、宽高或方向不对），所以没有可下载的文件。请再试一次，或换个浏览器。',
    keepOpen: '压缩时请保持本页打开。',
  },
};

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.platform));
const dur = (s: number) => ((r) => `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`)(Math.round(s));

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const out = h('div', {});
  if (!webcodecsOk()) {
    host.replaceChildren(h('p', { class: 'tl-msg is-error' }, t('noSupport')));
    return;
  }
  let file: File | null = null;
  let meta: VideoMeta | null = null;

  const gate = new TaskGate();
  const urls = new UrlBag();
  const opt = { preset: 'balanced' as Preset, maxLong: 0 };
  const sel = (opts: [string, string][], on: (v: string) => void) => {
    const s = h('select', { onchange: () => on(s.value) }, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  const prog = h('progress', { class: 'tl-progress', max: 100, value: 0, hidden: true });
  const go = h('button', { class: 'tl-btn', disabled: true, onclick: run }, t('start'));
  const stop = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => gate.cancel() }, t('cancel'));
  const info = h('p', { class: 'tl-note' });

  const idleUi = () => {
    stop.hidden = prog.hidden = true;
    go.disabled = !meta;
  };
  async function pick(f: File) {
    gate.invalidate();
    urls.revokeAll();
    out.replaceChildren();
    file = f;
    meta = null;
    idleUi();
    info.textContent = '';
    const limit = isIos() ? LIMIT_IOS : LIMIT_DESKTOP;
    if (f.size > limit) return void (msg.textContent = t(isIos() ? 'tooBigIos' : 'tooBig', { size: fmtBytes(f.size), limit: fmtBytes(limit) }));
    msg.textContent = t('probing');
    try {
      const m = await probe(f);
      if (file !== f) return;
      meta = m;
      info.textContent = t('info', { w: displaySize(m.w, m.h, m.rotation).w, h: displaySize(m.w, m.h, m.rotation).h, fps: Math.round(m.fps), dur: dur(m.duration), size: fmtBytes(f.size), codec: m.codec });
      msg.textContent = [m.hdr ? t('hdr') : '', t('keepOpen')].filter(Boolean).join(' ');
      go.disabled = false;
    } catch {
      if (file === f) msg.textContent = t('notVideo');
    }
  }
  async function run() {
    const f = file;
    if (!f || !meta) return;
    const task = gate.begin();
    const o = { ...opt };
    urls.revokeAll();
    go.disabled = true;
    stop.hidden = prog.hidden = false;
    prog.value = 0;
    out.replaceChildren();
    msg.textContent = t('working', { pct: 0 });
    try {
      const r = await transcode(f, { ...o, lowMemory: isIos(), signal: task.signal, onProgress: (d, n) => task.current && ((prog.value = (d / n) * 100), (msg.textContent = t('working', { pct: Math.round((d / n) * 100) }))) });
      if (!task.current) return; msg.textContent = t('checking'); const ok = await verifyOutput(r.blob, { kind: 'avc', w: r.plan.w, h: r.plan.h, frames: r.frames, turn: r.meta.rotationMatrix }); if (!task.current) return; if (!ok) return void (msg.textContent = t('verifyFail'));
      const name = `${baseName(f.name)}-compressed.mp4`;
      const saved = Math.round((1 - r.blob.size / f.size) * 100);
      const url = urls.own(URL.createObjectURL(r.blob));
      msg.textContent = r.blob.size < f.size ? t('done', { from: fmtBytes(f.size), to: fmtBytes(r.blob.size), pct: saved }) : t(o.preset === 'smaller' ? 'biggerMin' : 'bigger', { from: fmtBytes(f.size), to: fmtBytes(r.blob.size) });
      const larger = r.blob.size >= f.size;
      out.replaceChildren(...(larger ? [] : [h('video', { src: url, controls: true, playsInline: true, class: 'tl-canvas', preload: 'metadata' })]),
        h('p', { class: 'tl-note' }, resultDetail(r.meta, r.plan, t)),
        h('a', { class: larger ? 'tl-btn tl-btn--ghost' : 'tl-btn', href: url, download: name }, larger ? t('downloadLarger') : t('download', { name })));
    } catch (e) {
      if (gate.version !== task.id) return;
      const m = e instanceof Error ? e.message : String(e);
      msg.textContent = e instanceof DOMException && e.name === 'AbortError' ? t('cancelled') : m.startsWith('decode-unsupported') ? t('decodeFail', { codec: m.split(':')[1] }) : m.startsWith('encode-unsupported') ? t('encodeFail') : (console.error(e), t('fail'));
    } finally {
      if (gate.version === task.id) idleUi();
    }
  }
  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.mp4,.mov,.m4v,video/mp4,video/quicktime', onFiles: ([f]) => pick(f) }),
    h('p', { class: 'tl-note' }, t('privacy')), info,
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('quality'), sel([['balanced', t('balanced')], ['smaller', t('smaller')]], (v) => (opt.preset = v as Preset))),
      h('label', { class: 'tl-row' }, t('res'), sel([['0', t('keep')], ['1920', t('r1080')], ['1280', t('r720')]], (v) => (opt.maxLong = Number(v))))),
    h('div', { class: 'tl-actions' }, go, stop), prog, msg, out);
}
