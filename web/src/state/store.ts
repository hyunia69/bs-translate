import { create } from "zustand";
import type { ConnectionStatus, DualState, Message, Settings } from "../types";
import type { MicDevice, RecordingState } from "../ui/props";

export const PIN_KEY = "ptt.pin";
const SETTINGS_KEY = "ptt.settings";
const MESSAGES_KEY = "ptt.messages";
const MAX_MESSAGES = 200;

export const DEFAULT_SETTINGS: Settings = {
  partnerLang: "en",
  engine: "gpt-live",
  fontScale: 0,
  theme: "contrast",
  mode: "onehand",
  micDeviceId: null,
  appMode: "basic",
};

/** Guests open the booth QR target `/guest`; every other path is the master (APP_PIN) app. */
export function isGuestRoute(): boolean {
  return window.location.pathname.startsWith("/guest");
}

export const INITIAL_DUAL: DualState = {
  role: isGuestRoute() ? "guest" : "master",
  phase: "setup",
  myLang: null,
  token: null,
  guestId: null,
  boothPin: null,
  masterOnline: false,
  masterLang: null,
  requests: [],
  partner: null,
  notice: null,
};

export type AlertBanner = { kind: "mic_denied" | "api_error"; message?: string };

export interface AppState {
  pin: string | null;
  pinBusy: boolean;
  pinError: string | null;
  settings: Settings;
  messages: Message[];
  status: ConnectionStatus;
  /**
   * True between "번역 시작하기" and "번역 중지": only then does an engine exist and bill.
   * Never persisted: every app load starts stopped.
   */
  sessionActive: boolean;
  /** Epoch ms when the current session started; null while stopped. */
  sessionStartedAt: number | null;
  online: boolean;
  alert: AlertBanner | null;
  recording: RecordingState | null;
  recordingTurnId: string | null;
  playingId: string | null;
  micDevices: MicDevice[];
  sheetOpen: boolean;
  mock: boolean;
  /** Dual mode (docs/dual-protocol.md). Never persisted. */
  dual: DualState;
  /** Both sides' dual utterances; memory only, cleared on each new pairing. Basic `messages` are separate. */
  dualMessages: Message[];
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function loadSettings(): Settings {
  const saved = readJson<Partial<Settings>>(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
}

function loadMessages(): Message[] {
  const saved = readJson<Message[]>(MESSAGES_KEY);
  if (!Array.isArray(saved)) return [];
  return saved.slice(-MAX_MESSAGES).map((m) => ({
    ...m,
    hasAudio: false,
    status: m.status === "recording" || m.status === "translating" ? (m.targetText ? "done" : "error") : m.status,
  }));
}

export const useStore = create<AppState>(() => ({
  // A guest has no APP_PIN, even on a device where the master once logged in.
  pin: isGuestRoute() ? null : localStorage.getItem(PIN_KEY),
  pinBusy: false,
  pinError: null,
  settings: loadSettings(),
  messages: loadMessages(),
  status: "idle",
  sessionActive: false,
  sessionStartedAt: null,
  online: navigator.onLine,
  alert: null,
  recording: null,
  recordingTurnId: null,
  playingId: null,
  micDevices: [],
  sheetOpen: false,
  mock: new URLSearchParams(window.location.search).get("mock") === "1",
  dual: INITIAL_DUAL,
  dualMessages: [],
}));

/** Updates one of my turns, in `dualMessages` when the turn is a dual turn, else in `messages`. */
export function updateMessage(id: string, fn: (m: Message) => Message): void {
  useStore.setState((s) => {
    const d = s.dualMessages.findIndex((m) => m.id === id && m.speaker === "me");
    if (d >= 0) {
      const dualMessages = s.dualMessages.slice();
      dualMessages[d] = fn(dualMessages[d]);
      return { dualMessages };
    }
    const i = s.messages.findIndex((m) => m.id === id);
    if (i < 0) return s;
    const messages = s.messages.slice();
    messages[i] = fn(messages[i]);
    return { messages };
  });
}

export function addMessage(m: Message): void {
  useStore.setState((s) => ({ messages: [...s.messages, m].slice(-MAX_MESSAGES) }));
}

export function addDualMessage(m: Message): void {
  useStore.setState((s) => ({ dualMessages: [...s.dualMessages, m].slice(-MAX_MESSAGES) }));
}

/** Inserts or replaces the partner's utterance with this id. */
export function upsertPartnerMessage(m: Message): void {
  useStore.setState((s) => {
    const i = s.dualMessages.findIndex((x) => x.id === m.id && x.speaker === "partner");
    if (i < 0) return { dualMessages: [...s.dualMessages, m].slice(-MAX_MESSAGES) };
    const dualMessages = s.dualMessages.slice();
    dualMessages[i] = m;
    return { dualMessages };
  });
}

export function setDual(patch: Partial<DualState> | ((d: DualState) => Partial<DualState>)): void {
  useStore.setState((s) => ({ dual: { ...s.dual, ...(typeof patch === "function" ? patch(s.dual) : patch) } }));
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

useStore.subscribe((s, prev) => {
  if (s.settings !== prev.settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(s.settings));
  if (s.pin !== prev.pin) {
    if (s.pin) localStorage.setItem(PIN_KEY, s.pin);
    else localStorage.removeItem(PIN_KEY);
  }
  if (s.messages !== prev.messages) {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      const text = useStore.getState().messages.map((m) => ({ ...m, hasAudio: false }));
      try {
        localStorage.setItem(MESSAGES_KEY, JSON.stringify(text));
      } catch (err) {
        console.error("[store] saving messages failed", err);
      }
    }, 400);
  }
});
