import { useEffect, useRef } from "react";

// What the reticle locks onto. The scrubber is left out: it has its own label.
const TARGETS = "[data-tip], button, a";
const PAD = 4; // px of air between a target and the brackets
const SIZE = 20; // px, the reticle while it follows the pointer

// A reticle pointer (after React Bits' Target Cursor): four corner brackets that
// follow the pointer and snap around whatever you point at, naming it when it
// has a `data-tip` or `aria-label`. Text fields keep the I-beam; touch screens
// and reduced motion keep the system cursor.
export function TargetCursor() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const root = document.documentElement;
    const reticle = ref.current!;
    const label = reticle.querySelector<HTMLElement>(".reticle-label")!;
    root.classList.add("target-cursor");

    let x = 0;
    let y = 0;
    let shown = false;
    let target: HTMLElement | null = null;
    let labelWidth = 0;
    let frame = 0;

    // Placed by its centre, so it grows and shrinks around the pointer.
    function place(cx: number, cy: number, width: number, height: number) {
      reticle.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%)`;
      reticle.style.width = `${width}px`;
      reticle.style.height = `${height}px`;
    }

    // Runs every frame while the pointer is on the page, so a target that moves
    // (a scrolling page, a reflowing row) keeps its brackets.
    function render() {
      const appearing = shown && !reticle.classList.contains("on");
      reticle.classList.toggle("on", shown);
      if (!shown) {
        frame = 0;
        return;
      }
      // The target was removed (a button that switches the view, say): look again under the pointer.
      if (target && !target.isConnected) target = document.elementFromPoint(x, y)?.closest<HTMLElement>(TARGETS) ?? null;
      if (target) {
        const box = target.getBoundingClientRect();
        place(box.left + box.width / 2, box.top + box.height / 2, box.width + 2 * PAD, box.height + 2 * PAD);
        const text = target.dataset.tip ?? target.getAttribute("aria-label") ?? "";
        if (label.textContent !== text) {
          label.textContent = text;
          labelWidth = label.offsetWidth; // measured only when it changes, not every frame
        }
        reticle.classList.add("locked");
        reticle.classList.toggle("labelled", Boolean(text));
        reticle.classList.toggle("flip", box.left - PAD + labelWidth > innerWidth - 8);
      } else {
        place(x, y, SIZE, SIZE);
        reticle.classList.remove("locked", "labelled");
      }
      // Coming back onto the page: start where the pointer is rather than gliding in.
      if (appearing) for (const t of reticle.getAnimations()) t.finish();
      frame = requestAnimationFrame(render);
    }

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      x = e.clientX;
      y = e.clientY;
      const el = e.target as Element;
      shown = !el.closest?.("input:not([type='range']), textarea"); // the I-beam takes over in text fields
      target = el.closest?.<HTMLElement>(TARGETS) ?? null;
      if (!frame) frame = requestAnimationFrame(render);
    }
    function onLeave(e: MouseEvent) {
      if (!e.relatedTarget) shown = false;
    }

    addEventListener("pointermove", onMove);
    document.addEventListener("mouseout", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      root.classList.remove("target-cursor");
      removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return (
    <div ref={ref} className="reticle" aria-hidden="true">
      <div className="reticle-corners">
        <i />
        <i />
        <i />
        <i />
      </div>
      <i className="reticle-dot" />
      <span className="reticle-label" />
    </div>
  );
}
