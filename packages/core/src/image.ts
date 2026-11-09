import { convertHeic, looksHeif } from './heic.ts';
import { getIcc, setIcc } from './jpeg.ts'; import { webpGetMeta } from './imgmeta.ts';

export interface Loaded {
  name: string;
  bmp: ImageBitmap;

  icc: Uint8Array | null;
  p3: boolean;
}
const isP3 = (icc: Uint8Array | null) => !!icc && Array.from(icc.subarray(0, 1200), (c) => (c ? String.fromCharCode(c) : '')).join('').includes('Display P3');

export async function loadImage(f: File): Promise<Loaded> {
  const head = new Uint8Array(await f.slice(0, 64 * 1024).arrayBuffer());
  const jpeg = head[0] === 0xff && head[1] === 0xd8;
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47; const webp = head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46 && head[8] === 0x57 && head[9] === 0x45 && head[10] === 0x42 && head[11] === 0x50;
  let icc: Uint8Array | null = null;

  if (jpeg || png || webp) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      icc = jpeg ? getIcc(bytes) : webp ? webpGetMeta(bytes).icc : await (await import('./png.ts')).pngGetIcc(bytes);
    } catch {

    }
  }
  try {
    return { name: f.name, bmp: await createImageBitmap(f), icc, p3: isP3(icc) };
  } catch (e) {
    if (!(await looksHeif(f))) throw e;

    const r = await convertHeic(f, { format: 'png', quality: 1, removeLocation: true, removeAllExif: true });
    const icc2 = await (await import('./png.ts')).pngGetIcc(new Uint8Array(await r.blob.arrayBuffer()));
    return { name: f.name, bmp: await createImageBitmap(r.blob), icc: icc2, p3: isP3(icc2) };
  }
}

export function makeCanvas(w: number, h: number, wantP3: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', wantP3 ? { colorSpace: 'display-p3' } : undefined)!;
  const p3 = wantP3 && (ctx.getContextAttributes?.().colorSpace ?? 'srgb') === 'display-p3';
  return { canvas, ctx, p3 };
}

export async function exportCanvas(canvas: HTMLCanvasElement, format: 'jpeg' | 'png', quality: number, icc: Uint8Array | null): Promise<Blob> {
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('encode failed'))), type, quality));
  if (!icc) return blob;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (format === 'jpeg') return new Blob([setIcc(bytes, icc) as BlobPart], { type });
  const { pngSetIcc } = await import('./png.ts');
  return new Blob([(await pngSetIcc(bytes, icc, 'Display P3')) as BlobPart], { type });
}
