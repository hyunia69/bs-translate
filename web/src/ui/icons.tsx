import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement>;
const base: P = { viewBox: "0 0 24 24", width: 24, height: 24, "aria-hidden": true, focusable: false };

/** Material "settings" glyph. */
export function IconGear(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

/** Material "swap_vert" glyph: used for the one-hand / facing mode toggle. */
export function IconFlip(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M16 17.01V10h-2v7.01h-3L15 21l4-3.99h-3zM9 3 5 6.99h3V14h2V6.99h3L9 3z" />
    </svg>
  );
}

/** Material "volume_up" glyph: marks bubbles that have replayable audio. */
export function IconSpeaker(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
    </svg>
  );
}

/** Material "play_arrow" glyph: the "번역 시작하기" button. */
export function IconPlay(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

/** Material "stop" glyph: the "번역 중지" button. */
export function IconStop(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M6 6h12v12H6z" />
    </svg>
  );
}

/** Material "swap_horiz" glyph: the me <-> partner pair in the dual header. */
export function IconSwapH(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M6.99 11 3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z" />
    </svg>
  );
}

/** Material "logout" glyph: leave the dual lobby. */
export function IconLeave(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M17 7l-1.41 1.41L18.17 11H8v2h10.17l-2.58 2.58L17 17l5-5zM4 5h8V3H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h8v-2H4V5z" />
    </svg>
  );
}

/** Two strokes: close / dismiss. */
export function IconClose(p: P) {
  return (
    <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="square">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Filled warning triangle: failed turn. */
export function IconWarn(p: P) {
  return (
    <svg {...base} {...p} fill="currentColor">
      <path d="M12 2 1 21h22L12 2zm1 15h-2v-2h2v2zm0-4h-2V9h2v4z" />
    </svg>
  );
}

/** Phone with rotation arrows: landscape guard. */
export function IconRotate(p: P) {
  return (
    <svg {...base} {...p} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="7" y="2" width="10" height="20" rx="2" />
      <path d="M3 12a9 9 0 0 1 3-6.7M6 2v3.3H2.7" />
      <path d="M21 12a9 9 0 0 1-3 6.7M18 22v-3.3h3.3" />
    </svg>
  );
}
