import type { Direction, EngineError, TurnEndReason } from "../types";
import type { CaptureHandle, RemoteCapture } from "./remoteCapture";

const SESSION_URL = "/api/session";
const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

export const READY_TIMEOUT_MS = 10_000;
export const DRAIN_TIMEOUT_MS = 10_000;
const CLOSED_GRACE_MS = 400;
const QUIET_MS = 1500;
const QUIET_AMPLITUDE = 0.004;
const DISCONNECT_MS = 3000;
const STATS_TIMEOUT_MS = 500;

export type SessionState = "connecting" | "ready" | "bound" | "closing" | "ended";

/** Receives everything a bound session produces; one session = one turn. */
export interface TurnSink {
  onBound?(info: { lostMs: number }): void;
  onSourceText(delta: string): void;
  onTargetText(delta: string): void;
  onAudio(pcm: Float32Array, sampleRate: number): void;
  onError(err: EngineError): void;
  onEnd(reason: TurnEndReason, audioBytesSent: number | undefined): void;
}

export interface WarmSessionEvents {
  onReady(session: WarmSession): void;
  /** Unbound session failed (connect failure, pc failed/closed, long disconnect, server closed it). */
  onFailed(session: WarmSession, err: EngineError): void;
  /** Non-fatal error event received while unbound. */
  onError(err: EngineError): void;
}

export interface WarmSessionDeps {
  pin: string;
  capture: RemoteCapture;
  events: WarmSessionEvents;
}

interface PendingBind {
  turnId: string;
  track: MediaStreamTrack;
  sink: TurnSink;
  at: number;
}

interface ServerErrorBody {
  type?: string;
  code?: string;
  message?: string;
  param?: string | null;
  event_id?: string;
}

interface ServerEvent {
  type?: string;
  delta?: string;
  session?: { id?: string; expires_at?: number };
  error?: ServerErrorBody;
}

class ConnectError extends Error {
  constructor(readonly engineError: EngineError) {
    super(engineError.message);
  }
}

let quietFallbackLogged = false;

export class WarmSession {
  state: SessionState = "connecting";
  /** Epoch ms from session.created (seconds or ms accepted), null until known. */
  expiresAtMs: number | null = null;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sender: RTCRtpSender | null = null;
  private capture: CaptureHandle | null = null;
  private abort = new AbortController();
  private dcOpen = false;
  private created = false;
  private pending: PendingBind | null = null;
  private sink: TurnSink | null = null;
  private turnId = "";
  private preBytes: number | undefined;
  private stopRequested = false;
  private closeEventId = "";
  private quiet = false;
  private lastActivity = 0;
  private closedGraceStarted = false;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;
  private quietTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly direction: Direction,
    private readonly deps: WarmSessionDeps,
  ) {}

  start(): void {
    this.readyTimer = setTimeout(
      () =>
        this.fail({
          code: "network",
          message: "번역 서버 연결 시간이 초과되었습니다",
          detail: "session ready timeout",
        }),
      READY_TIMEOUT_MS,
    );
    this.connect().catch((e: unknown) => this.fail(toEngineError(e)));
  }

  /** Bind a turn: immediately when READY, otherwise as soon as READY. */
  bindWhenReady(turnId: string, track: MediaStreamTrack, sink: TurnSink): void {
    if (this.state === "ready") this.doBind({ turnId, track, sink, at: performance.now() }, 0);
    else if (this.state === "connecting") this.pending = { turnId, track, sink, at: performance.now() };
    else {
      sink.onError({ code: "network", message: "번역 서버에 연결할 수 없습니다", turnId });
      sink.onEnd("error", undefined);
    }
  }

  /** "cancelled": turn never started sending (session still connecting); caller disposes the session. */
  stop(): "cancelled" | "closing" | "noop" {
    if (this.pending) {
      this.pending = null;
      return "cancelled";
    }
    if (this.state !== "bound") return "noop";
    this.stopRequested = true;
    this.state = "closing";
    if (this.sender) void this.sender.replaceTrack(null).catch(() => undefined);
    if (this.dc && this.dc.readyState === "open") {
      this.closeEventId = `close_${crypto.randomUUID()}`;
      // Client events carry an optional client-generated event_id; error.event_id echoes the failing client event's id.
      this.dc.send(JSON.stringify({ type: "session.close", event_id: this.closeEventId }));
    } else {
      void this.finish("error", { code: "network", message: "번역 서버 연결이 끊겼습니다", turnId: this.turnId });
      return "closing";
    }
    this.drainTimer = setTimeout(() => void this.finish("timeout"), DRAIN_TIMEOUT_MS);
    return "closing";
  }

  /** Close everything silently (no callbacks). */
  dispose(): void {
    if (this.state === "ended") return;
    this.state = "ended";
    this.pending = null;
    this.sink = null;
    this.cleanup();
  }

  private async connect(): Promise<void> {
    const ek = await this.fetchSecret();
    if (this.state === "ended") return;
    const pc = new RTCPeerConnection();
    this.pc = pc;
    const transceiver = pc.addTransceiver("audio", { direction: "sendrecv" });
    this.sender = transceiver.sender;
    pc.ontrack = (e) => {
      if (this.capture) return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.capture = this.deps.capture.attach(stream, (frame, rate) => this.onFrame(frame, rate));
    };
    pc.onconnectionstatechange = () => this.onPcState(pc.connectionState);
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => {
      this.dcOpen = true;
      this.maybeReady();
    };
    dc.onclose = () => {
      if (this.state === "connecting" || this.state === "ready") {
        this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: "data channel closed" });
      }
    };
    dc.onmessage = (e) => {
      if (typeof e.data === "string") this.onMessage(e.data);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.isEnded()) return;
    const res = await fetch(CALLS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${ek}`, "Content-Type": "application/sdp" },
      body: offer.sdp,
      signal: this.abort.signal,
    });
    const answer = await res.text();
    if (!res.ok) {
      console.warn(`[engine] SDP exchange failed status=${res.status} body=${answer.slice(0, 300)}`);
      throw new ConnectError({
        code: "api",
        message: "번역 서버에 연결할 수 없습니다",
        detail: { status: res.status, body: answer.slice(0, 300) },
      });
    }
    if (this.isEnded()) return;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  private isEnded(): boolean {
    return this.state === "ended";
  }

  private async fetchSecret(): Promise<string> {
    let res: Response;
    try {
      res = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: this.deps.pin, source: this.direction.source, target: this.direction.target }),
        signal: this.abort.signal,
      });
    } catch (err) {
      if (this.abort.signal.aborted) throw err;
      throw new ConnectError({ code: "network", message: "네트워크에 연결할 수 없습니다", detail: String(err) });
    }
    if (res.status === 401) throw new ConnectError({ code: "auth", message: "PIN이 올바르지 않습니다" });
    if (res.status === 429) {
      throw new ConnectError({ code: "rate_limit", message: "요청이 너무 많습니다. 잠시 후 다시 시도합니다" });
    }
    if (!res.ok) {
      throw new ConnectError({
        code: "api",
        message: "번역 서버에 연결할 수 없습니다",
        detail: { status: res.status },
      });
    }
    const body = (await res.json()) as { translation?: { value?: string } };
    const value = body.translation?.value;
    if (!value) {
      throw new ConnectError({ code: "api", message: "번역 서버에 연결할 수 없습니다", detail: "missing secret" });
    }
    return value;
  }

  private onPcState(state: RTCPeerConnectionState): void {
    if (this.state === "ended") return;
    if (state === "connected") {
      this.clearTimer("disconnectTimer");
      return;
    }
    const unbound = this.state === "connecting" || this.state === "ready";
    if (state === "failed" || state === "closed") {
      this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: `pc ${state}` });
    } else if (state === "disconnected" && unbound && !this.disconnectTimer) {
      this.disconnectTimer = setTimeout(
        () => this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: "pc disconnected > 3s" }),
        DISCONNECT_MS,
      );
    }
  }

  private maybeReady(): void {
    if (this.state !== "connecting" || !this.dcOpen || !this.created) return;
    this.clearTimer("readyTimer");
    this.state = "ready";
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      this.doBind(p, performance.now() - p.at);
      return;
    }
    this.deps.events.onReady(this);
  }

  private doBind(p: PendingBind, lostMs: number): void {
    this.state = "bound";
    this.turnId = p.turnId;
    this.sink = p.sink;
    this.stopRequested = false;
    this.clearTimer("disconnectTimer");
    p.sink.onBound?.({ lostMs });
    void this.attachTrack(p.track);
  }

  private async attachTrack(track: MediaStreamTrack): Promise<void> {
    this.preBytes = await this.readBytesSent();
    console.info(`[engine] pre-turn audio bytesSent=${this.preBytes ?? "unknown"}`);
    if (this.stopRequested || this.state !== "bound" || !this.sender) return;
    await this.sender.replaceTrack(track).catch((err: unknown) => console.warn("[engine] replaceTrack failed", err));
  }

  private onMessage(raw: string): void {
    let ev: ServerEvent;
    try {
      ev = JSON.parse(raw) as ServerEvent;
    } catch {
      return;
    }
    const live = this.state === "bound" || this.state === "closing";
    switch (ev.type) {
      case "session.created":
        this.created = true;
        if (typeof ev.session?.expires_at === "number") {
          this.expiresAtMs = ev.session.expires_at * 1000;
        }
        this.maybeReady();
        break;
      case "session.updated":
        break;
      case "session.input_transcript.delta":
        if (live && this.sink && typeof ev.delta === "string") {
          this.touch();
          this.sink.onSourceText(ev.delta);
        }
        break;
      case "session.output_transcript.delta":
        if (live && this.sink && typeof ev.delta === "string") {
          this.touch();
          this.sink.onTargetText(ev.delta);
        }
        break;
      case "session.closed":
        this.onServerClosed();
        break;
      case "error":
        this.onServerError(ev.error ?? {});
        break;
      default:
        break;
    }
  }

  private onServerClosed(): void {
    if (this.state === "closing") {
      if (this.closedGraceStarted) return;
      this.closedGraceStarted = true;
      this.graceTimer = setTimeout(() => void this.finish("completed"), CLOSED_GRACE_MS);
    } else if (this.state === "bound") {
      void this.finish("error", { code: "api", message: "번역 세션이 종료되었습니다", turnId: this.turnId });
    } else if (this.state === "connecting" || this.state === "ready") {
      this.fail({ code: "api", message: "번역 세션이 종료되었습니다", detail: "session.closed while unbound" });
    }
  }

  private onServerError(body: ServerErrorBody): void {
    const message = String(body.message ?? "");
    const closeRejected =
      this.state === "closing" &&
      !this.quiet &&
      ((body.event_id !== undefined && body.event_id === this.closeEventId) ||
        /session\.close|unsupported|not supported|unknown event/i.test(message));
    if (closeRejected) {
      this.quiet = true;
      this.touch();
      if (!quietFallbackLogged) {
        quietFallbackLogged = true;
        console.info("[engine] session.close not accepted over WebRTC; using quiet detection");
      }
      if (this.drainTimer) {
        this.quietTimer = setInterval(() => {
          if (performance.now() - this.lastActivity >= QUIET_MS) void this.finish("completed");
        }, 100);
      }
      return;
    }
    const err: EngineError = {
      code: "api",
      message: "번역 서버 오류가 발생했습니다",
      detail: body,
      turnId: this.sink ? this.turnId : undefined,
    };
    if (this.sink) this.sink.onError(err);
    else this.deps.events.onError(err);
  }

  private onFrame(frame: Float32Array, sampleRate: number): void {
    if (this.state !== "bound" && this.state !== "closing") return;
    if (this.quiet) {
      let peak = 0;
      for (let i = 0; i < frame.length; i++) {
        const a = Math.abs(frame[i] ?? 0);
        if (a > peak) peak = a;
      }
      if (peak > QUIET_AMPLITUDE) this.touch();
    }
    this.sink?.onAudio(frame, sampleRate);
  }

  private touch(): void {
    this.lastActivity = performance.now();
  }

  private fail(err: EngineError): void {
    if (this.state === "ended") return;
    if (this.state === "bound" || this.state === "closing") {
      void this.finish("error", { ...err, turnId: this.turnId });
      return;
    }
    const pending = this.pending;
    this.state = "ended";
    this.pending = null;
    this.cleanup();
    if (pending) {
      pending.sink.onError({ ...err, turnId: pending.turnId });
      pending.sink.onEnd("error", undefined);
    }
    this.deps.events.onFailed(this, err);
  }

  private async finish(reason: TurnEndReason, err?: EngineError): Promise<void> {
    if (this.state === "ended") return;
    this.state = "ended";
    const sink = this.sink;
    this.sink = null;
    this.clearTimers();
    if (err) sink?.onError(err);
    const post = await this.readBytesSent();
    const bytes = post !== undefined && this.preBytes !== undefined ? Math.max(0, post - this.preBytes) : undefined;
    this.cleanup();
    sink?.onEnd(reason, bytes);
  }

  private async readBytesSent(): Promise<number | undefined> {
    const pc = this.pc;
    if (!pc) return undefined;
    const read = async (): Promise<number | undefined> => {
      try {
        const report = await pc.getStats();
        let total = 0;
        let found = false;
        report.forEach((s: { type: string; kind?: string; mediaType?: string; bytesSent?: number }) => {
          if (s.type === "outbound-rtp" && (s.kind ?? s.mediaType) === "audio") {
            total += s.bytesSent ?? 0;
            found = true;
          }
        });
        return found ? total : 0;
      } catch {
        return undefined;
      }
    };
    const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), STATS_TIMEOUT_MS));
    return Promise.race([read(), timeout]);
  }

  private clearTimer(name: "readyTimer" | "disconnectTimer" | "drainTimer" | "graceTimer"): void {
    const t = this[name];
    if (t) clearTimeout(t);
    this[name] = null;
  }

  private clearTimers(): void {
    this.clearTimer("readyTimer");
    this.clearTimer("disconnectTimer");
    this.clearTimer("drainTimer");
    this.clearTimer("graceTimer");
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.quietTimer = null;
  }

  private cleanup(): void {
    this.clearTimers();
    this.abort.abort();
    this.capture?.detach();
    this.capture = null;
    const pc = this.pc;
    this.pc = null;
    if (this.dc) {
      this.dc.onopen = this.dc.onclose = this.dc.onmessage = null;
      try {
        this.dc.close();
      } catch {
        /* already closed */
      }
    }
    this.dc = null;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
  }
}

function toEngineError(e: unknown): EngineError {
  if (e instanceof ConnectError) return e.engineError;
  return { code: "network", message: "번역 서버에 연결할 수 없습니다", detail: String(e) };
}
