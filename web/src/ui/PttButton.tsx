import type { CSSProperties, KeyboardEvent, PointerEvent } from "react";
import { MAX_RECORD_MS, type Lang, type PartnerLang, type Speaker } from "../types";
import { Flag } from "./flags";
import { stringsFor } from "./i18n";
import type { RecordingState } from "./props";

export interface PttButtonProps {
  speaker: Speaker;
  /** Language of the partner; labels the partner button and picks its recording strings. Ignored when `lang` is given. */
  partnerLang?: PartnerLang;
  /** Overrides the speaker-derived language (dual mode: one key in my own language). */
  lang?: Lang;
  /** Overrides the idle label (default: the language name). */
  label?: string;
  /** Replaces the "listening" text while recording, e.g. "Tap to stop". */
  stopHint?: string;
  /** True while this button's speaker is being recorded. */
  recording: boolean;
  /** Visibly disabled, e.g. while the other speaker records. */
  disabled?: boolean;
  /** Elapsed recording time, shown as mm:ss while recording. */
  elapsedMs?: number;
  /** Microphone input level 0..1 while recording. */
  level?: number;
  /** Recording limit used for the countdown; defaults to MAX_RECORD_MS. */
  maxMs?: number;
  /** Fired on pointer-down (and Enter/Space). The controller decides whether this starts or stops a turn. */
  onPress(): void;
}

/**
 * Derives the per-button recording props from the controller's recording state.
 * `ready` is the engine's readiness: until it is true the buttons stay visibly disabled.
 */
export function pttStateFor(recording: RecordingState | null, speaker: Speaker, ready = true) {
  const mine = recording?.speaker === speaker;
  return {
    recording: mine,
    // A button that is recording must stay tappable so the turn can be stopped whatever the engine reports.
    disabled: !mine && (recording !== null || !ready),
    elapsedMs: mine ? recording.elapsedMs : 0,
    level: mine ? recording.level : 0,
  };
}

export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function PttButton({
  speaker,
  partnerLang = "en",
  lang: langOverride,
  label,
  stopHint,
  recording,
  disabled = false,
  elapsedMs = 0,
  level = 0,
  maxMs = MAX_RECORD_MS,
  onPress,
}: PttButtonProps) {
  const lang: Lang = langOverride ?? (speaker === "me" ? "ko" : partnerLang);
  const t = stringsFor(lang);
  const remainingMs = Math.max(0, maxMs - elapsedMs);
  const showLeft = recording && remainingMs < 10_000;
  const pct = Math.round(Math.min(1, Math.max(0, level)) * 100);
  const cls = ["ptt", `ptt--${speaker}`, recording && "ptt--recording"].filter(Boolean).join(" ");

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    onPress();
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (disabled || e.repeat) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPress();
    }
  };

  return (
    <button
      type="button"
      className={cls}
      lang={lang}
      disabled={disabled}
      aria-pressed={recording}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
      style={{ "--level": `${pct}%` } as CSSProperties}
    >
      {recording ? (
        <>
          <span className="ptt__hint">{stopHint ?? t.listening}</span>
          <span className="ptt__timer" aria-live="off">
            {mmss(elapsedMs)}
          </span>
          {showLeft && <span className="ptt__left">{t.secondsLeft(Math.ceil(remainingMs / 1000))}</span>}
          <span className="ptt__meter" aria-hidden="true">
            <i />
          </span>
        </>
      ) : (
        <>
          <Flag lang={lang} className="flag ptt__flag" />
          <span className="ptt__name">{label ?? t.name}</span>
        </>
      )}
    </button>
  );
}
