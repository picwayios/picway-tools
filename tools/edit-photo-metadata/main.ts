import { getGps, loadDict, readFields, type ExifDict } from '@picway-tools/core/exif.ts';
import { canDecode } from '@picway-tools/core/decodable.ts'; import { makeLatest } from '@picway-tools/core/latest.ts';
import { buildEdited, LocationLeakError, MAX_FIELD_CHARS, origLocationState, readBackSaysNone, savedProblem, TooLongError } from '@picway-tools/core/editsave.ts';
import { convertHeic, looksHeif } from '@picway-tools/core/heic.ts';
import { readInfo } from '@picway-tools/core/info.ts';
import { getExifTiff, looksLikeJpegImage } from '@picway-tools/core/jpeg.ts';
import { TileMap } from '@picway-tools/core/map.ts';
import { browserOffset, exifToLocal, localToExif, parseCoordInputs, parseLatLon, validOffset } from '@picway-tools/core/mapmath.ts';
import { openPhoto } from '@picway-tools/core/opensel.ts';
import { TaskGate, UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, Hint, hintNodes, makeT, toolHref, type Strings } from '@picway-tools/core/ui.ts'; import { clearOffer, offerDownload } from '@picway-tools/core/offer.ts';

const S: Strings<string> = {
  en: {
    pick: 'Choose a photo',
    hint: 'JPG or HEIC, up to 200 MB. One photo at a time.',
    heic: 'HEIC photos are converted to JPG first, keeping the Display P3 color profile. JPG photos are edited without re-encoding.',
    loading: 'Reading the photo…',
    secLoc: 'Location',
    showMap: 'Show map',
    mapConsent: 'No server receives the photo file. Showing the map loads map tiles from OpenStreetMap, so OpenStreetMap sees which area around the pin you are looking at, along with the usual details any website receives, such as your IP address.',
    mapNote: 'Click the map to place the pin, drag to move, and use + and − to zoom. The photo file is processed inside your browser, and this page has no server that receives it. The map loads tiles from OpenStreetMap, and place search sends the name you type to OpenStreetMap’s Nominatim service.',
    lat: 'Latitude',
    lon: 'Longitude',
    coords: 'Or paste “latitude, longitude”',
    search: 'Search a place',
    searchGo: 'Search',
    searching: 'Searching…',
    noResult: 'No match. Try a more specific name.',
    searchFail: 'The place search isn’t reachable. You can still click the map or type coordinates.',
    clearLoc: 'Remove the location from this photo',
    original: 'Original: {v}',
    none: 'none',
    origHidden: 'no GPS position, but the XMP/IPTC data holds location info. It stays in the file unless you tick “Remove the location from this photo” below.',
    origUnsure: 'couldn’t fully read the location info, so we can’t say whether there is one.',
    secTime: 'Date and time taken',
    dt: 'Date and time',
    tz: 'Time zone offset',
    tzHint: 'e.g. +08:00. Leave empty to keep what the photo has.',
    useBrowserTz: 'Use my time zone ({tz})',
    sortNote: 'The Photos app sorts by this capture time. After you add the edited file to Photos, the photo moves to its new place in the timeline.',
    secCam: 'Camera and author',
    make: 'Camera make',
    model: 'Camera model',
    artist: 'Author',
    caption: 'Description',
    copyright: 'Copyright',
    download: 'Save edited photo',
    working: 'Writing…',
    saved: 'Saved. Read back from the new file: {what}',
    badCoords: 'Latitude must be between −90 and 90, and longitude between −180 and 180.',
    leftLoc: 'The check found a location still in the new file ({what}), so nothing was saved. Please report it.',
    xmpDropped: 'The photo’s XMP/IPTC data was removed too, because it can hold the old location.',
    hiddenKept: 'The new file’s XMP/IPTC data still holds location info.',
    badTz: 'Time zone offset looks like +08:00 or −05:00.',
    tooLong: 'The text is too long to save. Shorten the camera, author, caption or copyright fields.',
    badDt: 'Enter both a date and a time.',
    notPhoto: 'This tool works on JPG and HEIC photos. To turn another picture into a JPG, use',
    goBorder: 'Photo border',
    tooBig: 'This file is over 200 MB.',
    fail: 'Couldn’t read this photo: {e}',
    badJpeg: 'This file isn’t a complete JPG photo, so it can’t be edited here.',
    badOut: 'The new file didn’t come out as a complete photo, so nothing was saved. Please report it.',
    unsureLoc: 'We couldn’t fully check the new file, so we can’t confirm the old location is gone.',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    attrib: '© OpenStreetMap contributors',
    dlLink: 'Download {name}',
    goConv: 'Image converter',
    notPhotoOnly: 'This tool works on JPG and HEIC photos.',
  },
  'zh-Hans': {
    pick: '选择一张照片',
    hint: '支持 JPG 或 HEIC，不超过 200 MB。一次一张。',
    heic: 'HEIC 照片会先转成 JPG（保留 Display P3 色彩配置文件）。JPG 照片直接改信息，不重新编码。',
    loading: '正在读取照片…',
    secLoc: '位置',
    showMap: '显示地图',
    mapConsent: '没有接收照片文件的服务器。显示地图时会从 OpenStreetMap 加载地图图块，所以 OpenStreetMap 会看到你在查看图钉附近的哪一片区域，还有任何网站都会收到的常规信息，例如你的 IP 地址。',
    mapNote: '点地图放图钉，拖动移动，用 + 和 − 缩放。照片文件在浏览器里处理，本页没有接收它的服务器。地图图块来自 OpenStreetMap，地名搜索会把你输入的地名发给 OpenStreetMap 的 Nominatim 服务。',
    lat: '纬度',
    lon: '经度',
    coords: '或粘贴“纬度, 经度”',
    search: '搜索地名',
    searchGo: '搜索',
    searching: '正在搜索…',
    noResult: '没有匹配结果，试试更具体的名称。',
    searchFail: '地名搜索连不上。你仍然可以点地图或直接输入坐标。',
    clearLoc: '去掉这张照片的位置',
    original: '原值：{v}',
    none: '无',
    origHidden: '没有 GPS 坐标，但 XMP/IPTC 数据里带着位置信息。不勾选下面的「去掉这张照片的位置」，就会留在文件里。',
    origUnsure: '没能完全读取位置信息，所以不能确定有没有位置。',
    secTime: '拍摄日期和时间',
    dt: '日期和时间',
    tz: '时区偏移',
    tzHint: '例如 +08:00。留空则保留照片原有的。',
    useBrowserTz: '用我的时区（{tz}）',
    sortNote: '照片 App 按这个拍摄时间排序。把改好的文件加入照片后，这张照片会移到时间线上新的位置。',
    secCam: '相机和作者',
    make: '相机品牌',
    model: '相机型号',
    artist: '作者',
    caption: '说明',
    copyright: '版权',
    download: '保存修改后的照片',
    working: '正在写入…',
    saved: '已保存。从新文件读回的内容：{what}',
    badCoords: '纬度要在 −90 到 90 之间，经度要在 −180 到 180 之间。',
    leftLoc: '检查发现新文件里还留着位置信息（{what}），所以没有保存。请反馈给我们。',
    xmpDropped: '照片里的 XMP/IPTC 数据也一并去掉了，因为它们可能带着旧位置。',
    hiddenKept: '新文件的 XMP/IPTC 数据里还带着位置信息。',
    badTz: '时区偏移的格式像 +08:00 或 −05:00。',
    tooLong: '文字太长，没法保存。请缩短相机、作者、说明或版权这几项。',
    badDt: '请同时填写日期和时间。',
    notPhoto: '这个工具处理 JPG 和 HEIC 照片。其他图片想存成 JPG，可以用',
    goBorder: '加相框',
    tooBig: '这个文件超过 200 MB。',
    fail: '这张照片没能读取：{e}',
    badJpeg: '这个文件不是完整的 JPG 照片，没法在这里编辑。',
    badOut: '新文件不是一张完整的照片，所以没有保存。请反馈给我们。',
    unsureLoc: '新文件没能完全检查，所以不能确定旧位置已经去掉。',
    zoomIn: '放大',
    zoomOut: '缩小',
    attrib: '© OpenStreetMap 贡献者',
    dlLink: '下载 {name}',
    goConv: '图片转换',
    notPhotoOnly: '这个工具处理 JPG 和 HEIC 照片。',
  },
};

const isJpeg = (u: Uint8Array) => u[0] === 0xff && u[1] === 0xd8;

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  const root = h('div', {});
  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: '.jpg,.jpeg,.heic,.heif,image/jpeg,image/heic,image/heif', passAll: true, onFiles: ([f]) => open(f) }),
    h('p', { class: 'tl-note' }, t('heic')),
    root,
  );

  const gate = new TaskGate();
  const urls = new UrlBag();
  const open = (f: File) =>
    openPhoto<File>(gate, f, {
      read: async (x) => {
        if (x.size > 200 * 1048576) throw new Error(t('tooBig'));
        return new Uint8Array(await x.arrayBuffer());
      },
      isJpeg,
      checkJpeg: async (b) => {
        if (!looksLikeJpegImage(b)) throw new Hint(t('badJpeg'), []);
        if (!(await canDecode(b))) throw new Hint(t('badJpeg'), []);
      },
      looksHeif,
      convert: async (x) => new Uint8Array(await (await convertHeic(x, { format: 'jpeg', quality: 0.95, removeLocation: false, removeAllExif: false })).blob.arrayBuffer()),
      begin: () => {
        urls.revokeAll();
        root.replaceChildren(h('p', { class: 'tl-msg', role: 'status' }, t('loading')));
      },
      ready: (x, bytes) => editor(x, bytes, gate.version),
      fail: (e, notPhoto) =>
        root.replaceChildren(h('p', { class: 'tl-msg is-error' }, ...(notPhoto ? hintNodes(notPhotoHint()) : e instanceof Hint ? hintNodes(e) : [t('fail', { e: e instanceof Error ? e.message : String(e) })]))),
    });

  const notPhotoHint = () => ((href) => (href ? new Hint(t('notPhoto'), [[t('goConv'), href]]) : new Hint(t('notPhotoOnly'), [])))(toolHref('image-converter'));
  function editor(f: File, bytes: Uint8Array, version: number) {
    const stale = () => gate.version !== version;
    const dict: ExifDict = loadDict(getExifTiff(bytes));
    const orig = readFields(dict);
    const origGps = getGps(dict);
    const origLoc = origLocationState(bytes, !!origGps);
    const url = urls.own(URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' })));
    let pin: { lat: number; lon: number } | null = origGps;
    let clearLoc = false;

    const latIn = h('input', { type: 'text', inputMode: 'decimal', size: 12, value: origGps ? origGps.lat.toFixed(6) : '' });
    const lonIn = h('input', { type: 'text', inputMode: 'decimal', size: 12, value: origGps ? origGps.lon.toFixed(6) : '' });
    const pasteIn = h('input', { type: 'text', size: 24, placeholder: '37.7749, -122.4194' });
    const clearBox = h('input', { type: 'checkbox', onchange: () => ((clearLoc = clearBox.checked), (map.el.style.opacity = clearLoc ? '0.4' : '1'), refreshCoords()) });
    const map = new TileMap({
      lat: origGps?.lat ?? 20,
      lon: origGps?.lon ?? 0,
      zoom: origGps ? 13 : 2,
      labels: { zoomIn: t('zoomIn'), zoomOut: t('zoomOut') },
      onPick: (lat, lon) => place(lat, lon, false),
    });
    map.setPin(pin);

    map.el.hidden = true;
    const mapBtn = h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: () => ((map.el.hidden = false), (mapBox.hidden = true), (attribP.hidden = false), map.enable()) }, t('showMap'));
    const mapBox = h('div', {}, h('p', { class: 'tl-note' }, t('mapConsent')), mapBtn);
    const attribP = h('p', { class: 'tl-attrib', hidden: true }, h('a', { href: 'https://www.openstreetmap.org/copyright', rel: 'noopener' }, t('attrib')));
    function place(lat: number, lon: number, recenter: boolean) {
      pin = { lat, lon };
      latIn.value = lat.toFixed(6);
      lonIn.value = lon.toFixed(6);
      clearBox.checked = clearLoc = false;
      map.el.style.opacity = '1';
      map.setPin(pin);
      if (recenter) map.setCenter(lat, lon, 13);
      refreshCoords();
    }

    const readCoordInputs = () => {
      const c = parseCoordInputs(latIn.value, lonIn.value);
      return c.kind === 'empty' && origGps ? ({ kind: 'bad' } as const) : c;
    };
    const coordErr = h('small', { class: 'tl-err', role: 'alert' });
    const refreshCoords = () => {
      const bad = !clearLoc && readCoordInputs().kind === 'bad';
      coordErr.textContent = bad ? t('badCoords') : '';
      save.disabled = bad;
    };
    const fromInputs = () => {
      const c = parseCoordInputs(latIn.value, lonIn.value);
      if (c.kind === 'ok') place(c.lat, c.lon, true);
      refreshCoords();
    };
    latIn.addEventListener('input', refreshCoords);
    lonIn.addEventListener('input', refreshCoords);
    latIn.addEventListener('change', fromInputs);
    lonIn.addEventListener('change', fromInputs);
    pasteIn.addEventListener('change', () => {
      const p = parseLatLon(pasteIn.value);
      if (p) place(p.lat, p.lon, true);
      else status.textContent = t('badCoords');
    });

    const qIn = h('input', { type: 'search', size: 28, 'aria-label': t('search') });
    const results = h('ul', { class: 'tl-results' });
    const latest = makeLatest();
    const search = async () => {
      const q = qIn.value.trim();
      if (!q) return;
      const ticket = latest.begin();
      results.replaceChildren(h('li', {}, t('searching')));
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, { headers: { Accept: 'application/json' }, signal: ticket.signal });
        const j = (await r.json()) as { lat: string; lon: string; display_name: string }[];
        if (!ticket.current()) return;
        results.replaceChildren(...(j.length ? j.map((x) => h('li', {}, h('button', { type: 'button', class: 'tl-link', onclick: () => place(Number(x.lat), Number(x.lon), true) }, x.display_name))) : [h('li', {}, t('noResult'))]));
      } catch {
        if (!ticket.current()) return;
        results.replaceChildren(h('li', {}, t('searchFail')));
      }
    };
    qIn.addEventListener('keydown', (e) => e.key === 'Enter' && (e.preventDefault(), search()));

    const dtIn = h('input', { type: 'datetime-local', step: '1', min: '1900-01-01T00:00:00', max: '9999-12-31T23:59:59', value: exifToLocal(orig.dateTimeOriginal) });
    const tzIn = h('input', { type: 'text', size: 8, placeholder: '+08:00', value: orig.offset ?? '' });
    const tz = browserOffset();

    const mk = (label: string, key: keyof typeof orig) => {
      const inp = h('input', { type: 'text', size: 28, maxLength: MAX_FIELD_CHARS, value: orig[key] ?? '' });
      return { inp, row: h('label', { class: 'tl-row' }, label, inp, h('small', {}, t('original', { v: orig[key] || t('none') }))), key };
    };
    const fields = [mk(t('make'), 'make'), mk(t('model'), 'model'), mk(t('artist'), 'artist'), mk(t('caption'), 'description'), mk(t('copyright'), 'copyright')];

    const status = h('p', { class: 'tl-msg', role: 'status' });
    const got = h('span', { class: 'tl-got' });
    const save = h('button', { type: 'button', class: 'tl-btn', onclick: async () => {
     try {
      status.textContent = '';
      clearOffer(got);

      let pinNow: { lat: number; lon: number } | null = null;
      if (!clearLoc) {
        const c = readCoordInputs();
        if (c.kind === 'bad') return void (status.textContent = t('badCoords'));
        if (c.kind === 'ok') pinNow = { lat: c.lat, lon: c.lon };
      }

      const patch: Parameters<typeof buildEdited>[1]['patch'] = {};
      const newDt = dtIn.value ? localToExif(dtIn.value) : '';
      if (dtIn.value && !newDt) return void (status.textContent = t('badDt'));
      if (newDt && newDt !== (orig.dateTimeOriginal ?? '').slice(0, 19)) patch.dateTimeOriginal = newDt;
      const off = tzIn.value.trim().replace('−', '-');
      if (off && !validOffset(off)) return void (status.textContent = t('badTz'));
      if (off && off !== (orig.offset ?? '')) patch.offset = off;
      for (const { inp, key } of fields) if (inp.value !== (orig[key] ?? '')) patch[key] = inp.value;
      let built;
      try {
        built = buildEdited(bytes, { clearLoc, pin: pinNow, origGps, patch });
      } catch (e) {
        if (e instanceof LocationLeakError) return void (status.textContent = t('leftLoc', { what: e.message }));
        if (e instanceof TooLongError) return void (status.textContent = t('tooLong'));
        throw e;
      }
      const out = built.out;

      const back = await readInfo(out);
      if (stale()) return;
      const bad = savedProblem(back, clearLoc);
      if (bad === 'location') return void (status.textContent = t('leftLoc', { what: 'GPS' }));
      if (bad) return void (status.textContent = t('badOut'));
      const decodable = await canDecode(out);
      if (stale()) return;
      if (!decodable) return void (status.textContent = t('badOut'));

      const what = [back.gps ? `${back.gps.lat.toFixed(5)}, ${back.gps.lon.toFixed(5)}` : readBackSaysNone(back, built.locationUnsure) ? t('none') : '', back.rows.find((r) => r.key === 'DateTimeOriginal')?.value ?? ''].filter(Boolean).join(' · ');
      status.textContent = t('saved', { what }) + ` (${fmtBytes(out.length)})` + (built.droppedXmpIptc ? ' ' + t('xmpDropped') : '') + (built.locationUnsure ? ' ' + t('unsureLoc') : '') + (back.hiddenLoc ? ' ' + t('hiddenKept') : '');

      const name = `${baseName(f.name)}-edited.jpg`;
      offerDownload({ slot: got, blob: new Blob([out as BlobPart], { type: 'image/jpeg' }), name, label: t('dlLink', { name }), auto: true });
     } catch (e) {
      if (stale()) return;
      status.textContent = t('fail', { e: e instanceof Error ? e.message : String(e) });
     }
    } }, t('download'));

    const sec = (title: string, ...kids: (Node | null)[]) => h('fieldset', { class: 'tl-sec' }, h('legend', {}, title), ...kids);
    root.replaceChildren(
      h('div', { class: 'tl-edit' },
        h('img', { class: 'tl-preview', src: url, alt: f.name }),
        sec(t('secLoc'),
          mapBox,
          map.el,
          attribP,
          h('p', { class: 'tl-note' }, t('mapNote')),
          h('div', { class: 'tl-row' }, h('label', { class: 'tl-row' }, t('lat'), latIn), h('label', { class: 'tl-row' }, t('lon'), lonIn)),
          coordErr,
          h('p', { class: 'tl-note' }, t('original', { v: origGps ? `${origGps.lat.toFixed(5)}, ${origGps.lon.toFixed(5)}` : origLoc === 'hidden' ? t('origHidden') : origLoc === 'unsure' ? t('origUnsure') : t('none') })),
          h('label', { class: 'tl-row' }, t('coords'), pasteIn),
          h('div', { class: 'tl-row' }, h('label', { class: 'tl-row' }, t('search'), qIn), h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: search }, t('searchGo'))),
          results,
          h('label', { class: 'tl-row' }, clearBox, t('clearLoc'))),
        sec(t('secTime'),
          h('label', { class: 'tl-row' }, t('dt'), dtIn, h('small', {}, t('original', { v: orig.dateTimeOriginal || t('none') }))),
          h('div', { class: 'tl-row' }, h('label', { class: 'tl-row' }, t('tz'), tzIn), h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: () => (tzIn.value = tz) }, t('useBrowserTz', { tz }))),
          h('p', { class: 'tl-note' }, t('tzHint')),
          h('p', { class: 'tl-note' }, t('sortNote'))),
        sec(t('secCam'), ...fields.map((x) => x.row)),
        h('div', { class: 'tl-actions' }, save, got),
        status));
  }
}
