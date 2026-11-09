export function reorderDepth(cts: ArrayLike<number>, cap = 32): number {
  let depth = 0;
  for (let i = 1; i < cts.length; i++) {
    let n = 0;
    for (let j = Math.max(0, i - cap); j < i; j++) if (cts[j] > cts[i]) n++;
    if (n > depth) depth = n;
  }
  return depth;
}

export function makeReorder<T extends { timestamp: number }>(emit: (item: T) => void, depth = 0) {
  const held: T[] = [];
  let d = depth;
  return {
    get depth() { return d; },
    set depth(v: number) { d = Math.max(d, v); },
    push(item: T) {
      let i = held.length;
      while (i > 0 && held[i - 1].timestamp > item.timestamp) i--;
      held.splice(i, 0, item);
      while (held.length > d) emit(held.shift() as T);
    },
    flush() {
      while (held.length) emit(held.shift() as T);
    },

    drop(): T[] {
      return held.splice(0, held.length);
    },
  };
}
