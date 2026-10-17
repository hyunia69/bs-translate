import type {
  ConnectionStatus,
  Direction,
  EngineCallbacks,
  EngineConfig,
  EngineError,
  EngineId,
  TranslationEngine,
} from "../types";
import { RemoteCapture } from "./remoteCapture";
import { WarmSession, type TurnSink } from "./warmSession";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const ERROR_AFTER_FAILURES = 5;
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 10_000;
const LOST_AUDIO_LOG_MS = 150;

interface Slot {
  key: string;
  direction: Direction;
  session: WarmSession | null;
  failures: number;
  authFailed: boolean;
  backoffTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
}

interface Turn {
  id: string;
  session: WarmSession;
  ended: boolean;
}

const dirKey = (d: Direction): string => `${d.source}-${d.target}`;

export class RealtimeTranslateEngine implements TranslationEngine {
  readonly id: EngineId = "realtime-translate";
  readonly name = "gpt-realtime-translate";

  private readonly slots = new Map<string, Slot>();
  private readonly capture = new RemoteCapture();
  private readonly turns = new Set<Turn>();
  private current: Turn | null = null;
  private pin = "";
  private offline = typeof navigator !== "undefined" && navigator.onLine === false;
  private everReady = false;
  private disposed = false;
  private lastStatus: { status: ConnectionStatus; detail?: string } | null = null;

  constructor(private readonly cb: EngineCallbacks) {
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
  }

  async configure(config: EngineConfig): Promise<void> {
    if (this.disposed) return;
    const pinChanged = config.pin !== this.pin;
    this.pin = config.pin;
    const wanted = new Map(config.directions.map((d) => [dirKey(d), d]));

    for (const [key, slot] of this.slots) {
      if (!wanted.has(key)) {
        this.disposeSlot(slot);
        this.slots.delete(key);
      }
    }
    for (const [key, direction] of wanted) {
      const existing = this.slots.get(key);
      if (!existing) {
        this.everReady = false;
        const slot: Slot = {
          key,
          direction,
          session: null,
          failures: 0,
          authFailed: false,
          backoffTimer: null,
          refreshTimer: null,
        };
        this.slots.set(key, slot);
        this.warm(slot);
      } else if (pinChanged || existing.authFailed) {
        existing.authFailed = false;
        existing.failures = 0;
        this.warm(existing);
      } else if (!existing.session && !existing.backoffTimer) {
        this.warm(existing);
      }
    }
    void this.capture.warm().catch((err: unknown) => console.warn("[engine] capture warm-up failed", err));
    this.updateStatus();
  }

  start(direction: Direction, micTrack: MediaStreamTrack): string {
    const id = crypto.randomUUID();
    if (this.current) this.stop();
    const slot = this.slots.get(dirKey(direction));
    if (!slot || this.disposed) {
      queueMicrotask(() => {
        this.cb.onError({ code: "unknown", message: "설정되지 않은 통역 방향입니다", turnId: id });
        this.cb.onTurnEnd(id, { reason: "error" });
      });
      return id;
    }
    if (slot.authFailed) {
      queueMicrotask(() => {
        this.cb.onError({ code: "auth", message: "PIN이 올바르지 않습니다", turnId: id });
        this.cb.onTurnEnd(id, { reason: "error" });
      });
      return id;
    }

    const session = slot.session ?? this.newSession(slot);
    const turn: Turn = { id, session, ended: false };
    this.turns.add(turn);
    this.current = turn;
    slot.session = null;
    this.clearSlotTimers(slot);

    const sink: TurnSink = {
      onBound: ({ lostMs }) => {
        if (lostMs > LOST_AUDIO_LOG_MS) {
          console.warn(`[engine] turn bound after connect gap; ~${Math.round(lostMs)} ms of speech was not sent`);
        }
      },
      onSourceText: (d) => this.cb.onSourceText(id, d),
      onTargetText: (d) => this.cb.onTargetText(id, d),
      onAudio: (pcm, rate) => this.cb.onAudio(id, pcm, rate),
      onError: (err) => this.cb.onError({ ...err, turnId: id }),
      onEnd: (reason, audioBytesSent) => this.endTurn(turn, reason, audioBytesSent),
    };
    session.bindWhenReady(id, micTrack, sink);
    this.warm(slot);
    return id;
  }

  stop(): void {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    if (turn.session.stop() === "cancelled") {
      console.warn("[engine] stop before the session was ready; speech was lost");
      turn.session.dispose();
      this.cb.onError({ code: "network", message: "연결 준비 중이라 음성이 전달되지 않았습니다", turnId: turn.id });
      this.endTurn(turn, "error", undefined);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
    for (const slot of this.slots.values()) this.disposeSlot(slot);
    this.slots.clear();
    for (const turn of this.turns) {
      turn.ended = true;
      turn.session.dispose();
    }
    this.turns.clear();
    this.current = null;
    this.capture.close();
  }

  private endTurn(turn: Turn, reason: "completed" | "timeout" | "error", audioBytesSent: number | undefined): void {
    if (turn.ended) return;
    turn.ended = true;
    this.turns.delete(turn);
    if (this.current === turn) this.current = null;
    this.cb.onTurnEnd(turn.id, { reason, audioBytesSent });
  }

  private newSession(slot: Slot): WarmSession {
    const session = new WarmSession(slot.direction, {
      pin: this.pin,
      capture: this.capture,
      events: {
        onReady: (s) => this.onSessionReady(slot, s),
        onFailed: (s, err) => this.onSessionFailed(slot, s, err),
        onError: (err) => this.cb.onError(err),
      },
    });
    session.start();
    return session;
  }

  private warm(slot: Slot): void {
    this.clearSlotTimers(slot);
    slot.session?.dispose();
    slot.session = this.newSession(slot);
    this.updateStatus();
  }

  private onSessionReady(slot: Slot, session: WarmSession): void {
    if (slot.session !== session) return;
    slot.failures = 0;
    if (session.expiresAtMs !== null) {
      const delay = Math.max(MIN_REFRESH_DELAY_MS, session.expiresAtMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
      slot.refreshTimer = setTimeout(() => {
        slot.refreshTimer = null;
        if (slot.session === session && session.state === "ready") this.warm(slot);
      }, delay);
    }
    this.updateStatus();
  }

  private onSessionFailed(slot: Slot, session: WarmSession, err: EngineError): void {
    if (slot.session !== session) return;
    slot.session = null;
    slot.failures += 1;
    console.warn(`[engine] warm session ${slot.key} failed (#${slot.failures}): ${err.message}`);
    if (err.code === "auth") {
      slot.authFailed = true;
      this.cb.onError(err);
      this.updateStatus();
      return;
    }
    if (slot.failures === 1 || slot.failures === ERROR_AFTER_FAILURES) this.cb.onError(err);
    const delay = BACKOFF_MS[Math.min(slot.failures - 1, BACKOFF_MS.length - 1)] ?? 15000;
    slot.backoffTimer = setTimeout(() => {
      slot.backoffTimer = null;
      if (!this.offline && this.slots.get(slot.key) === slot && !slot.session) this.warm(slot);
    }, delay);
    this.updateStatus();
  }

  private clearSlotTimers(slot: Slot): void {
    if (slot.backoffTimer) clearTimeout(slot.backoffTimer);
    if (slot.refreshTimer) clearTimeout(slot.refreshTimer);
    slot.backoffTimer = null;
    slot.refreshTimer = null;
  }

  private disposeSlot(slot: Slot): void {
    this.clearSlotTimers(slot);
    slot.session?.dispose();
    slot.session = null;
  }

  private updateStatus(): void {
    if (this.disposed) return;
    const slots = [...this.slots.values()];
    let next: { status: ConnectionStatus; detail?: string };
    if (this.offline) next = { status: "offline" };
    else if (slots.some((s) => s.authFailed)) next = { status: "error", detail: "auth" };
    else if (slots.some((s) => s.failures >= ERROR_AFTER_FAILURES)) next = { status: "error", detail: "connect" };
    else if (slots.some((s) => s.failures > 0)) next = { status: "reconnecting" };
    else {
      if (slots.length > 0 && slots.every((s) => s.session?.state === "ready")) this.everReady = true;
      next = { status: this.everReady ? "ready" : "connecting" };
    }
    if (this.lastStatus?.status === next.status && this.lastStatus.detail === next.detail) return;
    this.lastStatus = next;
    this.cb.onStatus(next.status, next.detail);
  }

  private readonly handleOffline = (): void => {
    this.offline = true;
    this.updateStatus();
  };

  private readonly handleOnline = (): void => {
    this.offline = false;
    for (const slot of this.slots.values()) {
      slot.failures = 0;
      this.warm(slot);
    }
    this.updateStatus();
  };
}
