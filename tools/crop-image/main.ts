import { CROP_ACCEPT, cropImage, dragRect, fitRatio, flip, frameDims, frameMatrix, initGeometry, rotate, setSize, type CropOptions, type CropResult, type Geometry, type Handle, type Rect } from '@picway-tools/core/crop.ts';
import { convertImage, OUT_EXT, preload } from '@picway-tools/core/convert.ts';
import { resizeFormatFor, Unsupported, type ResizeChoice } from '@picway-tools/core/resize.ts';
import { pctChange } from '@picway-tools/core/compress.ts';
import { sniffKind, type Kind } from '@picway-tools/core/sniff.ts';
import { UrlBag } from '@picway-tools/core/task.ts';
import { baseName, dropzone, fmtBytes, h, makeT, tick, type Strings } from '@picway-tools/core/ui.ts'; import { errCode, REASONS } from '@picway-tools/core/errcode.ts';
import { EXTRA } from './strings.ts';

const S: Strings<string> = { ...EXTRA,
  en: {
    pick: 'Choose an image',
    hint: 'or drop it here. JPG, PNG, WebP, HEIC, AVIF, BMP or TIFF, up to 200 MB.',
    opening: 'Opening…',
    rotL: 'Rotate left',
    rotR: 'Rotate right',
    flipH: 'Flip horizontal',
    flipV: 'Flip vertical',
    reset: 'Reset',
    ratio: 'Aspect ratio',
    free: 'Free',
    orig: 'Original',
    box: 'Crop area. Drag it to move it, drag a corner to resize it, or move it with the arrow keys.',
    width: 'Width',
    height: 'Height',
    left: 'From left',
    top: 'From top',
    format: 'Save as',
    same: 'Same format as the original',
    background: 'Background for transparent areas',
    location: 'Remove location (GPS)',
    allExif: 'Remove all camera and date info (EXIF)',
    note: 'HEIC, BMP and TIFF are saved as JPG. The image is encoded again, so the file size changes. To change the pixel size, use the image resizer.',
    create: 'Create image',
    working: 'Working…',
    download: 'Download',
    tooBig: 'This file is over 200 MB.',
    gif: 'GIF isn’t supported here: editing it as a still image would drop the animation.',
    fail: 'Couldn’t open this file: {e}',
    failSave: 'Couldn’t create the image: {e}',
    gpsOut: 'location removed',
    gpsIn: 'location kept',
    exifOut: 'all EXIF removed', exifDrop: 'camera and date info not kept in this format',
    colP3: 'Display P3 kept',
    colSrgb: 'converted to sRGB',
    flat: 'transparent areas filled with the background color',
    down: 'Shrunk to fit this device’s size limit',
    first: 'animated image: only the first frame was kept',
  },
  'zh-Hans': {
    pick: '选择一张图片',
    hint: '或把图片拖到这里。支持 JPG、PNG、WebP、HEIC、AVIF、BMP、TIFF，不超过 200 MB。',
    opening: '正在打开…',
    rotL: '向左转',
    rotR: '向右转',
    flipH: '左右翻转',
    flipV: '上下翻转',
    reset: '复原',
    ratio: '比例',
    free: '自由',
    orig: '原图比例',
    box: '裁剪框。拖动可移动，拖四个角可改大小，也可以用方向键移动。',
    width: '宽',
    height: '高',
    left: '距左边',
    top: '距上边',
    format: '保存为',
    same: '和原图同一格式',
    background: '透明部分的底色',
    location: '去掉位置信息（GPS）',
    allExif: '去掉全部相机和日期信息（EXIF）',
    note: 'HEIC、BMP、TIFF 会存成 JPG。图片会重新编码，文件大小会变。想改像素尺寸，用改图片尺寸工具。',
    create: '生成图片',
    working: '正在处理…',
    download: '下载',
    tooBig: '这个文件超过 200 MB。',
    gif: '这里不处理 GIF：当成静态图编辑会丢掉动画。',
    fail: '没能打开这个文件：{e}',
    failSave: '没能生成图片：{e}',
    gpsOut: '已去掉位置',
    gpsIn: '保留了位置',
    exifOut: '已去掉全部 EXIF', exifDrop: '这个格式不保留相机和日期信息',
    colP3: '保留 Display P3',
    colSrgb: '已转成 sRGB',
    flat: '透明部分已铺上底色',
    down: '为适应本设备的尺寸上限缩小了',
    first: '这是动图，只保留了第一帧',
  },
};

const NAMES: Record<string, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', avif: 'AVIF', heic: 'HEIC', bmp: 'BMP', tiff: 'TIFF', gif: 'GIF' };

const RATIOS: [string, number][] = [['1:1', 1], ['4:5', 4 / 5], ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16], ['16:9', 16 / 9], ['3:2', 3 / 2], ['4:3', 4 / 3], ['5:4', 5 / 4]];

const PREVIEW = 1600;

export function mount(host: HTMLElement) {
  const t = makeT(S, host); const why = (e: unknown) => (console.warn(e), makeT(REASONS, host)(errCode(e)));
  const opt = { format: 'same' as ResizeChoice, background: '#ffffff', removeLocation: true, removeAllExif: false };
  let file: File | null = null; let srcKind: Kind | null = null;
  let sw = 0;
  let sh = 0;
  let pv: ImageBitmap | null = null;
  let geo: Geometry = initGeometry(1, 1);
  let loadGen = 0;
  let gen = 0; let running: Promise<unknown> = Promise.resolve();
  const urls = new UrlBag();

  const msg = h('p', { class: 'tl-msg', role: 'status' });
  const canvas = h('canvas', { style: 'display:block;max-width:100%;max-height:70vh;width:auto;height:auto' });
  const box = h('div', { tabindex: 0, role: 'group', 'aria-label': t('box'), style: 'position:absolute;box-sizing:border-box;border:2px solid #fff;outline:1px solid rgba(0,0,0,.6);box-shadow:0 0 0 9999px rgba(0,0,0,.45);cursor:move;touch-action:none' });
  for (const c of ['nw', 'ne', 'sw', 'se'] as Handle[]) box.append(h('span', { 'data-h': c, style: `position:absolute;width:22px;height:22px;${c[0] === 'n' ? 'top:0' : 'bottom:0'};${c[1] === 'w' ? 'left:0' : 'right:0'};background:#fff;border:2px solid #333;border-radius:4px;box-sizing:border-box;cursor:${c === 'nw' || c === 'se' ? 'nwse' : 'nesw'}-resize` }));
  const stage = h('div', { style: 'position:relative;display:inline-block;justify-self:start;max-width:100%;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:8px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 0 0/16px 16px' }, canvas, box);
  const num = (on: () => void) => h('input', { type: 'number', min: '0', step: '1', inputmode: 'numeric', style: 'width:6em', onchange: on });
  const wIn = num(() => sized('w'));
  const hIn = num(() => sized('h'));
  const xIn = num(() => moved());
  const yIn = num(() => moved());
  const ratioSel = h('select', { onchange: () => onRatio() }, h('option', { value: 'free' }, t('free')), h('option', { value: 'orig' }, t('orig')), ...RATIOS.map(([k]) => h('option', { value: k }, k)));
  const btn = (label: string, on: () => void) => h('button', { type: 'button', class: 'tl-btn tl-btn--ghost', onclick: on }, label);
  const result = h('div', { class: 'tl-status', style: 'display:grid;gap:4px;justify-items:start' });
  const create = h('button', { type: 'button', class: 'tl-btn', onclick: () => void make() }, t('create'));

  const frame = () => frameDims(sw, sh, geo.rot);
  const ratioVal = (): number | null => {
    if (ratioSel.value === 'free') return null;
    if (ratioSel.value === 'orig') { const [fw, fh] = frame(); return fw / fh; }
    return RATIOS.find(([k]) => k === ratioSel.value)?.[1] ?? null;
  };

  function invalidate() {
    gen++;
    urls.revokeAll();
    result.replaceChildren();
  }
  function drawImage() {
    if (!pv) return;
    const [w, h2] = frameDims(pv.width, pv.height, geo.rot);
    canvas.width = w;
    canvas.height = h2;
    const ctx = canvas.getContext('2d')!;
    ctx.save();
    ctx.transform(...frameMatrix(geo.rot, geo.flip, pv.width, pv.height));
    ctx.drawImage(pv, 0, 0);
    ctx.restore();
  }
  function drawBox() {
    const [fw, fh] = frame();
    const c = geo.crop;
    Object.assign(box.style, { left: `${(c.x / fw) * 100}%`, top: `${(c.y / fh) * 100}%`, width: `${(c.w / fw) * 100}%`, height: `${(c.h / fh) * 100}%` });
    for (const [el, v, max] of [[wIn, c.w, fw], [hIn, c.h, fh], [xIn, c.x, fw - c.w], [yIn, c.y, fh - c.h]] as [HTMLInputElement, number, number][]) (el.value = String(v)), (el.max = String(max));
  }
  function setCrop(r: Rect) {
    const c = geo.crop;
    if (r.x === c.x && r.y === c.y && r.w === c.w && r.h === c.h) return drawBox();
    geo = { ...geo, crop: r };
    drawBox();
    invalidate();
  }
  function sized(changed: 'w' | 'h') {
    if ([wIn, hIn].some((el) => el.value.trim() === '')) return drawBox(); const [fw, fh] = frame();
    setCrop(setSize(geo.crop, Number(wIn.value), Number(hIn.value), ratioVal(), fw, fh, changed));
  }
  function moved() {
    if ([xIn, yIn].some((el) => el.value.trim() === '')) return drawBox(); const [fw, fh] = frame();
    setCrop(dragRect({ ...geo.crop, x: 0, y: 0 }, 'move', Number(xIn.value) || 0, Number(yIn.value) || 0, null, fw, fh));
  }
  function onRatio() {
    const r = ratioVal();
    const [fw, fh] = frame();
    setCrop(r ? fitRatio(r, fw, fh) : geo.crop);
  }

  function transform(next: Geometry) {
    geo = next;
    const r = ratioVal();
    const [fw, fh] = frame();
    if (r && Math.abs(geo.crop.w / geo.crop.h / r - 1) > 0.01) geo = { ...geo, crop: ((k) => ({ x: geo.crop.x + k.x, y: geo.crop.y + k.y, w: k.w, h: k.h }))(fitRatio(r, geo.crop.w, geo.crop.h)) };
    drawImage();
    drawBox();
    invalidate();
  }

  let drag: { handle: Handle; x: number; y: number; start: Rect; k: number; id: number } | null = null;
  stage.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement;
    const handle = (target.dataset.h as Handle | undefined) ?? (target === box ? 'move' : null);
    if (!handle || !pv) return;
    e.preventDefault();
    const [fw] = frame();
    drag = { handle, x: e.clientX, y: e.clientY, start: geo.crop, k: fw / stage.getBoundingClientRect().width, id: e.pointerId };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [fw, fh] = frame();
    setCrop(dragRect(drag.start, drag.handle, (e.clientX - drag.x) * drag.k, (e.clientY - drag.y) * drag.k, ratioVal(), fw, fh));
  });
  const end = (e: PointerEvent) => { if (drag && e.pointerId === drag.id) drag = null; };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  box.addEventListener('keydown', (e) => {
    const d = e.shiftKey ? 10 : 1;
    const [dx, dy] = ({ ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, -d], ArrowDown: [0, d] } as Record<string, [number, number]>)[e.key] ?? [0, 0];
    if (!dx && !dy) return;
    e.preventDefault();
    const [fw, fh] = frame();
    setCrop(dragRect(geo.crop, 'move', dx, dy, null, fw, fh));
  });

  const fmt = h('select', { onchange: () => (onFormat(), invalidate()) },
    h('option', { value: 'same' }, t('same')), h('option', { value: 'jpeg' }, 'JPG'), h('option', { value: 'png' }, 'PNG'), h('option', { value: 'webp' }, 'WebP'));
  const bgIn = h('input', { type: 'color', value: '#ffffff', onchange: () => ((opt.background = bgIn.value), invalidate()) });
  const bgRow = h('label', { class: 'tl-row' }, t('background'), bgIn);
  function onFormat() {
    opt.format = fmt.value as ResizeChoice;
    bgRow.hidden = opt.format === 'webp' || opt.format === 'png' || (opt.format === 'same' && (srcKind === 'png' || srcKind === 'webp' || srcKind === 'avif'));
    if (opt.format === 'webp') preload('webp');
  }
  const loc = h('input', { type: 'checkbox', checked: true, onchange: () => ((opt.removeLocation = loc.checked), invalidate()) }); let locWas = true;
  const all = h('input', {
    type: 'checkbox',
    onchange: () => ((opt.removeAllExif = all.checked), all.checked ? ((locWas = loc.checked), (loc.checked = true)) : (loc.checked = locWas), (loc.disabled = all.checked), (opt.removeLocation = loc.checked), invalidate()),
  });

  const editor = h('div', { class: 'tl-opts', hidden: true },
    h('div', { class: 'tl-actions' }, btn(t('rotL'), () => transform(rotate(geo, sw, sh, false))), btn(t('rotR'), () => transform(rotate(geo, sw, sh, true))), btn(t('flipH'), () => transform(flip(geo, sw, sh, true))), btn(t('flipV'), () => transform(flip(geo, sw, sh, false))), btn(t('reset'), () => ((ratioSel.value = 'free'), transform(initGeometry(sw, sh))))),
    h('label', { class: 'tl-row' }, t('ratio'), ratioSel),
    stage,
    h('div', { class: 'tl-row' }, h('label', {}, t('width'), ' ', wIn), ' × ', h('label', {}, t('height'), ' ', hIn), ' px'),
    h('div', { class: 'tl-row' }, h('label', {}, t('left'), ' ', xIn), h('label', {}, t('top'), ' ', yIn)),
    h('label', { class: 'tl-row' }, t('format'), fmt),
    bgRow,
    h('label', { class: 'tl-row' }, loc, t('location')),
    h('label', { class: 'tl-row' }, all, t('allExif')),
    h('p', { class: 'tl-note' }, t('note')),
    h('div', { class: 'tl-actions' }, create),
    result);

  async function open(f: File) {
    const my = ++loadGen; const prev = running; let done = () => {}; running = new Promise<void>((r) => (done = r));
    invalidate();
    editor.hidden = true;
    pv?.close();
    pv = null;
    file = null;
    msg.textContent = t('opening');
    try {
      await prev; if (my !== loadGen) return; if (f.size > 200 * 1048576) throw new TooBig();
      const kind = sniffKind(new Uint8Array(await f.slice(0, 4096).arrayBuffer())); if (!resizeFormatFor(kind, 'same')) throw new Unsupported('gif');
      await tick();
      let w = 0;
      let hh = 0;
      const dec = convertImage(f, { format: 'png', quality: 1, background: '#ffffff', removeLocation: true, removeAllExif: true, resize: (a, b) => { (w = a), (hh = b); const k = Math.min(1, PREVIEW / Math.max(a, b)); return [a * k, b * k]; } }).then((r) => (my === loadGen ? createImageBitmap(r.blob) : null));
      const bmp = await dec;
      if (!bmp || my !== loadGen) return bmp?.close();
      (file = f), (pv = bmp), (sw = w), (sh = hh), (srcKind = kind);
      geo = initGeometry(sw, sh);
      ratioSel.value = 'free'; onFormat();
      msg.textContent = '';
      editor.hidden = false;
      drawImage();
      drawBox();
    } catch (e) {
      if (my !== loadGen) return;
      msg.textContent = e instanceof TooBig ? t('tooBig') : e instanceof Unsupported ? t('gif') : t('fail', { e: why(e) });
    } finally { done(); }
  }

  async function make() {
    if (!file) return;
    const my = ++gen; create.disabled = true;
    urls.revokeAll();
    const o: CropOptions = { geometry: { ...geo, crop: { ...geo.crop } }, srcWidth: sw, srcHeight: sh, ...opt };
    const f = file;
    result.replaceChildren(t('working'));
    try {
      const job = running.then(() => cropImage(f, o)); running = job.then(() => undefined, () => undefined);
      const r = await job;
      if (my !== gen) return;
      if (!r.blob.size) throw new Error('empty result');
      show(f, r, o);
    } catch (e) {
      if (my !== gen) return;
      result.replaceChildren(h('span', { class: 'tl-err' }, e instanceof Unsupported ? t('gif') : t('failSave', { e: why(e) })));
    } finally { create.disabled = false; }
  }
  function show(f: File, r: CropResult, o: CropOptions) {
    const g = o.geometry;
    const [fw, fh] = frameDims(o.srcWidth, o.srcHeight, g.rot);
    const c = g.crop;
    const tag = c.x || c.y || c.w !== fw || c.h !== fh ? 'cropped' : g.flip && g.rot === 2 ? 'flipped' : g.rot ? 'rotated' : g.flip ? 'flipped' : 'edited';
    const name = `${baseName(f.name)}-${tag}.${OUT_EXT[r.format]}`;
    const url = urls.own(URL.createObjectURL(r.blob));
    const notes = [
      `${r.srcWidth}×${r.srcHeight} → ${r.width}×${r.height}`,
      `${fmtBytes(f.size)} → ${fmtBytes(r.blob.size)} (${pctChange(f.size, r.blob.size)})`,
      `${NAMES[r.from] ?? r.from.toUpperCase()} → ${NAMES[r.format]}`,
      r.colour === 'p3' ? t('colP3') : r.colourConverted ? t('colSrgb') : '',
      r.hadGps ? (r.gpsRemoved ? t('gpsOut') : t('gpsIn')) : '',
      o.removeAllExif ? t('exifOut') : '',
      r.flattened ? t('flat') : '',
      r.downscaled ? t('down') : '',
      r.firstFrameOnly ? t('first') : '', !o.removeAllExif && r.exifDropped ? t('exifDrop') : '',
    ].filter(Boolean);
    result.replaceChildren(h('a', { class: 'tl-btn', href: url, download: name }, `${t('download')} ${name}`), h('small', {}, notes.join(' · ')));
  }

  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: CROP_ACCEPT, passAll: true, onFiles: (fs) => void open(fs[0]) }),
    msg,
    editor,
  );
  onFormat();
}

class TooBig extends Error {}
