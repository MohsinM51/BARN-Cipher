import { memo, useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { cellAt, type Frame, type Run } from "../lib/timeline.ts";
import { cls } from "./cls.ts";

interface Props {
  ref: RefObject<HTMLDivElement | null>;
  run: Run;
  frame: Frame;
  linked: number;
  onLink: (j: number) => void;
}

// A fixed pseudo-random delay per cell, so the stream "prints" in a scattered order.
const printDelay = (i: number) => (Math.imul(i + 1, 2654435761) >>> 0) % 520;

const StreamCell = memo(function StreamCell(props: {
  i: number;
  j: number;
  bit: number | null;
  marked: boolean;
  skip: number | null;
  current: boolean;
  linked: boolean;
}) {
  const { i, j, bit, marked, skip, current, linked } = props;
  return (
    <span
      className={cls("cell", marked && "marked", current && "current", linked && "linked", j !== -1 && "planned")}
      data-i={i}
      data-j={j === -1 ? undefined : j}
      style={{ "--d": `${printDelay(i)}ms` } as CSSProperties}
    >
      <span className="d">{bit ?? ""}</span>
      <span className="skip">{skip ?? ""}</span>
    </span>
  );
});

// Whole octets per row, as many as fit the container's width.
function useColumns(ref: RefObject<HTMLDivElement | null>) {
  const [cols, setCols] = useState(32);
  useLayoutEffect(() => {
    const box = ref.current!;
    const measure = () => {
      const cell = parseFloat(getComputedStyle(box).getPropertyValue("--cell")) || 28;
      const octet = 8 * cell + 7 + 2 + 4; // 8 cells, 7 rules between them, 2 border px, 4px gap
      const gutter = 48; // the row-number column
      setCols(8 * Math.max(1, Math.floor((box.clientWidth - gutter + 4) / octet)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return cols;
}

// Fig. 3: the random stream becoming the cipher (or the cipher being read).
export function StreamFigure({ ref, run, frame, linked, onLink }: Props) {
  const cols = useColumns(ref);
  const length = run.cipher.length;
  const blank = run.mode === "encrypt" && frame.phase === "message"; // no random bits drawn yet
  const current = frame.hop ? frame.hop.to - 1 : -1;

  const rows = [];
  for (let start = 0; start < length; start += cols) {
    const end = Math.min(start + cols, length);
    const octets = [];
    for (let o = start; o < end; o += 8) {
      const cells = [];
      for (let i = o; i < Math.min(o + 8, end); i++) {
        const { bit, marked, j } = cellAt(run, frame, i);
        cells.push(
          <StreamCell
            key={i}
            i={i}
            j={j}
            bit={blank ? null : bit}
            marked={marked}
            skip={marked ? run.key[j % run.key.length] : null}
            current={i === current}
            linked={j !== -1 && j === linked}
          />,
        );
      }
      octets.push(
        <div className="octet" key={o}>
          {cells}
        </div>,
      );
    }
    rows.push(
      <div className="row" key={start}>
        <span className="offset">{start + 1}</span>
        <div className="cells">{octets}</div>
      </div>,
    );
  }

  return (
    <figure className="fig">
      <div
        ref={ref}
        className="stream"
        onMouseOver={(e) => onLink(Number((e.target as HTMLElement).closest<HTMLElement>(".planned")?.dataset.j ?? -1))}
        onMouseLeave={() => onLink(-1)}
      >
        {rows}
        {/* Scratch layer for animation overlays; React never renders into it. */}
        <div className="fx" aria-hidden="true" />
      </div>
      <figcaption>
        <b>Fig. 3.</b>{" "}
        {run.mode === "encrypt"
          ? `Random stream P becoming cipher C, ${length} bits. Blue bits carry the message; the number under each is the skip that reached it.`
          : `Cipher C, ${length} bits. Blue bits are read back as the message; the number under each is the skip that reached it.`}{" "}
        Point at a bit to see its partner in Fig. 1.
      </figcaption>
    </figure>
  );
}
