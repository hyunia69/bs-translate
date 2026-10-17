import { AudioPlayer } from "../audio/player";
import { createEngine, createMockEngine, mockStats } from "../engine";
import { listMicrophones, onDevicesChanged } from "../platform/devices";
import { MicManager, type MicError } from "../platform/mic";
import { tryLockPortrait } from "../platform/orientation";
import { registerServiceWorker } from "../platform/pwa";
import { vibrateError, vibrateStart, vibrateStop } from "../platform/vibrate";
import { keepScreenOn } from "../platform/wakeLock";
import {
  MAX_RECORD_MS,
  type Direction,
  type DualPeer,
  type DualWireMessage,
  type EngineCallbacks,
  type EngineError,
  type EngineId,
  type Lang,
  type Message,
  type PartnerLang,
  type Settings,
  type Speaker,
  type TranslationEngine,
  type TurnEndInfo,
  type TurnLatencyLog,
} from "../types";
import { getConfig, postAuth, postLatencyLog, postTranscript } from "./api";
import {
  beaconDualLeave,
  getDualBooth,
  openGuestEvents,
  openMasterEvents,
  postBoothPin,
  postDualEnd,
  postDualLeave,
  postDualMessage,
  postDualRespond,
  postGuestRequest,
  postMasterJoin,
  type DualApiError,
  type DualEventHandlers,
  type DualEventStream,
  type GuestEvent,
  type MasterEvent,
} from "./dualApi";
import {
  INITIAL_DUAL,
  addDualMessage,
  addLatencyLog,
  addMessage,
  setDual,
  updateMessage,
  upsertPartnerMessage,
  useStore,
  type AppState,
} from "./store";

const AUDIBLE_THRESHOLD = 0.004;
const LOG_FALLBACK_MS = 3000;

interface Turn {
  id: string;
  direction: Direction;
  /** Dual turns are text only: never played, relayed to the partner. */
  dual: boolean;
  engineName: string;
  startedAtIso: string;
  startAt: number;
  stopAt: number | null;
  firstAudioAt: number | null;
  playbackAt: number | null;
  endAt: number | null;
  endInfo: TurnEndInfo | null;
  logTimer: ReturnType<typeof setTimeout> | null;
}

export const stats = { playbackStartsWhileRecording: 0, turns: 0, engineConfigures: 0, engineDisposes: 0 };

const player = new AudioPlayer();
const mic = new MicManager();
const turns = new Map<string, Turn>();

let engine: TranslationEngine | null = null;
let engineId: EngineId | null = null;
let engineGen = 0;
let configuredKey = "";
let starting = false;
let micOpened = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let wake: { release(): void } | null = null;
let initialized = false;

const get = useStore.getState;
const set = useStore.setState;

function busyRecording(): boolean {
  return starting || get().recordingTurnId !== null;
}

function directionsFor(partner: PartnerLang): Direction[] {
  return [
    { source: "ko", target: partner },
    { source: partner, target: "ko" },
  ];
}

/** Guests are always in dual mode; the master is when its settings say so. */
function dualActive(): boolean {
  const { dual, settings } = get();
  return dual.role === "guest" || settings.appMode === "dual";
}

/** APP_PIN for the master/basic app, the guest token for a paired guest (guests have no APP_PIN). */
function engineCredential(): string | null {
  const { pin, dual } = get();
  if (dual.role === "guest") return dual.phase === "paired" ? dual.token : null;
  return pin;
}

/** null while dual mode is not paired: then no engine may run. */
function engineDirections(): Direction[] | null {
  const { settings, dual } = get();
  if (!dualActive()) return directionsFor(settings.partnerLang);
  if (dual.phase !== "paired" || !dual.partner || !dual.myLang) return null;
  return [{ source: dual.myLang, target: dual.partner.lang }];
}

function maxAbs(pcm: Float32Array): number {
  let m = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.abs(pcm[i]);
    if (v > m) m = v;
  }
  return m;
}

function showApiError(message: string): void {
  set({ alert: { kind: "api_error", message } });
}

function makeCallbacks(gen: number): EngineCallbacks {
  const live = () => gen === engineGen;
  return {
    onSourceText: (id, delta) => {
      if (live()) updateMessage(id, (m) => ({ ...m, sourceText: m.sourceText + delta }));
    },
    onTargetText: (id, delta) => {
      if (live()) updateMessage(id, (m) => ({ ...m, targetText: m.targetText + delta }));
    },
    onAudio: (id, pcm, sampleRate) => {
      if (!live()) return;
      const t = turns.get(id);
      const dual = t ? t.dual : get().dualMessages.some((m) => m.id === id);
      // Dual mode plays no audio; the first sample is still timed for the latency log.
      if (!dual) player.append(id, pcm, sampleRate);
      if (t && t.stopAt !== null && t.firstAudioAt === null && maxAbs(pcm) > AUDIBLE_THRESHOLD) {
        t.firstAudioAt = performance.now();
      }
    },
    onTurnEnd: (id, info) => {
      if (live()) handleTurnEnd(id, info);
    },
    onError: (err) => {
      if (live()) handleEngineError(err);
    },
    onStatus: (status, detail) => {
      if (!live()) return;
      if (detail) console.info(`[engine] status ${status}: ${detail}`);
      set((s) => ({
        status,
        alert: status === "ready" && s.alert?.kind === "api_error" ? null : s.alert,
      }));
    },
  };
}

/** Creates and configures the engine for the current settings. Connects nothing unless a session is active. */
function syncEngine(): void {
  const { settings, mock, sessionActive } = get();
  const pin = engineCredential();
  if (!pin || !sessionActive) return;
  const directions = engineDirections();
  if (!directions) return;
  if (engine && engineId !== settings.engine) disposeEngine();
  if (!engine) {
    engineGen += 1;
    const cb = makeCallbacks(engineGen);
    engine = mock ? createMockEngine(cb) : createEngine(settings.engine, cb);
    engineId = settings.engine;
    configuredKey = "";
  }
  const key = `${directions.map((d) => `${d.source}>${d.target}`).join(",")}|${pin}`;
  if (key === configuredKey) return;
  configuredKey = key;
  stats.engineConfigures += 1;
  engine.configure({ directions, pin }).catch((err: unknown) => {
    console.error("[engine] configure failed", err);
    showApiError("번역 엔진을 준비하지 못했습니다.");
  });
}

/** Closes every engine connection. Open turns are finalized; ended turns still get their latency log. */
function disposeEngine(): void {
  if (get().recordingTurnId) stopTurn();
  engineGen += 1;
  if (engine) {
    engine.dispose();
    stats.engineDisposes += 1;
  }
  engine = null;
  engineId = null;
  configuredKey = "";
  for (const t of Array.from(turns.values())) {
    if (t.endAt === null) {
      if (t.logTimer) clearTimeout(t.logTimer);
      updateMessage(t.id, (m) => ({ ...m, status: m.targetText ? "done" : "error", hasAudio: player.hasAudio(t.id) }));
    } else {
      writeLatencyLog(t.id);
    }
  }
  turns.clear();
  set({ status: "idle" });
}

/**
 * "번역 시작하기": called from the tap handler so the connection (and the audio unlock) count as a user gesture.
 * Billing starts here and nowhere else.
 */
export function startSession(): void {
  const { pin, sessionActive } = get();
  if (!pin || sessionActive || dualActive()) return;
  beginSession();
}

function beginSession(): void {
  if (!engineCredential()) return;
  set({ sessionActive: true, sessionStartedAt: Date.now() });
  void player.resume();
  syncEngine();
}

/** "번역 중지": ends a running turn, closes all connections, stops playback. Safe to call while stopped. */
export function stopSession(): void {
  disposeEngine();
  player.stop();
  set((s) => ({
    sessionActive: false,
    sessionStartedAt: null,
    alert: s.alert?.kind === "api_error" ? null : s.alert,
  }));
}

function handleEngineError(err: EngineError): void {
  console.error(`[engine] ${err.code}: ${err.message}`, err.detail ?? "");
  if (err.code === "auth") {
    // A guest's token stops opening engine sessions once the master ended it; a guest never logs out.
    if (get().dual.role === "guest") guestEnded("ended");
    else logout("PIN이 올바르지 않습니다");
    return;
  }
  showApiError(err.message);
}

function clearRecordingUi(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (maxTimer) clearTimeout(maxTimer);
  tickTimer = null;
  maxTimer = null;
  mic.stopLevel();
  set({ recording: null, recordingTurnId: null });
}

function handleMicError(e: unknown): void {
  const err = e as Partial<MicError>;
  console.error("[mic]", e);
  vibrateError();
  if (err.kind === "denied") set({ alert: { kind: "mic_denied" } });
  else showApiError(err.message ?? "마이크를 열 수 없습니다.");
}

async function startTurn(speaker: Speaker, dual = false): Promise<void> {
  if (!engine || busyRecording()) return;
  if (dual !== dualActive()) return;
  starting = true;
  if (!dual) {
    void player.resume();
    player.stop();
  }
  vibrateStart();
  void tryLockPortrait();

  let track: MediaStreamTrack;
  try {
    track = await mic.open(get().settings.micDeviceId);
  } catch (e) {
    starting = false;
    handleMicError(e);
    return;
  }
  if (!micOpened) {
    micOpened = true;
    refreshMics();
  }
  const eng = engine;
  if (!eng) {
    starting = false;
    return;
  }
  let direction: Direction;
  if (dual) {
    const d = get().dual;
    if (d.phase !== "paired" || !d.partner || !d.myLang) {
      starting = false;
      return;
    }
    direction = { source: d.myLang, target: d.partner.lang };
  } else {
    // A turn may have ended (and started playing) while the mic was opening.
    player.stop();
    const partner = get().settings.partnerLang;
    direction = speaker === "me" ? { source: "ko", target: partner } : { source: partner, target: "ko" };
  }
  let id: string;
  try {
    id = eng.start(direction, track);
  } catch (err) {
    starting = false;
    console.error("[engine] start failed", err);
    showApiError("녹음을 시작할 수 없습니다.");
    return;
  }
  starting = false;

  const startAt = performance.now();
  turns.set(id, {
    id,
    direction,
    dual,
    engineName: eng.name,
    startedAtIso: new Date().toISOString(),
    startAt,
    stopAt: null,
    firstAudioAt: null,
    playbackAt: null,
    endAt: null,
    endInfo: null,
    logTimer: null,
  });
  const message: Message = {
    id,
    speaker,
    source: direction.source,
    target: direction.target,
    sourceText: "",
    targetText: "",
    status: "recording",
    createdAt: Date.now(),
    engine: eng.name,
    hasAudio: false,
  };
  if (dual) addDualMessage(message);
  else addMessage(message);
  set({ recording: { speaker, elapsedMs: 0, level: 0 }, recordingTurnId: id });
  mic.startLevel((level) => set((s) => (s.recording ? { recording: { ...s.recording, level } } : s)));
  tickTimer = setInterval(() => {
    set((s) => (s.recording ? { recording: { ...s.recording, elapsedMs: performance.now() - startAt } } : s));
  }, 100);
  maxTimer = setTimeout(stopTurn, MAX_RECORD_MS);
}

function stopTurn(): void {
  const id = get().recordingTurnId;
  if (!id) return;
  vibrateStop();
  const t = turns.get(id);
  if (t) t.stopAt = performance.now();
  // Recording state is cleared before engine.stop(): the engine may end the turn synchronously.
  clearRecordingUi();
  updateMessage(id, (m) => (m.status === "recording" ? { ...m, status: "translating" } : m));
  // Recording is over and the mic is detached, so playing now cannot echo: start the buffered
  // translation immediately and keep streaming the rest as it arrives (owner decision 2026-10-16).
  if (!t?.dual) {
    void player.resume();
    player.stream(id);
  }
  engine?.stop();
}

function handleTurnEnd(id: string, info: TurnEndInfo): void {
  const now = performance.now();
  if (get().recordingTurnId === id) clearRecordingUi();
  const t = turns.get(id);
  if (t) {
    t.stopAt ??= now;
    t.endAt = now;
    t.endInfo = info;
  }
  stats.turns += 1;

  const dual = t?.dual ?? false;
  const hasAudio = !dual && player.hasAudio(id);
  let finished: Message | undefined;
  updateMessage(id, (m) => {
    // A turn can end "completed" with no translation (observed live for ko->ja); show it as failed, not as a blank bubble.
    finished = { ...m, status: m.targetText.trim() ? "done" : "error", hasAudio };
    return finished;
  });

  // If the stream started at stop is still on, let it finish; if it was interrupted (new turn, replay), do not restart it.
  if (!dual) player.endStream(id);

  // Dual turns never play, so there is no playback start to wait for.
  if (t?.playbackAt != null || dual) writeLatencyLog(id);
  else if (t) t.logTimer = setTimeout(() => writeLatencyLog(id), LOG_FALLBACK_MS);

  const { pin, transcriptsEnabled } = get();
  if (finished && pin && transcriptsEnabled) postTranscript(pin, finished);
}

function writeLatencyLog(id: string): void {
  const t = turns.get(id);
  if (!t || t.endAt === null || t.stopAt === null || !t.endInfo) return;
  turns.delete(id);
  if (t.logTimer) clearTimeout(t.logTimer);
  const since = (at: number | null) => (at === null ? null : Math.round(at - (t.stopAt as number)));
  const log: TurnLatencyLog = {
    turnId: t.id,
    engine: t.engineName,
    source: t.direction.source,
    target: t.direction.target,
    recordMs: Math.round(t.stopAt - t.startAt),
    stopToFirstAudioMs: since(t.firstAudioAt),
    stopToPlaybackMs: since(t.playbackAt),
    stopToEndMs: since(t.endAt),
    endReason: t.endInfo.reason,
    audioBytesSent: t.endInfo.audioBytesSent ?? null,
    at: t.startedAtIso,
  };
  addLatencyLog(log);
  console.info("[latency]", log);
  const pin = get().pin;
  if (pin) postLatencyLog(pin, log);
}

function wirePlayer(): void {
  player.on("playbackstart", (turnId, atMs) => {
    if (busyRecording()) {
      stats.playbackStartsWhileRecording += 1;
      console.error("[player] playback started while recording", turnId);
    }
    set({ playingId: turnId });
    const t = turns.get(turnId);
    // Playback now usually starts at stop, before the turn ends; the log is written once both are known.
    if (t && t.playbackAt === null && t.stopAt !== null) {
      t.playbackAt = atMs;
      if (t.endAt !== null) writeLatencyLog(turnId);
    }
  });
  player.on("playbackend", (turnId) => {
    set((s) => (s.playingId === turnId ? { playingId: null } : s));
  });
}

function refreshMics(): void {
  listMicrophones()
    .then((micDevices) => set({ micDevices }))
    .catch((err: unknown) => console.error("[mic] listing devices failed", err));
}

function afterLogin(): void {
  const pin = get().pin;
  if (!pin) return;
  wake ??= keepScreenOn();
  syncEngine();
  refreshMics();
  if (get().settings.appMode === "dual") void refreshBooth();
  void getConfig(pin).then((cfg) => {
    if (get().pin !== pin) return;
    if (cfg === "unauthorized") logout("PIN이 올바르지 않습니다");
    else if (cfg) set({ transcriptsEnabled: cfg.saveTranscripts });
  });
}

function logout(error: string | null): void {
  masterStop();
  stopSession();
  wake?.release();
  wake = null;
  set({ pin: null, pinError: error, pinBusy: false, transcriptsEnabled: false, sheetOpen: false });
}

export async function submitPin(pin: string): Promise<void> {
  if (get().pinBusy) return;
  set({ pinBusy: true, pinError: null });
  const result = await postAuth(pin);
  if (result === "ok") {
    set({ pin, pinBusy: false, pinError: null });
    afterLogin();
    return;
  }
  const pinError =
    result === "invalid"
      ? "PIN이 올바르지 않습니다"
      : result === "rate_limited"
        ? "잠시 후 다시 시도해 주세요"
        : "서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요";
  set({ pinBusy: false, pinError });
}

export function pressTalk(speaker: Speaker): void {
  const rec = get().recording;
  if (rec) {
    if (rec.speaker === speaker) stopTurn();
    return;
  }
  void startTurn(speaker);
}

export function replay(id: string): void {
  if (busyRecording()) return;
  if (player.currentTurnId() === id) {
    player.stop();
    return;
  }
  void player.resume();
  void player.play(id);
}

export function updateSettings(patch: Partial<Settings>): void {
  const prev = get().settings;
  if (patch.partnerLang && patch.partnerLang !== prev.partnerLang && busyRecording()) return;
  const next = { ...prev, ...patch };
  set({ settings: next });
  if (next.appMode !== prev.appMode && get().dual.role === "master") {
    if (next.appMode === "dual") {
      stopSession();
      if (get().pin) void refreshBooth();
    } else {
      masterStop();
    }
  }
  if (next.engine !== prev.engine || next.partnerLang !== prev.partnerLang) syncEngine();
  if (next.micDeviceId !== prev.micDeviceId && micOpened && !busyRecording()) {
    mic.open(next.micDeviceId).then(refreshMics, handleMicError);
  }
}

export function clearHistory(): void {
  player.clear();
  set({ messages: [], playingId: null });
}

export function dismissAlert(): void {
  set({ alert: null });
}

export function setSheetOpen(sheetOpen: boolean): void {
  set({ sheetOpen });
}

// ---- Dual mode, v2 master/guest (docs/dual-protocol.md) ----

const DUAL_KEY = "ptt.dual";
const RELAY_MS = 200;
const LANGS: readonly Lang[] = ["ko", "en", "ja", "zh"];

type DualNotice =
  | "wrong_pin"
  | "master_offline"
  | "same_lang"
  | "network"
  | "rate_limited"
  | "ended"
  | "declined"
  | "replaced"
  | "guest_left"
  | "unavailable"
  | "connection_lost"
  | "pin_changed_failed";

const DUAL_NOTICES: Record<DualNotice, Record<Lang, string>> = {
  wrong_pin: {
    ko: "PIN 코드가 올바르지 않습니다",
    en: "The PIN code is incorrect",
    ja: "PINコードが正しくありません",
    zh: "PIN码不正确",
  },
  master_offline: {
    ko: "지금은 부스에 연결할 수 없습니다",
    en: "The booth is not available right now",
    ja: "現在ブースに接続できません",
    zh: "展位暂时无法连接",
  },
  same_lang: {
    ko: "부스와 같은 언어는 선택할 수 없습니다",
    en: "Please choose a language different from the booth's",
    ja: "ブースと同じ言語は選べません",
    zh: "不能选择与展位相同的语言",
  },
  network: {
    ko: "서버에 연결할 수 없습니다",
    en: "Cannot reach the server",
    ja: "サーバーに接続できません",
    zh: "无法连接服务器",
  },
  rate_limited: {
    ko: "잠시 후 다시 시도해 주세요",
    en: "Please try again shortly",
    ja: "しばらくしてからもう一度お試しください",
    zh: "请稍后再试",
  },
  ended: { ko: "대화가 종료되었습니다", en: "The conversation has ended", ja: "会話が終了しました", zh: "对话已结束" },
  declined: {
    ko: "요청이 거절되었습니다",
    en: "Your request was declined",
    ja: "リクエストが断られました",
    zh: "您的请求被拒绝了",
  },
  replaced: {
    ko: "다른 기기에서 부스를 시작해 연결이 종료되었습니다",
    en: "Another device took over the booth",
    ja: "別の端末がブースを開始したため接続が終了しました",
    zh: "另一台设备接管了展位，连接已结束",
  },
  guest_left: { ko: "상대방이 나갔습니다", en: "Your partner left", ja: "相手が退出しました", zh: "对方已离开" },
  unavailable: {
    ko: "이 요청은 지금 수락할 수 없습니다",
    en: "This request can no longer be accepted",
    ja: "このリクエストは現在受け付けられません",
    zh: "目前无法接受该请求",
  },
  connection_lost: { ko: "연결이 끊어졌습니다", en: "Connection lost", ja: "接続が切れました", zh: "连接已断开" },
  pin_changed_failed: {
    ko: "부스 PIN을 변경하지 못했습니다",
    en: "Could not change the booth PIN",
    ja: "ブースPINを変更できませんでした",
    zh: "无法更改展位PIN",
  },
};

/** Localized in the user's language: my dual language, else the role's default (guest: browser language, master: ko). */
function dualNotice(key: DualNotice, lang?: Lang): string {
  const d = get().dual;
  return DUAL_NOTICES[key][lang ?? d.myLang ?? (d.role === "guest" ? guestDefaultLang() : "ko")];
}

/** Last master language, for prefilling the master setup form only (never auto-joins). */
export function loadDualPrefill(): { lang: Lang } {
  try {
    const raw = localStorage.getItem(DUAL_KEY);
    const saved = raw ? (JSON.parse(raw) as { lang?: unknown } | null) : null;
    return { lang: LANGS.find((l) => l === saved?.lang) ?? "ko" };
  } catch {
    return { lang: "ko" };
  }
}

/** The guest entry screen always starts with English selected (owner decision 2026-10-17). */
export function guestDefaultLang(): Lang {
  return "en";
}

interface Relay {
  timer: ReturnType<typeof setTimeout> | null;
  lastAt: number;
  /** POSTs of one message are serialized so a stale update can never overtake the final one. */
  chain: Promise<void>;
  sent: string;
}

let dualStream: DualEventStream | null = null;
/** Bumped whenever the dual session is reset, so a join/request answering late is discarded. */
let joinGen = 0;
const relays = new Map<string, Relay>();

function closeDualStream(): void {
  dualStream?.close();
  dualStream = null;
}

function resetRelays(): void {
  for (const r of relays.values()) if (r.timer) clearTimeout(r.timer);
  relays.clear();
}

function toWire(m: Message): DualWireMessage {
  return {
    id: m.id,
    source: m.source,
    target: m.target,
    sourceText: m.sourceText,
    targetText: m.targetText,
    status: m.status,
    createdAt: m.createdAt,
  };
}

/** Queues a POST of the message's latest state (read when the POST actually goes out). */
function relayNow(id: string, r: Relay): void {
  r.lastAt = performance.now();
  r.chain = r.chain.then(async () => {
    const { dual, dualMessages } = get();
    const m = dualMessages.find((x) => x.id === id && x.speaker === "me");
    if (!m || !dual.token || dual.phase !== "paired") return;
    const wire = toWire(m);
    const json = JSON.stringify(wire);
    if (json === r.sent) return;
    r.sent = json;
    const res = await postDualMessage(dual.token, wire);
    if (res.ok) return;
    r.sent = "";
    if (res.error === "unknown_token" && get().dual.token === dual.token) connectionLost();
  });
}

/** At most one POST per RELAY_MS per message; done/error goes out at once. */
function relayChanged(m: Message): void {
  let r = relays.get(m.id);
  if (!r) {
    r = { timer: null, lastAt: -Infinity, chain: Promise.resolve(), sent: "" };
    relays.set(m.id, r);
  }
  if (m.status === "done" || m.status === "error") {
    if (r.timer) clearTimeout(r.timer);
    r.timer = null;
    relayNow(m.id, r);
    return;
  }
  if (r.timer) return;
  const wait = r.lastAt + RELAY_MS - performance.now();
  if (wait <= 0) {
    relayNow(m.id, r);
    return;
  }
  const relay = r;
  relay.timer = setTimeout(() => {
    relay.timer = null;
    relayNow(m.id, relay);
  }, wait);
}

function upsertWire(w: DualWireMessage): void {
  if (get().dual.phase !== "paired") return;
  upsertPartnerMessage({
    id: w.id,
    speaker: "partner",
    source: w.source,
    target: w.target,
    sourceText: w.sourceText,
    targetText: w.targetText,
    status: w.status,
    createdAt: w.createdAt,
    engine: "dual",
    hasAudio: false,
  });
}

/** Both roles: paired -> new conversation, engine started in one direction (myLang -> partner.lang). */
function enterPaired(partner: DualPeer): void {
  resetRelays();
  set((s) => ({
    dual: { ...s.dual, phase: "paired", partner, requests: s.dual.role === "guest" ? [] : s.dual.requests, notice: null },
    dualMessages: [],
  }));
  if (get().sessionActive) syncEngine();
  else beginSession();
}

/** Master only: the pairing ended, back to waiting for the next guest. */
function masterUnpaired(reason: "ended" | "guest_left"): void {
  if (get().dual.phase !== "paired") return;
  stopSession();
  resetRelays();
  setDual({ phase: "waiting", partner: null, notice: reason === "guest_left" ? dualNotice("guest_left") : null });
}

/** Back to setup: closes the stream and the engine. Keeps the role and the booth info. */
function resetDual(notice: string | null): void {
  joinGen += 1;
  closeDualStream();
  if (get().sessionActive && dualActive()) stopSession();
  resetRelays();
  set((s) => ({
    dual: {
      ...INITIAL_DUAL,
      role: s.dual.role,
      boothPin: s.dual.boothPin,
      masterOnline: s.dual.masterOnline,
      masterLang: s.dual.masterLang,
      notice,
    },
  }));
}

/** Guest only: the session is over (ended event, engine auth error, lost stream); back to the entry screen. */
function guestEnded(notice: DualNotice): void {
  resetDual(dualNotice(notice));
  void refreshBooth();
}

function connectionLost(): void {
  if (get().dual.role === "guest") guestEnded("connection_lost");
  else resetDual(dualNotice("connection_lost"));
}

function dualActionFailed(token: string, error: DualApiError): void {
  if (get().dual.token !== token) return;
  if (error === "unknown_token") {
    connectionLost();
    return;
  }
  const notice: DualNotice =
    error === "busy" || error === "unavailable" ? "unavailable" : error === "rate_limited" ? error : "network";
  setDual({ notice: dualNotice(notice) });
}

function masterHandlers(): DualEventHandlers<MasterEvent> {
  return {
    state: (e) => {
      setDual({ boothPin: e.boothPin, requests: e.requests });
      const phase = get().dual.phase;
      if (e.partner && phase !== "paired") enterPaired(e.partner);
      // Paired before the stream dropped, but the pairing ended meanwhile.
      else if (!e.partner && phase === "paired") masterUnpaired("guest_left");
    },
    requests: (e) => setDual({ requests: e.requests }),
    booth_pin: (e) => setDual({ boothPin: e.boothPin }),
    paired: (e) => {
      if (get().dual.phase !== "paired") enterPaired(e.partner);
    },
    unpaired: (e) => masterUnpaired(e.reason),
    message: (e) => upsertWire(e.message),
    replaced: () => resetDual(dualNotice("replaced")),
    closed: connectionLost,
  };
}

function guestHandlers(): DualEventHandlers<GuestEvent> {
  return {
    state: (e) => {
      if (e.status === "paired" && e.partner && get().dual.phase !== "paired") enterPaired(e.partner);
    },
    paired: (e) => {
      if (get().dual.phase !== "paired") enterPaired(e.partner);
    },
    message: (e) => upsertWire(e.message),
    ended: (e) => guestEnded(e.reason === "declined" ? "declined" : "ended"),
    closed: connectionLost,
  };
}

/** GET /api/dual/booth -> boothPin / masterOnline / masterLang. Failures keep the last known values. */
export async function refreshBooth(): Promise<void> {
  const res = await getDualBooth();
  if (!res.ok) return;
  const { boothPin, masterOnline, masterLang } = res.value;
  setDual({ boothPin, masterOnline, masterLang });
}

/** Master: setup -> joining -> waiting (booth PIN on screen, guest requests arrive over SSE). */
export async function masterStart(lang: Lang): Promise<void> {
  const { pin, dual, settings } = get();
  if (!pin || dual.role !== "master" || settings.appMode !== "dual" || dual.phase !== "setup") return;
  try {
    localStorage.setItem(DUAL_KEY, JSON.stringify({ lang }));
  } catch (err) {
    console.error("[dual] saving prefill failed", err);
  }
  const gen = ++joinGen;
  setDual({ phase: "joining", myLang: lang, token: null, requests: [], partner: null, notice: null });
  const res = await postMasterJoin(pin, lang);
  if (gen !== joinGen) {
    // Stopped (or switched to basic) while joining: do not keep the server-side master around.
    if (res.ok) void postDualLeave(res.value.token);
    return;
  }
  if (!res.ok) {
    if (res.error === "invalid_pin") {
      resetDual(null);
      logout("PIN이 올바르지 않습니다");
      return;
    }
    resetDual(dualNotice(res.error === "rate_limited" ? "rate_limited" : "network", lang));
    return;
  }
  setDual({ phase: "waiting", token: res.value.token, boothPin: res.value.boothPin, masterOnline: true, masterLang: lang });
  closeDualStream();
  dualStream = openMasterEvents(res.value.token, masterHandlers());
}

/** Master: leaves on the server (any guests are ended), stops the engine; back to setup. */
export function masterStop(): void {
  const { token, role } = get().dual;
  if (role !== "master") return;
  if (token) void postDualLeave(token);
  resetDual(null);
}

/** Master: accept or decline a pending guest. The server answers with paired/requests events. */
export function masterRespond(guestId: string, accept: boolean): void {
  const { token, role } = get().dual;
  if (!token || role !== "master") return;
  setDual((d) => ({ requests: d.requests.filter((r) => r.id !== guestId), notice: null }));
  void postDualRespond(token, guestId, accept).then((res) => {
    if (res.ok) return;
    dualActionFailed(token, res.error);
  });
}

/** Master (APP_PIN): sets a new 4-digit booth PIN. False (and an alert) on failure. */
export async function changeBoothPin(boothPin: string): Promise<boolean> {
  const pin = get().pin;
  if (!pin) return false;
  const res = await postBoothPin(pin, boothPin);
  if (res.ok) {
    setDual({ boothPin: res.value.boothPin });
    return true;
  }
  if (res.error === "invalid_pin") logout("PIN이 올바르지 않습니다");
  else showApiError(dualNotice("pin_changed_failed"));
  return false;
}

/** Guest: setup -> requesting; waits for the master's answer over SSE. Errors return to setup with a notice. */
export async function guestRequest(pin: string, lang: Lang): Promise<void> {
  const { dual } = get();
  if (dual.role !== "guest" || dual.phase !== "setup") return;
  const gen = ++joinGen;
  setDual({ phase: "requesting", myLang: lang, token: null, guestId: null, partner: null, notice: null });
  const res = await postGuestRequest(pin, lang);
  if (gen !== joinGen) {
    // Cancelled while requesting: do not leave a pending request on the master's screen.
    if (res.ok) void postDualLeave(res.value.token);
    return;
  }
  if (!res.ok) {
    const notice: DualNotice =
      res.error === "wrong_pin" ||
      res.error === "master_offline" ||
      res.error === "same_lang" ||
      res.error === "rate_limited"
        ? res.error
        : "network";
    resetDual(dualNotice(notice, lang));
    void refreshBooth();
    return;
  }
  setDual({ token: res.value.token, guestId: res.value.guestId });
  closeDualStream();
  dualStream = openGuestEvents(res.value.token, guestHandlers());
}

/** Guest: withdraws the request or leaves the conversation; back to the entry screen. */
export function guestCancel(): void {
  const { token, role } = get().dual;
  if (role !== "guest") return;
  if (token) void postDualEnd(token);
  resetDual(null);
  void refreshBooth();
}

/** The End button. Master: ends the pairing for both phones, back to waiting at once. Guest: same as guestCancel. */
export function dualEnd(): void {
  const { token, phase, role } = get().dual;
  if (role === "guest") {
    guestCancel();
    return;
  }
  if (!token || phase !== "paired") return;
  masterUnpaired("ended");
  void postDualEnd(token).then((res) => {
    if (!res.ok) dualActionFailed(token, res.error);
  });
}

/** The single dual talk key: tap starts my turn (myLang -> partner.lang), tap again stops it. */
export function pressDualTalk(): void {
  if (get().dual.phase !== "paired") return;
  if (get().recording) {
    stopTurn();
    return;
  }
  void startTurn("me", true);
}

function dualPageHide(): void {
  const token = get().dual.token;
  if (!token) return;
  beaconDualLeave(token);
  // A page restored from the back/forward cache starts at setup; the server member is gone.
  resetDual(null);
}

declare global {
  interface Window {
    __ptt?: {
      getState(): AppState;
      stats: typeof stats;
      mockStats?: typeof mockStats;
    };
  }
}

export function initController(): void {
  if (initialized) return;
  initialized = true;
  registerServiceWorker();
  wirePlayer();
  window.addEventListener("online", () => set({ online: true }));
  window.addEventListener("offline", () => set({ online: false }));
  // Closing the tab must stop billing promptly; a page restored from the back/forward cache simply starts stopped.
  window.addEventListener("pagehide", stopSession);
  window.addEventListener("pagehide", dualPageHide);
  useStore.subscribe((s, prev) => {
    if (s.dualMessages === prev.dualMessages) return;
    const old = new Set(prev.dualMessages);
    for (const m of s.dualMessages) if (m.speaker === "me" && !old.has(m)) relayChanged(m);
  });
  onDevicesChanged(refreshMics);
  window.__ptt = { getState: get, stats, ...(get().mock ? { mockStats } : {}) };
  if (get().dual.role === "guest") {
    // Guests skip the APP_PIN screen: no getConfig, no logs, no transcripts.
    wake ??= keepScreenOn();
    void refreshBooth();
  } else if (get().pin) {
    afterLogin();
  }
}
