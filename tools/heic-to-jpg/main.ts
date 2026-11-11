import { convertHeic, HEIC_ACCEPT, looksHeif, type ConvertOptions, type ConvertResult } from '@picway-tools/core/heic.ts';
import { Reprocessor, type Item } from '@picway-tools/core/reprocess.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { clearZipOffer, zipAndDownload } from '@picway-tools/core/zipdl.ts';
import { baseName, downloadBlob, dropzone, fmtBytes, h, makeT, tick, Hint, hintNodes, isJpgPng, toolHref, type Strings } from '@picway-tools/core/ui.ts'; import { EXTRA } from './strings.ts'; import { judgeJpgPng } from '@picway-tools/core/heicgate.ts'; import { REASONS } from '@picway-tools/core/errcode.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose HEIC photos',
    hint: 'or drop them here. Up to 50 files, 200 MB each. Processing starts as soon as you choose files.',
    format: 'Save as',
    quality: 'JPG quality',
    location: 'Remove location (GPS)',
    allExif: 'Remove all camera and date info (EXIF)',
    p3: 'Color: Display P3 is kept when your photo has it.',
    working: 'Converting…',
    done: 'Done',
    download: 'Download',
    all: 'Download all (ZIP)',
    again: 'Clear list',
    notHeic: 'This isn’t a HEIC/HEIF photo.',
    already: 'This is already a JPG/PNG, no need to convert.',
    goLoc: 'Remove location',
    goBorder: 'Add a border',
    tooBig: 'This file is over 200 MB.',
    tooMany: 'Only the first 50 files were added.',
    fail: 'Couldn’t convert this photo: {e}',
    colP3: 'Display P3 kept',
    colOther: 'original color profile kept',
    colNone: 'this photo had no color profile (shown as sRGB)',
    gpsOut: 'location removed',
    gpsIn: 'location kept',
    gpsUnsure: 'couldn’t confirm the location was removed',
    noGps: 'no location in this photo',
    exifOut: 'all EXIF removed',
    down: 'Shrunk to fit this device’s canvas limit',
    lib: 'decoded with libheif',
  },
  'zh-Hans': {
    pick: '选择 HEIC 照片',
    hint: '或把照片拖到这里。最多 50 张，每张不超过 200 MB。选好文件就会自动开始处理。',
    format: '保存为',
    quality: 'JPG 质量',
    location: '去掉位置信息（GPS）',
    allExif: '去掉全部相机和日期信息（EXIF）',
    p3: '色彩：照片带 Display P3 时会保留。',
    working: '正在转换…',
    done: '完成',
    download: '下载',
    all: '全部下载（ZIP）',
    again: '清空列表',
    notHeic: '这不是 HEIC/HEIF 照片。',
    already: '这张已经是 JPG/PNG，不用转。',
    goLoc: '去掉位置信息',
    goBorder: '加相框',
    tooBig: '这个文件超过 200 MB。',
    tooMany: '只添加了前 50 个文件。',
    fail: '这张照片没能转换：{e}',
    colP3: '保留 Display P3',
    colOther: '保留原色彩配置文件',
    colNone: '这张照片本来没有色彩配置文件（按 sRGB 显示）',
    gpsOut: '已去掉位置',
    gpsIn: '保留了位置',
    gpsUnsure: '没能确认位置已去掉',
    noGps: '这张照片本来就没有位置',
    exifOut: '已去掉全部 EXIF',
    down: '为适应本设备的画布上限缩小了尺寸',
    lib: '用 libheif 解码',
  },
};

interface Row extends Item {
  f: File;
  li: HTMLElement;
  status: HTMLElement;
  out?: { name: string; blob: Blob };
  url?: string;
}

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const opt: ConvertOptions = { format: 'jpeg', quality: 0.92, removeLocation: true, removeAllExif: false };

  const settingsChanged = () => void q.invalidate();
  const fmt = h('select', { onchange: () => ((opt.format = fmt.value as ConvertOptions['format']), (qRow.hidden = opt.format === 'png'), settingsChanged()) }, h('option', { value: 'jpeg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'));
  const qIn = h('input', { type: 'range', min: '50', max: '100', value: '92', oninput: () => ((opt.quality = Number(qIn.value) / 100), (qOut.textContent = qIn.value + '%')), onchange: settingsChanged });
  const qOut = h('span', {}, '92%');
  const qRow = h('label', { class: 'tl-row' }, t('quality'), qIn, qOut);
  const loc = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.removeLocation = loc.checked), settingsChanged()) });
  const all = h('input', {
    type: 'checkbox',
    onchange: () => ((opt.removeAllExif = all.checked), (loc.disabled = all.checked), all.checked && (loc.checked = true), (opt.removeLocation = true), settingsChanged()),
  });
  const list = h('ul', { class: 'tl-list' });
  const urls = new UrlBag();

  const doneList = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out).map((r) => r.out!) : []);
  const sync = () => {
    zipBtn.hidden = doneList().length < 2; if (zipBtn.hidden) clearZipOffer(msg);
    clear.hidden = q.items.length === 0;
  };
  const zipBtn = h('button', { class: 'tl-btn', hidden: true, onclick: () => zip() }, t('all'));
  const clear = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => (q.clear(), urls.revokeAll(), (list.innerHTML = ''), sync()) }, t('again'));
  const msg = h('p', { class: 'tl-msg', role: 'status' });

  async function zip() {
    const gen = q.gen;
    const outs = doneList();
    if (outs.length < 2) return;
    await zipAndDownload({ outs, zipName: 'heic-converted.zip', msg, host, alive: () => gen === q.gen && q.idle });
  }

  async function run(row: Row, o: ConvertOptions) {
    const f = row.f;
    if (f.size > 200 * 1048576) throw new Error(t('tooBig'));

    const verdict = await judgeJpgPng(new Uint8Array(await f.slice(0, 512).arrayBuffer()), async () => new Uint8Array(await f.arrayBuffer()));
    if (verdict === 'damaged') throw new Error(makeT(REASONS, host)('damaged'));
    if (verdict === 'already') throw new Hint(t('already'), [[t('goLoc'), toolHref('remove-photo-location')], [t('goBorder'), toolHref('photo-border')]]);
    if (!(await looksHeif(f))) throw new Error(t('notHeic'));
    await tick();
    return convertHeic(f, { ...o });
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
      const name = `${baseName(row.f.name)}.${o.format === 'png' ? 'png' : 'jpg'}`;
      row.out = { name, blob: r.blob };
      show(row, name, r, o);
      sync();
    },
    fail: (row, e) => {
      if (e instanceof Hint) row.status.replaceChildren(...hintNodes(e));
      else row.status.textContent = t('fail', { e: e instanceof Error ? e.message : String(e) });
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
      `${r.width}×${r.height}`,
      `${fmtBytes(row.f.size)} → ${fmtBytes(r.blob.size)}`,
      r.colour === 'p3' ? t('colP3') : r.colour === 'other' ? t('colOther') : t('colNone'),
      r.gpsUnsure ? t('gpsUnsure') : !r.hadGps ? t('noGps') : r.gpsRemoved ? t('gpsOut') : t('gpsIn'),
      o.removeAllExif && o.format === 'jpeg' ? t('exifOut') : '',
      r.downscaled ? t('down') : '',
      r.path === 'library' ? t('lib') : '',
    ].filter(Boolean);
    row.status.replaceChildren(h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`), h('small', {}, notes.join(' · ')));
    row.li.prepend(h('img', { class: 'tl-thumb', src: url, alt: '', width: 48, height: 48 }));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: HEIC_ACCEPT, multiple: true, passAll: true, onFiles: add }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('format'), fmt),
      qRow,
      h('label', { class: 'tl-row' }, loc, t('location')),
      h('label', { class: 'tl-row' }, all, t('allExif')),
      h('p', { class: 'tl-note' }, t('p3'))),
    msg,
    list,
    h('div', { class: 'tl-actions' }, zipBtn, clear),
  );
}
