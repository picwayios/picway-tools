export interface Ticket {
  readonly gen: number;

  readonly n: number;
}

export interface Failure<F> {
  file: F;
  name: string;
}

export class Intake<T, F = unknown> {
  items: T[] = [];
  failures: Failure<F>[] = [];
  pending = 0;
  private gen = 0;

  reserve(cap: number, want: number): Ticket {
    const room = Math.max(0, cap - this.items.length - this.pending);
    const n = Math.min(room, want);
    this.pending += n;
    return { gen: this.gen, n };
  }

  settle(t: Ticket, item: T | null, fail?: Failure<F>): boolean {
    if (t.gen !== this.gen) return false;
    this.pending = Math.max(0, this.pending - 1);
    if (item) this.items.push(item);
    else if (fail) this.failures.push(fail);
    return true;
  }

  release(t: Ticket, k: number) {
    if (t.gen === this.gen) this.pending = Math.max(0, this.pending - k);
  }
  alive(t: Ticket) {
    return t.gen === this.gen;
  }

  clear(): T[] {
    this.gen++;
    this.pending = 0;
    this.failures = [];
    const old = this.items;
    this.items = [];
    return old;
  }
  dismissFailure(f: Failure<F>) {
    this.failures = this.failures.filter((x) => x !== f);
  }
}

export class Latest {
  private n = 0;

  next(): number {
    return ++this.n;
  }
  is(id: number): boolean {
    return id === this.n;
  }

  invalidate() {
    this.n++;
  }
}
