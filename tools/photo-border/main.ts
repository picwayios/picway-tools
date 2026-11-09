import { exportCanvas, loadImage, makeCanvas, type Loaded } from '@picway-tools/core/image.ts'; import { captionInk } from '@picway-tools/core/colour.ts';
import { Latest } from '@picway-tools/core/collagestate.ts';
import { borderLayout, type BorderStyle } from '@picway-tools/core/layout.ts';
import { exportWithSnapshot } from '@picway-tools/core/exportsnap.ts';
import { baseName, downloadBlob, dropzone, h, makeT, type Strings } from '@picway-tools/core/ui.ts';

const S: Strings<string> = {
  en: {
    pick: 'Choose a photo',
    hint: 'JPG, PNG, WebP or HEIC.',
    style: 'Style',
    even: 'Even border',
    polaroid: 'Polaroid card',
    square: 'Pad to 1:1 square',
    portrait45: 'Pad to 4:5 portrait',
    width: 'Border width',
    color: 'Color',
    caption: 'Polaroid caption (optional)',
    format: 'Save as',
    download: 'Download',
    size: '{w}×{h} px',
    note: 'The new picture has no camera or location info. Display P3 is kept when the photo has it.',
    fail: 'Couldn’t open {name}. The previous result was cleared; choose another photo.',
  },
  'zh-Hans': {
    pick: '选择一张照片',
    hint: '支持 JPG、PNG、WebP、HEIC。',
    style: '样式',
    even: '四周等宽边框',
    polaroid: '拍立得卡片',
    square: '补成 1:1 正方形',
    portrait45: '补成 4:5 竖图',
    width: '边框宽度',
    color: '颜色',
    caption: '拍立得底部文字（可选）',
    format: '保存为',
    download: '下载',
    size: '{w}×{h} 像素',
    note: '新图片不带相机和位置信息。照片带 Display P3 时会保留。',
    fail: '没能打开 {name}。上一张的结果已清除，请重新选择照片。',
  },
};

export function mount(host: HTMLElement) {
  const t = makeT(S, host);
  let img: Loaded | null = null;
  const latest = new Latest();
  const st = { style: 'even' as BorderStyle, pct: 5, color: '#ffffff', caption: '', format: 'jpeg' as 'jpeg' | 'png' };
  const sel = (opts: [string, string][], on: (v: string) => void) => {
    const s = h('select', { onchange: () => on(s.value) }, ...opts.map(([v, l]) => h('option', { value: v }, l)));
    return s;
  };
  const out = h('canvas', { class: 'tl-canvas' });
  const info = h('p', { class: 'tl-note', role: 'status' });
  const capRow = h('label', { class: 'tl-row', hidden: true }, t('caption'), h('input', { type: 'text', maxLength: 80, oninput: (e: Event) => ((st.caption = (e.target as HTMLInputElement).value), draw()) }));
  const dl = h('button', { class: 'tl-btn', disabled: true, onclick: async () => {
    const cur = img;
    if (!cur) return;
    const snap = { format: st.format, name: `${baseName(cur.name)}-border` };
    const r = build();
    await exportWithSnapshot(snap, (s) => exportCanvas(r.canvas, s.format, 0.95, r.icc), () => img === cur, downloadBlob);
  } }, t('download'));
  function build() {
    const bmp = img!.bmp;
    const l = borderLayout(bmp.width, bmp.height, st.style, st.pct);
    const c = makeCanvas(l.W, l.H, img!.p3);
    c.ctx.fillStyle = st.color;
    c.ctx.fillRect(0, 0, l.W, l.H);
    c.ctx.drawImage(bmp, l.x, l.y);
    if (st.style === 'polaroid' && st.caption) {
      const m = l.x;
      const zone = l.H - (l.y + bmp.height);
      const ink = captionInk(st.color);
      c.ctx.fillStyle = ink;
      c.ctx.textAlign = 'center';
      c.ctx.textBaseline = 'middle';
      c.ctx.font = `${Math.round(zone * 0.35)}px system-ui, -apple-system, sans-serif`;
      c.ctx.fillText(st.caption, l.W / 2, l.y + bmp.height + zone / 2, l.W - 2 * m);
    }
    return { canvas: c.canvas, W: l.W, H: l.H, icc: c.p3 ? img!.icc : null };
  }
  function draw() {
    if (!img) return;
    const r = build();
    out.width = r.W;
    out.height = r.H;
    out.getContext('2d')!.drawImage(r.canvas, 0, 0);
    dl.disabled = false;
    info.textContent = `${t('size', { w: r.W, h: r.H })}. ${t('note')}`;
  }
  const width = h('input', { type: 'range', min: '0', max: '20', step: '0.5', value: '5', oninput: () => ((st.pct = Number(width.value)), draw()) });
  host.replaceChildren(
    dropzone({ label: t('pick'), hint: t('hint'), accept: 'image/*,.heic,.heif', onFiles: async ([f]) => {
      const id = latest.next();
      try {
        const next = await loadImage(f);
        if (!latest.is(id)) return next.bmp.close();
        img?.bmp.close();
        img = next;
        draw();
      } catch {
        if (!latest.is(id)) return;

        img?.bmp.close();
        img = null;
        out.width = out.height = 0;
        dl.disabled = true;
        info.textContent = t('fail', { name: f.name });
      }
    } }),
    h('div', { class: 'tl-opts' },
      h('label', { class: 'tl-row' }, t('style'), sel([['even', t('even')], ['polaroid', t('polaroid')], ['square', t('square')], ['portrait45', t('portrait45')]], (v) => ((st.style = v as BorderStyle), (capRow.hidden = v !== 'polaroid'), draw()))),
      h('label', { class: 'tl-row' }, t('width'), width),
      h('label', { class: 'tl-row' }, t('color'), h('input', { type: 'color', value: '#ffffff', oninput: (e: Event) => ((st.color = (e.target as HTMLInputElement).value), draw()) })),
      capRow,
      h('label', { class: 'tl-row' }, t('format'), sel([['jpeg', 'JPG'], ['png', 'PNG']], (v) => (st.format = v as 'jpeg' | 'png')))),
    out, info, h('div', { class: 'tl-actions' }, dl));
}
