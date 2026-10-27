import { useEffect, useReducer } from "react";
import { encodeText, parseBits, parseKey, streamLength, type Bit, type Key } from "./lib/barn.ts";
import { decryption, encryption, type Mode, type Run } from "./lib/timeline.ts";

// Limits that keep the figure readable. The cipher core itself has none.
export const MAX_TEXT_BYTES = 64;
export const MAX_STREAM_BITS = 4096;
export const SPEEDS = [0.5, 1, 2, 4];
export const STEP_MS = 900; // one step at 1× speed

export interface Fields {
  text: string; // the plaintext, or the cipher bits when decrypting
  key: string;
}

export type Errors = Partial<Record<keyof Fields, string>>;

// Checks the form. When it's usable, `build` makes a run; encrypting draws a fresh random stream.
export function prepare(mode: Mode, fields: Fields): { errors: Errors; build?: () => Run } {
  const errors: Errors = {};
  let key: Key | undefined;
  try {
    key = parseKey(fields.key);
  } catch (error) {
    errors.key = (error as Error).message;
  }

  if (mode === "encrypt") {
    const size = encodeText(fields.text).bytes.length;
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
  try {
    cipher = parseBits(fields.text);
  } catch (error) {
    errors.text = (error as Error).message;
  }
  if (cipher && cipher.length > MAX_STREAM_BITS) errors.text = `That's ${cipher.length} bits; the figure draws up to ${MAX_STREAM_BITS}.`;
  if (errors.text || !cipher || !key) return { errors };
  const [c, k] = [cipher, key];
  return { errors, build: () => decryption(c, k) };
}

interface State {
  fields: Fields;
  run: Run;
  stale: boolean; // the fields have errors, so the run on screen is the last valid one
  edited: boolean; // typed in by hand since the fields were last loaded
  step: number;
  playing: boolean;
  speed: number;
}

type Action =
  | { type: "edit"; fields: Fields; run?: Run; loaded: boolean }
  | { type: "start"; run: Run }
  | { type: "go"; step: number }
  | { type: "move"; by: number } // relative, so rapid clicks or key repeats never act on a stale step
  | { type: "tick" }
  | { type: "toggle" }
  | { type: "pause" }
  | { type: "speed" };

function reducer(state: State, action: Action): State {
  const last = state.run.lastStep;
  switch (action.type) {
    case "edit": {
      const next = { ...state, fields: action.fields, edited: !action.loaded, playing: false };
      return action.run ? { ...next, run: action.run, stale: false, step: 0 } : { ...next, stale: true };
    }
    case "start":
      return { ...state, run: action.run, stale: false, step: 0, playing: true };
    case "go":
      return { ...state, step: Math.max(0, Math.min(last, action.step)), playing: false };
    case "move":
      return { ...state, step: Math.max(0, Math.min(last, state.step + action.by)), playing: false };
    case "tick":
      return state.step >= last ? { ...state, playing: false } : { ...state, step: state.step + 1 };
    case "toggle":
      if (state.playing) return { ...state, playing: false };
      // Pressing play moves on straight away; at the end it starts over.
      return { ...state, playing: true, step: state.step >= last ? 0 : state.step + 1 };
    case "pause":
      return { ...state, playing: false };
    case "speed":
      return { ...state, speed: SPEEDS[(SPEEDS.indexOf(state.speed) + 1) % SPEEDS.length] };
  }
}

// Form fields, the run they produce, and its playback, for one mode.
export function useCipher(mode: Mode, initial: Fields) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    fields: initial,
    run: prepare(mode, initial).build!(),
    stale: false,
    edited: false,
    step: 0,
    playing: false,
    speed: 1,
  }));

  useEffect(() => {
    if (!state.playing) return;
    const delay = state.step === 0 ? 400 : STEP_MS / state.speed;
    const timer = setTimeout(() => dispatch({ type: "tick" }), delay);
    return () => clearTimeout(timer);
  }, [state.playing, state.step, state.speed]);

  const { errors, build } = prepare(mode, state.fields);

  return {
    ...state,
    errors,
    // `loaded` marks fields filled in by the app rather than typed by the user.
    edit(patch: Partial<Fields>, loaded = false) {
      const fields = { ...state.fields, ...patch };
      dispatch({ type: "edit", fields, run: prepare(mode, fields).build?.(), loaded });
    },
    start: () => build && dispatch({ type: "start", run: build() }),
    go: (step: number) => dispatch({ type: "go", step }),
    move: (by: number) => dispatch({ type: "move", by }),
    toggle: () => dispatch({ type: "toggle" }),
    pause: () => dispatch({ type: "pause" }),
    cycleSpeed: () => dispatch({ type: "speed" }),
  };
}

export type Cipher = ReturnType<typeof useCipher>;
