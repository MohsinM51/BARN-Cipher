/*
 * Splits one encryption or decryption into numbered steps for the visualiser.
 *
 * What is on screen at step n is computed from the run and n alone, so
 * playing, scrubbing and stepping back always show the same picture for the
 * same step. (v1 changed its state on every click and tried to undo it on
 * Previous, which is how it ended up burying or reading bits twice.)
 *
 * Encryption: message → random stream → one step per bit → cipher.
 * Decryption: cipher → one step per bit → plaintext.
 */
import { bitsToBytes, decodeBits, decrypt, encrypt, type Bit, type EncodedChar, type Key } from "./barn.ts";

export type Mode = "encrypt" | "decrypt";
export type Phase = "message" | "stream" | "bury" | "cipher" | "read" | "plaintext";

interface RunBase {
  key: Key;
  cipher: Bit[];
  positions: number[];
  bits: Bit[]; // message bits, buried or read in order
  bytes: number[];
  slot: number[]; // stream position → message bit j, or -1
  lastStep: number;
}

export interface EncryptRun extends RunBase {
  mode: "encrypt";
  text: string;
  chars: EncodedChar[];
  random: Bit[];
  charOfByte: string[];
}

export interface DecryptRun extends RunBase {
  mode: "decrypt";
  text: string;
  leftoverBits: number;
  exactFit: boolean;
}

export type Run = EncryptRun | DecryptRun;

// The skip that brings message bit j to its stream position (1-based, as in the paper).
export interface Hop {
  j: number;
  k: number;
  skip: number;
  from: number;
  to: number;
}

// `count` is how many message bits are buried (or read) once the step is done;
// `hop` describes the bit handled by the step itself, if any.
export interface Frame {
  step: number;
  phase: Phase;
  count: number;
  hop: Hop | null;
}

export interface Segment {
  text: string;
  first: number; // index of its first message bit
  bits: number;
  bytes: number[];
}

const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
export const sub = (n: number) => String(n).replace(/\d/g, (d) => SUBSCRIPT[Number(d)]);
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
// {1, 3, 2, 1}; long keys are shortened so the narration stays readable.
export const keyText = (key: Key, max = 12) => `{${key.slice(0, max).join(", ")}${key.length > max ? ", …" : ""}}`;
export const hex = (byte: number) => "0x" + byte.toString(16).toUpperCase().padStart(2, "0");

// Control characters become their visible "control picture" symbols (␀, ␉, ␊ …).
export const printable = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f]/g, (c) => String.fromCharCode(c === "\u007f" ? 0x2421 : 0x2400 + c.charCodeAt(0)));
export const glyph = (char: string) => (char === " " ? "␣" : printable(char));
export function quote(text: string, max = 32) {
  const chars = Array.from(printable(text));
  return `“${chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("")}”`;
}

/* ---------- Runs ---------- */

function slots(length: number, positions: number[]) {
  const slot = new Array<number>(length).fill(-1);
  positions.forEach((i, j) => {
    slot[i] = j;
  });
  return slot;
}

// `random` is only passed by tests that need a fixed stream.
export function encryption(text: string, key: Key, random?: Bit[]): EncryptRun {
  const result = encrypt(text, key, random);
  return {
    mode: "encrypt",
    text,
    ...result,
    slot: slots(result.cipher.length, result.positions),
    lastStep: result.bits.length + 2,
    charOfByte: result.chars.flatMap(({ char, bytes }) => bytes.map(() => char)),
  };
}

export function decryption(cipher: Bit[], key: Key): DecryptRun {
  const result = decrypt(cipher, key);
  return {
    mode: "decrypt",
    ...result,
    slot: slots(result.cipher.length, result.positions),
    lastStep: result.bits.length + 1,
  };
}

/* ---------- Steps ---------- */

export function hop(run: Run, j: number): Hop {
  const k = j % run.key.length;
  return { j, k, skip: run.key[k], from: j === 0 ? 0 : run.positions[j - 1] + 1, to: run.positions[j] + 1 };
}

export function frameAt(run: Run, step: number): Frame {
  const n = Math.max(0, Math.min(run.lastStep, Math.round(step) || 0));
  const mu = run.bits.length;
  let phase: Phase;
  let count: number;
  let current: number;
  if (run.mode === "encrypt") {
    phase = n === 0 ? "message" : n === 1 ? "stream" : n === run.lastStep ? "cipher" : "bury";
    count = Math.min(Math.max(n - 1, 0), mu);
    current = phase === "bury" ? n - 2 : -1;
  } else {
    phase = n === 0 ? "cipher" : n === run.lastStep ? "plaintext" : "read";
    count = Math.min(n, mu);
    current = phase === "read" ? n - 1 : -1;
  }
  return { step: n, phase, count, hop: current >= 0 ? hop(run, current) : null };
}

// What stream cell i (0-based) shows at a frame. `marked` means buried or read.
export function cellAt(run: Run, frame: Frame, i: number) {
  const j = run.slot[i];
  const marked = j !== -1 && j < frame.count;
  const bit = run.mode === "encrypt" && !marked ? run.random[i] : run.cipher[i];
  return { bit, marked, j };
}

// Message bits grouped the way Fig. 1 shows them: one group per character
// when encrypting; when decrypting, one group per piece of text the decoder
// emits as bytes arrive (so a broken byte shows up as "�" where it happened).
export function segments(run: Run): Segment[] {
  if (run.mode === "encrypt") {
    let first = 0;
    return run.chars.map(({ char, bytes }) => {
      const segment = { text: glyph(char), first, bits: bytes.length * 8, bytes };
      first += segment.bits;
      return segment;
    });
  }
  const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const out: Segment[] = [];
  let start = 0;
  run.bytes.forEach((byte, b) => {
    let text = decoder.decode(Uint8Array.of(byte), { stream: true });
    if (b === run.bytes.length - 1) text += decoder.decode(); // a cut-off character becomes "�"
    if (!text) return;
    const bytes = run.bytes.slice(start, b + 1);
    out.push({ text: Array.from(text, glyph).join(""), first: start * 8, bits: bytes.length * 8, bytes });
    start = b + 1;
  });
  if (run.leftoverBits) out.push({ text: "", first: start * 8, bits: run.leftoverBits, bytes: [] });
  return out;
}

// Scrubber marks: one per phase, plus one at the start of every byte.
export function ticks(run: Run) {
  const first = run.mode === "encrypt" ? 2 : 1;
  const bytes: number[] = [];
  for (let s = first + 8; s < first + run.bits.length; s += 8) bytes.push(s);
  const phases: [string, number][] =
    run.mode === "encrypt"
      ? [["Message", 0], ["Stream", 1], ["Bury", 2], ["Cipher", run.lastStep]]
      : [["Cipher", 0], ["Read", 1], ["Plaintext", run.lastStep]];
  return { phases: phases.map(([label, step]) => ({ label, step })), bytes };
}

/* ---------- Narration ---------- */

const fromText = (h: Hop) => (h.from === 0 ? "from the start" : `from position ${h.from}`);

// Why a decryption looks wrong, if it does (empty when everything fits).
export function fitWarnings(run: DecryptRun): string[] {
  const mu = run.bits.length;
  if (mu === 0) return ["Not even one message bit fits: the first skip already runs past the end."];
  const warnings: string[] = [];
  if (!run.exactFit) warnings.push(`The last skip doesn't land on bit ${run.cipher.length}, so the key or the cipher's length is off.`);
  if (run.leftoverBits) warnings.push(`${mu} bits aren't whole bytes (${run.leftoverBits} left over), so this is probably the wrong key.`);
  return warnings;
}

export function describe(run: Run, frame: Frame): { title: string; text: string } {
  const mu = run.bits.length;
  const length = run.cipher.length;
  const h = frame.hop;

  if (run.mode === "encrypt") {
    switch (frame.phase) {
      case "message":
        return {
          title: "The message",
          text:
            `${quote(run.text)} is ${plural(run.bytes.length, "byte")} of UTF-8, so μ = ${mu} bits. ` +
            `With K = ${keyText(run.key)} they need a stream of ${length} random bits.`,
        };
      case "stream": {
        // randomBits() asks for whole bytes and unpacks each into 8 bits, most significant first.
        const total = Math.ceil(length / 8);
        const sample = bitsToBytes(run.random).slice(0, 4).map((b) => hex(b).slice(2));
        const spare = total * 8 - length;
        return {
          title: "Random stream P",
          text:
            `crypto.getRandomValues(), the browser's cryptographic generator, returns ${plural(total, "random byte")} ` +
            `(${sample.join(" ")}${total > sample.length ? " …" : ""}). Each is unpacked into 8 bits, most significant first` +
            `${spare ? `, and the last ${spare} are dropped` : ""}, giving the ${length} bits of P. The operating system seeds ` +
            `that generator from hardware noise; the paper uses a true hardware RNG instead.`,
        };
      }
      case "bury": {
        const { j, k, skip, to } = h!;
        const bit = run.bits[j];
        const was = run.random[to - 1];
        const change =
          was === bit
            ? `P${sub(to)} is already ${bit}; it keeps its value but now carries the message.`
            : `P${sub(to)} was ${was}; it now holds ${bit}.`;
        return {
          title: `Bury bit ${j + 1} of ${mu}`,
          text:
            `M${sub(j + 1)} = ${bit}, from ${quote(glyph(run.charOfByte[j >> 3]))}. ` +
            `Skip K${sub(k + 1)} = ${skip} ${fromText(h!)} to position ${to}. ${change}`,
        };
      }
      default: {
        const changed = run.cipher.filter((b, i) => b !== run.random[i]).length;
        return {
          title: "Cipher C",
          text:
            `All ${mu} bits are buried in ${length}. Only ${changed} stream bits actually changed: ` +
            `a random bit already matches the message bit half the time. Share C, keep K secret.`,
        };
      }
    }
  }

  switch (frame.phase) {
    case "cipher": {
      const fits =
        fitWarnings(run).join(" ") ||
        `The last skip lands exactly on bit ${length}, and ${mu} bits make ${plural(mu / 8, "whole byte")}.`;
      return {
        title: "Cipher C and key K",
        text: `With K = ${keyText(run.key)}, ${plural(mu, "message bit")} fit in these ${length} bits. ${fits}`,
      };
    }
    case "read": {
      const { j, k, skip, to } = h!;
      let text = `Skip K${sub(k + 1)} = ${skip} ${fromText(h!)} to position ${to}. C${sub(to)} = ${run.bits[j]} becomes M${sub(j + 1)}.`;
      if ((j + 1) % 8 === 0) {
        const byte = (j + 1) / 8;
        const soFar = decodeBits(run.bits.slice(0, j + 1)).text;
        text += ` Byte ${byte} is complete: ${hex(run.bytes[byte - 1])}. Text so far: ${quote(soFar)}.`;
      }
      return { title: `Read bit ${j + 1} of ${mu}`, text };
    }
    default: {
      const notes = fitWarnings(run);
      if (run.text.includes("�")) notes.push("“�” marks bytes that aren't valid UTF-8, another sign of a wrong key.");
      return {
        title: "Plaintext",
        text: `${plural(run.bytes.length, "byte")} decode to ${quote(run.text, 64)}. ${notes.join(" ")}`.trim(),
      };
    }
  }
}
