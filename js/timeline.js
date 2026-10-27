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
(function (factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./barn.js"));
  else globalThis.Timeline = factory(globalThis.BARN);
})(function (BARN) {
  "use strict";

  const SUBSCRIPT = "₀₁₂₃₄₅₆₇₈₉";
  const sub = (n) => String(n).replace(/\d/g, (d) => SUBSCRIPT[d]);
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const keyText = (key) => `{${key.join(", ")}}`;
  const hex = (byte) => "0x" + byte.toString(16).toUpperCase().padStart(2, "0");

  // Control characters become their visible "control picture" symbols (␀, ␉, ␊ …).
  const printable = (text) =>
    String(text).replace(/[\u0000-\u001f\u007f]/g, (c) => String.fromCharCode(c === "\u007f" ? 0x2421 : 0x2400 + c.charCodeAt(0)));
  const glyph = (char) => (char === " " ? "␣" : printable(char));
  const quote = (text, max = 32) => {
    const chars = Array.from(printable(text));
    return `“${chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("")}”`;
  };

  /* ---------- Runs ---------- */

  function build(mode, result) {
    const slot = new Array(result.cipher.length).fill(-1); // stream position → message bit j
    result.positions.forEach((i, j) => {
      slot[i] = j;
    });
    const lastStep = result.bits.length + (mode === "encrypt" ? 2 : 1);
    return { mode, ...result, slot, lastStep };
  }

  // `random` is only passed by tests that need a fixed stream.
  function encryption(text, key, random) {
    const run = build("encrypt", BARN.encrypt(text, key, random));
    run.text = String(text);
    run.charOfByte = run.chars.flatMap(({ char, bytes }) => bytes.map(() => char));
    return run;
  }

  const decryption = (cipher, key) => build("decrypt", BARN.decrypt(cipher, key));

  /* ---------- Steps ---------- */

  // The skip that brings message bit j to its stream position (1-based, as in the paper).
  function hop(run, j) {
    const k = j % run.key.length;
    return { j, k, skip: run.key[k], from: j === 0 ? 0 : run.positions[j - 1] + 1, to: run.positions[j] + 1 };
  }

  // `count` is how many message bits are buried (or read) once step n is done;
  // `hop` describes the bit handled by step n itself, if any.
  function frameAt(run, step) {
    const n = Math.max(0, Math.min(run.lastStep, Math.round(step) || 0));
    const mu = run.bits.length;
    let phase, count, current;
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
  function cellAt(run, frame, i) {
    const j = run.slot[i];
    const marked = j !== -1 && j < frame.count;
    const bit = run.mode === "encrypt" && !marked ? run.random[i] : run.cipher[i];
    return { bit, marked, j };
  }

  // Scrubber marks: one per phase, plus one at the start of every byte.
  function ticks(run) {
    const first = run.mode === "encrypt" ? 2 : 1;
    const bytes = [];
    for (let s = first + 8; s < first + run.bits.length; s += 8) bytes.push(s);
    const phases =
      run.mode === "encrypt"
        ? [["Message", 0], ["Stream", 1], ["Bury", 2], ["Cipher", run.lastStep]]
        : [["Cipher", 0], ["Read", 1], ["Plaintext", run.lastStep]];
    return { phases: phases.map(([label, step]) => ({ label, step })), bytes };
  }

  /* ---------- Narration ---------- */

  const fromText = (h) => (h.from === 0 ? "from the start" : `from position ${h.from}`);

  // Why a decryption looks wrong, if it does (empty when everything fits).
  function fitWarnings(run) {
    const mu = run.bits.length;
    if (mu === 0) return ["Not even one message bit fits: the first skip already runs past the end."];
    const warnings = [];
    if (!run.exactFit) warnings.push(`The last skip doesn't land on bit ${run.cipher.length}, so the key or the cipher's length is off.`);
    if (run.leftoverBits) warnings.push(`${mu} bits aren't whole bytes (${run.leftoverBits} left over), so this is probably the wrong key.`);
    return warnings;
  }

  function describe(run, frame) {
    const mu = run.bits.length;
    const length = run.cipher.length;
    const h = frame.hop;

    switch (frame.phase) {
      case "message":
        return {
          title: "The message",
          text:
            `${quote(run.text)} is ${plural(run.bytes.length, "byte")} of UTF-8, so μ = ${mu} bits. ` +
            `With K = ${keyText(run.key)} they need a stream of ${length} random bits.`,
        };

      case "stream":
        return {
          title: "Random stream P",
          text:
            `${length} random bits from the browser's cryptographic generator, standing in for the ` +
            `paper's hardware TRNG. Next, message bits replace ${mu} of them.`,
        };

      case "bury": {
        const bit = run.bits[h.j];
        const was = run.random[h.to - 1];
        const change =
          was === bit
            ? `P${sub(h.to)} is already ${bit}; it keeps its value but now carries the message.`
            : `P${sub(h.to)} was ${was}; it now holds ${bit}.`;
        return {
          title: `Bury bit ${h.j + 1} of ${mu}`,
          text:
            `M${sub(h.j + 1)} = ${bit}, from ${quote(glyph(run.charOfByte[h.j >> 3]))}. ` +
            `Skip K${sub(h.k + 1)} = ${h.skip} ${fromText(h)} to position ${h.to}. ${change}`,
        };
      }

      case "cipher": {
        if (run.mode === "encrypt") {
          const changed = run.cipher.filter((b, i) => b !== run.random[i]).length;
          return {
            title: "Cipher C",
            text:
              `All ${mu} bits are buried in ${length}. Only ${changed} stream bits actually changed: ` +
              `a random bit already matches the message bit half the time. Share C, keep K secret.`,
          };
        }
        const fits =
          fitWarnings(run).join(" ") ||
          `The last skip lands exactly on bit ${length}, and ${mu} bits make ${plural(mu / 8, "whole byte")}.`;
        return {
          title: "Cipher C and key K",
          text: `With K = ${keyText(run.key)}, ${plural(mu, "message bit")} fit in these ${length} bits. ${fits}`,
        };
      }

      case "read": {
        const bit = run.bits[h.j];
        let text = `Skip K${sub(h.k + 1)} = ${h.skip} ${fromText(h)} to position ${h.to}. C${sub(h.to)} = ${bit} becomes M${sub(h.j + 1)}.`;
        if ((h.j + 1) % 8 === 0) {
          const byte = (h.j + 1) / 8;
          const soFar = BARN.decodeBits(run.bits.slice(0, h.j + 1)).text;
          text += ` Byte ${byte} is complete: ${hex(run.bytes[byte - 1])}. Text so far: ${quote(soFar)}.`;
        }
        return { title: `Read bit ${h.j + 1} of ${mu}`, text };
      }

      case "plaintext": {
        const notes = fitWarnings(run);
        if (run.text.includes("�")) notes.push("“�” marks bytes that aren't valid UTF-8, another sign of a wrong key.");
        return {
          title: "Plaintext",
          text: `${plural(run.bytes.length, "byte")} decode to ${quote(run.text, 64)}. ${notes.join(" ")}`.trim(),
        };
      }
    }
    throw new Error(`Unknown phase ${frame.phase}`);
  }

  return { encryption, decryption, frameAt, cellAt, hop, ticks, describe, fitWarnings, printable, glyph, hex, sub };
});
