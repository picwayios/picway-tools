import type { Strings } from '../lib/ui.ts';

export type Key = 'zipFail' | 'zipTooBig' | 'zipLink';

export const S: Strings<Key> = {
  en: {
    zipFail: 'Couldn’t make the ZIP. Download the files one by one.',
    zipTooBig: 'These files add up to {size}, too much to pack into one ZIP on this device (limit {limit}). Download them one by one.',
    zipLink: 'Download {name}',
  },
  'zh-Hans': {
    zipFail: '没能打包成 ZIP，请逐个下载。',
    zipTooBig: '这些文件加起来有 {size}，这台设备打不了这么大的 ZIP（上限 {limit}）。请逐个下载。',
    zipLink: '下载 {name}',
  },
  'zh-Hant': {
    zipFail: '沒能打包成 ZIP，請逐個下載。',
    zipTooBig: '這些檔案加起來有 {size}，這台裝置打不了這麼大的 ZIP（上限 {limit}）。請逐個下載。',
    zipLink: '下載 {name}',
  },
  ja: {
    zipFail: 'ZIP にまとめられませんでした。1 つずつダウンロードしてください。',
    zipTooBig: 'ファイルの合計は {size} で、この端末では 1 つの ZIP にまとめられません（上限 {limit}）。1 つずつダウンロードしてください。',
    zipLink: '{name} をダウンロード',
  },
};
