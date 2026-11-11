import { COMPRESS_ACCEPT, COMPRESS_QUALITY, compressImage, MAX_SIDES, pctChange, Unsupported, type Choice, type CompressOptions, type CompressResult } from '@picway-tools/core/compress.ts';
import { OUT_EXT, preload } from '@picway-tools/core/convert.ts';
import { FitStopped } from '@picway-tools/core/fitsize.ts';
import { Reprocessor, type Item } from '@picway-tools/core/reprocess.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { clearZipOffer, zipAndDownload } from '@picway-tools/core/zipdl.ts';
import { baseName, downloadBlob, dropzone, fmtBytes, h, makeT, tick, type Strings } from '@picway-tools/core/ui.ts'; import { errCode, REASONS } from '@picway-tools/core/errcode.ts'; import { EXTRA } from './strings.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose images',
    hint: 'or drop them here. JPG, PNG, WebP, HEIC, AVIF, BMP or TIFF. Up to 50 files, 200 MB each. Processing starts as soon as you choose files.',
    format: 'Save as',
    same: 'Same format as the original',
    mode: 'Compress by',
    byQuality: 'Quality',
    byTarget: 'Target file size',
    quality: 'Quality',
    target: 'At most',
    maxSide: 'Longest side',
    keepSize: 'Keep the original size',
    px: 'at most {n} px',
    colors: 'PNG: reduce to 256 colors (much smaller for screenshots and graphics)',
    background: 'Background for transparent areas',
    location: 'Remove location (GPS)',
    allExif: 'Remove all camera and date info (EXIF)',
    note: 'HEIC, BMP and TIFF are saved as JPG. A lower quality or a smaller longest side gives a smaller file. Photos with fine detail need a higher quality to look the same.',
    working: 'Compressing…',
    download: 'Download',
    all: 'Download all (ZIP)', zipFail: 'Couldn’t make the ZIP. Download the files one by one.',
    again: 'Clear list',
    total: 'Total: {from} → {to} ({pct})',
    tooBig: 'This file is over 200 MB.',
    tooMany: 'Only {n} more files were added: the list holds up to 50.',
    gif: 'GIF isn’t supported here: compressing it as a still image would drop the animation.',
    fail: 'Couldn’t compress this file: {e}',
    q: 'quality {n}%',
    fits: 'within {t}',
    missed: 'couldn’t get under {t}; this is the smallest it got',
    shrunk: 'size reduced to reach the target',
    paletted: '256 colors',
    notSmaller: 'Not smaller than the original. Try a lower quality or a smaller longest side.',
    under: 'The original is already under {t}, so this copy isn’t smaller. You can use the original as it is.',
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
    format: '保存为',
    same: '和原图同一格式',
    mode: '压缩方式',
    byQuality: '按质量',
    byTarget: '压到指定大小',
    quality: '质量',
    target: '不超过',
    maxSide: '长边',
    keepSize: '保持原尺寸',
    px: '不超过 {n} 像素',
    colors: 'PNG：减到 256 色（截图、图标、插画会小很多）',
    background: '透明部分的底色',
    location: '去掉位置信息（GPS）',
    allExif: '去掉全部相机和日期信息（EXIF）',
    note: 'HEIC、BMP、TIFF 会存成 JPG。质量调低、长边调小，文件就更小；细节多的照片需要高一点的质量才看不出差别。',
    working: '正在压缩…',
    download: '下载',
    all: '全部下载（ZIP）', zipFail: '没能打包成 ZIP，请逐个下载。',
    again: '清空列表',
    total: '合计：{from} → {to}（{pct}）',
    tooBig: '这个文件超过 200 MB。',
    tooMany: '只添加了 {n} 个文件：列表最多 50 个。',
    gif: '这里不压缩 GIF：当成静态图压缩会丢掉动画。',
    fail: '这个文件没能压缩：{e}',
    q: '质量 {n}%',
    fits: '不超过 {t}',
    missed: '没能压到 {t} 以内，这是能压到的最小',
    shrunk: '为达到目标大小缩小了尺寸',
    paletted: '256 色',
    notSmaller: '没有比原图小。试试调低质量，或把长边调小。',
    under: '原图本来就不超过 {t}，这份没有比它小，可以直接用原图。',
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

export { pctChange };

export function mount(host: HTMLElement) {
  const t = makeT(S, host); const why = (e: unknown) => (console.warn(e), makeT(REASONS, host)(errCode(e)));
  const opt: CompressOptions = { format: 'same', quality: COMPRESS_QUALITY / 100, maxSide: 0, target: 0, reduceColors: true, background: '#ffffff', removeLocation: true, removeAllExif: false };
  let byTarget = false;

  let applied = '';
  const settingsChanged = () => { const now = JSON.stringify(opt); if (now !== applied) ((applied = now), void q.invalidate()); };
  const fmt = h('select', { onchange: () => (onFormat(), settingsChanged()) },
    h('option', { value: 'same' }, t('same')), h('option', { value: 'jpeg' }, 'JPG'), h('option', { value: 'webp' }, 'WebP'));
  const mode = h('select', { onchange: () => ((byTarget = mode.value === 'target'), onMode(), settingsChanged()) },
    h('option', { value: 'quality' }, t('byQuality')), h('option', { value: 'target' }, t('byTarget')));
  const qIn = h('input', { type: 'range', min: '30', max: '95', value: String(COMPRESS_QUALITY), oninput: () => (qOut.textContent = qIn.value + '%'), onchange: () => ((opt.quality = Number(qIn.value) / 100), settingsChanged()) });
  const qOut = h('span', {}, qIn.value + '%');
  const qRow = h('label', { class: 'tl-row' }, t('quality'), qIn, qOut);
  const tNum = h('input', { type: 'number', min: '1', max: '50000', step: 'any', value: '500', inputmode: 'decimal', style: 'width:7em', onchange: () => (readTarget(), settingsChanged()) });
  const tUnit = h('select', { onchange: () => (readTarget(), settingsChanged()) }, h('option', { value: 'KB' }, 'KB'), h('option', { value: 'MB' }, 'MB'));
  const tRow = h('label', { class: 'tl-row' }, t('target'), tNum, tUnit);
  const side = h('select', { onchange: () => ((opt.maxSide = Number(side.value)), settingsChanged()) },
    ...MAX_SIDES.map((n) => h('option', { value: String(n) }, n ? t('px', { n }) : t('keepSize'))));
  const colors = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.reduceColors = colors.checked), settingsChanged()) });
  const colorsRow = h('label', { class: 'tl-row' }, colors, t('colors'));
  const bgIn = h('input', { type: 'color', value: '#ffffff', onchange: () => ((opt.background = bgIn.value), settingsChanged()) });
  const bgRow = h('label', { class: 'tl-row' }, t('background'), bgIn);

  function readTarget() {
    const n = Number(tNum.value);
    const bytes = Math.round((Number.isFinite(n) && n > 0 ? n : 500) * (tUnit.value === 'MB' ? 1048576 : 1024));
    opt.target = byTarget ? Math.min(50 * 1048576, Math.max(10 * 1024, bytes)) : 0;
    if (byTarget && opt.target !== bytes) tNum.value = String(+(opt.target / (tUnit.value === 'MB' ? 1048576 : 1024)).toFixed(2));
  }
  function onMode() {
    qRow.hidden = byTarget;
    tRow.hidden = !byTarget;
    readTarget();
  }
  function onFormat() {
    opt.format = fmt.value as Choice;
    bgRow.hidden = opt.format === 'webp';
    colorsRow.hidden = opt.format !== 'same';
    if (opt.format === 'webp') preload('webp');
  }
  const loc = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.removeLocation = loc.checked), settingsChanged()) }); let locWas = true;
  const all = h('input', {
    type: 'checkbox',
    onchange: () => ((opt.removeAllExif = all.checked), all.checked ? ((locWas = loc.checked), (loc.checked = true)) : (loc.checked = locWas), (loc.disabled = all.checked), (opt.removeLocation = loc.checked), settingsChanged()),
  });
  const list = h('ul', { class: 'tl-list' });
  const urls = new UrlBag();
  const summary = h('p', { class: 'tl-msg', role: 'status' });

  const doneRows = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out) : []);
  const sync = () => {
    const rows = doneRows();
    zipBtn.hidden = rows.length < 2; if (zipBtn.hidden) clearZipOffer(msg);
    clear.hidden = q.items.length === 0;
    const from = rows.reduce((n, r) => n + r.f.size, 0);
    const to = rows.reduce((n, r) => n + r.out!.blob.size, 0);
    summary.textContent = rows.length > 1 ? t('total', { from: fmtBytes(from), to: fmtBytes(to), pct: pctChange(from, to) }) : '';
  };
  const zipBtn = h('button', { class: 'tl-btn', hidden: true, onclick: () => zip() }, t('all'));
  const clear = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => (q.clear(), urls.revokeAll(), (list.innerHTML = ''), sync()) }, t('again'));
  const msg = h('p', { class: 'tl-msg', role: 'status' });

  async function zip() {
    const gen = q.gen;
    const outs = doneRows().map((r) => r.out!);
    if (outs.length < 2) return;
    await zipAndDownload({ outs, zipName: 'compressed-images.zip', msg, host, alive: () => gen === q.gen && q.idle });
  }

  async function run(row: Row, o: CompressOptions) {
    const g = q.gen;
    if (row.f.size > 200 * 1048576) throw new Error(t('tooBig'));
    await tick();
    return compressImage(row.f, { ...o }, () => g !== q.gen || !q.items.includes(row));
  }
  const q: Reprocessor<Row, CompressOptions, CompressResult> = new Reprocessor<Row, CompressOptions, CompressResult>({
    snapshot: () => ({ ...opt }),
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
      let name = `${baseName(row.f.name)}-compressed.${OUT_EXT[r.format]}`;
      for (let i = 2; names.has(name); i++) name = `${baseName(row.f.name)}-compressed-${i}.${OUT_EXT[r.format]}`;
      row.out = { name, blob: r.blob };
      show(row, name, r, o);
      sync();
    },
    fail: (row, e) => fail(row, e),
  });
  function fail(row: Row, e: unknown) {
    if (e instanceof FitStopped) return;
    row.out = undefined; row.status.textContent = e instanceof Unsupported ? t('gif') : e instanceof Error && e.message === t('tooBig') ? t('tooBig') : t('fail', { e: why(e) });
    row.li.classList.add('is-error');
    sync();
  }
  function add(files: File[]) {
    readTarget(), settingsChanged(); const room = Math.max(0, 50 - q.items.length);
    msg.textContent = files.length > room ? t('tooMany', { n: room }) : '';
    for (const f of files.slice(0, room)) {
      const status = h('span', { class: 'tl-status' }, t('working'));
      const li = h('li', { class: 'tl-item' }, h('span', { class: 'tl-name' }, f.name), status);
      list.append(li);
      void q.add({ gen: -1, f, li, status });
    }
    sync();
  }
  function show(row: Row, name: string, r: CompressResult, o: CompressOptions) {
    const url = (row.url = urls.own(URL.createObjectURL(r.blob)));
    const tgt = fmtBytes(o.target);
    const notes = [
      `${fmtBytes(row.f.size)} → ${fmtBytes(r.blob.size)} (${pctChange(row.f.size, r.blob.size)})`,
      `${NAMES[r.from] ?? r.from.toUpperCase()} → ${NAMES[r.format]}`,
      r.width !== r.srcWidth || r.height !== r.srcHeight ? `${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height}` : `${r.width}×${r.height}`,
      r.q !== undefined ? t('q', { n: Math.round(r.q * 100) }) : r.paletted ? t('paletted') : '',
      o.target ? (r.fits ? t('fits', { t: tgt }) : t('missed', { t: tgt })) : '',
      r.shrunkForTarget ? t('shrunk') : '',
      r.colour === 'p3' ? t('colP3') : r.colourConverted ? t('colSrgb') : '',
      r.gpsUnsure ? t('gpsUnsure') : r.hadGps ? (r.gpsRemoved ? t('gpsOut') : t('gpsIn')) : '',
      o.removeAllExif ? t('exifOut') : '',
      r.flattened ? t('flat') : '',
      r.downscaled ? t('down') : '',
      r.firstFrameOnly ? t('first') : '', !o.removeAllExif && r.exifDropped ? t('exifDrop') : '',
    ].filter(Boolean);
    row.status.replaceChildren(
      h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`),
      h('small', {}, notes.join(' · ')),
      ...(r.notSmaller ? [h('small', { class: 'tl-err' }, o.target && row.f.size <= o.target ? t('under', { t: tgt }) : t('notSmaller'))] : []),
    );
    row.li.prepend(h('img', { class: 'tl-thumb', src: url, alt: '', width: 48, height: 48, onerror: (e: Event) => (e.target as HTMLElement).remove() }));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: COMPRESS_ACCEPT, multiple: true, passAll: true, onFiles: add }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('format'), fmt),
      h('label', { class: 'tl-row' }, t('mode'), mode),
      qRow,
      tRow,
      h('label', { class: 'tl-row' }, t('maxSide'), side),
      colorsRow,
      bgRow,
      h('label', { class: 'tl-row' }, loc, t('location')),
      h('label', { class: 'tl-row' }, all, t('allExif')),
      h('p', { class: 'tl-note' }, t('note'))),
    msg,
    summary,
    list,
    h('div', { class: 'tl-actions' }, zipBtn, clear),
  );
  onFormat();
  onMode();
  applied = JSON.stringify(opt);
}
