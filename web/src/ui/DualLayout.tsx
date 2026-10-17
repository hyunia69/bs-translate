import type { DualLayoutProps } from "./dualProps";
import { dualStringsFor } from "./dualStrings";
import { Flag } from "./flags";
import { STATUS_DOT } from "./Header";
import { stringsFor } from "./i18n";
import { IconGear, IconStop, IconSwapH } from "./icons";
import { MessageList } from "./MessageList";
import { PttButton, pttStateFor } from "./PttButton";

/** Paired conversation (both roles): me <-> partner in the header, both sides' bubbles, one talk key in my language. The gear is the master's only. */
export function DualLayout({
  myLang,
  myLabel,
  partner,
  partnerLabel,
  messages,
  recording,
  engineReady,
  status,
  banner,
  onTalk,
  onEnd,
  onOpenSettings,
}: DualLayoutProps) {
  const t = dualStringsFor(myLang);
  const dot = STATUS_DOT[status].dot;
  const statusLabel = t.status[status];
  return (
    <div className="dual-screen" lang={myLang}>
      <header className="hdr">
        <div className="dual-pair">
          <span className="dual-side">
            <Flag lang={myLang} className="flag" />
            <span className="dual-side__label">{myLabel}</span>
            <span className="sr-only">
              {t.me} · {stringsFor(myLang).name}
            </span>
          </span>
          <IconSwapH className="dual-pair__arrow" />
          <span className="dual-side dual-side--partner">
            <Flag lang={partner.lang} className="flag" />
            <span className="dual-side__label">{partnerLabel}</span>
            <span className="sr-only">
              {t.partner} · <span lang={partner.lang}>{stringsFor(partner.lang).name}</span>
            </span>
          </span>
        </div>
        <span className={`dot ${dot}`} role="status" aria-label={statusLabel} title={statusLabel} />
        <div className="hdr__right">
          <button type="button" className="icon-btn icon-btn--danger" onClick={onEnd}>
            <IconStop />
            {t.end}
          </button>
          {onOpenSettings && (
            <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label={t.settings}>
              <IconGear />
            </button>
          )}
        </div>
      </header>
      {banner}
      <MessageList
        messages={messages}
        emptyHint={
          <>
            <p>{t.connectedWith(partnerLabel)}</p>
            <p>{t.speakHint}</p>
          </>
        }
      />
      <div className="ptt-bar ptt-bar--single">
        <PttButton speaker="me" lang={myLang} label={t.talkIdle} stopHint={t.stopHint} {...pttStateFor(recording, "me", engineReady)} onPress={onTalk} />
      </div>
    </div>
  );
}
