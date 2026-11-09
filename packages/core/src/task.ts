export interface Task {
  readonly id: number;
  readonly signal: AbortSignal;

  readonly current: boolean;
}

export class TaskGate {
  private seq = 0;
  private ctl: AbortController | null = null;

  get version() {
    return this.seq;
  }
  begin(): Task {
    this.ctl?.abort();
    const ctl = new AbortController();
    this.ctl = ctl;
    const id = ++this.seq;
    const gate = this;
    return {
      id,
      signal: ctl.signal,
      get current() {
        return !ctl.signal.aborted && gate.seq === id;
      },
    };
  }

  invalidate() {
    this.ctl?.abort();
    this.ctl = null;
    this.seq++;
  }

  cancel() {
    this.ctl?.abort();
  }
}

export class UrlBag {
  private urls = new Set<string>();
  own(url: string) {
    this.urls.add(url);
    return url;
  }
  revoke(url: string | undefined) {
    if (url && this.urls.delete(url)) URL.revokeObjectURL(url);
  }
  revokeAll() {
    for (const u of this.urls) URL.revokeObjectURL(u);
    this.urls.clear();
  }
  get size() {
    return this.urls.size;
  }
}
