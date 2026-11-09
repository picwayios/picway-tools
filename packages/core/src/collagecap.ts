export const CAP = { strip: 30, grid: 20 } as const;
export const capOf = (mode: string): number => (mode === 'strip' ? CAP.strip : CAP.grid);

export const usedItems = <T>(items: readonly T[], mode: string): T[] => items.slice(0, capOf(mode));

export const overCap = (n: number, mode: string): number => (n > capOf(mode) ? capOf(mode) : 0);
