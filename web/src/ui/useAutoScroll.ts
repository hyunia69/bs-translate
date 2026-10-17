import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const NEAR_BOTTOM_PX = 120;

export interface AutoScrollRefs<C extends HTMLElement, I extends HTMLElement> {
  /** The scrolling container (overflow-y: auto). */
  containerRef: RefObject<C | null>;
  /** Its single content wrapper, observed for size changes. */
  contentRef: RefObject<I | null>;
}

/**
 * Stick-to-bottom scrolling for a log-like list.
 * - A new item (itemKey changes, including the first render) always scrolls to the bottom.
 * - While the user is at the bottom, content growth (streaming text, font-scale change) and
 *   container resizes (banner, keyboard) keep the newest item in view.
 * - Once the user scrolls up more than NEAR_BOTTOM_PX, nothing moves until a new item arrives.
 */
export function useAutoScroll<C extends HTMLElement, I extends HTMLElement>(itemKey: string | number): AutoScrollRefs<C, I> {
  const containerRef = useRef<C>(null);
  const contentRef = useRef<I>(null);
  const pinned = useRef(true);
  const lastItem = useRef<string | number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
    });
    ro.observe(content);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || itemKey === lastItem.current) return;
    lastItem.current = itemKey;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "instant" });
  }, [itemKey]);

  return { containerRef, contentRef };
}
