/*
 * BARN — Bury Among Random Numbers
 *
 * J. J. Tatarkiewicz and W. B. Kuźmicz, "New Class of Ciphers Using Hardware
 * Entropy Source", arXiv:2404.09288 (2024).
 *
 * The message's bits replace bits of a random stream at positions picked by
 * the key: skip K1 bits and write, skip K2 bits and write, and so on, reusing
 * the key cyclically. Whoever knows the key can read the bits back out.
 *
 * Everything here is pure (no DOM). Stream positions are 0-based in code; the
 * paper and the UI count from 1.
 */

export type Bit = 0 | 1;
export type Key = number[];

// Far above the paper's largest key digit (15), but keeps streams bounded.
export const MAX_SKIP = 255;

const encoder = new TextEncoder();
// ignoreBOM keeps a leading U+FEFF in the message instead of dropping it.
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);

/* ---------- Parsing user input ---------- */

// Accepts "1,3,2,1", "1 3 2 1" or the paper's notation "{1, 3, 2, 1}".
export function parseKey(input: string): Key {
  const tokens = input.replace(/[{}[\]]/g, " ").split(/[\s,;]+/).filter(Boolean);
  if (tokens.length === 0) throw new Error("Enter a key, for example 1,3,2,1.");

  const key = tokens.map((token) => {
    if (!/^\d+$/.test(token)) {
      throw new Error(`“${token}” isn't a whole number. Key elements are positive integers.`);
    }
    const k = Number(token);
    // Paper, Sec. 3: a zero would write two message bits into one stream bit.
    if (k === 0) throw new Error("Key elements can't be 0: two message bits would land on the same stream bit.");
    if (k > MAX_SKIP) throw new Error(`Key elements go up to ${MAX_SKIP}.`);
    return k;
  });

  // Paper, Sec. 3: only ones would copy the message into consecutive bits.
  if (key.every((k) => k === 1)) {
    throw new Error("A key of only 1s copies the message straight into the stream. Use at least one number above 1.");
  }
  return key;
}

export function parseBits(input: string): Bit[] {
  const text = input.replace(/\s+/g, "");
  if (!text) throw new Error("Paste the cipher bits (0s and 1s).");
  const bad = text.search(/[^01]/);
  if (bad !== -1) {
    throw new Error(`The cipher can only contain 0 and 1, but it has “${String.fromCodePoint(text.codePointAt(bad)!)}”.`);
  }
  return Array.from(text, (c) => (c === "1" ? 1 : 0));
}

/* ---------- Text ⇄ bits (UTF-8, most significant bit first) ---------- */

export function bytesToBits(bytes: Iterable<number>): Bit[] {
  const bits: Bit[] = [];
  for (const byte of bytes) for (let k = 7; k >= 0; k--) bits.push(((byte >> k) & 1) as Bit);
  return bits;
}

// Whole bytes only; a trailing partial byte is left out.
export function bitsToBytes(bits: readonly Bit[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let k = 0; k < 8; k++) byte = (byte << 1) | bits[i + k];
    bytes.push(byte);
  }
  return bytes;
}

export interface EncodedChar {
  char: string;
  bytes: number[];
}

// Keeps the per-character split so the UI can show which bytes form which character.
export function encodeText(text: string) {
  const chars: EncodedChar[] = [];
  const bytes: number[] = [];
  for (const char of text) {
    const charBytes = Array.from(encoder.encode(char));
    chars.push({ char, bytes: charBytes });
    bytes.push(...charBytes);
  }
  return { chars, bytes, bits: bytesToBits(bytes) };
}

// Length of the longest prefix that doesn't stop inside a multi-byte character.
function completePrefix(bytes: readonly number[]): number {
  let lead = bytes.length - 1;
  while (lead >= 0 && bytes.length - lead <= 3 && (bytes[lead] & 0xc0) === 0x80) lead--;
  if (lead < 0) return bytes.length;
  const b = bytes[lead];
  const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
  return bytes.length - lead < need ? lead : bytes.length;
}

// Decodes the whole bytes in `bits`. Until `final`, a character whose bytes
// haven't all arrived is held back rather than shown as "�".
export function decodeBits(bits: readonly Bit[], { final = false } = {}) {
  const bytes = bitsToBytes(bits);
  const ready = final ? bytes.length : completePrefix(bytes);
  return {
    bytes,
    text: decoder.decode(Uint8Array.from(bytes.slice(0, ready))),
    pendingBytes: bytes.length - ready,
  };
}

/* ---------- Where the message bits go ---------- */

// Paper, Eq. (1): 1-based stream position of the j-th message bit (j ≥ 1).
export function positionOf(j: number, key: Key): number {
  const cycles = Math.floor((j - 1) / key.length);
  const t = j - cycles * key.length;
  return cycles * sum(key) + sum(key.slice(0, t));
}

// Paper, Algorithm 1: 0-based positions of the first `count` message bits.
export function positions(count: number, key: Key): number[] {
  const out: number[] = [];
  for (let j = 0, i = -1; j < count; j++) {
    i += key[j % key.length];
    out.push(i);
  }
  return out;
}

// The cipher ends at the last buried bit (paper: Eq. (1) with j = μ).
export const streamLength = (count: number, key: Key) => (count > 0 ? positionOf(count, key) : 0);

// μ: how many message bits a cipher of `length` bits carries under `key`.
export function messageLength(length: number, key: Key): number {
  const cycle = sum(key);
  const cycles = Math.floor(length / cycle);
  let count = cycles * key.length;
  let used = cycles * cycle;
  for (const k of key) {
    if (used + k > length) break;
    used += k;
    count++;
  }
  return count;
}

/* ---------- Randomness ---------- */

// The paper assumes a hardware TRNG; a browser's CSPRNG is the closest a web page gets.
export function randomBits(count: number): Bit[] {
  const bytes = new Uint8Array(Math.ceil(count / 8));
  for (let i = 0; i < bytes.length; i += 65536) {
    crypto.getRandomValues(bytes.subarray(i, i + 65536)); // 64 KiB per call at most
  }
  return bytesToBits(bytes).slice(0, count);
}

/* ---------- The cipher ---------- */

export function bury(message: readonly Bit[], key: Key, random: readonly Bit[]): Bit[] {
  const length = streamLength(message.length, key);
  if (random.length < length) {
    throw new RangeError(`Burying ${message.length} bits needs ${length} random bits, got ${random.length}.`);
  }
  const cipher = random.slice(0, length);
  positions(message.length, key).forEach((i, j) => {
    cipher[i] = message[j];
  });
  return cipher;
}

// `random` is only passed by tests that need a fixed stream.
export function encrypt(text: string, key: Key, random?: readonly Bit[]) {
  const message = encodeText(text);
  const length = streamLength(message.bits.length, key);
  const stream = random ? random.slice(0, length) : randomBits(length);
  return {
    key,
    ...message,
    positions: positions(message.bits.length, key),
    random: stream,
    cipher: bury(message.bits, key, stream),
  };
}

export function decrypt(cipher: readonly Bit[], key: Key) {
  const count = messageLength(cipher.length, key);
  const plan = positions(count, key);
  const bits = plan.map((i) => cipher[i]);
  const { bytes, text } = decodeBits(bits, { final: true });
  return {
    key,
    cipher: cipher.slice(),
    positions: plan,
    bits,
    bytes,
    text,
    leftoverBits: count % 8,
    // With the right key the last skip lands exactly on the last cipher bit.
    exactFit: count > 0 && plan[count - 1] === cipher.length - 1,
  };
}

/* ---------- Keys from random bits (paper, Sec. 3) ---------- */

// Random bits are read in fixed-width groups; groups that spell a usable
// digit become key elements and the rest (such as all zeros) are discarded.
export const KEY_BASES = {
  ternary: { width: 2, max: 2 }, //      01 10        → 1 2
  quaternary: { width: 2, max: 3 }, //   01 10 11     → 1 2 3
  octal: { width: 3, max: 7 }, //        001 … 111    → 1 … 7
  decimal: { width: 4, max: 9 }, //      0001 … 1001  → 1 … 9
  hexadecimal: { width: 4, max: 15 }, // 0001 … 1111  → 1 … 15
} as const;

export type KeyBase = keyof typeof KEY_BASES;

export function keyFromBits(bits: readonly Bit[], base: KeyBase): Key {
  const { width, max } = KEY_BASES[base];
  const key: Key = [];
  for (let i = 0; i + width <= bits.length; i += width) {
    let digit = 0;
    for (let k = 0; k < width; k++) digit = (digit << 1) | bits[i + k];
    if (digit >= 1 && digit <= max) key.push(digit);
  }
  return key;
}

export function generateKey(base: KeyBase = "quaternary", randomBitCount = 32): Key {
  if (!(base in KEY_BASES)) throw new Error(`Unknown base “${base}”.`);
  if (randomBitCount < KEY_BASES[base].width) {
    throw new RangeError(`A ${base} digit needs at least ${KEY_BASES[base].width} random bits.`);
  }
  for (;;) {
    const key = keyFromBits(randomBits(randomBitCount), base);
    if (key.some((k) => k > 1)) return key; // redraw empty or all-ones keys
  }
}
