// Tests for src/lib/drawing.ts: where Fig. 3's dimension lines and cells go.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { positions } from "../src/lib/barn.ts";
import { cellCentre, cellLeft, columnsFor, dimensions, type Grid, type Span } from "../src/lib/drawing.ts";

const KEY = [1, 3, 2, 1];
const plan = positions(10, KEY); // the paper's Fig. 3: 1, 4, 6, 7, 8, 11, 13, 14, 15, 18 (1-based)
const pick = (d: Span[]) => d.map(({ row, from, to, skip, end }) => [row, from, to, skip, end]);

describe("dimension lines", () => {
  test("on one wide row they chain from bit to bit, each labelled with its skip", () => {
    assert.deepEqual(pick(dimensions(plan, KEY, 4, 32)), [
      [0, null, 0, 1, true], // from the start of the stream to bit 1
      [0, 0, 3, 3, true],
      [0, 3, 5, 2, true],
      [0, 5, 6, 1, true],
    ]);
  });

  test("a skip that crosses a row break is drawn in two pieces", () => {
    // Rows of 8: bit 8 (column 7) to bit 11 crosses from row 0 into row 1.
    const d = dimensions(plan, KEY, 6, 8);
    assert.deepEqual(pick(d).slice(4), [
      [0, 6, 7, 1, true],
      [0, 7, null, 3, false], // leaves row 0 past its right edge…
      [1, null, 2, 3, true], // …and comes in at row 1's left edge
    ]);
  });

  test("a skip longer than a row passes through whole rows", () => {
    assert.deepEqual(pick(dimensions(positions(1, [20]), [20], 1, 8)), [
      [0, null, null, 20, false],
      [1, null, null, 20, false],
      [2, null, 3, 20, true],
    ]);
  });

  test("every bit gets one dimension, and its pieces add up to its skip", () => {
    const cols = 8;
    const d = dimensions(plan, KEY, plan.length, cols);
    const ends = d.filter((s) => s.end);
    assert.deepEqual(
      ends.map((s) => s.j),
      plan.map((_, j) => j),
    );
    // Counting cells: a row's left edge sits just before column 0, its right edge on the last column.
    for (const end of ends) {
      const cells = d.filter((s) => s.j === end.j).reduce((sum, s) => sum + (s.to ?? cols - 1) - (s.from ?? -1), 0);
      assert.equal(cells, end.skip);
    }
  });

  test("nothing is drawn before the first bit", () => {
    assert.deepEqual(dimensions(plan, KEY, 0, 32), []);
  });
});

describe("cell geometry", () => {
  const grid: Grid = { size: 30, gap: 4, byteGap: 10 };

  test("cells are evenly spaced with a wider gap between bytes", () => {
    assert.equal(cellLeft(0, grid), 0);
    assert.equal(cellLeft(7, grid), 7 * 34);
    assert.equal(cellLeft(8, grid), 8 * 34 + 10);
    assert.equal(cellCentre(8, grid), 8 * 34 + 10 + 15);
  });

  test("rows hold whole bytes that fit the width", () => {
    const byte = 8 * 30 + 7 * 4; // 268
    assert.equal(columnsFor(byte, grid), 8);
    assert.equal(columnsFor(2 * byte + 4 + 10 - 1, grid), 8);
    assert.equal(columnsFor(2 * byte + 4 + 10, grid), 16);
    assert.equal(columnsFor(10, grid), 8); // always at least one byte
  });
});
