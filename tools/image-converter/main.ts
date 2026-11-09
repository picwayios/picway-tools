import { convertImage, DEFAULT_QUALITY, IN_ACCEPT, LOSSY, NEEDS_BACKGROUND, OUT_EXT, OUT_FORMATS, preload, type ConvertOptions, type ConvertResult, type OutFormat } from '@picway-tools/core/convert.ts';
import { Reprocessor, type Item } from '@picway-tools/core/reprocess.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { makeZip } from '@picway-tools/core/zip.ts';
import { baseName, downloadBlob, dropzone, fmtBytes, h, makeT, tick, type Strings } from '@picway-tools/core/ui.ts';

const S: Strings<string> = {
  en: {
    pick: 'Choose images',
    hint: 'or drop them here. HEIC, JPG, PNG, WebP, AVIF, GIF, BMP or TIFF. Up to 50 files, 200 MB each. Processing starts as soon as you choose files.',
    format: 'Convert to',
    quality: 'Quality',
    background: 'Background for transparent areas',
    location: 'Remove location (GPS)',
    allExif: 'Remove all camera and date info (EXIF)',
    colourNote: 'Color: JPG, PNG and WebP keep your photo’s color profile, such as Display P3. AVIF, GIF, BMP and TIFF are saved in sRGB.',
    exifNote: 'Camera and date info is kept only in JPG, PNG and WebP.',
    working: 'Converting…',
    download: 'Download',
    all: 'Download all (ZIP)',
    again: 'Clear list',
    tooBig: 'This file is over 200 MB.',
    tooMany: 'Only the first 50 files were added.',
    fail: 'Couldn’t convert this file: {e}',
    colP3: 'Display P3 kept',
    colOther: 'original color profile kept',
    colSrgb: 'converted to sRGB',
    gpsOut: 'location removed',
    gpsIn: 'location kept',
    gpsUnsure: 'couldn’t confirm the location was removed',
    noGps: 'no location in this photo',
    exifOut: 'all EXIF removed',
    exifDrop: 'camera and date info not kept in this format',
    flat: 'transparent areas filled with the background color',
    gifAlpha: 'GIF transparency is on/off only',
    first: 'animated file: only the first frame was converted',
    down: 'Shrunk to fit this format’s size limit',
  },
  'zh-Hans': {
    pick: '选择图片',
    hint: '或把图片拖到这里。支持 HEIC、JPG、PNG、WebP、AVIF、GIF、BMP、TIFF。最多 50 个，每个不超过 200 MB。选好文件就会自动开始处理。',
    format: '转换成',
    quality: '质量',
    background: '透明部分的底色',
    location: '去掉位置信息（GPS）',
    allExif: '去掉全部相机和日期信息（EXIF）',
    colourNote: '色彩：JPG、PNG、WebP 会保留照片的色彩配置文件（如 Display P3）；AVIF、GIF、BMP、TIFF 按 sRGB 保存。',
    exifNote: '相机和日期信息只在 JPG、PNG、WebP 里保留。',
    working: '正在转换…',
    download: '下载',
    all: '全部下载（ZIP）',
    again: '清空列表',
    tooBig: '这个文件超过 200 MB。',
    tooMany: '只添加了前 50 个文件。',
    fail: '这个文件没能转换：{e}',
    colP3: '保留 Display P3',
    colOther: '保留原色彩配置文件',
    colSrgb: '已转成 sRGB',
    gpsOut: '已去掉位置',
    gpsIn: '保留了位置',
    gpsUnsure: '没能确认位置已去掉',
    noGps: '这张照片本来就没有位置',
    exifOut: '已去掉全部 EXIF',
    exifDrop: '这个格式不保留相机和日期信息',
    flat: '透明部分已铺上底色',
    gifAlpha: 'GIF 的透明只有“有”和“无”两档',
    first: '这是动图，只转换了第一帧',
    down: '为适应这个格式的尺寸上限缩小了',
  },
};

const NAMES: Record<OutFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', gif: 'GIF', bmp: 'BMP', tiff: 'TIFF' };

interface Row extends Item {
  f: File;
  li: HTMLElement;
  status: HTMLElement;
  out?: { name: string; blob: Blob };
  url?: string;
}

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const quality: Record<OutFormat, number> = { ...DEFAULT_QUALITY };
  const opt: ConvertOptions = { format: 'webp', quality: DEFAULT_QUALITY.webp / 100, background: '#ffffff', removeLocation: true, removeAllExif: false };

  const settingsChanged = () => void q.invalidate();
  const fmt = h('select', { onchange: () => (onFormat(), settingsChanged()) }, ...OUT_FORMATS.map((f) => h('option', { value: f }, NAMES[f])));
  fmt.value = opt.format;
  const qIn = h('input', { type: 'range', min: '30', max: '100', value: String(quality[opt.format]), oninput: () => ((opt.quality = Number(qIn.value) / 100), (quality[opt.format] = Number(qIn.value)), (qOut.textContent = qIn.value + '%')), onchange: settingsChanged });
  const qOut = h('span', {}, qIn.value + '%');
  const qRow = h('label', { class: 'tl-row' }, t('quality'), qIn, qOut);
  const bgIn = h('input', { type: 'color', value: '#ffffff', onchange: () => ((opt.background = bgIn.value), settingsChanged()) });
  const bgRow = h('label', { class: 'tl-row' }, t('background'), bgIn);
  function onFormat() {
    opt.format = fmt.value as OutFormat;
    qRow.hidden = !LOSSY.includes(opt.format);
    bgRow.hidden = !NEEDS_BACKGROUND.includes(opt.format);
    qIn.value = String(quality[opt.format]);
    opt.quality = quality[opt.format] / 100;
    qOut.textContent = qIn.value + '%';
    preload(opt.format);
  }
  const loc = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.removeLocation = loc.checked), settingsChanged()) });
  const all = h('input', {
    type: 'checkbox',
    onchange: () => ((opt.removeAllExif = all.checked), (loc.disabled = all.checked), all.checked && (loc.checked = true), (opt.removeLocation = true), settingsChanged()),
  });
  const list = h('ul', { class: 'tl-list' });
  const urls = new UrlBag();

  const doneList = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out).map((r) => r.out!) : []);
  const sync = () => {
    zipBtn.hidden = doneList().length < 2;
    clear.hidden = q.items.length === 0;
  };
  const zipBtn = h('button', { class: 'tl-btn', hidden: true, onclick: () => zip() }, t('all'));
  const clear = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => (q.clear(), urls.revokeAll(), (list.innerHTML = ''), sync()) }, t('again'));
  const msg = h('p', { class: 'tl-msg', role: 'status' });

  async function zip() {
    const gen = q.gen;
    const outs = doneList();
    if (outs.length < 2) return;
    const entries = await Promise.all(outs.map(async (d) => ({ name: d.name, data: new Uint8Array(await d.blob.arrayBuffer()) })));
    if (gen !== q.gen || !q.idle || entries.length < 2) return;
    downloadBlob(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }), 'converted-images.zip');
  }

  async function run(row: Row, o: ConvertOptions) {
    const f = row.f;
    if (f.size > 200 * 1048576) throw new Error(t('tooBig'));
    await tick();
    return convertImage(f, { ...o });
  }
  const q = new Reprocessor<Row, ConvertOptions, ConvertResult>({
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
      const name = `${baseName(row.f.name)}.${OUT_EXT[o.format]}`;
      row.out = { name, blob: r.blob };
      show(row, name, r, o);
      sync();
    },
    fail: (row, e) => {
      row.status.textContent = t('fail', { e: e instanceof Error ? e.message : String(e) });
      row.li.classList.add('is-error');
      sync();
    },
  });
  function add(files: File[]) {
    msg.textContent = files.length > 50 ? t('tooMany') : '';
    for (const f of files.slice(0, 50)) {
      const status = h('span', { class: 'tl-status' }, t('working'));
      const li = h('li', { class: 'tl-item' }, h('span', { class: 'tl-name' }, f.name), status);
      list.append(li);
      void q.add({ gen: -1, f, li, status });
    }
    sync();
  }
  function show(row: Row, name: string, r: ConvertResult, o: ConvertOptions) {
    const url = (row.url = urls.own(URL.createObjectURL(r.blob)));
    const notes = [
      `${(NAMES as Record<string, string>)[r.from] ?? r.from.toUpperCase()} → ${NAMES[o.format]}`,
      `${r.width}×${r.height}`,
      `${fmtBytes(row.f.size)} → ${fmtBytes(r.blob.size)}`,
      r.colour === 'p3' ? t('colP3') : r.colour === 'other' ? t('colOther') : r.colourConverted ? t('colSrgb') : '',
      r.gpsUnsure ? t('gpsUnsure') : r.hadGps ? (r.gpsRemoved ? t('gpsOut') : t('gpsIn')) : '',
      o.removeAllExif ? t('exifOut') : r.exifDropped ? t('exifDrop') : '',
      r.flattened ? t('flat') : '',
      r.gifAlpha ? t('gifAlpha') : '',
      r.firstFrameOnly ? t('first') : '',
      r.downscaled ? t('down') : '',
    ].filter(Boolean);
    row.status.replaceChildren(h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`), h('small', {}, notes.join(' · ')));
    row.li.prepend(h('img', { class: 'tl-thumb', src: url, alt: '', width: 48, height: 48, onerror: (e: Event) => (e.target as HTMLElement).remove() }));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: IN_ACCEPT, multiple: true, passAll: true, onFiles: add }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('format'), fmt),
      qRow,
      bgRow,
      h('label', { class: 'tl-row' }, loc, t('location')),
      h('label', { class: 'tl-row' }, all, t('allExif')),
      h('p', { class: 'tl-note' }, t('colourNote')),
      h('p', { class: 'tl-note' }, t('exifNote'))),
    msg,
    list,
    h('div', { class: 'tl-actions' }, zipBtn, clear),
  );
  onFormat();
}
