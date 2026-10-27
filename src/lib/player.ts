/*
 * The visualiser's form checks and playback, kept free of React so they can be
 * tested: prepare() validates the fields and builds a run, reducer() moves
 * through its steps.
 */
import { byteLength, parseBits, parseKey, streamLength, type Bit, type Key } from "./barn.ts";
import { decryption, encryption, type Mode, type Run } from "./timeline.ts";

// Limits that keep the figure readable. The cipher core itself has none.
export const MAX_TEXT_BYTES = 64;
export const MAX_STREAM_BITS = 4096;
export const MAX_KEY_LENGTH = 512; // the paper's longest keys (Table 1) have 384 elements
export const SPEEDS = [0.5, 1, 2, 4];
export const STEP_MS = 900; // one step at 1× speed

export interface Fields {
  text: string; // the plaintext, or the cipher bits when decrypting
  key: string;
}

export type Errors = Partial<Record<keyof Fields, string>>;

// Checks the form. When it's usable, `build` makes a run; encrypting draws a fresh random stream.
// Oversized input is rejected before any expensive work, so pasting a novel stays responsive.
export function prepare(mode: Mode, fields: Fields): { errors: Errors; build?: () => Run } {
  const errors: Errors = {};
  let key: Key | undefined;
  try {
    key = parseKey(fields.key);
    if (key.length > MAX_KEY_LENGTH) {
      errors.key = `That's ${key.length} key elements; the figure handles up to ${MAX_KEY_LENGTH}.`;
      key = undefined;
    }
  } catch (error) {
    errors.key = (error as Error).message;
  }

  if (mode === "encrypt") {
    const size = byteLength(fields.text);
    if (!fields.text) errors.text = "Type a message to encrypt.";
    else if (size > MAX_TEXT_BYTES) errors.text = `That's ${size} bytes. Keep it to ${MAX_TEXT_BYTES} so the figure stays readable.`;
    else if (key && streamLength(size * 8, key) > MAX_STREAM_BITS) {
      errors.key = `This key needs a ${streamLength(size * 8, key)}-bit stream and the figure draws up to ${MAX_STREAM_BITS}. Use smaller skips or a shorter message.`;
    }
    if (errors.text || errors.key || !key) return { errors };
    const k = key;
    return { errors, build: () => encryption(fields.text, k) };
  }

  let cipher: Bit[] | undefined;
  const digits = fields.text.replace(/\s+/g, "").length;
  if (digits > MAX_STREAM_BITS) errors.text = `That's ${digits} bits; the figure draws up to ${MAX_STREAM_BITS}.`;
  else {
    try {
      cipher = parseBits(fields.text);
    } catch (error) {
      errors.text = (error as Error).message;
    }
  }
  if (errors.text || !cipher || !key) return { errors };
  const [c, k] = [cipher, key];
  return { errors, build: () => decryption(c, k) };
}

export interface State {
  fields: Fields;
  run: Run;
  stale: boolean; // the fields have errors, so the run on screen is the last valid one
  edited: boolean; // typed in by hand since the fields were last loaded
  step: number;
  playing: boolean;
  speed: number;
}

export type Action =
  | { type: "edit"; fields: Fields; run?: Run; loaded: boolean }
  | { type: "start"; run: Run }
  | { type: "go"; step: number }
  | { type: "move"; by: number } // relative, so rapid clicks or key repeats never act on a stale step
  | { type: "tick" }
  | { type: "toggle" }
  | { type: "pause" }
  | { type: "speed" };

export function initialState(mode: Mode, fields: Fields): State {
  return { fields, run: prepare(mode, fields).build!(), stale: false, edited: false, step: 0, playing: false, speed: 1 };
}

const clamp = (step: number, last: number) => Math.max(0, Math.min(last, step));

export function reducer(state: State, action: Action): State {
  const last = state.run.lastStep;
  switch (action.type) {
    case "edit": {
      const next = { ...state, fields: action.fields, edited: !action.loaded, playing: false };
      return action.run ? { ...next, run: action.run, stale: false, step: 0 } : { ...next, stale: true };
    }
    case "start":
      return { ...state, run: action.run, stale: false, step: 0, playing: action.run.lastStep > 0 };
    case "go":
      return { ...state, step: clamp(action.step, last), playing: false };
    case "move":
      return { ...state, step: clamp(state.step + action.by, last), playing: false };
    case "tick": {
      if (state.step >= last) return { ...state, playing: false };
      const step = state.step + 1;
      return { ...state, step, playing: step < last }; // stops the moment the last step shows
    }
    case "toggle": {
      if (state.playing) return { ...state, playing: false };
      // Pressing play moves on straight away; at the end it starts over.
      const step = state.step >= last ? 0 : state.step + 1;
      return { ...state, step, playing: step < last };
    }
    case "pause":
      return { ...state, playing: false };
    case "speed":
      return { ...state, speed: SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length] };
  }
}
