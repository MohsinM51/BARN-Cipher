import { useEffect, useRef } from "react";

const REST = -22; // degrees: the arrow's tilt when the pointer is still, like a system cursor

// A pointer for mouse and trackpad. The ink arrow turns toward where it's
// heading and settles back when you stop (after React Bits' Gyroscope Cursor),
// and carries a small label for whatever it's over (after their User Cursor):
// a bit's position and partner, a key element, a button and its shortcut.
// Text fields keep the normal I-beam; touch screens and reduced motion keep
// the system cursor.
export function Cursor() {
  const arrowRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const arrow = arrowRef.current!;
    const tag = tagRef.current!;
    root.classList.add("custom-cursor");

    let x = 0;
    let y = 0;
    let seen = false;
    let tagX = 0; // the label trails the arrow slightly
    let tagY = 0;
    let vx = 0; // smoothed velocity, so the heading doesn't jitter
    let vy = 0;
    let angle = REST;
    let lastMove = 0;
    let pressed = 0;
    let press = 0; // eased toward `pressed`
    let label = "";
    let frame = 0;

    function tick(now: number) {
      const moving = now - lastMove < 120 && Math.hypot(vx, vy) > 1.2;
      const heading = moving ? (Math.atan2(vy, vx) * 180) / Math.PI + 90 : REST;
      const turn = ((heading - angle + 540) % 360) - 180; // the short way round
      angle = ((angle + turn * 0.18 + 540) % 360) - 180; // kept within ±180°
      tagX += (x - tagX) * 0.3;
      tagY += (y - tagY) * 0.3;
      press += (pressed - press) * 0.35;
      arrow.style.transform = `translate(${x}px, ${y}px) rotate(${angle}deg) scale(${1 - press * 0.15})`;
      tag.style.transform = `translate(${tagX + 16}px, ${tagY + 20}px)`;
      const settled =
        !moving && Math.abs(turn) < 0.3 && Math.hypot(x - tagX, y - tagY) < 0.3 && Math.abs(pressed - press) < 0.01;
      frame = settled ? 0 : requestAnimationFrame(tick);
    }
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      if (!seen) {
        // First appearance: start in place instead of sweeping in from the corner.
        x = tagX = e.clientX;
        y = tagY = e.clientY;
        seen = true;
      }
      vx = vx * 0.6 + (e.clientX - x) * 0.4;
      vy = vy * 0.6 + (e.clientY - y) * 0.4;
      x = e.clientX;
      y = e.clientY;
      lastMove = performance.now();

      const el = e.target as Element;
      root.classList.toggle("cursor-text", Boolean(el.closest?.("input:not([type='range']), textarea")));
      const text = el.closest?.<HTMLElement>("[data-tip]")?.dataset.tip ?? "";
      if (text !== label) {
        label = text;
        if (text) tag.textContent = text; // keep the old text while it fades out
        tag.classList.toggle("on", Boolean(text));
      }
      root.classList.add("cursor-in");
      wake();
    }
    function onLeave(e: MouseEvent) {
      if (!e.relatedTarget) root.classList.remove("cursor-in");
    }
    function onDown() {
      pressed = 1;
      wake();
    }
    function onUp() {
      pressed = 0;
      wake();
    }

    addEventListener("pointermove", onMove);
    addEventListener("pointerdown", onDown);
    addEventListener("pointerup", onUp);
    document.addEventListener("mouseout", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove("custom-cursor", "cursor-in", "cursor-text");
      removeEventListener("pointermove", onMove);
      removeEventListener("pointerdown", onDown);
      removeEventListener("pointerup", onUp);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return (
    <>
      <div ref={arrowRef} className="cursor" aria-hidden="true">
        <svg viewBox="-8 -1 16 20">
          <path d="M0 0 7 17.5 0 13 -7 17.5Z" />
        </svg>
      </div>
      <div ref={tagRef} className="cursor-tag" aria-hidden="true" />
    </>
  );
}
