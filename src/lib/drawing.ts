// Geometry for Fig. 3 drawn as a blueprint: where the cells sit in a row, and
// the dimension line that marks each skip.
import type { Key } from "./barn.ts";

// One piece of a dimension line, within one row. A skip runs from the previous
// bit's cell (or the start of the stream) to its own bit's cell; when that
// crosses a row break it is drawn in pieces, and only the last piece, the one
// that reaches the bit, carries the arrowhead and the value.
export interface Span {
  j: number; // which message bit the skip led to
  row: number;
  from: number | null; // column it starts from; null: it comes in from the row's left edge
  to: number | null; // column it ends at; null: it carries on past the row's right edge
  skip: number;
  end: boolean;
}

// The dimensions for the first `count` bits, laid out in rows of `cols` cells.
export function dimensions(positions: readonly number[], key: Key, count: number, cols: number): Span[] {
  const out: Span[] = [];
  for (let j = 0; j < count; j++) {
    const start = j === 0 ? -1 : positions[j - 1]; // -1: before the stream
    const at = positions[j];
    const skip = key[j % key.length];
    const last = Math.floor(at / cols);
    let row = start < 0 ? 0 : Math.floor(start / cols);
    let from: number | null = start < 0 ? null : start % cols;
    for (; row < last; row++, from = null) out.push({ j, row, from, to: null, skip, end: false });
    out.push({ j, row, from, to: at % cols, skip, end: true });
  }
  return out;
}

export interface Grid {
  size: number; // cell width and height
  gap: number; // between cells
  byteGap: number; // extra space between groups of eight
}

export const cellLeft = (col: number, { size, gap, byteGap }: Grid) => col * (size + gap) + Math.floor(col / 8) * byteGap;
export const cellCentre = (col: number, grid: Grid) => cellLeft(col, grid) + grid.size / 2;

// How many cells fit in a row of `width` px, in whole bytes (at least one).
export function columnsFor(width: number, { size, gap, byteGap }: Grid): number {
  const byteWidth = 8 * size + 7 * gap;
  return 8 * Math.max(1, Math.floor((width + gap + byteGap) / (byteWidth + gap + byteGap)));
}
