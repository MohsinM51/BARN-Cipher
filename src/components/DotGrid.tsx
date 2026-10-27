import { useEffect, useRef } from "react";

const SPACING = 24; // px between dots
const BASE = 0.85; // resting radius
const BOOST = 2; // extra radius right under the pointer
const REACH = 150; // px over which the pointer is felt
const INK = [27, 26, 23, 0.16];
const BLUE = [29, 63, 214, 0.55];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inkAt = (t: number) => `rgba(${INK.map((v, i) => (i < 3 ? Math.round(lerp(v, BLUE[i], t)) : lerp(v, BLUE[i], t))).join(",")})`;

// Dotted graph paper behind the page, offset by the scroll position so it moves
// like print on the page. Near the pointer the dots swell and take on blue ink
// (after the interactive dot grids by Rob Crocker and sathishk-dev). It stays
// still on touch screens and when reduced motion is requested.
export function DotGrid() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const live = matchMedia("(pointer: fine)").matches && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    const target = { x: 0, y: 0 };
    const pointer = { x: 0, y: 0 }; // eased toward target
    let presence = 0; // 0 → 1 as the pointer arrives, back to 0 when it leaves
    let present = 0;
    let frame = 0;

    function draw() {
      ctx.clearRect(0, 0, width, height);
      const top = SPACING / 2 - (scrollY % SPACING);
      const near: number[] = []; // x, y, strength for dots the pointer reaches

      ctx.fillStyle = inkAt(0);
      ctx.beginPath();
      for (let y = top; y < height + SPACING; y += SPACING) {
        for (let x = SPACING / 2; x < width; x += SPACING) {
          const d = Math.hypot(x - pointer.x, y - pointer.y);
          const t = presence * Math.max(0, 1 - d / REACH) ** 2;
          if (t > 0.02) {
            near.push(x, y, t);
            continue;
          }
          ctx.moveTo(x + BASE, y);
          ctx.arc(x, y, BASE, 0, Math.PI * 2);
        }
      }
      ctx.fill();

      for (let n = 0; n < near.length; n += 3) {
        ctx.fillStyle = inkAt(near[n + 2]);
        ctx.beginPath();
        ctx.arc(near[n], near[n + 1], BASE + BOOST * near[n + 2], 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function tick() {
      pointer.x += (target.x - pointer.x) * 0.2;
      pointer.y += (target.y - pointer.y) * 0.2;
      presence += (present - presence) * 0.12;
      draw();
      const settled =
        Math.abs(target.x - pointer.x) < 0.5 && Math.abs(target.y - pointer.y) < 0.5 && Math.abs(present - presence) < 0.005;
      frame = settled ? 0 : requestAnimationFrame(tick);
    }
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    function resize() {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      width = innerWidth;
      height = innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      if (!present) Object.assign(pointer, { x: e.clientX, y: e.clientY }); // arrive in place, no sweep
      Object.assign(target, { x: e.clientX, y: e.clientY });
      present = 1;
      wake();
    }
    function onLeave(e: MouseEvent) {
      if (e.relatedTarget) return; // still inside the window
      present = 0;
      wake();
    }
    const onScroll = () => (live ? wake() : draw());

    resize();
    addEventListener("resize", resize);
    addEventListener("scroll", onScroll, { passive: true });
    if (live) {
      addEventListener("pointermove", onMove);
      document.addEventListener("mouseout", onLeave);
    }
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("resize", resize);
      removeEventListener("scroll", onScroll);
      removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return <canvas ref={ref} className="dot-grid" aria-hidden="true" />;
}
