import type { ReactNode } from "react";
import type { Message, PartnerLang } from "../types";
import { Bubble } from "./Bubble";
import { KO_STRINGS, PARTNER_STRINGS } from "./i18n";
import { useAutoScroll } from "./useAutoScroll";

export interface MessageListProps {
  messages: Message[];
  /** Used for the default empty-state hint shown to the partner. Ignored when `emptyHint` is given. */
  partnerLang?: PartnerLang;
  /** Replaces the default empty-state content (the two "tap the button and speak" lines). */
  emptyHint?: ReactNode;
  /** Id of the message whose audio is playing, if any. */
  playingId?: string | null;
  onReplay?(id: string): void;
}

/** One-hand mode conversation: both speakers, newest at the bottom, sticks to the newest message. */
export function MessageList({ messages, partnerLang = "en", emptyHint, playingId = null, onReplay }: MessageListProps) {
  const last = messages[messages.length - 1];
  const { containerRef, contentRef } = useAutoScroll<HTMLDivElement, HTMLDivElement>(last?.id ?? "");
  return (
    <div className="msg-list" ref={containerRef} role="log" aria-live="polite">
      <div className="msg-list__inner" ref={contentRef}>
        {messages.length === 0 ? (
          <div className="msg-list__empty">
            {emptyHint ?? (
              <>
                <p>{KO_STRINGS.speakHint}</p>
                <p lang={partnerLang}>{PARTNER_STRINGS[partnerLang].speakHint}</p>
              </>
            )}
          </div>
        ) : (
          messages.map((m) => <Bubble key={m.id} message={m} playing={m.id === playingId} onReplay={onReplay} />)
        )}
      </div>
    </div>
  );
}
