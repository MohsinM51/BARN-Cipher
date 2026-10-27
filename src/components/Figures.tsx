import { useRef, useState } from "react";
import type { Frame, Run } from "../lib/timeline.ts";
import { useStepAnimation } from "../animation.ts";
import { KeyFigure } from "./KeyFigure.tsx";
import { MessageFigure } from "./MessageFigure.tsx";
import { StreamFigure } from "./StreamFigure.tsx";

interface Props {
  run: Run;
  frame: Frame;
  stale: boolean;
  speed: number;
}

export function Figures({ run, frame, stale, speed }: Props) {
  const messageRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const [linked, setLinked] = useState(-1); // message bit j under the pointer, in either figure
  useStepAnimation(run, frame, speed, messageRef, streamRef);

  return (
    <section className={stale ? "figure stale" : "figure"} aria-label="Figures">
      <MessageFigure ref={messageRef} run={run} frame={frame} linked={linked} onLink={setLinked} />
      <KeyFigure run={run} frame={frame} />
      <StreamFigure ref={streamRef} run={run} frame={frame} linked={linked} onLink={setLinked} />
    </section>
  );
}
