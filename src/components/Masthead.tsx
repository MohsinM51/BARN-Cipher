import type { Mode } from "../lib/timeline.ts";

const MODES: [Mode, string][] = [
  ["encrypt", "Encrypt"],
  ["decrypt", "Decrypt"],
];

export function Masthead({ mode, onMode }: { mode: Mode; onMode: (mode: Mode) => void }) {
  return (
    <header className="masthead">
      <div>
        <h1>
          BARN <span>Bury Among Random Numbers</span>
        </h1>
        <p className="byline">
          An interactive figure for J. J. Tatarkiewicz and W. B. Kuźmicz,{" "}
          <a href="https://arxiv.org/abs/2404.09288" target="_blank" rel="noreferrer">
            <i>New Class of Ciphers Using Hardware Entropy Source</i>
          </a>{" "}
          (2024).
        </p>
      </div>
      <div className="modes" role="group" aria-label="Mode">
        {MODES.map(([value, label]) => (
          <button key={value} type="button" aria-pressed={mode === value} onClick={() => onMode(value)}>
            {label}
          </button>
        ))}
      </div>
    </header>
  );
}
