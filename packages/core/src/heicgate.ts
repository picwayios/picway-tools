import { sniffKind, structureError } from './sniff.ts';

export type JpgPngVerdict = 'already' | 'damaged' | 'pass';

export async function judgeJpgPng(head: Uint8Array, readAll: () => Promise<Uint8Array>): Promise<JpgPngVerdict> {
  const kind = sniffKind(head);
  if (kind !== 'jpeg' && kind !== 'png') return 'pass';
  return structureError(await readAll(), kind) ? 'damaged' : 'already';
}
