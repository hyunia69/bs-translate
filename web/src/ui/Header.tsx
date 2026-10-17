import type { ConnectionStatus, LayoutMode, PartnerLang } from "../types";
import { PARTNER_LANG_SHORT } from "./i18n";
import { IconFlip, IconGear } from "./icons";

export interface HeaderProps {
  partnerLang: PartnerLang;
  onPartnerLangChange(lang: PartnerLang): void;
  status: ConnectionStatus;
  mode: LayoutMode;
  onToggleMode(): void;
  onOpenSettings(): void;
  /** Lock the language control, e.g. while a turn is recording. */
  langLocked?: boolean;
}

const LANGS: PartnerLang[] = ["en", "ja", "zh"];

/** Status dot skin + Korean label per connection status; shared with the session bar. */
export const STATUS_DOT: Record<ConnectionStatus, { dot: string; label: string }> = {
  idle: { dot: "dot--idle", label: "대기" },
  connecting: { dot: "dot--busy", label: "연결 중" },
  ready: { dot: "dot--ready", label: "연결됨" },
  reconnecting: { dot: "dot--busy", label: "재연결 중" },
  offline: { dot: "dot--bad", label: "오프라인" },
  error: { dot: "dot--bad", label: "오류" },
};

export function Header({ partnerLang, onPartnerLangChange, status, mode, onToggleMode, onOpenSettings, langLocked = false }: HeaderProps) {
  const s = STATUS_DOT[status];
  const nextMode = mode === "onehand" ? "대면" : "한손";
  return (
    <header className="hdr">
      <div className="seg" role="group" aria-label="상대 언어">
        {LANGS.map((l) => (
          <button
            key={l}
            type="button"
            className="seg__btn"
            lang={l}
            aria-pressed={l === partnerLang}
            disabled={langLocked && l !== partnerLang}
            onClick={() => onPartnerLangChange(l)}
          >
            {PARTNER_LANG_SHORT[l]}
          </button>
        ))}
      </div>
      <span className={`dot ${s.dot}`} role="status" aria-label={`연결 상태: ${s.label}`} title={s.label} />
      <div className="hdr__right">
        <button type="button" className="icon-btn" onClick={onToggleMode} aria-label={`${nextMode} 모드로 전환`}>
          <IconFlip />
          {nextMode}
        </button>
        <button type="button" className="icon-btn" onClick={onOpenSettings} aria-label="설정">
          <IconGear />
        </button>
      </div>
    </header>
  );
}
