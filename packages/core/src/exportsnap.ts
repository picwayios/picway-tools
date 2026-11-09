export interface ExportSnap {
  format: 'jpeg' | 'png';
  name: string;
}
export const extOf = (format: 'jpeg' | 'png') => (format === 'png' ? 'png' : 'jpg');

export async function exportWithSnapshot(snap: ExportSnap, encode: (s: ExportSnap) => Promise<Blob>, stillCurrent: () => boolean, deliver: (b: Blob, filename: string) => void): Promise<boolean> {
  const blob = await encode(snap);
  if (!stillCurrent()) return false;
  deliver(blob, `${snap.name}.${extOf(snap.format)}`);
  return true;
}
