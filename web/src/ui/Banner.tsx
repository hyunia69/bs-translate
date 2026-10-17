import { IconClose } from "./icons";

export type BannerKind = "mic_denied" | "offline" | "reconnecting" | "api_error" | "info";

export interface BannerProps {
  kind: BannerKind;
  /** Detail text: the short API error message, or the info text. Overrides the built-in body. */
  message?: string;
  /** Called when the user taps ✕. The button is rendered only for kinds that may be dismissed. */
  onDismiss?(): void;
}

type Tone = "bad" | "warn" | "info";

const KINDS: Record<BannerKind, { tone: Tone; title: string; body?: string; dismissible: boolean }> = {
  mic_denied: {
    tone: "bad",
    title: "마이크 권한이 필요합니다",
    body: "주소창의 자물쇠 아이콘 → 권한 → 마이크 허용으로 바꾼 뒤 새로고침해 주세요.",
    dismissible: true,
  },
  offline: { tone: "bad", title: "네트워크 연결 끊김", body: "연결이 돌아오면 자동으로 다시 연결합니다.", dismissible: false },
  reconnecting: { tone: "warn", title: "재연결 중...", dismissible: false },
  api_error: { tone: "bad", title: "오류", dismissible: true },
  info: { tone: "info", title: "안내", dismissible: true },
};

export function Banner({ kind, message, onDismiss }: BannerProps) {
  const k = KINDS[kind];
  const body = message ?? k.body;
  return (
    <div className={`banner banner--${k.tone}`} role={k.tone === "info" ? "status" : "alert"}>
      <div className="min-w-0 flex-1">
        <div className="banner__title">{k.title}</div>
        {body && <div className="banner__body">{body}</div>}
      </div>
      {k.dismissible && onDismiss && (
        <button type="button" className="banner__close" onClick={onDismiss} aria-label="닫기">
          <IconClose />
        </button>
      )}
    </div>
  );
}
