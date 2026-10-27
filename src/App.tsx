import { useEffect, useState } from "react";
import { frameAt, type Mode } from "./lib/timeline.ts";
import { useCipher, type Cipher } from "./useCipher.ts";
import { Figures } from "./components/Figures.tsx";
import { DecryptInputs, EncryptInputs } from "./components/Inputs.tsx";
import { Masthead } from "./components/Masthead.tsx";
import { Output } from "./components/Output.tsx";
import { Player } from "./components/Player.tsx";
import { PointerLabel } from "./components/PointerLabel.tsx";

// Space plays or pauses, the arrows step, Home and End jump. Typing in a field is left alone.
function useShortcuts(cipher: Cipher) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === " " && target.closest("button, a")) return; // Space presses the focused button instead
      const actions: Record<string, () => void> = {
        " ": cipher.toggle,
        ArrowRight: () => cipher.move(1),
        ArrowLeft: () => cipher.move(-1),
        Home: () => cipher.go(0),
        End: () => cipher.go(cipher.run.lastStep),
      };
      if (!actions[e.key]) return;
      e.preventDefault();
      actions[e.key]();
    }
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [cipher]);
}

export function App() {
  const [mode, setMode] = useState<Mode>("encrypt");
  const encrypt = useCipher("encrypt", { text: "BARN", key: "1, 3, 2, 1" });
  const latest = { text: encrypt.run.cipher.join(""), key: encrypt.run.key.join(", ") };
  const decrypt = useCipher("decrypt", latest);
  const active = mode === "encrypt" ? encrypt : decrypt;
  const frame = frameAt(active.run, active.step);
  useShortcuts(active);

  // The Decrypt tab picks up the latest cipher and key, unless you've typed your own there.
  function switchTo(next: Mode, handOver = false) {
    if (next === mode) return;
    active.pause();
    if (next === "decrypt" && (handOver || !decrypt.edited)) {
      if (latest.text !== decrypt.fields.text || latest.key !== decrypt.fields.key) decrypt.edit(latest, true);
    }
    setMode(next);
  }

  return (
    <>
      <div className="page">
        <Masthead mode={mode} onMode={(next) => switchTo(next)} />
        <main>
          {mode === "encrypt" ? <EncryptInputs cipher={encrypt} /> : <DecryptInputs cipher={decrypt} />}
          {/* Keyed by mode so switching fades the new figures in from scratch. */}
          <div className="stage" key={mode}>
            <div className="stage-main">
              <Figures run={active.run} frame={frame} stale={active.stale} speed={active.speed} />
              <Output
                run={active.run}
                frame={frame}
                onSkip={() => active.go(active.run.lastStep)}
                onDecrypt={() => switchTo("decrypt", true)}
              />
            </div>
            <aside className="stage-side">
              <Player cipher={active} frame={frame} />
            </aside>
          </div>
        </main>
        <footer className="colophon">
          <span>Made by Mohsin Mohamed</span>
          <span>
            BARN is the work of J. J. Tatarkiewicz and W. B. Kuźmicz,{" "}
            <a href="https://arxiv.org/abs/2404.09288" target="_blank" rel="noreferrer">
              arXiv:2404.09288
            </a>
          </span>
        </footer>
      </div>
      <PointerLabel />
    </>
  );
}
