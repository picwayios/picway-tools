export interface Item {

  gen: number;
}
export interface Hooks<I extends Item, O, R> {
  snapshot(): O;
  run(item: I, opts: O): Promise<R>;

  start(item: I): void;
  done(item: I, result: R, opts: O): void;
  fail(item: I, error: unknown, opts: O): void;
}

export class Reprocessor<I extends Item, O, R> {
  gen = 0;
  items: I[] = [];
  private running = false;
  private hooks: Hooks<I, O, R>;
  constructor(hooks: Hooks<I, O, R>) {
    this.hooks = hooks;
  }

  add(item: I) {
    item.gen = -1;
    this.items.push(item);
    return this.pump();
  }

  invalidate() {
    this.gen++;
    for (const it of this.items) {
      it.gen = -1;
      this.hooks.start(it);
    }
    return this.pump();
  }
  clear() {
    this.gen++;
    this.items = [];
  }

  get idle() {
    return this.items.every((i) => i.gen === this.gen);
  }

  get settled() {
    return this.items.filter((i) => i.gen === this.gen).length;
  }
  async pump() {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const item = this.items.find((i) => i.gen !== this.gen);
        if (!item) break;
        const g = this.gen;
        const opts = this.hooks.snapshot();
        this.hooks.start(item);
        try {
          const r = await this.hooks.run(item, opts);
          if (g !== this.gen || !this.items.includes(item)) continue;
          item.gen = g;
          this.hooks.done(item, r, opts);
        } catch (e) {
          if (g !== this.gen || !this.items.includes(item)) continue;
          item.gen = g;
          this.hooks.fail(item, e, opts);
        }
      }
    } finally {
      this.running = false;
    }
  }
}
