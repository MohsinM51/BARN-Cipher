import { useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { describe, frameAt, ticks, type Frame } from "../lib/timeline.ts";
import type { Cipher } from "../useCipher.ts";

const ICONS = {
  start: "M2.5 3h1.6v10H2.5zM9 3v10L4.6 8zM14 3v10L9.6 8z",
  prev: "M3.5 3h1.6v10H3.5zM12.5 3v10L6 8z",
  play: "M4.5 2.5v11L13 8z",
  pause: "M4 3h3v10H4zM9 3h3v10H9z",
  next: "M3.5 3v10L10 8zM10.9 3h1.6v10h-1.6z",
  end: "M2 3v10l4.4-5zM7 3v10l4.4-5zM11.9 3h1.6v10h-1.6z",
};

const Icon = ({ path }: { path: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d={path} />
  </svg>
);

// The thumb is 12px wide, so step positions run from 6px to (width − 6px).
const THUMB = 12;

// Centre the hover label over the pointer, but keep it inside the track near either end.
const tagShift = (x: number, width: number) => (x < 90 ? "0%" : x > width - 90 ? "-100%" : "-50%");

// The step card: narration, transport and scrubber. Sits in the margin beside the figures.
export function Player({ cipher, frame }: { cipher: Cipher; frame: Frame }) {
  const { run, playing, speed, go, move, toggle, cycleSpeed } = cipher;
  const last = run.lastStep;
  const { title, text } = describe(run, frame);
  const marks = useMemo(() => ticks(run), [run]);
  const [hover, setHover] = useState<{ x: number; width: number; step: number } | null>(null);
  const hovered = hover && frameAt(run, hover.step); // clamped, in case the run changed under the pointer
  const percent = (step: number) => `${last ? (step / last) * 100 : 0}%`;

  function onHover(e: PointerEvent<HTMLDivElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - box.left, THUMB / 2), box.width - THUMB / 2);
    setHover({ x, width: box.width, step: Math.round(((x - THUMB / 2) / (box.width - THUMB)) * last) });
  }

  return (
    <section className="step-card" aria-label="Playback">
      <p className="step-count">
        step {frame.step} of {last}
      </p>

      <div className="transport">
        <button type="button" onClick={() => go(0)} disabled={frame.step === 0} aria-label="Back to the start" data-tip="Start · Home">
          <Icon path={ICONS.start} />
        </button>
        <button type="button" onClick={() => move(-1)} disabled={frame.step === 0} aria-label="Previous step" data-tip="Previous · ←">
          <Icon path={ICONS.prev} />
        </button>
        <button type="button" className="play" onClick={toggle} aria-label={playing ? "Pause" : "Play"} data-tip={`${playing ? "Pause" : "Play"} · space`}>
          <Icon path={playing ? ICONS.pause : ICONS.play} />
        </button>
        <button type="button" onClick={() => move(1)} disabled={frame.step === last} aria-label="Next step" data-tip="Next · →">
          <Icon path={ICONS.next} />
        </button>
        <button type="button" onClick={() => go(last)} disabled={frame.step === last} aria-label="Skip to the end" data-tip="End · End">
          <Icon path={ICONS.end} />
        </button>
        <button type="button" className="speed" onClick={cycleSpeed} aria-label={`Speed ${speed}×, change`} data-tip="Playback speed">
          {speed}×
        </button>
      </div>

      <div className="scrub" onPointerMove={onHover} onPointerLeave={() => setHover(null)}>
        <div className="ticks" aria-hidden="true">
          {marks.bytes.map((s) => (
            <span key={s} className="tick" style={{ left: percent(s) }} />
          ))}
          {marks.phases.map(({ label, step }) => (
            <span key={label} className="tick phase" style={{ left: percent(step) }} />
          ))}
        </div>
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={frame.step}
          onChange={(e) => go(Number(e.target.value))}
          aria-label="Step"
          aria-valuetext={`Step ${frame.step} of ${last}: ${title}`}
          style={{ "--progress": percent(frame.step) } as CSSProperties}
        />
        {hover && hovered && (
          <span className="scrub-tag" style={{ left: hover.x, transform: `translateX(${tagShift(hover.x, hover.width)})` }}>
            {hovered.step} · {describe(run, hovered).title}
          </span>
        )}
      </div>

      {/* Below the controls, so the buttons never shift as the text changes length. */}
      <div className="narration" aria-live={playing ? "off" : "polite"}>
        <h2 key={`t${frame.step}`}>{title}</h2>
        <p key={`p${frame.step}`}>{text}</p>
      </div>
    </section>
  );
}
