import { MessageList } from "./MessageList";
import type { ConversationLayoutProps } from "./props";
import { PttButton, pttStateFor } from "./PttButton";
import { StartButton } from "./StartButton";

export type OneHandLayoutProps = ConversationLayoutProps;

/** Thin header, scrolling bubble list, two thumb-reach PTT buttons fixed at the bottom (one start button while stopped). */
export function OneHandLayout({
  header,
  sessionBar,
  banner,
  messages,
  partnerLang,
  recording,
  playingId,
  onReplay,
  onPtt,
  sessionActive,
  engineReady,
  onStartSession,
}: OneHandLayoutProps) {
  return (
    <div className="onehand">
      {header}
      {sessionBar}
      {banner}
      <MessageList messages={messages} partnerLang={partnerLang} playingId={playingId} onReplay={onReplay} />
      {sessionActive ? (
        <div className="ptt-bar">
          <PttButton speaker="me" partnerLang={partnerLang} {...pttStateFor(recording, "me", engineReady)} onPress={() => onPtt("me")} />
          <PttButton speaker="partner" partnerLang={partnerLang} {...pttStateFor(recording, "partner", engineReady)} onPress={() => onPtt("partner")} />
        </div>
      ) : (
        <div className="ptt-bar ptt-bar--single">
          <StartButton onPress={onStartSession} />
        </div>
      )}
    </div>
  );
}
