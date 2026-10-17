import type { KeyboardEvent } from "react";
import type { Lang, Message, Speaker } from "../types";
import { Pending, clock } from "./Bubble";
import { Flag } from "./flags";
import { KO_STRINGS, PARTNER_STRINGS, type UiStrings } from "./i18n";
import { IconSpeaker, IconWarn } from "./icons";
import type { ConversationLayoutProps } from "./props";
import { PttButton, pttStateFor } from "./PttButton";
import { StartButton } from "./StartButton";
import { useAutoScroll } from "./useAutoScroll";

export type FacingLayoutProps = ConversationLayoutProps;

interface FacingItemProps {
  message: Message;
  strings: UiStrings;
  playing: boolean;
  onReplay?(id: string): void;
}

/** One translated utterance, large, read by the side that did not speak it. */
function FacingItem({ message: m, strings, playing, onReplay }: FacingItemProps) {
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
    "facing-item",
    `facing-item--${m.speaker}`,
    m.status === "error" && "facing-item--error",
    replay && "facing-item--tappable",
    playing && "facing-item--playing",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls} role={replay ? "button" : undefined} tabIndex={replay ? 0 : undefined} onClick={replay} onKeyDown={onKeyDown}>
      <div className="facing-item__meta">
        <Flag lang={m.source} className="flag" />
        <span className="num">{clock(m.createdAt)}</span>
        {m.hasAudio && (
          <span className="bubble__audio" aria-hidden="true">
            <IconSpeaker />
          </span>
        )}
      </div>
      <div className="facing-item__text">{m.targetText}</div>
      {m.status === "recording" && (
        <div className="facing-item__status">
          <Pending />
        </div>
      )}
      {m.status === "translating" && (
        <div className="facing-item__status">
          <Pending />
          {strings.translating}
        </div>
      )}
      {m.status === "error" && (
        <div className="facing-item__status">
          <IconWarn />
          {strings.error}
        </div>
      )}
    </div>
  );
}

interface FacingListProps {
  /** Messages spoken by the other side, i.e. whose targetText is in this reader's language. */
  items: Message[];
  lang: Lang;
  strings: UiStrings;
  playingId: string | null;
  onReplay?(id: string): void;
}

function FacingList({ items, lang, strings, playingId, onReplay }: FacingListProps) {
  const last = items[items.length - 1];
  const { containerRef, contentRef } = useAutoScroll<HTMLDivElement, HTMLDivElement>(last?.id ?? "");
  return (
    <div className="facing__list" ref={containerRef} role="log" aria-live="polite" lang={lang}>
      <div className="facing__inner" ref={contentRef}>
        {items.length === 0 ? (
          <div className="msg-list__empty">{strings.speakHint}</div>
        ) : (
          items.map((m) => <FacingItem key={m.id} message={m} strings={strings} playing={m.id === playingId} onReplay={onReplay} />)
        )}
      </div>
    </div>
  );
}

/**
 * Phone flat on the table. Top half is rotated 180° for the partner and shows
 * only the partner-language translations of "me" turns; bottom half is the
 * rep's and shows only the Korean translations of partner turns.
 */
export function FacingLayout({
  header,
  sessionBar,
  banner,
  messages,
  partnerLang,
  recording,
  playingId = null,
  onReplay,
  onPtt,
  sessionActive,
  engineReady,
  onStartSession,
}: FacingLayoutProps) {
  const forPartner = messages.filter((m: Message) => m.speaker === "me");
  const forRep = messages.filter((m: Message) => m.speaker === "partner");
  const ps = PARTNER_STRINGS[partnerLang];
  const press = (speaker: Speaker) => () => onPtt(speaker);
  return (
    <div className="facing">
      <section className="facing__half facing__half--partner" aria-label={ps.name} lang={partnerLang}>
        <FacingList items={forPartner} lang={partnerLang} strings={ps} playingId={playingId} onReplay={onReplay} />
        <div className="facing__ptt">
          {sessionActive ? (
            <PttButton speaker="partner" partnerLang={partnerLang} {...pttStateFor(recording, "partner", engineReady)} onPress={press("partner")} />
          ) : (
            <div className="wait-note" role="status">
              {ps.waiting}
            </div>
          )}
        </div>
      </section>
      <div className="facing__divider" aria-hidden="true" />
      <section className="facing__half" aria-label="한국어">
        {header}
        {sessionBar}
        {banner}
        <FacingList items={forRep} lang="ko" strings={KO_STRINGS} playingId={playingId} onReplay={onReplay} />
        <div className="facing__ptt">
          {sessionActive ? (
            <PttButton speaker="me" partnerLang={partnerLang} {...pttStateFor(recording, "me", engineReady)} onPress={press("me")} />
          ) : (
            <StartButton onPress={onStartSession} />
          )}
        </div>
      </section>
    </div>
  );
}
