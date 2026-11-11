import { S } from './zipstrings.ts';
import { buildZip } from './zip.ts';
import { isIOS } from './platform.ts';
import { fmtBytes, h, makeT } from './ui.ts';
import { clearOffer, offerDownload } from './offer.ts';

export async function zipAndDownload(o: { outs: { name: string; blob: Blob }[]; zipName: string; msg: HTMLElement; host?: HTMLElement; alive?: () => boolean }): Promise<boolean> {
  const t = makeT(S, o.host);
  const r = await buildZip(o.outs, { ios: isIOS(), alive: o.alive });
  if (r.ok) {

    o.msg.replaceChildren(h('span', { 'data-zip-offer': '' }));
    offerDownload({ slot: o.msg.firstElementChild as HTMLElement, blob: r.blob, name: o.zipName, label: t('zipLink', { name: o.zipName }), auto: true, valid: o.alive });
    return true;
  }
  if (o.alive && !o.alive()) return false;
  if (r.why === 'tooBig') o.msg.textContent = t('zipTooBig', { size: fmtBytes(r.total), limit: fmtBytes(r.limit) });
  else if (r.why === 'fail') o.msg.textContent = t('zipFail');
  return false;
}

export function clearZipOffer(msg: HTMLElement) {
  const s = msg.querySelector<HTMLElement>('[data-zip-offer]');
  if (s) clearOffer(s), s.remove();
}
