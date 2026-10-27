// Tests for src/lib/player.ts: the form checks and the playback reducer.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  initialState,
  MAX_KEY_LENGTH,
  MAX_STREAM_BITS,
  MAX_TEXT_BYTES,
  prepare,
  reducer,
  type Action,
  type State,
} from "../src/lib/player.ts";
import { seeded } from "./helpers.ts";

const encrypting = (text: string, key = "1, 3, 2, 1") => prepare("encrypt", { text, key });
const decrypting = (text: string, key = "1, 3, 2, 1") => prepare("decrypt", { text, key });

describe("form checks", () => {
  test("valid input builds a run and has no errors", () => {
    const { errors, build } = encrypting("BARN");
    assert.deepEqual(errors, {});
    assert.equal(build!().text, "BARN");
  });

  test("text is measured in UTF-8 bytes, not characters", () => {
    assert.equal(encrypting("é".repeat(MAX_TEXT_BYTES / 2)).errors.text, undefined);
    assert.match(encrypting("é".repeat(MAX_TEXT_BYTES / 2 + 1)).errors.text!, /That's 66 bytes/);
    assert.match(encrypting("").errors.text!, /Type a message/);
  });

  test("a megabyte of pasted text is turned away quickly", () => {
    const started = performance.now();
    const { errors, build } = encrypting("x".repeat(1 << 20));
    assert.match(errors.text!, /That's 1048576 bytes/);
    assert.equal(build, undefined);
    assert.ok(performance.now() - started < 250, "should not encode the whole text");
  });

  test("keys are capped in length", () => {
    const longest = Array(MAX_KEY_LENGTH).fill(2).join(",");
    assert.equal(encrypting("a", longest).errors.key, undefined);
    assert.match(encrypting("a", `${longest},2`).errors.key!, new RegExp(`up to ${MAX_KEY_LENGTH}`));
  });

  test("the stream the figure would have to draw is capped", () => {
    assert.match(encrypting("x".repeat(30), "255").errors.key!, new RegExp(`up to ${MAX_STREAM_BITS}`));
  });

  test("ciphers must be bits, and not too many", () => {
    assert.match(decrypting("0102").errors.text!, /only contain 0 and 1/);
    assert.match(decrypting("0".repeat(MAX_STREAM_BITS + 1)).errors.text!, new RegExp(`up to ${MAX_STREAM_BITS}`));
    assert.equal(decrypting("01 10\n0110").errors.text, undefined);
  });

  test("never throws, whatever is typed", () => {
    const rand = seeded(11);
    const alphabet = "01 ,;{}[]-.e9x🙂é\n\t2";
    const junk = () => Array.from({ length: Math.floor(rand() * 40) }, () => alphabet[Math.floor(rand() * alphabet.length)]).join("");
    for (let trial = 0; trial < 2000; trial++) {
      for (const mode of ["encrypt", "decrypt"] as const) {
        const { errors, build } = prepare(mode, { text: junk(), key: junk() });
        assert.ok(build || Object.keys(errors).length > 0, "invalid input must explain itself");
        if (build) assert.doesNotThrow(build);
      }
    }
  });
});

describe("playback", () => {
  const fresh = (): State => initialState("encrypt", { text: "Hi", key: "1, 3, 2, 1" });
  const run = (state: State, ...actions: Action[]) => actions.reduce(reducer, state);

  test("playing stops the moment the last step shows", () => {
    let state = run(fresh(), { type: "toggle" });
    let ticks = 0;
    while (state.playing) {
      state = reducer(state, { type: "tick" });
      ticks++;
    }
    assert.equal(state.step, state.run.lastStep);
    assert.equal(ticks, state.run.lastStep - 1); // toggle already took the first step
  });

  test("play at the end starts over from the beginning", () => {
    const atEnd = run(fresh(), { type: "go", step: Infinity });
    const replay = reducer(atEnd, { type: "toggle" });
    assert.deepEqual([replay.step, replay.playing], [0, true]);
  });

  test("play on the second-to-last step lands on the end without staying in play", () => {
    const state = run(fresh(), { type: "go", step: Infinity }, { type: "move", by: -1 }, { type: "toggle" });
    assert.deepEqual([state.step, state.playing], [state.run.lastStep, false]);
  });

  test("moves and jumps stay in range and pause playback", () => {
    let state = run(fresh(), { type: "toggle" });
    state = run(state, ...Array<Action>(100).fill({ type: "move", by: 1 }));
    assert.deepEqual([state.step, state.playing], [state.run.lastStep, false]);
    state = run(state, { type: "go", step: -5 }, { type: "move", by: -1 });
    assert.equal(state.step, 0);
  });

  test("a valid edit resets to the start; an invalid one keeps the last run, marked stale", () => {
    const moved = run(fresh(), { type: "go", step: 5 });
    const fields = { text: "Yo", key: "2, 1" };
    const edited = reducer(moved, { type: "edit", fields, run: prepare("encrypt", fields).build!(), loaded: false });
    assert.deepEqual([edited.step, edited.stale, edited.edited, edited.run.text], [0, false, true, "Yo"]);
    const broken = reducer(edited, { type: "edit", fields: { text: "Yo", key: "0" }, loaded: false });
    assert.deepEqual([broken.stale, broken.run.text], [true, "Yo"]);
  });

  test("speed cycles through 0.5×, 1×, 2× and 4×", () => {
    const speeds = [];
    let state = fresh();
    for (let i = 0; i < 4; i++) speeds.push((state = reducer(state, { type: "speed" })).speed);
    assert.deepEqual(speeds, [2, 4, 0.5, 1]);
  });
});
