import { memo, useLayoutEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
import { bitsToBytes } from "../lib/barn.ts";
import { cellCentre, cellLeft, columnsFor, dimensions, type Grid, type Span } from "../lib/drawing.ts";
import { cellAt, hex, plural, sub, type Frame, type Run } from "../lib/timeline.ts";
import { cls } from "./cls.ts";

const GAP = 4; // px between cells
const BYTE_GAP = 10; // extra px between bytes
const LANE = 30; // height of the dimension lane above each row
const LINE_Y = 15; // where dimension lines sit in the lane

interface Props {
  ref: RefObject<HTMLDivElement | null>;
  run: Run;
  frame: Frame;
  linked: number;
  onLink: (j: number) => void;
}

const StreamCell = memo(function StreamCell(props: {
  i: number;
  j: number;
  bit: number | null;
  marked: boolean;
  current: boolean;
  linked: boolean;
  delay: number;
  tip: string;
}) {
  const { i, j, bit, marked, current, linked, delay, tip } = props;
  return (
    <span
      className={cls("cell", marked && "marked", current && "current", linked && "linked", bit === null && "blank", j !== -1 && "planned")}
      data-i={i}
      data-j={j === -1 ? undefined : j}
      data-tip={tip}
      style={{ "--d": `${delay}ms` } as CSSProperties}
    >
      <span className="d">{bit ?? ""}</span>
    </span>
  );
});

interface LaneProps {
  run: Run;
  start: number; // the row's first cell
  cells: number; // how many cells the row has
  dims: Span[];
  current: number; // j of the skip being drawn now, if it's in this row
  bytes: number[] | null; // while the stream is drawn: the random bytes, to label the row's groups of eight
  perByte: number; // ms between bytes printing in
  grid: Grid;
}

// The lane above one row: a chain of dimension lines, one per skip that crosses
// the row (the one in progress in yellow), or the random bytes while they're drawn.
const Lane = memo(
  function Lane({ start, cells, dims, current, bytes, perByte, grid }: LaneProps) {
    const width = cellLeft(cells - 1, grid) + grid.size;
    const byteWidth = 8 * grid.size + 7 * grid.gap;
    // Only whole bytes are labelled: a stream that isn't a multiple of 8 ends partway through one.
    const labels = bytes ? Array.from({ length: Math.ceil(cells / 8) }, (_, k) => start / 8 + k).filter((b) => b < bytes.length) : [];
    return (
      <svg className="lane" width={width} height={LANE} aria-hidden="true">
        {labels.map((b, k) => (
          <text
            key={b}
            className="byte-label"
            x={cellLeft(k * 8, grid) + byteWidth / 2}
            y={LANE - 9}
            textAnchor="middle"
            style={{ "--d": `${Math.round(b * perByte)}ms` } as CSSProperties}
          >
            {hex(bytes![b])}
          </text>
        ))}
        {dims.map((d) => {
          const x1 = d.from === null ? 0 : cellCentre(d.from, grid);
          const x2 = d.to === null ? width : cellCentre(d.to, grid);
          return (
            <g key={d.j} className={cls("dim", d.j === current && "current")}>
              <line className="dim-line" x1={x1} y1={LINE_Y} x2={x2} y2={LINE_Y} />
              {d.end && (
                <>
                  <line className="dim-ext" x1={x2} y1={LANE} x2={x2} y2={LINE_Y - 6} />
                  <path className="dim-arrow" d={`M${x2} ${LINE_Y}l-6 -3v6z`} />
                  <text className="dim-label" x={(x1 + x2) / 2} y={LINE_Y - 4} textAnchor="middle">
                    {d.skip}
                  </text>
                </>
              )}
            </g>
          );
        })}
      </svg>
    );
  },
  // A row's dimensions only change when one is added to it or the current one moves.
  (a, b) =>
    a.run === b.run &&
    a.start === b.start &&
    a.cells === b.cells &&
    a.dims.length === b.dims.length &&
    a.current === b.current &&
    a.bytes === b.bytes &&
    a.grid === b.grid,
);

// What the pointer's label says about stream cell i.
function tipFor(run: Run, i: number, j: number, marked: boolean, blank: boolean) {
  const pos = `${run.mode === "encrypt" ? "P" : "C"}${sub(i + 1)}`;
  if (blank) return `${pos} · not drawn yet`;
  if (j === -1) return `${pos} · random filler`;
  const skip = `K${sub((j % run.key.length) + 1)} = ${run.key[j % run.key.length]}`;
  if (run.mode === "encrypt") return marked ? `${pos} = M${sub(j + 1)} · ${skip}` : `${pos} · M${sub(j + 1)} goes here`;
  return marked ? `${pos} → M${sub(j + 1)} · ${skip}` : `${pos} · M${sub(j + 1)} is read here`;
}

// Whole bytes per row, as many as fit; the cell size comes from CSS (smaller on phones).
function useLayout(ref: RefObject<HTMLDivElement | null>) {
  const [layout, setLayout] = useState<{ cols: number; grid: Grid }>({ cols: 24, grid: { size: 30, gap: GAP, byteGap: BYTE_GAP } });
  useLayoutEffect(() => {
    const box = ref.current!;
    const measure = () => {
      const size = parseFloat(getComputedStyle(box).getPropertyValue("--cell")) || 30;
      const gutter = 48; // the row-number column
      const cols = columnsFor(box.clientWidth - gutter, { size, gap: GAP, byteGap: BYTE_GAP });
      setLayout((prev) => (prev.cols === cols && prev.grid.size === size ? prev : { cols, grid: { size, gap: GAP, byteGap: BYTE_GAP } }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [ref]);
  return layout;
}

// Fig. 3: the random stream becoming the cipher (or the cipher being read).
export function StreamFigure({ ref, run, frame, linked, onLink }: Props) {
  const { cols, grid } = useLayout(ref);
  const length = run.cipher.length;
  const blank = run.mode === "encrypt" && frame.phase === "message"; // no random bits drawn yet
  const current = frame.hop ? frame.hop.to - 1 : -1;
  // While the stream is drawn, each group of eight is one random byte: show its value.
  const randomBytes = useMemo(() => (run.mode === "encrypt" ? bitsToBytes(run.random) : null), [run]);
  // Printing in: bytes arrive in order and each unpacks its bits left to right.
  const perByte = Math.min(70, 650 / Math.ceil(length / 8));

  const byRow = useMemo(() => {
    const rows = new Map<number, Span[]>();
    for (const d of dimensions(run.positions, run.key, frame.count, cols)) {
      if (!rows.has(d.row)) rows.set(d.row, []);
      rows.get(d.row)!.push(d);
    }
    return rows;
  }, [run, frame.count, cols]);

  const rows = [];
  for (let start = 0, r = 0; start < length; start += cols, r++) {
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
            current={i === current}
            linked={j !== -1 && j === linked}
            delay={Math.round((o / 8) * perByte + (i - o) * 18)}
            tip={tipFor(run, i, j, marked, blank)}
          />,
        );
      }
      octets.push(
        <div className="octet" key={o}>
          {cells}
        </div>,
      );
    }
    const dims = byRow.get(r) ?? [];
    rows.push(
      <div className="row" key={start}>
        <span className="offset">{start + 1}</span>
        <div className="row-body">
          <Lane
            run={run}
            start={start}
            cells={end - start}
            dims={dims}
            current={frame.hop && dims.some((d) => d.j === frame.hop!.j) ? frame.hop.j : -1}
            bytes={frame.phase === "stream" ? randomBytes : null}
            perByte={perByte}
            grid={grid}
          />
          <div className="cells">{octets}</div>
        </div>
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
          ? `Random stream P becoming cipher C · ${plural(length, "bit")} in groups of eight, one random byte each. Filled cells carry the message; each dimension is the skip that reached them.`
          : `Cipher C · ${plural(length, "bit")}. Filled cells are read back as the message; each dimension is the skip that reached them.`}
      </figcaption>
    </figure>
  );
}
