export interface Ticket {
  signal: AbortSignal;
  current(): boolean;
}
export function makeLatest() {
  let seq = 0;
  let ctl: AbortController | null = null;
  return {
    begin(): Ticket {
      ctl?.abort();
      ctl = new AbortController();
      const mine = ++seq;
      return { signal: ctl.signal, current: () => mine === seq };
    },
  };
}
