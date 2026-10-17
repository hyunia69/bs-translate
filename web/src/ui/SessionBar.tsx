import { useEffect, useState } from "react";
import type { ConnectionStatus } from "../types";
import { STATUS_DOT } from "./Header";
import { IconStop } from "./icons";
import { mmss } from "./PttButton";

export interface SessionBarProps {
  /** Engine connection status; colors the dot exactly like the header's. */
  status: ConnectionStatus;
  /** Short engine label, e.g. "GPT-Live-1". */
  engineName: string;
  /** Epoch ms when the session started; drives the mm:ss counter. */
  startedAt: number;
  /** "번역 중지" tapped. */
  onStop(): void;
}

/**
 * Slim strip directly under the header while a session is active:
 * "● 번역 중 · <engine> · mm:ss" on the left, the stop control on the right.
 * Sits at the top, in the danger skin, so it can never be confused with the talk buttons.
 */
export function SessionBar({ status, engineName, startedAt, onStop }: SessionBarProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const s = STATUS_DOT[status];
  return (
    <div className="session-bar" data-testid="session-bar">
      <span className={`dot ${s.dot}`} role="status" aria-label={`연결 상태: ${s.label}`} title={s.label} />
      <span className="session-bar__text">
        번역 중 · <span className="session-bar__engine">{engineName}</span>
      </span>
      <span className="session-bar__time" aria-label="경과 시간">
        · {mmss(now - startedAt)}
      </span>
      <button type="button" className="session-bar__stop" onClick={onStop}>
        <IconStop />
        번역 중지
      </button>
    </div>
  );
}
