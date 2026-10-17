// Shared contracts. Every module (engine, UI, controller, platform) builds against this file.
// Change it only together with all of its users.

export type Lang = "ko" | "en" | "ja" | "zh";
export type PartnerLang = Exclude<Lang, "ko">;
/** me = Korean sales rep, partner = foreign visitor */
export type Speaker = "me" | "partner";

export interface Direction {
  source: Lang;
  target: Lang;
}

export type EngineId = "realtime-translate" | "gpt-live";

export type ConnectionStatus = "idle" | "connecting" | "ready" | "reconnecting" | "offline" | "error";

export type EngineErrorCode = "network" | "auth" | "rate_limit" | "api" | "mic" | "unknown";

export interface EngineError {
  code: EngineErrorCode;
  /** Short Korean message for the banner. */
  message: string;
  /** Raw detail for logs only. */
  detail?: unknown;
  turnId?: string;
}

export type TurnEndReason = "completed" | "timeout" | "error";

export interface TurnEndInfo {
  reason: TurnEndReason;
  /** Bytes of audio RTP actually sent during the turn (from RTCPeerConnection.getStats), if known. */
  audioBytesSent?: number;
}

export interface EngineCallbacks {
  /** Append-only source-language transcript fragment. Do not insert spaces between fragments. */
  onSourceText(turnId: string, delta: string): void;
  /** Append-only translated transcript fragment. */
  onTargetText(turnId: string, delta: string): void;
  /** Translated speech, mono Float32 PCM in [-1, 1]. Never played by the engine itself. */
  onAudio(turnId: string, pcm: Float32Array, sampleRate: number): void;
  /** All output of the turn has been received (or the drain timed out). Fired exactly once per turn. */
  onTurnEnd(turnId: string, info: TurnEndInfo): void;
  onError(err: EngineError): void;
  onStatus(status: ConnectionStatus, detail?: string): void;
}

export interface EngineConfig {
  /** Directions to keep warm, e.g. ko->en and en->ko. */
  directions: Direction[];
  pin: string;
}

export interface TranslationEngine {
  readonly id: EngineId;
  /** Model name for logs, e.g. "gpt-realtime-translate". */
  readonly name: string;
  /** (Re)configure and warm up connections for the given directions. Safe to call repeatedly. */
  configure(config: EngineConfig): Promise<void>;
  /** Begin a turn: from now on the mic track's audio is sent. Returns the turn id. */
  start(direction: Direction, micTrack: MediaStreamTrack): string;
  /** End the turn: stop sending audio immediately, keep receiving until onTurnEnd. */
  stop(): void;
  dispose(): void;
}

export type MessageStatus = "recording" | "translating" | "done" | "error";

export interface Message {
  id: string; // equals the engine turn id
  speaker: Speaker;
  source: Lang;
  target: Lang;
  sourceText: string;
  targetText: string;
  status: MessageStatus;
  createdAt: number;
  engine: string;
  /** True once translated audio exists for replay. */
  hasAudio: boolean;
}

export type FontScale = 0 | 1 | 2;
export type Theme = "contrast" | "dark";
export type LayoutMode = "onehand" | "facing";
/** basic = one phone shared by two speakers; dual = each speaker on their own phone (docs/dual-protocol.md). */
export type AppMode = "basic" | "dual";

export interface Settings {
  partnerLang: PartnerLang;
  engine: EngineId;
  fontScale: FontScale;
  theme: Theme;
  mode: LayoutMode;
  micDeviceId: string | null;
  appMode: AppMode;
}

// ---- Dual mode (contract: docs/dual-protocol.md) ----

/** master = the booth phone (APP_PIN user, appMode "dual"); guest = a visitor who opened /guest. */
export type DualRole = "master" | "guest";

/** The other side of a pairing. For a guest the id is its 3-digit guest number; the master's id is "master". */
export interface DualPeer {
  id: string;
  lang: Lang;
}

/**
 * master: setup -> joining -> waiting <-> paired
 * guest:  setup -> requesting -> paired -> (ended) setup
 */
export type DualPhase = "setup" | "joining" | "waiting" | "requesting" | "paired";

export interface DualState {
  role: DualRole;
  phase: DualPhase;
  myLang: Lang | null;
  /** Server-issued token (master join or guest request); null in setup. */
  token: string | null;
  /** My guest number (guest role only). */
  guestId: string | null;
  /** Current booth PIN from the server (GET /api/dual/booth or master events). */
  boothPin: string | null;
  /** Guest entry screen: is a master waiting, and in which language. */
  masterOnline: boolean;
  masterLang: Lang | null;
  /** Master only: pending guest requests, oldest first. */
  requests: DualPeer[];
  partner: DualPeer | null;
  /** Short message for the setup/waiting screen, already in my language. */
  notice: string | null;
}

/** One utterance relayed to the partner's phone, sent repeatedly as it grows (upsert by id). */
export interface DualWireMessage {
  id: string;
  source: Lang;
  target: Lang;
  sourceText: string;
  targetText: string;
  status: MessageStatus;
  createdAt: number;
}

export interface TurnLatencyLog {
  turnId: string;
  engine: string;
  source: Lang;
  target: Lang;
  recordMs: number;
  /** stop tap -> first translated audio sample received (ms) */
  stopToFirstAudioMs: number | null;
  /** stop tap -> playback actually started (ms) */
  stopToPlaybackMs: number | null;
  /** stop tap -> onTurnEnd (ms) */
  stopToEndMs: number | null;
  endReason: TurnEndReason;
  audioBytesSent: number | null;
  at: string; // ISO time
}

/** Server API contract (all JSON). */
export interface SessionRequest {
  pin: string;
  source: Lang;
  target: Lang;
}
export interface SessionResponse {
  /** Translation session client secret ("ek_..."), from POST /v1/realtime/translations/client_secrets. */
  translation: { value: string; expires_at: number };
}

export const LANG_LABEL: Record<Lang, string> = { ko: "한국어", en: "English", ja: "日本語", zh: "中文" };
export const LANG_FLAG: Record<Lang, string> = { ko: "🇰🇷", en: "🇺🇸", ja: "🇯🇵", zh: "🇨🇳" };
export const MAX_RECORD_MS = 60_000;
