/*
 * Step animations. React renders the finished state of every step; these only
 * decorate the change from one step to the next: the head counting out a
 * skip, a bit flying between figures, ink pressed into a cell. Stopping one
 * halfway therefore can't leave anything stale on screen.
 */
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { frameAt, type Frame, type Hop, type Run } from "./lib/timeline.ts";

const LAND = 0.85; // fraction of the walk after which the head has reached its cell
const GHOST = 28; // size of a flying bit, px

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// Everything one step starts, so it can all be stopped together.
interface Scene {
  message: HTMLElement;
  stream: HTMLElement;
  fx: HTMLElement; // overlay layer inside the stream figure
  ms: (base: number) => number; // scales a 1× duration by the playback speed
  animations: Animation[];
  cleanups: (() => void)[];
}

function stop(scene: Scene) {
  scene.animations.forEach((a) => a.cancel());
  scene.cleanups.forEach((fn) => fn());
}

function animate(scene: Scene, el: Element | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  if (!el) return;
  const animation = el.animate(keyframes, options);
  scene.animations.push(animation);
  return animation;
}

// A throwaway element that disappears when its animation ends or the step is stopped.
function overlay(scene: Scene, className: string, text = "", parent: HTMLElement = scene.fx) {
  const node = document.createElement("span");
  node.className = className;
  node.textContent = text;
  parent.append(node);
  scene.cleanups.push(() => node.remove());
  return node;
}

const cellEl = (scene: Scene, i: number) => scene.stream.querySelector<HTMLElement>(`.cell[data-i="${i}"]`)!;
const bitEl = (scene: Scene, j: number) => scene.message.querySelector<HTMLElement>(`.mbit[data-j="${j}"]`)!;
const placeAt = (el: HTMLElement) => `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;

// The head counts out the skip one cell at a time, with pencil numerals, then rests on its target.
function walk(scene: Scene, hop: Hop, duration: number) {
  const from = hop.from - 1; // 0-based; -1 is "before the stream"
  const target = cellEl(scene, hop.to - 1);
  const walker = overlay(scene, "walker");
  const frames: Keyframe[] = [];
  for (let c = 0; c <= hop.skip; c++) {
    const i = from + c;
    frames.push({ transform: placeAt(cellEl(scene, Math.max(i, 0))), opacity: i < 0 ? 0 : 1, offset: (c / hop.skip) * LAND, easing: "steps(1, end)" });
  }
  frames.push({ transform: placeAt(target), opacity: 1, offset: 1 });
  animate(scene, walker, frames, { duration, fill: "forwards" })!.onfinish = () => walker.remove();

  // The target's own ring would give the answer away before the head arrives.
  animate(scene, target, [{ boxShadow: "none" }, { boxShadow: "none" }], { duration: duration * LAND });

  if (hop.skip > 16) return;
  for (let c = 1; c <= hop.skip; c++) {
    const cell = cellEl(scene, from + c);
    const mark = overlay(scene, "count-mark", String(c));
    mark.style.transform = `translate(${cell.offsetLeft}px, ${cell.offsetTop - 17}px)`;
    animate(scene, mark, [{ opacity: 0 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], {
      duration: scene.ms(560),
      delay: (c / hop.skip) * duration * LAND,
      fill: "backwards",
    });
  }
}

// A copy of a bit travels in an arc from one element to another.
function fly(scene: Scene, from: HTMLElement, to: HTMLElement, text: string, duration: number, delay = 0) {
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const [ax, ay, bx, by] = [a.left + a.width / 2, a.top + a.height / 2, b.left + b.width / 2, b.top + b.height / 2];
  const at = (x: number, y: number, scale = 1) =>
    `translate(${x + scrollX - GHOST / 2}px, ${y + scrollY - GHOST / 2}px) scale(${scale})`;
  const lift = Math.min(70, 24 + Math.abs(bx - ax) / 5);

  const ghost = overlay(scene, "ghost", text, document.body);
  animate(
    scene,
    ghost,
    [
      { transform: at(ax, ay, 0.9), opacity: 0 },
      { transform: at(ax, ay - 6, 1.2), opacity: 1, offset: 0.15 },
      { transform: at((ax + bx) / 2, Math.min(ay, by) - lift, 1.2), offset: 0.55 },
      { transform: at(bx, by), opacity: 1, offset: 0.96 },
      { transform: at(bx, by), opacity: 0 },
    ],
    { duration, delay, easing: "cubic-bezier(.45,0,.25,1)", fill: "both" },
  )!.onfinish = () => ghost.remove();
}

// Ink pressed into place: the digit lands large and soft, then settles.
function stamp(scene: Scene, el: Element | null, delay: number, duration = scene.ms(300)) {
  animate(
    scene,
    el,
    [
      { transform: "scale(1.9)", opacity: 0, filter: "blur(1.5px)" },
      { transform: "scale(0.92)", opacity: 1, filter: "blur(0)", offset: 0.65 },
      { transform: "scale(1)", opacity: 1, filter: "blur(0)" },
    ],
    { duration, delay, easing: "cubic-bezier(.2,.8,.3,1)", fill: "backwards" },
  );
}

// The paper soaks up a little ink around a freshly written cell.
function soak(scene: Scene, cell: HTMLElement, delay: number) {
  animate(scene, cell, [{ backgroundColor: cssVar("--soak") }, { backgroundColor: cssVar("--paper") }], {
    duration: scene.ms(700),
    delay,
    easing: "ease-out",
  });
}

function fadeIn(scene: Scene, el: Element | null, delay: number, duration = scene.ms(220)) {
  animate(scene, el, [{ opacity: 0 }, { opacity: 1 }], { duration, delay, fill: "backwards" });
}

// Encrypting: random bits print in all over the stream (step 0 → 1).
function printStream(scene: Scene) {
  const { stream } = scene;
  stream.style.setProperty("--k", String(scene.ms(1)));
  stream.classList.add("printing");
  const timer = setTimeout(() => stream.classList.remove("printing"), scene.ms(950));
  scene.cleanups.push(() => {
    clearTimeout(timer);
    stream.classList.remove("printing");
  });
}

function forward(scene: Scene, run: Run, frame: Frame) {
  if (frame.phase === "stream") return printStream(scene);
  const hop = frame.hop;
  if (!hop) return;

  const target = cellEl(scene, hop.to - 1);
  const walkMs = scene.ms(Math.min(Math.max(hop.skip * 90, 300), 560));
  const land = walkMs * LAND;
  walk(scene, hop, walkMs);
  fadeIn(scene, target.querySelector(".skip"), land);
  soak(scene, target, land);

  if (run.mode === "encrypt") {
    // The message bit flies down; the old random bit shows until it's pressed over.
    fly(scene, bitEl(scene, hop.j), target, String(run.bits[hop.j]), land);
    const was = overlay(scene, "was", String(run.random[hop.to - 1]));
    was.style.transform = placeAt(target);
    animate(scene, was, [{ opacity: 1 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], { duration: land + scene.ms(60), fill: "forwards" });
    stamp(scene, target.querySelector(".d"), land);
    return;
  }

  // Decrypting: the read bit lifts out of the cipher into the message, then any
  // byte or character it completes is stamped in.
  const slot = bitEl(scene, hop.j);
  const flight = scene.ms(340);
  const ink = cssVar("--ink-2");
  animate(scene, target.querySelector(".d"), [{ color: ink }, { color: ink }], { duration: land });
  fly(scene, target, slot, String(run.bits[hop.j]), flight, land);
  stamp(scene, slot.querySelector(".d"), land + flight);
  const after = land + flight + scene.ms(120);
  stamp(scene, scene.message.querySelector(`.glyph[data-last="${hop.j}"]`), after, scene.ms(420));
  fadeIn(scene, scene.message.querySelector(`.hex[data-last="${hop.j}"]`), after);
}

// Stepping back: the bit goes home again.
function backward(scene: Scene, run: Run, left: Frame) {
  const hop = left.hop;
  if (!hop) return;
  const cell = cellEl(scene, hop.to - 1);
  const slot = bitEl(scene, hop.j);
  if (run.mode === "encrypt") {
    fly(scene, cell, slot, String(run.bits[hop.j]), scene.ms(340));
    fadeIn(scene, cell.querySelector(".d"), 0, scene.ms(300));
  } else {
    fly(scene, slot, cell, String(run.bits[hop.j]), scene.ms(340));
  }
}

export function useStepAnimation(
  run: Run,
  frame: Frame,
  speed: number,
  messageRef: RefObject<HTMLElement | null>,
  streamRef: RefObject<HTMLElement | null>,
) {
  const seen = useRef({ run, step: frame.step });

  // Keyed on the run and step only: re-renders for other reasons (hovering,
  // typing) mustn't cut a running animation short.
  useLayoutEffect(() => {
    const before = seen.current;
    seen.current = { run, step: frame.step };
    const message = messageRef.current;
    const stream = streamRef.current;
    if (!message || !stream || before.run !== run || reducedMotion()) return;

    const scene: Scene = {
      message,
      stream,
      fx: stream.querySelector<HTMLElement>(".fx")!,
      ms: (base) => base / speed,
      animations: [],
      cleanups: [],
    };
    if (frame.step === before.step + 1) forward(scene, run, frame);
    else if (frame.step === before.step - 1) backward(scene, run, frameAt(run, before.step));
    return () => stop(scene);
  }, [run, frame.step]);

  // Keep the head in view (clear of the sticky player) as it moves.
  useEffect(() => {
    const cell = frame.hop && streamRef.current?.querySelector<HTMLElement>(`.cell[data-i="${frame.hop.to - 1}"]`);
    if (!cell) return;
    const box = cell.getBoundingClientRect();
    const bottom = innerHeight - (document.querySelector<HTMLElement>(".player")?.offsetHeight ?? 0);
    if (box.top < 0 || box.bottom > bottom) {
      cell.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  }, [run, frame.step]);
}
