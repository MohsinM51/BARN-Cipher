import { Fragment, useLayoutEffect, useRef, useState } from "react";
import { sub, type Frame, type Run } from "../lib/timeline.ts";

// Fig. 2: the key. One underline slides to whichever skip is in use.
export function KeyFigure({ run, frame }: { run: Run; frame: Frame }) {
  const current = frame.hop?.k ?? -1;
  const box = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ x: 0, y: 0, width: 0, on: false });

  useLayoutEffect(() => {
    const chip = box.current?.querySelector<HTMLElement>(`.k[data-k="${current}"]`);
    // When no skip is in use the bar fades out where it is rather than jumping away.
    setBar((prev) =>
      chip ? { x: chip.offsetLeft, y: chip.offsetTop + chip.offsetHeight, width: chip.offsetWidth, on: true } : { ...prev, on: false },
    );
  }, [current, run.key]);

  return (
    <figure className="fig">
      <div ref={box} className="key">
        <span className="brace">{"{"}</span>
        {run.key.map((k, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">,</span>}
            <span className={i === current ? "k current" : "k"} data-k={i} data-tip={`K${sub(i + 1)} = ${k}`}>
              {k}
            </span>
          </Fragment>
        ))}
        <span className="brace">{"}"}</span>
        <span
          className="key-bar"
          aria-hidden="true"
          style={{ transform: `translate(${bar.x}px, ${bar.y}px)`, width: bar.width, opacity: bar.on ? 1 : 0 }}
        />
      </div>
      <figcaption>
        <b>Fig. 2.</b> Key K: κ = {run.key.length} skips, taken in turn and repeated from the start.
      </figcaption>
    </figure>
  );
}
