import { useEffect, useState, type KeyboardEvent } from "react";
import type { AppMode, EngineId, FontScale, Settings, Theme } from "../types";
import { PIN_UNKNOWN } from "./dualStrings";
import { ENGINE_LABEL } from "./i18n";
import { IconClose } from "./icons";
import type { MicDevice } from "./props";

export type SheetSettings = Pick<Settings, "engine" | "fontScale" | "theme" | "micDeviceId">;

export interface SettingsSheetProps {
  open: boolean;
  settings: SheetSettings;
  /** Microphones from enumerateDevices(); an empty label is shown as "마이크 N". */
  micDevices: MicDevice[];
  onChange(patch: Partial<SheetSettings>): void;
  /** With `onAppModeChange`, shows the "사용 모드" (기본 / 듀얼 (마스터)) field at the top. */
  appMode?: AppMode;
  onAppModeChange?(mode: AppMode): void;
  /** Current booth PIN (dual mode, master only); null while unknown. */
  boothPin?: string | null;
  /** Absolute URL guests open, shown under the booth PIN. */
  guestUrl?: string;
  /** With `onBoothPinChange`, shows the "게스트 PIN" field: the current PIN, a 4-digit input and the change button. May return a promise. */
  onBoothPinChange?(pin: string): void | Promise<unknown>;
  /** Called only after the inline "정말 지울까요?" confirmation. */
  onClearHistory(): void;
  onClose(): void;
}

const ENGINES: { id: EngineId; label: string }[] = [
  { id: "gpt-live", label: `${ENGINE_LABEL["gpt-live"]} (기본)` },
  { id: "realtime-translate", label: ENGINE_LABEL["realtime-translate"] },
];
const APP_MODES: { id: AppMode; label: string }[] = [
  { id: "basic", label: "기본" },
  { id: "dual", label: "듀얼 (마스터)" },
];
const BOOTH_PIN_RE = /^\d{4}$/;
const FONT_SCALES: { id: FontScale; label: string }[] = [
  { id: 0, label: "보통" },
  { id: 1, label: "크게" },
  { id: 2, label: "아주 크게" },
];
const THEMES: { id: Theme; label: string }[] = [
  { id: "contrast", label: "고대비" },
  { id: "dark", label: "다크" },
];

interface SegmentedProps<T extends string | number> {
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange(value: T): void;
  /** Vertical list for long labels. */
  vertical?: boolean;
}

function Segmented<T extends string | number>({ label, options, value, onChange, vertical = false }: SegmentedProps<T>) {
  return (
    <div className="field" role="group" aria-label={label}>
      <span className="field__label">{label}</span>
      <div className={vertical ? "choice" : "seg seg--lg"}>
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className={vertical ? "choice__btn" : "seg__btn"}
            aria-pressed={o.id === value}
            onClick={() => onChange(o.id)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsSheet({
  open,
  settings,
  micDevices,
  onChange,
  appMode,
  onAppModeChange,
  boothPin = null,
  guestUrl,
  onBoothPinChange,
  onClearHistory,
  onClose,
}: SettingsSheetProps) {
  const [confirming, setConfirming] = useState(false);
  const [pinDraft, setPinDraft] = useState("");
  const [pinSaving, setPinSaving] = useState(false);
  useEffect(() => {
    if (!open) {
      setConfirming(false);
      setPinDraft("");
    }
  }, [open]);
  if (!open) return null;

  const pinValid = BOOTH_PIN_RE.test(pinDraft);
  const saveBoothPin = async () => {
    if (!onBoothPinChange || !pinValid || pinSaving) return;
    setPinSaving(true);
    try {
      await onBoothPinChange(pinDraft);
      setPinDraft("");
    } finally {
      setPinSaving(false);
    }
  };
  const onPinKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void saveBoothPin();
    }
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="sheet__hdr">
        <h2 id="settings-title" className="sheet__title">
          설정
        </h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="설정 닫기">
          <IconClose />
          닫기
        </button>
      </div>
      <div className="sheet__body">
        {appMode !== undefined && onAppModeChange && (
          <Segmented label="사용 모드" options={APP_MODES} value={appMode} onChange={onAppModeChange} />
        )}
        {onBoothPinChange && (
          <div className="field">
            <span className="field__label">게스트 PIN</span>
            <div className="booth booth--compact">
              <span className="booth__cap">현재 PIN</span>
              <span className="booth__pin" data-testid="booth-pin-current">
                {boothPin ?? PIN_UNKNOWN}
              </span>
              {guestUrl && (
                <>
                  <span className="booth__cap">게스트 접속 주소</span>
                  <span className="booth__url">{guestUrl}</span>
                </>
              )}
            </div>
            <div className="booth-pin__row">
              <input
                className="booth-pin__input"
                data-testid="booth-pin-input"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                maxLength={4}
                value={pinDraft}
                disabled={pinSaving}
                aria-label="새 게스트 PIN (4자리)"
                onChange={(e) => setPinDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
                onKeyDown={onPinKeyDown}
              />
              <button type="button" className="btn btn--primary" data-testid="booth-pin-save" disabled={!pinValid || pinSaving} onClick={() => void saveBoothPin()}>
                {pinSaving ? "변경 중…" : "변경"}
              </button>
            </div>
          </div>
        )}
        <label className="field">
          <span className="field__label">마이크</span>
          <select
            className="select"
            value={settings.micDeviceId ?? ""}
            onChange={(e) => onChange({ micDeviceId: e.target.value || null })}
          >
            <option value="">기본 마이크</option>
            {micDevices.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `마이크 ${i + 1}`}
              </option>
            ))}
          </select>
        </label>

        <Segmented label="번역 엔진" options={ENGINES} value={settings.engine} onChange={(engine) => onChange({ engine })} vertical />
        <Segmented label="글자 크기" options={FONT_SCALES} value={settings.fontScale} onChange={(fontScale) => onChange({ fontScale })} />
        <Segmented label="테마" options={THEMES} value={settings.theme} onChange={(theme) => onChange({ theme })} />

        <div className="field">
          <span className="field__label">대화 기록</span>
          {confirming ? (
            <div className="confirm" role="alertdialog" aria-label="대화 기록 삭제 확인">
              <span className="flex-1">모든 대화 기록을 지울까요?</span>
              <button
                type="button"
                className="btn btn--danger"
                onClick={() => {
                  setConfirming(false);
                  onClearHistory();
                }}
              >
                지우기
              </button>
              <button type="button" className="btn" onClick={() => setConfirming(false)}>
                취소
              </button>
            </div>
          ) : (
            <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)}>
              대화 기록 지우기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
