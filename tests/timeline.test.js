// Tests for js/timeline.js, the step model behind the visualiser.
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const BARN = require("../js/barn.js");
const Timeline = require("../js/timeline.js");
const { seeded, seededBits } = require("./helpers.js");

const KEY = [1, 3, 2, 1];
const enc = Timeline.encryption("HELLO", KEY, seededBits(seeded(8), 100)); // 40 bits, 70-bit cipher
const dec = Timeline.decryption(enc.cipher, KEY);

const frame = (run, n) => Timeline.frameAt(run, n);
const shownAt = (run, n) => run.cipher.map((_, i) => Timeline.cellAt(run, frame(run, n), i));

// The stream at step n worked out from scratch, independently of cellAt.
function expected(run, n) {
  const mu = run.bits.length;
  const count = run.mode === "encrypt" ? Math.min(Math.max(n - 1, 0), mu) : Math.min(n, mu);
  const bits = run.mode === "encrypt" ? run.random.slice(0, run.cipher.length) : run.cipher.slice();
  const marked = bits.map(() => false);
  for (let j = 0; j < count; j++) {
    const i = run.positions[j];
    if (run.mode === "encrypt") bits[i] = run.bits[j];
    marked[i] = true;
  }
  return bits.map((bit, i) => ({ bit, marked: marked[i] }));
}
const strip = (cells) => cells.map(({ bit, marked }) => ({ bit, marked }));

describe("steps", () => {
  test("encryption: message, stream, one step per bit, cipher", () => {
    assert.equal(enc.lastStep, 42);
    assert.deepEqual(
      [0, 1, 2, 41, 42].map((n) => frame(enc, n).phase),
      ["message", "stream", "bury", "bury", "cipher"],
    );
  });

  test("decryption: cipher, one step per bit, plaintext", () => {
    assert.equal(dec.lastStep, 41);
    assert.deepEqual(
      [0, 1, 40, 41].map((n) => frame(dec, n).phase),
      ["cipher", "read", "read", "plaintext"],
    );
  });

  test("out-of-range, fractional and missing steps are clamped", () => {
    assert.equal(frame(enc, -5).step, 0);
    assert.equal(frame(enc, 999).step, enc.lastStep);
    assert.equal(frame(enc, 2.6).step, 3);
    assert.equal(frame(enc, NaN).step, 0);
  });

  test("hops use the paper's 1-based positions", () => {
    assert.equal(frame(enc, 1).hop, null);
    assert.deepEqual(frame(enc, 2).hop, { j: 0, k: 0, skip: 1, from: 0, to: 1 });
    assert.deepEqual(frame(enc, 3).hop, { j: 1, k: 1, skip: 3, from: 1, to: 4 });
    assert.deepEqual(frame(dec, 2).hop, frame(enc, 3).hop);
  });

  test("an empty message still has a start and an end", () => {
    const empty = Timeline.encryption("", KEY);
    assert.deepEqual([0, 1, 2].map((n) => frame(empty, n).phase), ["message", "stream", "cipher"]);
  });

  test("scrubber ticks mark the phases and each byte", () => {
    assert.deepEqual(Timeline.ticks(enc).phases.map((p) => p.step), [0, 1, 2, 42]);
    assert.deepEqual(Timeline.ticks(enc).bytes, [10, 18, 26, 34]);
    assert.deepEqual(Timeline.ticks(dec).bytes, [9, 17, 25, 33]);
  });
});

describe("what each step shows", () => {
  test("no bit is marked before the first one is buried", () => {
    for (const n of [0, 1]) assert.ok(shownAt(enc, n).every((c) => !c.marked));
  });

  test("the last encryption step shows exactly the cipher", () => {
    const cells = shownAt(enc, enc.lastStep);
    assert.deepEqual(cells.map((c) => c.bit), enc.cipher);
    assert.deepEqual(
      cells.flatMap((c, i) => (c.marked ? [i] : [])),
      enc.positions,
    );
  });

  test("decryption step n has read exactly n bits, and they are the message", () => {
    for (let n = 0; n <= dec.lastStep; n++) {
      const read = shownAt(dec, n).filter((c) => c.marked).map((c) => c.bit);
      assert.deepEqual(read, enc.bits.slice(0, Math.min(n, 40)));
    }
  });
});

describe("navigation can't corrupt the state (the v1 bug)", () => {
  for (const run of [enc, dec]) {
    test(`every ${run.mode}ion step looks the same however you get there`, () => {
      const rand = seeded(9);
      let n = 0;
      for (let move = 0; move < 2000; move++) {
        const r = rand();
        if (r < 0.45) n++; // next
        else if (r < 0.8) n--; // previous
        else n = Math.floor(rand() * (run.lastStep + 1)); // scrub
        n = Math.max(0, Math.min(run.lastStep, n));
        assert.deepEqual(strip(shownAt(run, n)), expected(run, n), `step ${n}, move ${move}`);
      }
    });
  }

  test("three reads, one Previous, then to the end still gives HELLO", () => {
    let n = 0;
    for (const move of [+1, +1, +1, -1]) n += move;
    while (n < dec.lastStep) n++;
    const { count } = frame(dec, n);
    assert.equal(BARN.decodeBits(dec.bits.slice(0, count), { final: true }).text, "HELLO");
  });
});

describe("narration", () => {
  const say = (run, n) => Timeline.describe(run, frame(run, n));

  test("uses the paper's notation", () => {
    // "H" is 01001000, so M₂ = 1; the second skip is K₂ = 3, from position 1 to 4.
    assert.match(say(enc, 3).text, /M₂ = 1, from “H”\. Skip K₂ = 3 from position 1 to position 4\./);
    assert.match(say(enc, 2).text, /Skip K₁ = 1 from the start to position 1\./);
  });

  test("says whether the random bit had to change", () => {
    for (let n = 2; n < enc.lastStep; n++) {
      const { hop } = frame(enc, n);
      const same = enc.random[hop.to - 1] === enc.bits[hop.j];
      assert.match(say(enc, n).text, same ? /is already \d; it keeps its value/ : /was \d; it now holds \d/);
    }
  });

  test("counts how many stream bits changed", () => {
    const changed = enc.cipher.filter((b, i) => b !== enc.random[i]).length;
    assert.match(say(enc, enc.lastStep).text, new RegExp(`Only ${changed} stream bits actually changed`));
  });

  test("announces each completed byte while reading", () => {
    assert.match(say(dec, 16).text, /Byte 2 is complete: 0x45\. Text so far: “HE”\./);
  });

  test("a matching key gets no warning; the paper's guessed key does", () => {
    assert.match(say(dec, 0).text, /lands exactly on bit 70, and 40 bits make 5 whole bytes/);
    const guessed = Timeline.decryption(BARN.parseBits("100111000000110111"), [2, 1, 2, 1]);
    assert.match(say(guessed, 0).text, /12 bits aren't whole bytes \(4 left over\)/);
  });

  test("names the character each bit comes from, including multi-byte ones", () => {
    const run = Timeline.encryption("é", KEY);
    assert.match(say(run, 2 + 15).text, /M₁₆ = \d, from “é”/);
  });

  test("shows control characters as symbols", () => {
    assert.equal(Timeline.printable("a\tb\n\u0000\u007f"), "a␉b␊␀␡");
    assert.equal(Timeline.glyph(" "), "␣");
  });
});
