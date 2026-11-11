import { normInt, PERCENT_MAX, PERCENT_MIN, PX_MAX, RESIZE_ACCEPT, resizeImage, Unsupported, type ResizeChoice, type ResizeOptions, type ResizeResult } from '@picway-tools/core/resize.ts';
import { OUT_EXT, preload } from '@picway-tools/core/convert.ts';
import { pctChange } from '@picway-tools/core/compress.ts';
import { Reprocessor, type Item } from '@picway-tools/core/reprocess.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { clearZipOffer, zipAndDownload } from '@picway-tools/core/zipdl.ts';
import { baseName, downloadBlob, dropzone, fmtBytes, h, makeT, tick, type Strings } from '@picway-tools/core/ui.ts'; import { errCode, REASONS } from '@picway-tools/core/errcode.ts';
import { EXTRA } from './strings.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose images',
    hint: 'or drop them here. JPG, PNG, WebP, HEIC, AVIF, BMP or TIFF. Up to 50 files, 200 MB each. Processing starts as soon as you choose files.',
    by: 'Resize by',
    byPercent: 'Percentage',
    byPx: 'Width and height (pixels)',
    percent: 'Size',
    width: 'Width',
    height: 'Height',
    auto: 'auto',
    keepRatio: 'Keep the aspect ratio (fit inside width × height)',
    noEnlarge: 'Don’t enlarge images that are already smaller',
    format: 'Save as',
    same: 'Same format as the original',
    background: 'Background for transparent areas',
    location: 'Remove location (GPS)',
    allExif: 'Remove all camera and date info (EXIF)',
    note: 'HEIC, BMP and TIFF are saved as JPG. Making an image larger does not add detail. To make the file smaller as well, use the image compressor.',
    working: 'Resizing…',
    download: 'Download',
    all: 'Download all (ZIP)', zipFail: 'Couldn’t make the ZIP. Download the files one by one.',
    again: 'Clear list',
    tooBig: 'This file is over 200 MB.',
    tooMany: 'Only {n} more files were added: the list holds up to 50.',
    gif: 'GIF isn’t supported here: resizing it as a still image would drop the animation.',
    fail: 'Couldn’t resize this file: {e}',
    kept: 'already smaller than that, kept at its original size',
    stretched: 'aspect ratio changed (the image is stretched)',
    gpsOut: 'location removed',
    gpsIn: 'location kept',
    gpsUnsure: 'couldn’t confirm the location was removed',
    exifOut: 'all EXIF removed', exifDrop: 'camera and date info not kept in this format',
    colP3: 'Display P3 kept',
    colSrgb: 'converted to sRGB',
    flat: 'transparent areas filled with the background color',
    down: 'Shrunk to fit this device’s size limit',
    first: 'animated image: only the first frame was kept',
  },
  'zh-Hans': {
    pick: '选择图片',
    hint: '或把图片拖到这里。支持 JPG、PNG、WebP、HEIC、AVIF、BMP、TIFF。最多 50 个，每个不超过 200 MB。选好文件就会自动开始处理。',
    by: '调整方式',
    byPercent: '按百分比',
    byPx: '按宽高（像素）',
    percent: '大小',
    width: '宽',
    height: '高',
    auto: '自动',
    keepRatio: '保持宽高比（放进宽 × 高以内）',
    noEnlarge: '本来就比这小的图不放大',
    format: '保存为',
    same: '和原图同一格式',
    background: '透明部分的底色',
    location: '去掉位置信息（GPS）',
    allExif: '去掉全部相机和日期信息（EXIF）',
    note: 'HEIC、BMP、TIFF 会存成 JPG。把图片放大不会多出细节。想让文件也变小，用图片压缩工具。',
    working: '正在调整…',
    download: '下载',
    all: '全部下载（ZIP）', zipFail: '没能打包成 ZIP，请逐个下载。',
    again: '清空列表',
    tooBig: '这个文件超过 200 MB。',
    tooMany: '只添加了 {n} 个文件：列表最多 50 个。',
    gif: '这里不处理 GIF：当成静态图改尺寸会丢掉动画。',
    fail: '这个文件没能调整尺寸：{e}',
    kept: '本来就比这小，保持原尺寸',
    stretched: '宽高比变了（图片被拉伸）',
    gpsOut: '已去掉位置',
    gpsIn: '保留了位置',
    gpsUnsure: '没能确认位置已去掉',
    exifOut: '已去掉全部 EXIF', exifDrop: '这个格式不保留相机和日期信息',
    colP3: '保留 Display P3',
    colSrgb: '已转成 sRGB',
    flat: '透明部分已铺上底色',
    down: '为适应本设备的尺寸上限缩小了',
    first: '这是动图，只保留了第一帧',
  },
};

const NAMES: Record<string, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', heic: 'HEIC', bmp: 'BMP', tiff: 'TIFF', gif: 'GIF' };

interface Row extends Item {
  f: File;
  li: HTMLElement;
  status: HTMLElement;
  out?: { name: string; blob: Blob };
  url?: string;
}

function readInt(el: HTMLInputElement, lo: number, hi: number, empty: number): number {
  if (el.value.trim() === '') return empty;
  const n = Number(el.value);
  const v = normInt(n, lo, hi, empty);
  if (!v || String(v) !== el.value) el.value = v ? String(v) : '';
  return v;
}

export function mount(host: HTMLElement) {
  const t = makeT(S, host); const why = (e: unknown) => (console.warn(e), makeT(REASONS, host)(errCode(e)));
  const opt: ResizeOptions = { spec: { by: 'px', width: 1080, height: 0, keepRatio: true, noEnlarge: true }, format: 'same', background: '#ffffff', removeLocation: true, removeAllExif: false };

  let applied = '';
  const settingsChanged = () => { const now = JSON.stringify(opt); if (now !== applied) ((applied = now), void q.invalidate()); };

  const by = h('select', { onchange: () => (readSpec(), settingsChanged()) }, h('option', { value: 'px' }, t('byPx')), h('option', { value: 'percent' }, t('byPercent')));
  const pIn = h('input', { type: 'number', min: String(PERCENT_MIN), max: String(PERCENT_MAX), step: '1', value: '50', inputmode: 'numeric', style: 'width:5em', onchange: () => (readSpec(), settingsChanged()) });
  const pRow = h('label', { class: 'tl-row' }, t('percent'), pIn, '%');
  const wIn = h('input', { type: 'number', min: '1', max: String(PX_MAX), step: '1', value: '1080', placeholder: t('auto'), inputmode: 'numeric', style: 'width:6em', onchange: () => (readSpec(), settingsChanged()) });
  const hIn = h('input', { type: 'number', min: '1', max: String(PX_MAX), step: '1', value: '', placeholder: t('auto'), inputmode: 'numeric', style: 'width:6em', onchange: () => (readSpec(), settingsChanged()) });
  const pxRow = h('div', { class: 'tl-row' }, h('label', {}, t('width'), ' ', wIn), ' × ', h('label', {}, t('height'), ' ', hIn), ' px');
  const ratio = h('input', { type: 'checkbox', checked: true, onchange: () => (readSpec(), settingsChanged()) });
  const ratioRow = h('label', { class: 'tl-row' }, ratio, t('keepRatio'));
  const noEn = h('input', { type: 'checkbox', checked: true, onchange: () => (readSpec(), settingsChanged()) });
  const noEnRow = h('label', { class: 'tl-row' }, noEn, t('noEnlarge'));

  function readSpec() {
    const px = by.value === 'px';
    opt.spec = px
      ? { by: 'px', width: readInt(wIn, 1, PX_MAX, 0), height: readInt(hIn, 1, PX_MAX, 0), keepRatio: ratio.checked, noEnlarge: noEn.checked }
      : { by: 'percent', percent: readInt(pIn, PERCENT_MIN, PERCENT_MAX, 100), noEnlarge: false };
    if (!px && pIn.value === '') pIn.value = '100';
    pRow.hidden = px;
    pxRow.hidden = ratioRow.hidden = noEnRow.hidden = !px;
  }

  const fmt = h('select', { onchange: () => (onFormat(), settingsChanged()) },
    h('option', { value: 'same' }, t('same')), h('option', { value: 'jpeg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'), h('option', { value: 'webp' }, 'WebP'));
  const bgIn = h('input', { type: 'color', value: '#ffffff', onchange: () => ((opt.background = bgIn.value), settingsChanged()) });
  const bgRow = h('label', { class: 'tl-row' }, t('background'), bgIn);
  function onFormat() {
    opt.format = fmt.value as ResizeChoice;
    bgRow.hidden = opt.format === 'webp' || opt.format === 'png';
    if (opt.format === 'webp') preload('webp');
  }
  const loc = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.removeLocation = loc.checked), settingsChanged()) }); let locWas = true;
  const all = h('input', {
    type: 'checkbox',
    onchange: () => ((opt.removeAllExif = all.checked), all.checked ? ((locWas = loc.checked), (loc.checked = true)) : (loc.checked = locWas), (loc.disabled = all.checked), (opt.removeLocation = loc.checked), settingsChanged()),
  });

  const list = h('ul', { class: 'tl-list' });
  const urls = new UrlBag();

  const doneRows = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out) : []);
  const sync = () => {
    zipBtn.hidden = doneRows().length < 2; if (zipBtn.hidden) clearZipOffer(msg);
    clear.hidden = q.items.length === 0;
  };
  const zipBtn = h('button', { class: 'tl-btn', hidden: true, onclick: () => zip() }, t('all'));
  const clear = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => (q.clear(), urls.revokeAll(), (list.innerHTML = ''), sync()) }, t('again'));
  const msg = h('p', { class: 'tl-msg', role: 'status' });

  async function zip() {
    const gen = q.gen;
    const outs = doneRows().map((r) => r.out!);
    if (outs.length < 2) return;
    await zipAndDownload({ outs, zipName: 'resized-images.zip', msg, host, alive: () => gen === q.gen && q.idle });
  }

  class TooBig extends Error {}
  async function run(row: Row, o: ResizeOptions) {
    if (row.f.size > 200 * 1048576) throw new TooBig();
    await tick();
    return resizeImage(row.f, { ...o, spec: { ...o.spec } });
  }
  const q: Reprocessor<Row, ResizeOptions, ResizeResult> = new Reprocessor<Row, ResizeOptions, ResizeResult>({
    snapshot: () => ({ ...opt, spec: { ...opt.spec } }),
    run,
    start: (row) => {
      row.out = undefined;
      urls.revoke(row.url);
      row.url = undefined;
      row.li.classList.remove('is-error');
      row.li.querySelector('.tl-thumb')?.remove();
      row.status.replaceChildren(t('working'));
      sync();
    },
    done: (row, r, o) => {

      if (!r.blob.size) return q.items.includes(row) && fail(row, new Error('empty result'));
      const names = new Set(q.items.filter((x) => x !== row && x.out).map((x) => x.out!.name));
      const stem = `${baseName(row.f.name)}-${r.width}x${r.height}`;
      let name = `${stem}.${OUT_EXT[r.format]}`;
      for (let i = 2; names.has(name); i++) name = `${stem}-${i}.${OUT_EXT[r.format]}`;
      row.out = { name, blob: r.blob };
      show(row, name, r, o);
      sync();
    },
    fail: (row, e) => fail(row, e),
  });
  function fail(row: Row, e: unknown) {
    row.status.textContent = e instanceof Unsupported ? t('gif') : e instanceof TooBig ? t('tooBig') : t('fail', { e: why(e) });
    row.li.classList.add('is-error');
    sync();
  }
  function add(files: File[]) {
    readSpec(), settingsChanged(); const room = Math.max(0, 50 - q.items.length);
    msg.textContent = files.length > room ? t('tooMany', { n: room }) : '';
    for (const f of files.slice(0, room)) {
      const status = h('span', { class: 'tl-status' }, t('working'));
      const li = h('li', { class: 'tl-item' }, h('span', { class: 'tl-name' }, f.name), status);
      list.append(li);
      void q.add({ gen: -1, f, li, status });
    }
    sync();
  }
  function show(row: Row, name: string, r: ResizeResult, o: ResizeOptions) {
    const url = (row.url = urls.own(URL.createObjectURL(r.blob)));
    const notes = [
      `${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height}`,
      `${fmtBytes(row.f.size)} → ${fmtBytes(r.blob.size)} (${pctChange(row.f.size, r.blob.size)})`,
      `${NAMES[r.from] ?? r.from.toUpperCase()} → ${NAMES[r.format]}`,
      r.keptSmall ? t('kept') : '',
      r.stretched ? t('stretched') : '',
      r.colour === 'p3' ? t('colP3') : r.colourConverted ? t('colSrgb') : '',
      r.gpsUnsure ? t('gpsUnsure') : r.hadGps ? (r.gpsRemoved ? t('gpsOut') : t('gpsIn')) : '',
      o.removeAllExif ? t('exifOut') : '',
      r.flattened ? t('flat') : '',
      r.downscaled ? t('down') : '',
      r.firstFrameOnly ? t('first') : '', !o.removeAllExif && r.exifDropped ? t('exifDrop') : '',
    ].filter(Boolean);
    row.status.replaceChildren(h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`), h('small', {}, notes.join(' · ')));
    row.li.prepend(h('img', { class: 'tl-thumb', src: url, alt: '', width: 48, height: 48, onerror: (e: Event) => (e.target as HTMLElement).remove() }));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: RESIZE_ACCEPT, multiple: true, passAll: true, onFiles: add }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('by'), by),
      pxRow,
      pRow,
      ratioRow,
      noEnRow,
      h('label', { class: 'tl-row' }, t('format'), fmt),
      bgRow,
      h('label', { class: 'tl-row' }, loc, t('location')),
      h('label', { class: 'tl-row' }, all, t('allExif')),
      h('p', { class: 'tl-note' }, t('note'))),
    msg,
    list,
    h('div', { class: 'tl-actions' }, zipBtn, clear),
  );
  readSpec();
  onFormat();
  applied = JSON.stringify(opt);
}
