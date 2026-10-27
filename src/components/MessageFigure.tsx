import { memo, useMemo, type Ref } from "react";
import { hex, quote, segments, type Frame, type Run } from "../lib/timeline.ts";
import { cls } from "./cls.ts";

interface Props {
  ref: Ref<HTMLDivElement>;
  run: Run;
  frame: Frame;
  linked: number;
  onLink: (j: number) => void;
}

const MessageBit = memo(function MessageBit(props: {
  j: number;
  value: number | null;
  used: boolean;
  current: boolean;
  linked: boolean;
}) {
  const { j, value, used, current, linked } = props;
  return (
    <span className={cls("mbit", used && "used", current && "current", linked && "linked")} data-j={j}>
      <span className="d">{value ?? ""}</span>
    </span>
  );
});

// Fig. 1: the message's bits, grouped by character and byte.
export function MessageFigure({ ref, run, frame, linked, onLink }: Props) {
  const groups = useMemo(() => segments(run), [run]);
  const reading = run.mode === "decrypt";
  const current = frame.hop?.j ?? -1;
  // When decrypting, bits, bytes and characters only appear once they've been read.
  const shown = (lastBit: number) => !reading || lastBit < frame.count;

  return (
    <figure className="fig">
      <div
        ref={ref}
        className="message"
        onMouseOver={(e) => onLink(Number((e.target as HTMLElement).closest<HTMLElement>(".mbit")?.dataset.j ?? -1))}
        onMouseLeave={() => onLink(-1)}
      >
        {groups.map((group) => (
          <div className="seg" key={group.first}>
            <span className="glyph" data-last={group.first + group.bits - 1}>
              {shown(group.first + group.bits - 1) ? group.text : ""}
            </span>
            <div className="seg-bytes">
              {Array.from({ length: Math.ceil(group.bits / 8) }, (_, b) => {
                const first = group.first + b * 8;
                const width = Math.min(8, group.bits - b * 8);
                return (
                  <div className="byte" key={first}>
                    <div className="octet">
                      {Array.from({ length: width }, (_, k) => {
                        const j = first + k;
                        return (
                          <MessageBit
                            key={j}
                            j={j}
                            value={shown(j) ? run.bits[j] : null}
                            used={!reading && j < frame.count}
                            current={j === current}
                            linked={j === linked}
                          />
                        );
                      })}
                    </div>
                    <span className="hex" data-last={first + 7}>
                      {width === 8 && shown(first + 7) ? hex(group.bytes[b]) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <figcaption>
        <b>Fig. 1.</b>{" "}
        {reading
          ? `Recovered message M: ${run.bits.length} bits read from the cipher, decoded as UTF-8 as each byte completes.`
          : `Message M: ${quote(run.text)} as ${run.bytes.length} bytes of UTF-8, μ = ${run.bits.length} bits.`}
      </figcaption>
    </figure>
  );
}
