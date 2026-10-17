import type {
  ConnectionStatus,
  Direction,
  EngineCallbacks,
  EngineConfig,
  EngineError,
  EngineId,
  TranslationEngine,
} from "../types";
import { LiveSession, type LiveTurnSink } from "./liveSession";
import { RemoteCapture } from "./remoteCapture";

const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000];
const ERROR_AFTER_FAILURES = 5;
const REFRESH_BEFORE_EXPIRY_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 10_000;
const REFRESH_RETRY_MS = 5000;
const EARLY_CLOSE_MS = 5000;

interface Slot {
  key: string;
  direction: Direction;
  session: LiveSession | null;
  failures: number;
  authFailed: boolean;
  backoffTimer: ReturnType<typeof setTimeout> | null;
  refreshTimer: ReturnType<typeof setTimeout> | null;
}

interface Turn {
  id: string;
  session: LiveSession;
  ended: boolean;
}

const dirKey = (d: Direction): string => `${d.source}-${d.target}`;

// TODO(api): Korean/Japanese/Chinese support of gpt-live-1 is undocumented (no supported-language list in the docs);
// the official translation prompt is single-target ("[language] ONLY"), so the server owns the per-direction instructions.
export class GptLiveEngine implements TranslationEngine {
  readonly id: EngineId = "gpt-live";
  readonly name = "gpt-live-1";

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
    void this.capture.warm().catch((err: unknown) => console.warn("[engine:live] capture warm-up failed", err));
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

    if (!slot.session) this.warm(slot);
    const session = slot.session as LiveSession;
    const turn: Turn = { id, session, ended: false };
    this.turns.add(turn);
    this.current = turn;
    if (slot.refreshTimer) clearTimeout(slot.refreshTimer);
    slot.refreshTimer = null;

    const sink: LiveTurnSink = {
      onSourceText: (d) => this.cb.onSourceText(id, d),
      onTargetText: (d) => this.cb.onTargetText(id, d),
      onAudio: (pcm, rate) => this.cb.onAudio(id, pcm, rate),
      onError: (err) => this.cb.onError({ ...err, turnId: id }),
      onEnd: (reason, audioBytesSent) => this.endTurn(turn, reason, audioBytesSent),
    };
    session.bindWhenReady(id, micTrack, sink);
    return id;
  }

  stop(): void {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    if (turn.session.stop() === "cancelled") {
      console.warn("[engine:live] stop before the session was ready; speech was lost");
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
    for (const turn of this.turns) turn.ended = true;
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

  private warm(slot: Slot): void {
    this.clearSlotTimers(slot);
    slot.session?.dispose();
    const session = new LiveSession(slot.direction, {
      pin: this.pin,
      capture: this.capture,
      events: {
        onReady: (s) => this.onSessionReady(slot, s),
        onFailed: (s, err) => this.onSessionFailed(slot, s, err),
        onServerClosed: (s, reason) => this.onServerClosed(slot, s, reason),
        onError: (err) => this.cb.onError(err),
      },
    });
    slot.session = session;
    session.start();
    this.updateStatus();
  }

  private onSessionReady(slot: Slot, session: LiveSession): void {
    if (slot.session !== session) return;
    slot.failures = 0;
    this.scheduleRefresh(slot, session);
    this.updateStatus();
  }

  private scheduleRefresh(slot: Slot, session: LiveSession): void {
    if (slot.refreshTimer) clearTimeout(slot.refreshTimer);
    slot.refreshTimer = null;
    if (session.expiresAtMs === null) return;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, session.expiresAtMs - Date.now() - REFRESH_BEFORE_EXPIRY_MS);
    slot.refreshTimer = setTimeout(() => {
      slot.refreshTimer = null;
      if (slot.session !== session) return;
      if (session.state === "ready") this.warm(slot);
      else if (session.state !== "ended") slot.refreshTimer = setTimeout(() => this.retryRefresh(slot, session), REFRESH_RETRY_MS);
    }, delay);
  }

  /** A turn was bound when the refresh came due: wait until the session is idle again. */
  private retryRefresh(slot: Slot, session: LiveSession): void {
    slot.refreshTimer = null;
    if (slot.session !== session || session.state === "ended") return;
    if (session.state === "ready") this.warm(slot);
    else slot.refreshTimer = setTimeout(() => this.retryRefresh(slot, session), REFRESH_RETRY_MS);
  }

  private onServerClosed(slot: Slot, session: LiveSession, reason: string | undefined): void {
    if (slot.session !== session) return;
    console.info(`[engine:live] server closed ${slot.key} (reason=${reason ?? "unknown"}); rebuilding`);
    slot.session = null;
    if (performance.now() - session.createdAt < EARLY_CLOSE_MS) {
      this.onSessionFailed(slot, session, { code: "api", message: "번역 세션이 종료되었습니다", detail: reason }, true);
      return;
    }
    this.warm(slot);
  }

  private onSessionFailed(slot: Slot, session: LiveSession, err: EngineError, alreadyDetached = false): void {
    if (!alreadyDetached && slot.session !== session) return;
    slot.session = null;
    slot.failures += 1;
    console.warn(`[engine:live] session ${slot.key} failed (#${slot.failures}): ${err.message}`);
    if (err.code === "auth") {
      slot.authFailed = true;
      this.cb.onError(err);
      this.updateStatus();
      return;
    }
    if (slot.failures === 1 || slot.failures === ERROR_AFTER_FAILURES) this.cb.onError(err);
    const delay = BACKOFF_MS[Math.min(slot.failures - 1, BACKOFF_MS.length - 1)] ?? 15000;
    this.clearSlotTimers(slot);
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
      if (slots.length > 0 && slots.every((s) => s.session?.state === "ready" || s.session?.state === "bound" || s.session?.state === "draining")) {
        this.everReady = true;
      }
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
      if (slot.session?.state === "bound" || slot.session?.state === "draining") continue;
      slot.failures = 0;
      this.warm(slot);
    }
    this.updateStatus();
  };
}
