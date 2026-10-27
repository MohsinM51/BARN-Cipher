import { useEffect, useRef } from "react";

// A small label that rides beside the normal mouse pointer and names whatever
// it's over: a bit's position and partner, a key element, a button and its
// shortcut (read from `data-tip`). Mouse and trackpad only.
export function PointerLabel() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!matchMedia("(pointer: fine)").matches) return;
    const tag = ref.current!;
    let label = "";

    function onMove(e: PointerEvent) {
      if (e.pointerType !== "mouse") return;
      tag.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 18}px)`;
      const el = e.target as Element;
      const text = el.closest?.("input, textarea") ? "" : (el.closest?.<HTMLElement>("[data-tip]")?.dataset.tip ?? "");
      if (text === label) return;
      label = text;
      if (text) tag.textContent = text; // keep the old text while it fades out
      tag.classList.toggle("on", Boolean(text));
    }
    function onLeave(e: MouseEvent) {
      if (!e.relatedTarget) tag.classList.remove("on");
    }

    addEventListener("pointermove", onMove);
    document.addEventListener("mouseout", onLeave);
    return () => {
      removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);

  return <div ref={ref} className="pointer-label" aria-hidden="true" />;
}
