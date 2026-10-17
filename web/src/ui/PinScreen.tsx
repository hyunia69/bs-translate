import { useState, type FormEvent } from "react";

export interface PinScreenProps {
  /** Called with the 4-6 digit PIN when the user submits. */
  onSubmit(pin: string): void;
  /** Error text shown under the input, e.g. "PIN이 올바르지 않습니다". */
  error?: string | null;
  /** True while the PIN is being checked: locks the input and the button. */
  busy?: boolean;
}

const PIN_RE = /^\d{4,6}$/;

/** First-run screen: numeric PIN entry. */
export function PinScreen({ onSubmit, error = null, busy = false }: PinScreenProps) {
  const [pin, setPin] = useState("");
  const valid = PIN_RE.test(pin);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (valid && !busy) onSubmit(pin);
  };
  return (
    <form className="pin" onSubmit={submit}>
      <div>
        <h1 className="pin__title">부스 통역</h1>
        <p className="pin__sub">접속 PIN을 입력하세요 (4~6자리)</p>
      </div>
      <input
        className="pin__input"
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        autoFocus
        maxLength={6}
        value={pin}
        disabled={busy}
        aria-label="PIN"
        aria-invalid={!!error}
        aria-describedby="pin-error"
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
      <p className="pin__error" id="pin-error" role="alert">
        {error ?? ""}
      </p>
      <button type="submit" className="btn btn--primary btn--block" disabled={!valid || busy}>
        {busy ? "확인 중…" : "입장"}
      </button>
    </form>
  );
}
