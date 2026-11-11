import type { Strings } from './ui.ts';

export type ErrCode = 'raw' | 'not-image' | 'damaged' | 'unreadable' | 'unknown' | 'too-big' | 'memory';
export const ERR_CODES: ErrCode[] = ['raw', 'not-image', 'damaged', 'unreadable', 'unknown', 'too-big', 'memory'];

export const coded = (code: ErrCode, message: string) => Object.assign(new Error(message), { code });

export function errCode(e: unknown): ErrCode {
  const c = (e as { code?: unknown } | null)?.code;
  return typeof c === 'string' && (ERR_CODES as string[]).includes(c) ? (c as ErrCode) : 'unknown';
}

export const REASONS: Strings<ErrCode> = {
  en: {
    raw: 'camera RAW files aren’t supported.',
    'not-image': 'it isn’t an image this page can read. The file may be empty, or its extension may not match what’s inside.',
    damaged: 'the file looks damaged or cut off.',
    unreadable: 'this kind of image can’t be read here.',
    unknown: 'the browser ran into an error while processing it. Try again, or try another browser.',
    'too-big': 'this picture is too large for this device to open. Open it on a computer instead.',
    memory: 'the browser ran out of memory. Try a smaller picture, or open it on a computer.',
  },
  'zh-Hans': {
    raw: '不支持相机 RAW 文件。',
    'not-image': '这不是本页能读取的图片。文件可能是空的，或者扩展名和内容对不上。',
    damaged: '文件好像损坏了，或者不完整。',
    unreadable: '这种图片在这里读不了。',
    unknown: '浏览器处理时出错了。请再试一次，或者换个浏览器。',
    'too-big': '这张图片太大，这台设备打不开。请在电脑上打开。',
    memory: '浏览器内存不够了。请换小一点的图片，或者在电脑上打开。',
  },
  'zh-Hant': {
    raw: '不支援相機 RAW 檔。',
    'not-image': '這不是這個頁面能讀取的圖片。檔案可能是空的，或者副檔名和內容對不上。',
    damaged: '檔案好像損壞了，或者不完整。',
    unreadable: '這種圖片在這裡讀不了。',
    unknown: '瀏覽器處理時出錯了。請再試一次，或者換個瀏覽器。',
    'too-big': '這張圖片太大，這台裝置打不開。請在電腦上開啟。',
    memory: '瀏覽器記憶體不夠了。請換小一點的圖片，或者在電腦上開啟。',
  },
  ja: {
    raw: 'カメラの RAW ファイルには対応していません。',
    'not-image': 'このページで読み込める画像ではありません。ファイルが空か、拡張子と中身が合っていない可能性があります。',
    damaged: 'ファイルが壊れているか、途中で切れているようです。',
    unreadable: 'この種類の画像はここでは読み込めません。',
    unknown: 'ブラウザーでの処理中にエラーが起きました。もう一度試すか、別のブラウザーをお試しください。',
    'too-big': 'この画像は大きすぎて、この端末では開けません。パソコンで開いてください。',
    memory: 'ブラウザーのメモリが足りなくなりました。小さい画像にするか、パソコンで開いてください。',
  },
};
