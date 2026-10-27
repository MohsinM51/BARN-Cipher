import { useMemo, useRef, useState, type RefObject } from "react";
import { fitWarnings, printable, segments, type Frame, type Run } from "../lib/timeline.ts";

function CopyButton({ text, target }: { text: string; target: RefObject<HTMLElement | null> }) {
  const [label, setLabel] = useState("Copy");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setLabel("Copied");
    } catch {
      // No clipboard access (e.g. some browsers on file://): select it for a manual copy instead.
      if (target.current) getSelection()?.selectAllChildren(target.current);
      setLabel("Selected");
    }
    setTimeout(() => setLabel("Copy"), 1600);
  }
  return (
    <button type="button" className="btn" onClick={copy}>
      {label}
    </button>
  );
}

interface Props {
  run: Run;
  frame: Frame;
  onSkip: () => void;
  onDecrypt: () => void;
}

export function Output({ run, frame, onSkip, onDecrypt }: Props) {
  const textRef = useRef<HTMLParagraphElement>(null);
  const groups = useMemo(() => segments(run), [run]);

  if (run.mode === "encrypt") {
    const done = frame.phase === "cipher";
    const bits = run.cipher.join("");
    return (
      <section className="output" aria-live="polite">
        <span className="label">cipher C</span>
        <div className="output-body">
          {done ? (
            <p ref={textRef} className="bits reveal">
              {bits}
            </p>
          ) : (
            <p>
              The cipher is ready once all {run.bits.length} bits are buried.{" "}
              <button type="button" className="link" onClick={onSkip}>
                Skip to the end
              </button>
            </p>
          )}
        </div>
        {done && (
          <div className="output-actions">
            <CopyButton text={bits} target={textRef} />
            <button type="button" className="btn" onClick={onDecrypt}>
              Decrypt it
            </button>
          </div>
        )}
      </section>
    );
  }

  const done = frame.phase === "plaintext";
  const soFar = groups.filter((g) => g.first + g.bits <= frame.count).map((g) => g.text).join("");
  const warnings = fitWarnings(run);
  return (
    <section className="output" aria-live="polite">
      <span className="label">plaintext</span>
      <div className="output-body">
        <p ref={textRef} className={done ? "plain reveal" : "plain"}>
          {done ? printable(run.text) : soFar}
          {!done && <span className="pending">{frame.count < run.bits.length ? "…" : ""}</span>}
        </p>
        {done && warnings.map((w) => <p key={w} className="note">{w}</p>)}
      </div>
      {done && (
        <div className="output-actions">
          <CopyButton text={run.text} target={textRef} />
        </div>
      )}
    </section>
  );
}
