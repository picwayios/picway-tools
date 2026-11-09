export class BlobSink {

  private segs: { pos: number; blob: Blob }[] = [];
  private end = 0;

  get size() {
    return this.end;
  }

  write(data: Uint8Array, pos: number) {
    if (!data.byteLength) return;
    const piece = new Blob([data.slice()]);
    const stop = pos + data.byteLength;
    if (pos > this.end) this.segs.push({ pos: this.end, blob: new Blob([new Uint8Array(pos - this.end)]) });
    if (pos >= this.end) {
      this.segs.push({ pos, blob: piece });
      this.end = stop;
      return;
    }

    const kept: { pos: number; blob: Blob }[] = [];
    for (const s of this.segs) {
      const sEnd = s.pos + s.blob.size;
      if (sEnd <= pos || s.pos >= stop) kept.push(s);
      else {
        if (s.pos < pos) kept.push({ pos: s.pos, blob: s.blob.slice(0, pos - s.pos) });
        if (sEnd > stop) kept.push({ pos: stop, blob: s.blob.slice(stop - s.pos) });
      }
    }
    kept.push({ pos, blob: piece });
    kept.sort((a, b) => a.pos - b.pos);
    this.segs = kept;
    this.end = Math.max(this.end, stop);
  }

  toBlob(type: string) {
    return new Blob(this.segs.map((s) => s.blob), { type });
  }
}
