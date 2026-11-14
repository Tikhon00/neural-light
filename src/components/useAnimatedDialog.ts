import { useLayoutEffect, useRef, useState, type RefObject } from "react";

const easing = "cubic-bezier(.2,.85,.25,1)";
const openers = new WeakMap<HTMLDialogElement, HTMLElement>();

/** Keep a native dialog and its focus trap alive until the exit finishes. */
export function useAnimatedDialog<T extends string>(
  ref: RefObject<HTMLDialogElement | null>,
  requested: T | null,
) {
  const [presented, setPresented] = useState(requested);
  if (requested !== null && requested !== presented) setPresented(requested);
  const previous = useRef<T | null>(null);
  const bounds = useRef<DOMRect | null>(null);
  const generation = useRef(0);
  const animations = useRef<Animation[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const revision = ++generation.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = matchMedia("(max-width: 700px)").matches;
    const changing =
      requested !== null &&
      previous.current !== null &&
      previous.current !== requested;
    const currentOpacity = getComputedStyle(el).opacity;
    const currentTransform = getComputedStyle(el).transform;
    const interrupted = animations.current.some(
      (a) => a.playState === "running",
    );
    animations.current.forEach((a) => a.cancel());
    animations.current = [];

    const finishClose = () => {
      if (revision !== generation.current) return;
      // Closing an outgoing sheet must not steal focus from an incoming dialog.
      const focused = document.activeElement as HTMLElement | null;
      const otherDialog = focused?.closest("dialog[open]");
      el.close();
      if (otherDialog && otherDialog !== el && focused?.isConnected)
        focused.focus({ preventScroll: true });
      else {
        const opener = openers.get(el);
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      }
      delete el.dataset.motion;
      bounds.current = null;
      setPresented(null);
    };
    const run = (
      target: Element,
      frames: Keyframe[],
      duration: number,
      done?: () => void,
    ) => {
      const animation = target.animate(frames, {
        duration,
        easing,
        fill: "both",
      });
      animations.current.push(animation);
      animation.onfinish = () => {
        if (revision !== generation.current) return;
        done?.();
        animation.cancel();
        if (el.open) bounds.current = el.getBoundingClientRect();
      };
      return animation;
    };

    if (requested !== null) {
      const wasOpen = el.open;
      if (!wasOpen) {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement) {
          const parent = focused.closest<HTMLDialogElement>("dialog[open]");
          openers.set(el, (parent && openers.get(parent)) || focused);
        }
        el.showModal();
        el.querySelector<HTMLElement>("[data-dialog-autofocus]")?.focus({
          preventScroll: true,
        });
      }
      const next = el.getBoundingClientRect();
      if (reduced.matches) {
        el.dataset.motion = "open";
      } else if (changing && bounds.current) {
        const old = bounds.current;
        el.dataset.motion = "open";
        run(
          el,
          [
            {
              transformOrigin: "top left",
              transform: `translate(${old.x - next.x}px, ${old.y - next.y}px) scale(${old.width / next.width}, ${old.height / next.height})`,
            },
            { transformOrigin: "top left", transform: "none" },
          ],
          300,
        );
        const content = el.querySelector(".sheet-surface");
        if (content)
          run(
            content,
            [{ opacity: 0 }, { opacity: 1, offset: 0.8 }, { opacity: 1 }],
            280,
          );
      } else if (!wasOpen || interrupted) {
        el.dataset.motion = "opening";
        run(
          el,
          [
            {
              opacity: wasOpen ? currentOpacity : 0,
              transform: wasOpen
                ? currentTransform
                : `translateY(${narrow ? 28 : 12}px) scale(${narrow ? 0.985 : 0.965})`,
            },
            { opacity: 1, transform: "none" },
          ],
          narrow ? 360 : 320,
          () => {
            el.dataset.motion = "open";
          },
        );
      }
      if (changing) {
        // Navigation and focus must behave identically with Reduce Motion enabled.
        el.scrollTop = 0;
        el.querySelector<HTMLElement>(".sheet-heading button")?.focus({
          preventScroll: true,
        });
      }
      bounds.current = next;
    } else if (el.open) {
      if (reduced.matches) finishClose();
      else {
        el.dataset.motion = "closing";
        run(
          el,
          [
            { opacity: currentOpacity, transform: currentTransform },
            {
              opacity: 0,
              transform: `translateY(${narrow ? 20 : 8}px) scale(.98)`,
            },
          ],
          180,
          finishClose,
        );
      }
    }
    previous.current = requested;
    const settle = () => {
      if (reduced.matches)
        animations.current.forEach((a) => {
          if (a.playState === "running") a.finish();
        });
    };
    reduced.addEventListener("change", settle);
    return () => reduced.removeEventListener("change", settle);
  }, [requested, ref]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (el.open && !animations.current.some((a) => a.playState === "running"))
        bounds.current = el.getBoundingClientRect();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      generation.current++;
      animations.current.forEach((a) => a.cancel());
      el.close();
    };
  }, [ref]);
  return presented;
}
