import { IconPlay } from "./icons";

export interface StartButtonProps {
  /** "번역 시작하기" tapped; the controller connects the engine inside this gesture. */
  onPress(): void;
}

/** The only control while stopped: one full-width button in the talk buttons' thumb zone. */
export function StartButton({ onPress }: StartButtonProps) {
  return (
    <button type="button" className="start-btn" onClick={onPress}>
      <span className="start-btn__label">
        <IconPlay />
        번역 시작하기
      </span>
      <span className="start-btn__hint">방문객이 오면 눌러서 연결하세요</span>
    </button>
  );
}
