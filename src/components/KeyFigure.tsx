import { Fragment } from "react";
import type { Frame, Run } from "../lib/timeline.ts";

// Fig. 2: the key, with the skip in use underlined.
export function KeyFigure({ run, frame }: { run: Run; frame: Frame }) {
  const current = frame.hop?.k ?? -1;
  return (
    <figure className="fig">
      <div className="key">
        <span className="brace">{"{"}</span>
        {run.key.map((k, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="sep">,</span>}
            <span className={i === current ? "k current" : "k"}>{k}</span>
          </Fragment>
        ))}
        <span className="brace">{"}"}</span>
      </div>
      <figcaption>
        <b>Fig. 2.</b> Key K: κ = {run.key.length} skips, taken in turn and repeated from the start.
      </figcaption>
    </figure>
  );
}
