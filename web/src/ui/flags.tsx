import type { HTMLAttributes, ReactElement } from "react";
import type { Lang } from "../types";

/*
 * Flags from lipis/flag-icons v7.3.2 (MIT License, https://github.com/lipis/flag-icons), 4x3 set,
 * inlined so they render identically on every Android/iOS build (no emoji, no network).
 * Each flag's internal ids are prefixed with its language so two flags on one screen never collide.
 */
const VIEW = { viewBox: "0 0 640 480", preserveAspectRatio: "xMidYMid slice", "aria-hidden": true, focusable: false } as const;

function FlagKR() {
  return (
    <svg {...VIEW}>
      <defs>
        <clipPath id="flag-ko-kr-a">
          <path fillOpacity=".7" d="M-95.8-.4h682.7v512H-95.8z" />
        </clipPath>
      </defs>
      <g fillRule="evenodd" clipPath="url(#flag-ko-kr-a)" transform="translate(89.8 .4)scale(.9375)">
        <path fill="#fff" d="M-95.8-.4H587v512H-95.8Z" />
        <g transform="rotate(-56.3 361.6 -101.3)scale(10.66667)">
          <g id="flag-ko-kr-c">
            <path id="flag-ko-kr-b" fill="#000001" d="M-6-26H6v2H-6Zm0 3H6v2H-6Zm0 3H6v2H-6Z" />
            <use href="#flag-ko-kr-b" width="100%" height="100%" y="44" />
          </g>
          <path stroke="#fff" d="M0 17v10" />
          <path fill="#cd2e3a" d="M0-12a12 12 0 0 1 0 24Z" />
          <path fill="#0047a0" d="M0-12a12 12 0 0 0 0 24A6 6 0 0 0 0 0Z" />
          <circle cy="-6" r="6" fill="#cd2e3a" />
        </g>
        <g transform="rotate(-123.7 191.2 62.2)scale(10.66667)">
          <use href="#flag-ko-kr-c" width="100%" height="100%" />
          <path stroke="#fff" d="M0-23.5v3M0 17v3.5m0 3v3" />
        </g>
      </g>
    </svg>
  );
}

function FlagUS() {
  return (
    <svg {...VIEW}>
      <path fill="#bd3d44" d="M0 0h640v480H0" />
      <path stroke="#fff" strokeWidth="37" d="M0 55.3h640M0 129h640M0 203h640M0 277h640M0 351h640M0 425h640" />
      <path fill="#192f5d" d="M0 0h364.8v258.5H0" />
      <marker id="flag-en-us-a" markerHeight="30" markerWidth="30">
        <path fill="#fff" d="m14 0 9 27L0 10h28L5 27z" />
      </marker>
      <path
        fill="none"
        markerMid="url(#flag-en-us-a)"
        d="m0 0 16 11h61 61 61 61 60L47 37h61 61 60 61L16 63h61 61 61 61 60L47 89h61 61 60 61L16 115h61 61 61 61 60L47 141h61 61 60 61L16 166h61 61 61 61 60L47 192h61 61 60 61L16 218h61 61 61 61 60z"
      />
    </svg>
  );
}

function FlagJP() {
  return (
    <svg {...VIEW}>
      <defs>
        <clipPath id="flag-ja-jp-a">
          <path fillOpacity=".7" d="M-88 32h640v480H-88z" />
        </clipPath>
      </defs>
      <g fillRule="evenodd" strokeWidth="1pt" clipPath="url(#flag-ja-jp-a)" transform="translate(88 -32)">
        <path fill="#fff" d="M-128 32h720v480h-720z" />
        <circle cx="523.1" cy="344.1" r="194.9" fill="#bc002d" transform="translate(-168.4 8.6)scale(.76554)" />
      </g>
    </svg>
  );
}

function FlagCN() {
  return (
    <svg {...VIEW}>
      <defs>
        <path id="flag-zh-cn-a" fill="#ff0" d="M-.6.8 0-1 .6.8-1-.3h2z" />
      </defs>
      <path fill="#ee1c25" d="M0 0h640v480H0z" />
      <use href="#flag-zh-cn-a" width="30" height="20" transform="matrix(71.9991 0 0 72 120 96)" />
      <use href="#flag-zh-cn-a" width="30" height="20" transform="matrix(-12.33562 -20.5871 20.58684 -12.33577 240.3 48)" />
      <use href="#flag-zh-cn-a" width="30" height="20" transform="matrix(-3.38573 -23.75998 23.75968 -3.38578 288 95.8)" />
      <use href="#flag-zh-cn-a" width="30" height="20" transform="matrix(6.5991 -23.0749 23.0746 6.59919 288 168)" />
      <use href="#flag-zh-cn-a" width="30" height="20" transform="matrix(14.9991 -18.73557 18.73533 14.99929 240 216)" />
    </svg>
  );
}

const FLAGS: Record<Lang, () => ReactElement> = { ko: FlagKR, en: FlagUS, ja: FlagJP, zh: FlagCN };

/** Decorative inline flag; the language name is always written next to it. Size and corner come from the className. */
export function Flag({ lang, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { lang: Lang }) {
  const Art = FLAGS[lang];
  return (
    <span className={className} aria-hidden="true" {...rest}>
      <Art />
    </span>
  );
}
