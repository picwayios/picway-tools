import { convertHeic, looksHeif } from '@picway-tools/core/heic.ts';
import { readInfo, type PhotoInfo } from '@picway-tools/core/info.ts';
import { stripAllFromJpeg, stripLocationFromJpeg } from '@picway-tools/core/exif.ts';
import { canDecode } from '@picway-tools/core/decodable.ts';
import { looksLikeJpegImage } from '@picway-tools/core/jpeg.ts';
import { checkLocation } from '@picway-tools/core/location.ts';
import { Reprocessor, type Item } from '@picway-tools/core/reprocess.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { makeZip } from '@picway-tools/core/zip.ts';
import { baseName, downloadBlob, dropzone, fmtBytes, h, Hint, hintNodes, makeT, tick, toolHref, type Strings } from '@picway-tools/core/ui.ts';

const S: Strings<string> = {
  en: {
    pick: 'Choose photos',
    hint: 'JPG or HEIC. Up to 50 files, 200 MB each. Processing starts as soon as you choose files.',
    location: 'Remove location (GPS, preview image, XMP and IPTC)',
    allExif: 'Remove everything: camera, lens, dates and more (EXIF)',
    working: 'Reading…',
    found: 'Found in this photo',
    foundLoc: 'Location: {lat}, {lon}',
    noLoc: 'No location in this photo', maybeLoc: 'No GPS position found, but some data in this photo can’t be checked here, so we can’t say for sure there’s no location.', hiddenLoc: 'No GPS position, but the XMP or IPTC data in this photo holds location info.', unreadable: "Couldn't read this file's info, so we can't say whether it has a location.",
    foundNone: 'No camera or date info found',
    more: '+ {n} more fields',
    xmp: 'It also has XMP or IPTC data, which can hold place names or captions.',
    after: 'New file',
    verifiedLoc: 'Checked: the new file has no location.',
    verifiedAll: 'Checked: the new file has no camera, date or location info.',
    heicNote: 'HEIC was converted to JPG first, because only JPG can be edited here.',
    download: 'Download {name}',
    all: 'Download all (ZIP)',
    again: 'Clear list',
    notPhoto: 'This tool works on JPG and HEIC photos. To turn another picture into a JPG, use',
    goBorder: 'Photo border',
    tooBig: 'This file is over 200 MB.',
    tooMany: 'Only the first 50 files were added.',
    fail: 'Couldn’t clean this photo: {e}',
    left: 'The check found something still in the new file: {what}. Please report it.',
    colors: 'Pixels and color profile are unchanged.',
    badJpeg: 'This file isn’t a complete JPG photo, so nothing was cleaned.',
    badOut: 'The new file didn’t come out as a complete photo, so it isn’t offered for download. Please report it.',
    unsureLoc: 'We couldn’t fully check the new file, so we can’t confirm it has no location.',
    unsureAll: 'We couldn’t fully check the new file, so we can’t confirm it has no camera, date or location info.',
  },
  'zh-Hans': {
    pick: '选择照片',
    hint: '支持 JPG 或 HEIC。最多 50 张，每张不超过 200 MB。选好文件就会自动开始处理。',
    location: '去掉位置信息（GPS、预览图、XMP 和 IPTC）',
    allExif: '全部去掉：相机、镜头、日期等（EXIF）',
    working: '正在读取…',
    found: '这张照片里带的信息',
    foundLoc: '位置：{lat}，{lon}',
    noLoc: '这张照片里没有位置信息', maybeLoc: '没有找到 GPS 坐标，但照片里有些数据这里查不了，所以不能确定没有位置。', hiddenLoc: '没有 GPS 坐标，但照片的 XMP 或 IPTC 数据里带着位置信息。', unreadable: '读不出这个文件里的信息，所以不能说它有没有位置。',
    foundNone: '没有找到相机或日期信息',
    more: '另有 {n} 项',
    xmp: '里面还有 XMP 或 IPTC 数据，可能带地名或说明文字。',
    after: '新文件',
    verifiedLoc: '已检查：新文件里没有位置信息。',
    verifiedAll: '已检查：新文件里没有相机、日期或位置信息。',
    heicNote: 'HEIC 先转成了 JPG，因为这里只能改 JPG。',
    download: '下载 {name}',
    all: '全部下载（ZIP）',
    again: '清空列表',
    notPhoto: '这个工具处理 JPG 和 HEIC 照片。其他图片想存成 JPG，可以用',
    goBorder: '加相框',
    tooBig: '这个文件超过 200 MB。',
    tooMany: '只添加了前 50 个文件。',
    fail: '这张照片没能处理：{e}',
    left: '检查发现新文件里还有：{what}。请反馈给我们。',
    colors: '像素和色彩配置文件没有改动。',
    badJpeg: '这个文件不是完整的 JPG 照片，没有处理。',
    badOut: '新文件不是一张完整的照片，所以没有提供下载。请反馈给我们。',
    unsureLoc: '新文件没能完全检查，所以不能确定里面没有位置信息。',
    unsureAll: '新文件没能完全检查，所以不能确定里面没有相机、日期或位置信息。',
  },
};

const isJpeg = (u: Uint8Array) => u[0] === 0xff && u[1] === 0xd8;

interface Row extends Item {
  f: File;
  li: HTMLElement;
  status: HTMLElement;
  out?: { name: string; blob: Blob };
  url?: string;
}
interface Opts {
  removeLocation: boolean;
  removeAllExif: boolean;
}

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const opt: Opts = { removeLocation: true, removeAllExif: false };
  const settingsChanged = () => void q.invalidate();

  const loc = h('input', { type: 'checkbox', checked: true, disabled: true });
  const all = h('input', { type: 'checkbox', onchange: () => ((opt.removeAllExif = all.checked), settingsChanged()) });
  const list = h('ul', { class: 'tl-list' });
  const urls = new UrlBag();

  const doneList = () => (q.idle ? q.items.filter((r) => r.gen === q.gen && r.out).map((r) => r.out!) : []);
  const sync = () => {
    zipBtn.hidden = doneList().length < 2;
    clear.hidden = q.items.length === 0;
  };
  const zipBtn = h('button', { class: 'tl-btn', hidden: true, onclick: async () => {
    const gen = q.gen;
    const outs = doneList();
    if (outs.length < 2) return;
    const entries = await Promise.all(outs.map(async (d) => ({ name: d.name, data: new Uint8Array(await d.blob.arrayBuffer()) })));
    if (gen !== q.gen || !q.idle || entries.length < 2) return;
    downloadBlob(new Blob([makeZip(entries) as BlobPart], { type: 'application/zip' }), 'cleaned-photos.zip');
  } }, t('all'));
  const clear = h('button', { class: 'tl-btn tl-btn--ghost', hidden: true, onclick: () => (q.clear(), urls.revokeAll(), (list.innerHTML = ''), sync()) }, t('again'));
  const msg = h('p', { class: 'tl-msg', role: 'status' });

  const infoBlock = (i: PhotoInfo) =>
    h('details', { open: true }, h('summary', {}, t('found')),
      h('p', {}, !i.readable ? t('unreadable') : i.gps ? t('foundLoc', { lat: i.gps.lat.toFixed(5), lon: i.gps.lon.toFixed(5) }) : i.hiddenLoc ? t('hiddenLoc') : i.locUnsure ? t('maybeLoc') : t('noLoc')),
      !i.readable ? null : i.rows.length
        ? h('table', { class: 'tl-table' }, ...i.rows.map((r) => h('tr', {}, h('th', {}, r.key), h('td', {}, r.value))))
        : h('p', {}, t('foundNone')),
      i.more ? h('p', { class: 'tl-note' }, t('more', { n: i.more })) : null,
      i.xmpIptc ? h('p', { class: 'tl-note' }, t('xmp')) : null);

  async function run(row: Row, o: Opts) {
    const f = row.f;
    if (f.size > 200 * 1048576) throw new Error(t('tooBig'));
    const src = new Uint8Array(await f.arrayBuffer());
    const heic = !isJpeg(src) && (await looksHeif(f));
    if (!heic && !isJpeg(src)) throw new Hint(t('notPhoto'), [[t('goBorder'), toolHref('photo-border')]]);
    if (!heic && !looksLikeJpegImage(src)) throw new Error(t('badJpeg'));
    if (!heic && !(await canDecode(src))) throw new Error(t('badJpeg'));
    const before = await readInfo(src);
    await tick();
    let out: Uint8Array;
    if (heic) out = new Uint8Array(await (await convertHeic(f, { format: 'jpeg', quality: 0.95, ...o })).blob.arrayBuffer());
    else out = o.removeAllExif ? stripAllFromJpeg(src) : stripLocationFromJpeg(src);
    const after = await readInfo(out);

    if (!after.readable || !after.image) throw new Error(t('badOut'));
    if (!(await canDecode(out))) throw new Error(t('badOut'));

    const check = checkLocation(out, { strict: true, thumbs: true });
    const left = [...check.leaks, o.removeAllExif ? after.rows.filter((r) => r.key !== 'Orientation').map((r) => r.key).join(', ') : ''].filter(Boolean).join('; ');
    if (left) throw new Error(t('left', { what: left }));
    return { before, out, heic, unsure: check.unsure.length > 0 };
  }
  const q = new Reprocessor<Row, Opts, Awaited<ReturnType<typeof run>>>({
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
      const name = `${baseName(row.f.name)}${o.removeAllExif ? '-clean' : '-no-location'}.jpg`;
      const blob = new Blob([r.out as BlobPart], { type: 'image/jpeg' });
      row.out = { name, blob };
      const url = (row.url = urls.own(URL.createObjectURL(blob)));
      row.li.prepend(h('img', { class: 'tl-thumb', src: url, alt: '', width: 48, height: 48 }));
      row.status.replaceChildren(
        infoBlock(r.before),
        h('p', {}, h('strong', {}, `${t('after')}: `), `${fmtBytes(row.f.size)} → ${fmtBytes(blob.size)}. `, r.unsure ? (o.removeAllExif ? t('unsureAll') : t('unsureLoc')) : o.removeAllExif ? t('verifiedAll') : t('verifiedLoc'), ' ', r.heic ? t('heicNote') : t('colors')),
        h('a', { class: 'tl-btn', href: url, download: name }, t('download', { name })),
      );
      sync();
    },
    fail: (row, e) => {
      if (e instanceof Hint) row.status.replaceChildren(...hintNodes(e));
      else row.status.textContent = t('fail', { e: e instanceof Error ? e.message : String(e) });
      row.li.classList.add('is-error');
      sync();
    },
  });
  function addFile(f: File) {
    const status = h('span', { class: 'tl-status' }, t('working'));
    const li = h('li', { class: 'tl-item' }, h('span', { class: 'tl-name' }, f.name), status);
    list.append(li);
    const row: Row = { gen: -1, f, li, status };
    void q.add(row);
    sync();
  }
  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.jpg,.jpeg,.heic,.heif,image/jpeg,image/heic,image/heif', multiple: true, passAll: true, onFiles: (fs) => {
      msg.textContent = fs.length > 50 ? t('tooMany') : '';
      for (const f of fs.slice(0, 50)) addFile(f);
    } }),
    h('div', { class: 'tl-opts' }, h('label', { class: 'tl-row' }, loc, t('location')), h('label', { class: 'tl-row' }, all, t('allExif'))),
    msg,
    list,
    h('div', { class: 'tl-actions' }, zipBtn, clear),
  );
}
