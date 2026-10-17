import { useEffect, useMemo, useState } from "react";
import type { ConnectionStatus, FontScale, LayoutMode, PartnerLang, Speaker, Theme } from "../types";
import { AppShell, Banner, ENGINE_SHORT, FacingLayout, Header, OneHandLayout, PinScreen, SessionBar, SettingsSheet } from "./index";
import type { BannerKind, RecordingState, SheetSettings } from "./index";
import { PLAYING_ID, SAMPLE_LOGS, SAMPLE_MICS, sampleMessages } from "./demoData";

/*
 * Review screen. Every control is also a URL parameter so a state can be
 * linked or screenshotted directly, e.g. ?mode=facing&lang=ja&theme=dark&scale=2
 *   mode=onehand|facing  lang=en|ja|zh  theme=contrast|dark  scale=0|1|2
 *   rec=none|me|partner  late=1 (recording started at 0:52)  lvl=0..1 (initial meter level)  playing=1
 *   banner=none|mic_denied|offline|reconnecting|api_error|info
 *   status=idle|connecting|ready|reconnecting|offline|error
 *   sheet=1 (settings open)  pin=1 (PIN screen)  empty=1  panel=0 (hide the DEMO handle)
 *   session=0 (stopped: start button instead of the talk buttons, no session bar)
 */

const MODES = ["onehand", "facing"] as const satisfies readonly LayoutMode[];
const LANGS = ["en", "ja", "zh"] as const satisfies readonly PartnerLang[];
const THEMES = ["contrast", "dark"] as const satisfies readonly Theme[];
const SCALES = ["0", "1", "2"] as const;
const RECS = ["none", "me", "partner"] as const;
const BANNERS = ["none", "mic_denied", "offline", "reconnecting", "api_error", "info"] as const;
const STATUSES = ["idle", "connecting", "ready", "reconnecting", "offline", "error"] as const satisfies readonly ConnectionStatus[];
const SESSIONS = ["on", "off"] as const;

type BannerChoice = (typeof BANNERS)[number];

function pick<T extends string>(v: string | null, allowed: readonly T[], fallback: T): T {
  return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

const q = new URLSearchParams(window.location.search);

const BANNER_MESSAGE: Partial<Record<BannerChoice, string>> = {
  api_error: "번역 서버 응답 오류 (429)",
  info: "상대 언어를 바꾸면 새 세션이 시작됩니다.",
};

interface RowProps<T extends string> {
  label: string;
  options: readonly T[];
  value: T;
  names?: Partial<Record<T, string>>;
  onChange(v: T): void;
}

function Row<T extends string>({ label, options, value, names, onChange }: RowProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-xs font-bold text-(--ink-3)">{label}</span>
      <div className="seg flex-wrap">
        {options.map((o) => (
          <button key={o} type="button" className="seg__btn !min-h-8 !min-w-0 !px-2.5 !text-xs" aria-pressed={o === value} onClick={() => onChange(o)}>
            {names?.[o] ?? o}
          </button>
        ))}
      </div>
    </div>
  );
}

export function Demo() {
  const [mode, setMode] = useState<LayoutMode>(pick(q.get("mode"), MODES, "onehand"));
  const [lang, setLang] = useState<PartnerLang>(pick(q.get("lang"), LANGS, "en"));
  const [settings, setSettings] = useState<SheetSettings>({
    engine: "gpt-live",
    fontScale: Number(pick(q.get("scale"), SCALES, "0")) as FontScale,
    theme: pick(q.get("theme"), THEMES, "contrast"),
    micDeviceId: null,
  });
  const [recSpeaker, setRecSpeaker] = useState<Speaker | null>(() => {
    const r = pick(q.get("rec"), RECS, "none");
    return r === "none" ? null : r;
  });
  const [late, setLate] = useState(q.get("late") === "1");
  const [bannerKind, setBannerKind] = useState<BannerChoice>(pick(q.get("banner"), BANNERS, "none"));
  const [status, setStatus] = useState<ConnectionStatus>(pick(q.get("status"), STATUSES, "ready"));
  const [sessionActive, setSessionActive] = useState(q.get("session") !== "0");
  const [sessionStartedAt] = useState(() => Date.now() - 42_000);
  const [sheetOpen, setSheetOpen] = useState(q.get("sheet") === "1");
  const [pinOpen, setPinOpen] = useState(q.get("pin") === "1");
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(q.get("playing") === "1" ? PLAYING_ID : null);
  const [empty, setEmpty] = useState(q.get("empty") === "1");
  const [panelOpen, setPanelOpen] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(() => {
    const v = Number(q.get("lvl"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  });
  const showHandle = q.get("panel") !== "0";

  // Fake microphone: ticking clock + wobbling level while a speaker "records".
  useEffect(() => {
    if (!recSpeaker) return;
    const base = late ? 52_000 : 0;
    const start = performance.now();
    setElapsedMs(base);
    const id = window.setInterval(() => {
      const t = performance.now() - start;
      setElapsedMs(base + t);
      setLevel(Math.min(1, Math.max(0.05, 0.45 + 0.3 * Math.sin(t / 170) + 0.2 * Math.random())));
    }, 100);
    return () => window.clearInterval(id);
  }, [recSpeaker, late]);

  const messages = useMemo(() => (empty ? [] : sampleMessages(lang)), [lang, empty]);
  const recording: RecordingState | null = recSpeaker ? { speaker: recSpeaker, elapsedMs, level } : null;

  const replay = (id: string) => {
    setPlayingId(id);
    window.setTimeout(() => setPlayingId((cur) => (cur === id ? null : cur)), 2500);
  };
  const ptt = (s: Speaker) => setRecSpeaker((cur) => (cur === s ? null : s));
  const submitPin = (pin: string) => {
    setPinBusy(true);
    setPinError(null);
    window.setTimeout(() => {
      setPinBusy(false);
      if (pin === "1234") setPinOpen(false);
      else setPinError("PIN이 올바르지 않습니다. (데모 PIN: 1234)");
    }, 800);
  };

  const header = (
    <Header
      partnerLang={lang}
      onPartnerLangChange={setLang}
      status={status}
      mode={mode}
      onToggleMode={() => setMode((m) => (m === "onehand" ? "facing" : "onehand"))}
      onOpenSettings={() => setSheetOpen(true)}
      langLocked={recSpeaker !== null}
    />
  );
  const banner =
    bannerKind === "none" ? null : (
      <Banner kind={bannerKind as BannerKind} message={BANNER_MESSAGE[bannerKind]} onDismiss={() => setBannerKind("none")} />
    );
  const sessionBar = sessionActive ? (
    <SessionBar status={status} engineName={ENGINE_SHORT[settings.engine]} startedAt={sessionStartedAt} onStop={() => setSessionActive(false)} />
  ) : null;
  const layout = {
    header,
    sessionBar,
    banner,
    messages,
    partnerLang: lang,
    recording,
    playingId,
    onReplay: replay,
    onPtt: ptt,
    sessionActive,
    engineReady: status === "ready",
    onStartSession: () => setSessionActive(true),
  };

  return (
    <>
      <AppShell theme={settings.theme} fontScale={settings.fontScale} recording={recording !== null}>
        {pinOpen ? (
          <PinScreen onSubmit={submitPin} error={pinError} busy={pinBusy} />
        ) : mode === "onehand" ? (
          <OneHandLayout {...layout} />
        ) : (
          <FacingLayout {...layout} />
        )}
        <SettingsSheet
          open={sheetOpen && !pinOpen}
          settings={settings}
          micDevices={SAMPLE_MICS}
          latencyLogs={SAMPLE_LOGS}
          transcriptsEnabled
          csvHref="/api/transcripts.csv"
          onChange={(patch) => setSettings((s) => ({ ...s, ...patch }))}
          onClearHistory={() => setEmpty(true)}
          onClose={() => setSheetOpen(false)}
        />
      </AppShell>

      {showHandle && !panelOpen && (
        <button
          type="button"
          className="fixed top-1/2 right-0 z-300 -translate-y-1/2 rounded-l-(--r-sm) bg-(--invert) px-1.5 py-3 text-[11px] font-bold text-(--invert-fg) [writing-mode:vertical-rl]"
          onClick={() => setPanelOpen(true)}
          aria-label="데모 컨트롤 열기"
        >
          DEMO
        </button>
      )}
      {panelOpen && (
        <div className="fixed inset-x-0 bottom-0 z-300 mx-auto flex max-h-[70dvh] max-w-[430px] flex-col gap-2 overflow-y-auto border-t border-(--hair-2) bg-(--card) p-3 text-(--ink)">
          <div className="flex items-center justify-between">
            <span className="text-sm font-black">데모 컨트롤</span>
            <button type="button" className="icon-btn" onClick={() => setPanelOpen(false)}>
              닫기
            </button>
          </div>
          <Row label="모드" options={MODES} value={mode} names={{ onehand: "한손", facing: "대면" }} onChange={(v) => setMode(v)} />
          <Row label="상대 언어" options={LANGS} value={lang} names={{ en: "EN", ja: "日本語", zh: "中文" }} onChange={(v) => setLang(v)} />
          <Row label="테마" options={THEMES} value={settings.theme} names={{ contrast: "고대비", dark: "다크" }} onChange={(theme) => setSettings((s) => ({ ...s, theme }))} />
          <Row
            label="글자"
            options={SCALES}
            value={String(settings.fontScale) as (typeof SCALES)[number]}
            names={{ "0": "1x", "1": "1.25x", "2": "1.5x" }}
            onChange={(v) => setSettings((s) => ({ ...s, fontScale: Number(v) as FontScale }))}
          />
          <Row label="녹음" options={RECS} value={recSpeaker ?? "none"} names={{ none: "없음", me: "한국어", partner: "상대" }} onChange={(v) => setRecSpeaker(v === "none" ? null : v)} />
          <Row label="배너" options={BANNERS} value={bannerKind} names={{ none: "없음" }} onChange={(v) => setBannerKind(v)} />
          <Row label="연결" options={STATUSES} value={status} onChange={(v) => setStatus(v)} />
          <Row label="세션" options={SESSIONS} value={sessionActive ? "on" : "off"} names={{ on: "번역 중", off: "중지됨" }} onChange={(v) => setSessionActive(v === "on")} />
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input type="checkbox" checked={late} onChange={(e) => setLate(e.target.checked)} /> 0:52부터 녹음
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input type="checkbox" checked={playingId !== null} onChange={(e) => setPlayingId(e.target.checked ? PLAYING_ID : null)} /> 재생 표시
            </label>
            <label className="flex items-center gap-1.5 text-xs font-bold">
              <input type="checkbox" checked={empty} onChange={(e) => setEmpty(e.target.checked)} /> 대화 비움
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn !min-h-9 text-sm" onClick={() => setSheetOpen(true)}>
              설정 열기
            </button>
            <button type="button" className="btn !min-h-9 text-sm" onClick={() => setPinOpen((v) => !v)}>
              PIN 화면 {pinOpen ? "닫기" : "열기"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
