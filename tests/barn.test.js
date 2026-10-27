// Tests for js/barn.js. Run with `npm test` (or `node --test`).
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");
const BARN = require("../js/barn.js");

const bits = (s) => Array.from(s.replace(/\s+/g, ""), Number);
const str = (b) => b.join("");
const ones = (b) => b.filter(Boolean).length;

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
const seededKey = (rand) => {
  const key = Array.from({ length: 1 + Math.floor(rand() * 8) }, () => 1 + Math.floor(rand() * 15));
  return key.every((k) => k === 1) ? [...key, 2] : key;
};

// The paper's worked example, Sec. 2.
const FIG1_STREAM = bits("000110100000101110100"); // Fig. 1 (first 21 bits)
const FIG2_MESSAGE = bits("1110001101"); //            Fig. 2
const FIG3_CIPHER = bits("100111000000110111"); //     Fig. 3
const PAPER_KEY = [1, 3, 2, 1];

describe("the paper's worked example", () => {
  test("bits land at positions 1, 4, 6, 7, 8, 11, 13, 14, 15, 18 (Fig. 3)", () => {
    const oneBased = BARN.positions(10, PAPER_KEY).map((i) => i + 1);
    assert.deepEqual(oneBased, [1, 4, 6, 7, 8, 11, 13, 14, 15, 18]);
  });

  test("the cipher is 18 bits long", () => {
    assert.equal(BARN.streamLength(10, PAPER_KEY), 18);
  });

  test("burying Fig. 2 in Fig. 1 gives Fig. 3", () => {
    assert.equal(str(BARN.bury(FIG2_MESSAGE, PAPER_KEY, FIG1_STREAM)), str(FIG3_CIPHER));
  });

  test("the count of ones goes from 7 to 9, as the paper says", () => {
    assert.equal(ones(FIG1_STREAM.slice(0, 18)), 7);
    assert.equal(ones(FIG3_CIPHER), 9);
  });

  test("the right key reads Fig. 2 back out", () => {
    const out = BARN.decrypt(FIG3_CIPHER, PAPER_KEY);
    assert.equal(str(out.bits), str(FIG2_MESSAGE));
    assert.equal(out.exactFit, true);
  });

  test("the guessed key {2,1,2,1} reads 001100001011 (Fig. 4)", () => {
    const out = BARN.decrypt(FIG3_CIPHER, [2, 1, 2, 1]);
    assert.equal(str(out.bits), "001100001011");
    // It also ends exactly on the last bit, so a clean fit doesn't prove the key…
    assert.equal(out.exactFit, true);
    // …but 12 bits don't make whole bytes.
    assert.equal(out.leftoverBits, 4);
  });
});

describe("Eq. (1) and Algorithm 1", () => {
  test("give the same positions for random keys", () => {
    const rand = seeded(1);
    for (let trial = 0; trial < 200; trial++) {
      const key = seededKey(rand);
      const plan = BARN.positions(64, key);
      for (let j = 1; j <= 64; j++) assert.equal(BARN.positionOf(j, key), plan[j - 1] + 1);
    }
  });

  test("messageLength undoes streamLength", () => {
    const rand = seeded(2);
    for (let trial = 0; trial < 200; trial++) {
      const key = seededKey(rand);
      const count = Math.floor(rand() * 100);
      const length = BARN.streamLength(count, key);
      assert.equal(BARN.messageLength(length, key), count);
      if (count > 0) assert.equal(BARN.messageLength(length - 1, key), count - 1);
    }
  });
});

describe("parseKey", () => {
  test("reads commas, spaces, semicolons and the paper's braces", () => {
    for (const input of ["1,3,2,1", "1 3 2 1", "{1, 3, 2, 1}", " 1 ,3, 2,1 ", "[1;3;2;1]", "1,,3,2,1,", "01,3,2,1"]) {
      assert.deepEqual(BARN.parseKey(input), [1, 3, 2, 1], input);
    }
  });

  test("accepts a single element above 1 and the largest skip", () => {
    assert.deepEqual(BARN.parseKey("2"), [2]);
    assert.deepEqual(BARN.parseKey(String(BARN.MAX_SKIP)), [BARN.MAX_SKIP]);
  });

  const rejected = [
    ["", /Enter a key/],
    [" , ", /Enter a key/],
    ["0,2", /can't be 0/],
    ["1", /only 1s/],
    ["1,1,1", /only 1s/],
    ["-1,2", /whole number/],
    ["1.5,2", /whole number/],
    ["1e2", /whole number/],
    ["0x2", /whole number/],
    ["two,3", /whole number/],
    [String(BARN.MAX_SKIP + 1), /go up to/],
  ];
  for (const [input, message] of rejected) {
    test(`rejects ${JSON.stringify(input)}`, () => assert.throws(() => BARN.parseKey(input), message));
  }
});

describe("parseBits", () => {
  test("ignores spaces and line breaks", () => {
    assert.equal(str(BARN.parseBits(" 10 01\n1\t0 ")), "100110");
  });

  test("rejects anything other than 0 and 1", () => {
    assert.throws(() => BARN.parseBits(""), /Paste the cipher/);
    assert.throws(() => BARN.parseBits("0102"), /“2”/);
    assert.throws(() => BARN.parseBits("01🙂"), /“🙂”/);
  });
});

describe("text encoding", () => {
  test("is UTF-8 with the most significant bit first", () => {
    assert.equal(str(BARN.encodeText("A").bits), "01000001");
    assert.deepEqual(BARN.encodeText("é").bytes, [0xc3, 0xa9]);
    assert.deepEqual(BARN.encodeText("🙂").bytes, [0xf0, 0x9f, 0x99, 0x82]);
  });

  test("records which bytes belong to which character", () => {
    const { chars } = BARN.encodeText("aé日🙂");
    assert.deepEqual(
      chars.map(({ char, bytes }) => [char, bytes.length]),
      [["a", 1], ["é", 2], ["日", 3], ["🙂", 4]],
    );
  });

  test("bitsToBytes drops a trailing partial byte", () => {
    assert.deepEqual(BARN.bitsToBytes(bits("01000001 0110")), [0x41]);
  });

  test("a character is held back until all its bytes have arrived", () => {
    const all = BARN.encodeText("a日").bits; // 1 byte + 3 bytes
    const partial = (n) => {
      const { text, pendingBytes } = BARN.decodeBits(all.slice(0, n));
      return { text, pendingBytes };
    };
    assert.deepEqual(partial(16), { text: "a", pendingBytes: 1 });
    assert.deepEqual(partial(24), { text: "a", pendingBytes: 2 });
    assert.deepEqual(partial(32), { text: "a日", pendingBytes: 0 });
  });

  test("a final decode shows a cut-off character as U+FFFD", () => {
    const cut = BARN.encodeText("日").bits.slice(0, 16);
    assert.equal(BARN.decodeBits(cut, { final: true }).text, "�");
  });
});

describe("encrypt then decrypt", () => {
  const samples = [
    "HELLO",
    "a",
    " ",
    "Bury Among Random Numbers",
    "naïve café",
    "日本語",
    "🙂🔐",
    "é", // e + combining acute accent
    "tab\tand\nnewline",
    "﻿starts with a byte-order mark",
    "\u0000",
    "x".repeat(2000),
  ];
  for (const text of samples) {
    const label = text.length > 30 ? `${text.slice(0, 20)}… (${text.length} chars)` : text;
    test(`round-trips ${JSON.stringify(label)}`, () => {
      const { cipher } = BARN.encrypt(text, PAPER_KEY);
      const out = BARN.decrypt(cipher, PAPER_KEY);
      assert.equal(out.text, text);
      assert.equal(out.exactFit, true);
      assert.equal(out.leftoverBits, 0);
    });
  }

  test("round-trips random text under random keys", () => {
    const rand = seeded(3);
    const pool = [0x41, 0x7a, 0x20, 0x0a, 0xe9, 0x3a9, 0x5d0, 0x4e2d, 0xac00, 0x1f600, 0x1f512, 0x301];
    for (let trial = 0; trial < 300; trial++) {
      const length = 1 + Math.floor(rand() * 24);
      const text = String.fromCodePoint(...Array.from({ length }, () => pool[Math.floor(rand() * pool.length)]));
      const key = seededKey(rand);
      assert.equal(BARN.decrypt(BARN.encrypt(text, key).cipher, key).text, text);
    }
  });

  test("an empty message gives an empty cipher", () => {
    const { cipher } = BARN.encrypt("", [1, 2]);
    assert.deepEqual(cipher, []);
    assert.equal(BARN.decrypt(cipher, [1, 2]).text, "");
  });

  test("a lone surrogate can't be UTF-8 encoded and comes back as U+FFFD", () => {
    const { cipher } = BARN.encrypt("\uD800", PAPER_KEY);
    assert.equal(BARN.decrypt(cipher, PAPER_KEY).text, "�");
  });

  test("only the planned positions change; every other bit is the random stream", () => {
    const random = seededBits(seeded(4), 200);
    const run = BARN.encrypt("Hi", PAPER_KEY, random);
    const planned = new Set(run.positions);
    run.cipher.forEach((bit, i) => {
      if (!planned.has(i)) assert.equal(bit, random[i], `bit ${i + 1}`);
    });
    assert.equal(run.cipher.length, BARN.streamLength(16, PAPER_KEY));
  });

  test("bury refuses a random stream that is too short", () => {
    assert.throws(() => BARN.bury([1, 0, 1], [2, 2], [0, 1, 0]), RangeError);
  });
});

describe("decrypting the wrong thing", () => {
  const { cipher } = BARN.encrypt("HELLO", PAPER_KEY, seededBits(seeded(5), 100));

  test("μ is worked out from the cipher's length", () => {
    assert.equal(cipher.length, 70);
    assert.equal(BARN.decrypt(cipher, PAPER_KEY).bits.length, 40);
  });

  test("a wrong key gives different text", () => {
    assert.notEqual(BARN.decrypt(cipher, [2, 1, 3]).text, "HELLO");
  });

  test("cutting bits off the end loses message bits", () => {
    // The 40th skip is 1, so bit 39 now sits on the last position: still an exact fit…
    const oneShort = BARN.decrypt(cipher.slice(0, -1), PAPER_KEY);
    assert.equal(oneShort.bits.length, 39);
    assert.equal(oneShort.exactFit, true);
    assert.equal(oneShort.leftoverBits, 7); // …but no longer whole bytes.

    const twoShort = BARN.decrypt(cipher.slice(0, -2), PAPER_KEY);
    assert.equal(twoShort.bits.length, 38);
    assert.equal(twoShort.exactFit, false);
  });

  test("an extra bit is read as a 41st message bit and left over", () => {
    const out = BARN.decrypt([...cipher, 0], PAPER_KEY);
    assert.equal(out.text, "HELLO");
    assert.equal(out.bits.length, 41);
    assert.equal(out.leftoverBits, 1);
  });

  test("a cipher shorter than the first skip carries nothing", () => {
    const out = BARN.decrypt([1, 0], [3, 1]);
    assert.deepEqual(out.bits, []);
    assert.equal(out.text, "");
    assert.equal(out.exactFit, false);
  });
});

describe("randomness", () => {
  test("every encryption draws a fresh stream", () => {
    const text = "the same text, twice";
    assert.notDeepEqual(BARN.encrypt(text, PAPER_KEY).cipher, BARN.encrypt(text, PAPER_KEY).cipher);
  });

  test("random bits are 0 or 1 and roughly balanced", () => {
    const sample = BARN.randomBits(200_000);
    assert.equal(sample.length, 200_000);
    assert.ok(sample.every((b) => b === 0 || b === 1));
    const mean = ones(sample) / sample.length;
    assert.ok(Math.abs(mean - 0.5) < 0.01, `mean ${mean}`);
  });

  test("works past the 64 KiB per-call limit of getRandomValues", () => {
    assert.equal(BARN.randomBits(65536 * 8 + 3).length, 65536 * 8 + 3);
  });
});

describe("keys from random bits (Sec. 3)", () => {
  test("each base turns bit groups into digits and drops the rest", () => {
    assert.deepEqual(BARN.keyFromBits(bits("00 01 10 11"), "ternary"), [1, 2]);
    assert.deepEqual(BARN.keyFromBits(bits("00 01 10 11"), "quaternary"), [1, 2, 3]);
    assert.deepEqual(BARN.keyFromBits(bits("000 001 111 1"), "octal"), [1, 7]);
    assert.deepEqual(BARN.keyFromBits(bits("0000 0001 1001 1010 1111"), "decimal"), [1, 9]);
    assert.deepEqual(BARN.keyFromBits(bits("0000 0001 1001 1010 1111"), "hexadecimal"), [1, 9, 10, 15]);
  });

  test("key sizes match Table 1 and skips match the growth factors", () => {
    // Table 1, 64 random bits: 16, 24, 18, 9 and 15 elements (octal's 18.375 is
    // rounded down there). Sec. 3: messages grow 1.5, 2, 4, 5 and 8 times.
    const expected = {
      ternary: [16, 1.5],
      quaternary: [24, 2],
      octal: [18.375, 4],
      decimal: [9, 5],
      hexadecimal: [15, 8],
    };
    const rand = seeded(6);
    const runs = 4000;
    for (const [base, [size, skip]] of Object.entries(expected)) {
      let elements = 0;
      let total = 0;
      for (let r = 0; r < runs; r++) {
        const key = BARN.keyFromBits(seededBits(rand, 64), base);
        elements += key.length;
        total += key.reduce((a, b) => a + b, 0);
      }
      assert.ok(Math.abs(elements / runs - size) < 0.5, `${base}: ${elements / runs} elements`);
      assert.ok(Math.abs(total / elements - skip) < 0.1, `${base}: mean skip ${total / elements}`);
    }
  });

  test("generateKey only returns keys that parseKey accepts", () => {
    for (const base of Object.keys(BARN.KEY_BASES)) {
      for (let r = 0; r < 200; r++) {
        const key = BARN.generateKey(base, 8);
        assert.ok(key.every((k) => k >= 1 && k <= BARN.KEY_BASES[base].max));
        assert.deepEqual(BARN.parseKey(key.join(",")), key);
      }
    }
  });

  test("generateKey rejects unknown bases and too few bits", () => {
    assert.throws(() => BARN.generateKey("binary"), /Unknown base/);
    assert.throws(() => BARN.generateKey("octal", 2), RangeError);
  });
});
