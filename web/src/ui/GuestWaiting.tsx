import { Pending } from "./Bubble";
import type { GuestWaitingProps } from "./dualProps";
import { dualStringsFor } from "./dualStrings";
import { Flag } from "./flags";
import { stringsFor } from "./i18n";

/** Guest, phase "requesting": the request is out and the booth has not answered yet. The one way out is cancel. */
export function GuestWaiting({ myLang, onCancel }: GuestWaitingProps) {
  const t = dualStringsFor(myLang);
  return (
    <div className="dual-screen" lang={myLang}>
      <div className="pin">
        <div className="dual-setup dual-wait">
          <div role="status" aria-live="polite">
            <Pending />
            <h1 className="pin__title">{t.requestSent}</h1>
            <p className="pin__sub">{t.waitingAccept}</p>
          </div>
          <span className="dual-side">
            <Flag lang={myLang} className="flag" />
            <span className="dual-side__label">{stringsFor(myLang).name}</span>
            <span className="sr-only">{t.me}</span>
          </span>
          <button type="button" className="btn btn--block" onClick={onCancel}>
            {t.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
