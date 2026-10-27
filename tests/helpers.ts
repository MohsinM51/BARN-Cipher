// Shared test helpers. Not a test file itself (node --test only picks up *.test.ts).
import type { Bit } from "../src/lib/barn.ts";

export const bits = (s: string): Bit[] => Array.from(s.replace(/\s+/g, ""), (c) => (c === "1" ? 1 : 0));
export const str = (b: readonly number[]) => b.join("");

// Seeded PRNG (mulberry32) so the "random" cases are reproducible.
export function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const seededBits = (rand: () => number, n: number): Bit[] =>
  Array.from({ length: n }, () => (rand() < 0.5 ? 0 : 1));

// A valid key (1–8 elements of 1–15, not all ones).
export function seededKey(rand: () => number): number[] {
  const key = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => 1 + Math.floor(rand() * 15));
  return key.every((k) => k === 1) ? [...key, 2] : key;
}
