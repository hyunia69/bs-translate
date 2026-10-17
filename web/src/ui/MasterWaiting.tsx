import { Pending } from "./Bubble";
import type { MasterWaitingProps } from "./dualProps";
import { PIN_UNKNOWN, dualStringsFor } from "./dualStrings";
import { Flag } from "./flags";
import { stringsFor } from "./i18n";
import { IconGear, IconStop } from "./icons";

/** Master, phase "waiting": the booth PIN and guest URL on a card, pending guest requests as cards with accept / decline. */
export function MasterWaiting({ myLang, boothPin, guestUrl, requests, notice, onAccept, onDecline, onStop, onOpenSettings }: MasterWaitingProps) {
  const t = dualStringsFor(myLang);
  return (
    <div className="dual-screen" lang={myLang}>
      <header className="hdr">
        <span className="dual-side">
          <Flag lang={myLang} className="flag" />
          <span className="dual-side__label">{stringsFor(myLang).name}</span>
          <span className="sr-only">{t.me}</span>
        </span>
        <span className="dual-hdr__title">{t.waitingTitle}</span>
        <div className="hdr__right">
          <button type="button" className="icon-btn icon-btn--danger" onClick={onStop}>
            <IconStop />
            {t.stop}
          </button>
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label={t.settings}>
            <IconGear />
          </button>
        </div>
      </header>

      {notice && (
        <p className="dual-notice" role="status">
          {notice}
        </p>
      )}

      <div className="dual-list">
        <section className="booth" aria-label={t.boothPin}>
          <span className="booth__cap">{t.boothPin}</span>
          <span className="booth__pin" data-testid="master-booth-pin">
            {boothPin ?? PIN_UNKNOWN}
          </span>
          <span className="booth__cap">{t.guestUrl}</span>
          <span className="booth__url">{guestUrl}</span>
        </section>

        <span className="field__label">{t.requests}</span>
        {requests.length === 0 ? (
          <div className="msg-list__empty" role="status">
            <Pending />
            <p>{t.noRequests}</p>
          </div>
        ) : (
          <ul className="dual-requests" aria-label={t.requests}>
            {requests.map((r) => (
              <li key={r.id} className="request">
                <div className="request__who">
                  <Flag lang={r.lang} className="flag" />
                  <span className="request__num">{t.guestNumber(r.id)}</span>
                  <span className="request__lang" lang={r.lang}>
                    {stringsFor(r.lang).name}
                  </span>
                </div>
                <div className="request__actions">
                  <button type="button" className="btn btn--primary" onClick={() => onAccept(r.id)}>
                    {t.accept}
                  </button>
                  <button type="button" className="btn" onClick={() => onDecline(r.id)}>
                    {t.decline}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
