import { useState, type FormEvent } from "react";
import type { Lang } from "../types";
import type { MasterSetupProps } from "./dualProps";
import { DUAL_LANGS, DUAL_STRINGS } from "./dualStrings";
import { Flag } from "./flags";
import { stringsFor } from "./i18n";
import { IconGear } from "./icons";

const ko = DUAL_STRINGS.ko;
const en = DUAL_STRINGS.en;

/** Master (booth phone), phases "setup"/"joining": pick my language and start waiting. Korean copy with English sub-lines, since no language is chosen yet. */
export function MasterSetup({ initialLang, busy, notice, onStart, onBasicMode, onOpenSettings }: MasterSetupProps) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!busy) onStart(lang);
  };

  return (
    <div className="dual-screen" lang="ko">
      <header className="hdr">
        <div className="hdr__right">
          <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label={ko.settings}>
            <IconGear />
          </button>
        </div>
      </header>
      <form className="pin" onSubmit={submit}>
        <div className="dual-setup">
          <div>
            <h1 className="pin__title">{ko.masterTitle}</h1>
            <p className="pin__sub">{ko.masterSub}</p>
            <p className="pin__sub" lang="en">
              {en.masterSub}
            </p>
          </div>

          <div className="field" role="group" aria-label={ko.myLang}>
            <span className="field__label">
              {ko.myLang}{" "}
              <span className="dual-sub" lang="en">
                {en.myLang}
              </span>
            </span>
            <div className="choice choice--grid">
              {DUAL_LANGS.map((l) => (
                <button key={l} type="button" className="choice__btn" lang={l} aria-pressed={l === lang} disabled={busy} onClick={() => setLang(l)}>
                  <Flag lang={l} className="flag" />
                  {stringsFor(l).name}
                </button>
              ))}
            </div>
          </div>

          {notice && (
            <p className="dual-notice" id="dual-notice" role="alert">
              {notice}
            </p>
          )}

          <button type="submit" className="btn btn--primary btn--block" disabled={busy}>
            {busy ? ko.starting : ko.startWaiting}
            <span className="dual-sub" lang="en">
              {busy ? en.starting : en.startWaiting}
            </span>
          </button>
          <button type="button" className="btn w-full" disabled={busy} onClick={onBasicMode}>
            {ko.basicMode}
            <span className="dual-sub" lang="en">
              {en.basicMode}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
}
