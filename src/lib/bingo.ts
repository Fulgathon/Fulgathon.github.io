// Bingo card geometry, shared by the site, the demo backend and /mod (same rules as
// private.bingo_lines() in migration 20261215100000): the card is n×n with n = 3, 4 or 5
// (9, 16 or 25 events, row by row); a line is a row, a column or one of the two diagonals.
// Line order: rows 0..n-1, columns n..2n-1, then ↘ (2n) and ↗ (2n+1).

export const BINGO_SIZES = [3, 4, 5] as const;

/** The card's side for this many events, or null when the count isn't 9, 16 or 25. */
export function bingoSide(count: number): number | null {
  return count === 9 ? 3 : count === 16 ? 4 : count === 25 ? 5 : null;
}

export interface BingoLineDef { ids: number[]; arrow: string; name: string }

/** Every line of the card (empty unless the card is 3×3, 4×4 or 5×5). */
export function bingoLineDefs(ids: number[]): BingoLineDef[] {
  const n = bingoSide(ids.length);
  if (!n) return [];
  const r = Array.from({ length: n }, (_, i) => i);
  return [
    ...r.map((k) => ({ ids: ids.slice(k * n, k * n + n), arrow: '→', name: `rândul ${k + 1}` })),
    ...r.map((c) => ({ ids: r.map((j) => ids[c + n * j]), arrow: '↓', name: `coloana ${c + 1}` })),
    { ids: r.map((j) => ids[(n + 1) * j]), arrow: '↘', name: 'diagonala de sus-stânga' },
    { ids: r.map((j) => ids[n * (n - 1) - (n - 1) * j]), arrow: '↗', name: 'diagonala de jos-stânga' },
  ];
}

/** The same lines as sorted id lists (what the database stores for a pick). */
export function bingoLines(ids: number[]): number[][] {
  return bingoLineDefs(ids).map((l) => [...l.ids].sort((a, b) => a - b));
}
