import type { TaskGate } from './task.ts';

export interface OpenDeps<F> {

  read(f: F): Promise<Uint8Array>;

  isJpeg(b: Uint8Array): boolean;

  checkJpeg?(b: Uint8Array): void | Promise<void>;

  looksHeif(f: F): Promise<boolean>;

  convert(f: F): Promise<Uint8Array>;

  begin(): void;

  ready(f: F, bytes: Uint8Array): void;

  fail(e: unknown, notPhoto: boolean): void;
}

export async function openPhoto<F>(gate: TaskGate, f: F, d: OpenDeps<F>): Promise<boolean> {
  const task = gate.begin();
  d.begin();
  try {
    let bytes = await d.read(f);
    if (!task.current) return false;
    if (d.isJpeg(bytes)) {
      await d.checkJpeg?.(bytes);
      if (!task.current) return false;
    } else {
      const heif = await d.looksHeif(f);
      if (!task.current) return false;
      if (!heif) {
        d.fail(null, true);
        return true;
      }
      bytes = await d.convert(f);
      if (!task.current) return false;
    }
    d.ready(f, bytes);
    return true;
  } catch (e) {
    if (!task.current) return false;
    d.fail(e, false);
    return true;
  }
}
