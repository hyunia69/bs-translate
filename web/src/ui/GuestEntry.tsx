import { useState, type FormEvent } from "react";
import type { Lang } from "../types";
import type { GuestEntryProps } from "./dualProps";
import { PIN_UNKNOWN, dualStringsFor, splitPinInstruction } from "./dualStrings";
import { Flag } from "./flags";
import { stringsFor } from "./i18n";

const PIN_RE = /^\d{4}$/;

/**
 * Guest entry (/guest): my language, "PIN 코드 1234를 입력하세요" in that language with the booth PIN emphasized,
 * the PIN input and the request key. No settings gear, no basic mode: guests never leave the guest screens.
 */
export function GuestEntry({ boothPin, masterOnline, langs, initialLang, busy, notice, onRequest }: GuestEntryProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [pin, setPin] = useState("");
  const t = dualStringsFor(lang);
  const [before, after] = splitPinInstruction(t.pinInstruction);
  const valid = PIN_RE.test(pin);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !busy) onRequest(pin, lang);
  };

  return (
    <div className="dual-screen" lang={lang}>
      <form className="pin" onSubmit={submit}>
        <div className="dual-setup">
          <div>
            <h1 className="pin__title">{t.guestTitle}</h1>
            {/* booth presence: the server answers the request either way, so the key stays enabled */}
            <p className={masterOnline ? "dual-presence" : "dual-presence dual-presence--off"} role="status">
              <span className={masterOnline ? "dot dot--ready" : "dot dot--idle"} aria-hidden="true" />
              {masterOnline ? t.masterReady : t.masterNotReady}
            </p>
          </div>

          <div className="field" role="group" aria-label={t.myLang}>
            <span className="field__label">{t.myLang}</span>
            <div className="choice choice--grid">
              {langs.map((l) => (
                <button key={l} type="button" className="choice__btn" lang={l} aria-pressed={l === lang} disabled={busy} onClick={() => setLang(l)}>
                  <Flag lang={l} className="flag" />
                  {stringsFor(l).name}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <p className="dual-instruction">
              {before}
              <strong className="dual-instruction__pin" data-testid="booth-pin">
                {boothPin ?? PIN_UNKNOWN}
              </strong>
              {after}
            </p>
            <input
              className="pin__input"
              data-testid="guest-pin-input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              maxLength={4}
              value={pin}
              disabled={busy}
              aria-label={t.pinLabel}
              aria-describedby={notice ? "dual-notice" : undefined}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
            />
          </div>

          {notice && (
            <p className="dual-notice" id="dual-notice" role="alert">
              {notice}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={!valid || busy}>
            {busy ? t.requesting : t.request}
          </button>
        </div>
      </form>
    </div>
  );
}
