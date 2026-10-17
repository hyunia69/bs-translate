import type { KeyboardEvent } from "react";
import type { Message } from "../types";
import { Flag } from "./flags";
import { KO_STRINGS, stringsFor } from "./i18n";
import { IconSpeaker, IconWarn } from "./icons";

export interface BubbleProps {
  message: Message;
  /** True while this message's audio is being replayed. */
  playing?: boolean;
  /** Tap handler for messages with audio; receives the message id. */
  onReplay?(id: string): void;
}

/** Three stepping dots: "still arriving". */
export function Pending() {
  return (
    <span className="pending" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

export function clock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

export function Bubble({ message: m, playing = false, onReplay }: BubbleProps) {
  const src = stringsFor(m.source);
  const tgt = stringsFor(m.target);
  const replay = m.hasAudio && onReplay ? () => onReplay(m.id) : undefined;
  const onKeyDown = replay
    ? (e: KeyboardEvent) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          replay();
        }
      }
    : undefined;
  const cls = [
    "bubble",
    `bubble--${m.speaker}`,
    m.status === "error" && "bubble--error",
    replay && "bubble--tappable",
    playing && "bubble--playing",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={cls}
      role={replay ? "button" : undefined}
      tabIndex={replay ? 0 : undefined}
      aria-label={replay ? `${src.name} 다시 듣기` : undefined}
      onClick={replay}
      onKeyDown={onKeyDown}
    >
      <div className="bubble__meta">
        <span className="tag" lang={m.source}>
          <Flag lang={m.source} className="flag" />
          {src.name}
        </span>
        <span className="bubble__time">{clock(m.createdAt)}</span>
        {m.hasAudio && (
          <span className="bubble__audio" aria-hidden="true">
            <IconSpeaker />
          </span>
        )}
      </div>
      {m.sourceText && (
        <div className="bubble__src" lang={m.source}>
          {m.sourceText}
        </div>
      )}
      {(m.targetText || m.status === "done") && (
        <div className="bubble__tgt" lang={m.target}>
          {m.targetText}
        </div>
      )}
      {m.status === "recording" && (
        <div className="bubble__status" lang={m.source}>
          <Pending />
          {src.listening}
        </div>
      )}
      {m.status === "translating" && (
        <div className="bubble__status" lang={m.target}>
          <Pending />
          {tgt.translating}
        </div>
      )}
      {m.status === "error" && (
        <div className="bubble__status">
          <IconWarn />
          {KO_STRINGS.error}
          {m.target !== "ko" && <span lang={m.target}> · {tgt.error}</span>}
        </div>
      )}
    </article>
  );
}
