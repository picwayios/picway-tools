import { fmtBytes, h } from './ui.ts';

const prev = new WeakMap<Element, string>();

export function offerDownload(o: { slot: HTMLElement; blob: Blob; name: string; label: string; auto?: boolean; valid?: () => boolean; size?: boolean }): HTMLAnchorElement {
  const old = prev.get(o.slot);
  if (old) URL.revokeObjectURL(old);
  const url = URL.createObjectURL(o.blob);
  prev.set(o.slot, url);
  const a = h('a', { class: 'tl-btn', href: url, download: o.name }, o.label);
  if (o.valid) a.addEventListener('click', (e) => {
    if (o.valid!()) return;
    e.preventDefault();
    clearOffer(o.slot);
  });
  o.slot.replaceChildren(a, ...(o.size === false ? [] : [h('small', {}, ` ${fmtBytes(o.blob.size)}`)]));
  if (o.auto) a.click();
  return a;
}

export function clearOffer(slot: HTMLElement) {
  const old = prev.get(slot);
  if (old) URL.revokeObjectURL(old);
  prev.delete(slot);
  slot.replaceChildren();
}
