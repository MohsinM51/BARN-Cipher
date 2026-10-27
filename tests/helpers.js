// Shared test helpers. Not a test file itself (node --test only picks up *.test.js).

const bits = (s) => Array.from(s.replace(/\s+/g, ""), Number);
const str = (b) => b.join("");

// Seeded PRNG (mulberry32) so the "random" cases are reproducible.
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const seededBits = (rand, n) => Array.from({ length: n }, () => (rand() < 0.5 ? 0 : 1));

// A valid key (1–8 elements of 1–15, not all ones).
function seededKey(rand) {
  const key = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => 1 + Math.floor(rand() * 15));
  return key.every((k) => k === 1) ? [...key, 2] : key;
}

module.exports = { bits, str, seeded, seededBits, seededKey };
