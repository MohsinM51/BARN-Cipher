import { useEffect, useReducer } from "react";
import { initialState, prepare, reducer, STEP_MS, type Fields } from "./lib/player.ts";
import type { Mode } from "./lib/timeline.ts";

// Form fields, the run they produce, and its playback, for one mode.
export function useCipher(mode: Mode, initial: Fields) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(mode, initial));

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
