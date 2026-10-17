// One warm GPT-Live session for one direction. Unlike the default engine, the session is REUSED across turns:
// connect -> session.started -> session.input_audio.mute -> READY (sender has no track, nothing transmitted).
// A turn = unmute + mic track; the turn ends by QUIET DETECTION (GPT-Live has no response-done event).
import type { Direction, EngineError, TurnEndReason } from "../types";
import type { CaptureHandle, RemoteCapture } from "./remoteCapture";

const SESSION_URL = "/api/live/session";

export const READY_TIMEOUT_MS = 10_000;
export const QUIET_MS = 1500;
export const QUIET_EMPTY_MS = 2500;
export const TURN_CAP_MS = 12_000;
const QUIET_AMPLITUDE = 0.004;
const DISCONNECT_MS = 3000;
const STATS_TIMEOUT_MS = 500;
const LATE_LOG_INTERVAL_MS = 1000;
const TAG = "[engine:live]";

export type LiveState = "connecting" | "ready" | "bound" | "draining" | "ended";

export interface LiveTurnSink {
  onSourceText(delta: string): void;
  onTargetText(delta: string): void;
  onAudio(pcm: Float32Array, sampleRate: number): void;
  onError(err: EngineError): void;
  onEnd(reason: TurnEndReason, audioBytesSent: number | undefined): void;
}

export interface LiveSessionEvents {
  onReady(session: LiveSession): void;
  /** Session is unusable (connect failure, pc failed/closed, dc closed). Any bound turn has already been ended. */
  onFailed(session: LiveSession, err: EngineError): void;
  /** Server sent session.closed (any reason). Any bound turn has already been ended. */
  onServerClosed(session: LiveSession, reason: string | undefined): void;
  /** Non-fatal error event while no turn is bound. */
  onError(err: EngineError): void;
}

export interface LiveSessionDeps {
  pin: string;
  capture: RemoteCapture;
  events: LiveSessionEvents;
}

interface PendingBind {
  turnId: string;
  track: MediaStreamTrack;
  sink: LiveTurnSink;
}

interface LiveServerEvent {
  type?: string;
  delta?: string;
  reason?: string;
  client_event_id?: string;
  session?: { id?: string; expires_at?: number };
  error?: { type?: string; code?: string; message?: string; client_event_id?: string };
}

class ConnectError extends Error {
  constructor(readonly engineError: EngineError) {
    super(engineError.message);
  }
}

export class LiveSession {
  state: LiveState = "connecting";
  /** Epoch ms from session.started session.expires_at (Unix seconds), null until known. */
  expiresAtMs: number | null = null;
  readonly createdAt = performance.now();

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sender: RTCRtpSender | null = null;
  private capture: CaptureHandle | null = null;
  private abort = new AbortController();
  private dcOpen = false;
  private started = false;
  private pending: PendingBind | null = null;
  private sink: LiveTurnSink | null = null;
  private turnId = "";
  private preBytes: number | undefined;
  /** Cumulative audio bytesSent at the end of the previous turn (the counter never resets on a reused session). */
  private baselineBytes = 0;
  private stopAt = 0;
  private lastActivity = 0;
  private sawAfterStop = false;
  private stopRequested = false;
  private muteSeq = 0;
  private lateLoggedAt = 0;
  private lateDropped = 0;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private quietTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    readonly direction: Direction,
    private readonly deps: LiveSessionDeps,
  ) {}

  start(): void {
    this.readyTimer = setTimeout(
      () => this.fail({ code: "network", message: "번역 서버 연결 시간이 초과되었습니다", detail: "live session ready timeout" }),
      READY_TIMEOUT_MS,
    );
    this.connect().catch((e: unknown) => this.fail(toEngineError(e)));
  }

  /** Bind a turn: immediately when READY, otherwise as soon as READY. */
  bindWhenReady(turnId: string, track: MediaStreamTrack, sink: LiveTurnSink): void {
    if (this.state === "draining") void this.finish("completed");
    if (this.state === "ready") void this.doBind({ turnId, track, sink });
    else if (this.state === "connecting") this.pending = { turnId, track, sink };
    else {
      sink.onError({ code: "network", message: "번역 서버에 연결할 수 없습니다", turnId });
      sink.onEnd("error", undefined);
    }
  }

  /** "cancelled": the turn never started (session still connecting); the session itself stays usable. */
  stop(): "cancelled" | "draining" | "noop" {
    if (this.pending) {
      this.pending = null;
      return "cancelled";
    }
    if (this.state !== "bound") return "noop";
    this.stopRequested = true;
    this.state = "draining";
    this.stopAt = performance.now();
    this.lastActivity = this.stopAt;
    this.sawAfterStop = false;
    if (this.sender) void this.sender.replaceTrack(null).catch(() => undefined);
    this.sendMute();
    this.quietTimer = setInterval(() => this.checkQuiet(), 100);
    return "draining";
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
    // The data channel must exist BEFORE the offer is created.
    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    dc.onopen = () => {
      this.dcOpen = true;
    };
    dc.onclose = () => {
      if (this.state !== "ended") {
        this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: "data channel closed" });
      }
    };
    dc.onmessage = (e) => {
      if (typeof e.data === "string") this.onMessage(e.data);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    if (this.isEnded()) return;
    const answer = await this.exchange(offer.sdp ?? "");
    if (this.isEnded()) return;
    await pc.setRemoteDescription({ type: "answer", sdp: answer });
  }

  private isEnded(): boolean {
    return this.state === "ended";
  }

  /** The browser never calls api.openai.com for Live; our server owns the key and creates the session. */
  private async exchange(sdp: string): Promise<string> {
    let res: Response;
    try {
      res = await fetch(SESSION_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: this.deps.pin, source: this.direction.source, target: this.direction.target, sdp }),
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
      throw new ConnectError({ code: "api", message: "번역 서버에 연결할 수 없습니다", detail: { status: res.status } });
    }
    const body = (await res.json()) as { sdp?: string; sessionId?: string };
    if (!body.sdp) {
      throw new ConnectError({ code: "api", message: "번역 서버에 연결할 수 없습니다", detail: "missing answer sdp" });
    }
    return body.sdp;
  }

  private onPcState(state: RTCPeerConnectionState): void {
    if (this.state === "ended") return;
    if (state === "connected") {
      if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
      return;
    }
    if (state === "failed" || state === "closed") {
      this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: `pc ${state}` });
    } else if (state === "disconnected" && this.state === "ready" && !this.disconnectTimer) {
      this.disconnectTimer = setTimeout(
        () => this.fail({ code: "network", message: "번역 서버 연결이 끊겼습니다", detail: "pc disconnected > 3s" }),
        DISCONNECT_MS,
      );
    }
  }

  private send(obj: Record<string, unknown>): boolean {
    if (!this.dc || this.dc.readyState !== "open") return false;
    this.dc.send(JSON.stringify(obj));
    return true;
  }

  private sendMute(): void {
    // Optional client event_id; the ack carries it back as client_event_id.
    this.send({ type: "session.input_audio.mute", event_id: `mute_${++this.muteSeq}` });
  }

  private onSessionStarted(ev: LiveServerEvent): void {
    if (this.started) return;
    this.started = true;
    if (typeof ev.session?.expires_at === "number") this.expiresAtMs = ev.session.expires_at * 1000;
    // Commands are only valid after session.started. Mute immediately: the session is idle until a turn begins.
    this.sendMute();
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (this.state !== "connecting") return;
    this.state = "ready";
    void this.captureBaseline().then(() => {
      if (this.state !== "ready") return;
      if (this.pending) {
        const p = this.pending;
        this.pending = null;
        void this.doBind(p);
      } else {
        this.deps.events.onReady(this);
      }
    });
  }

  private async captureBaseline(): Promise<void> {
    this.baselineBytes = (await this.readBytesSent()) ?? 0;
  }

  private async doBind(p: PendingBind): Promise<void> {
    this.state = "bound";
    this.turnId = p.turnId;
    this.sink = p.sink;
    this.stopRequested = false;
    this.sawAfterStop = false;
    this.lateDropped = 0;
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.preBytes = await this.readBytesSent();
    const delta = this.preBytes !== undefined ? this.preBytes - this.baselineBytes : undefined;
    console.info(`${TAG} pre-turn audio bytesSent=${delta ?? "unknown"}`);
    if (this.stopRequested || this.state !== "bound" || !this.sender) return;
    await this.sender.replaceTrack(p.track).catch((err: unknown) => console.warn(`${TAG} replaceTrack failed`, err));
    if (this.stopRequested || this.state !== "bound") return;
    this.send({ type: "session.input_audio.unmute", event_id: `unmute_${this.turnId}` });
  }

  private onMessage(raw: string): void {
    let ev: LiveServerEvent;
    try {
      ev = JSON.parse(raw) as LiveServerEvent;
    } catch {
      return;
    }
    switch (ev.type) {
      case "session.started":
        this.onSessionStarted(ev);
        break;
      case "session.input_transcript.delta":
        if (this.accepting() && this.sink && typeof ev.delta === "string") this.sink.onSourceText(ev.delta);
        break;
      case "session.output_transcript.delta":
        if (typeof ev.delta !== "string") break;
        if (this.accepting() && this.sink) {
          this.touch();
          this.sink.onTargetText(ev.delta);
        } else {
          this.logLate("output transcript delta");
        }
        break;
      case "session.closed":
        this.onClosed(ev.reason);
        break;
      case "error":
        this.onServerError(ev.error ?? {});
        break;
      default:
        // session.input_audio.muted / unmuted / updated / usage.updated and others need no handling.
        break;
    }
  }

  private accepting(): boolean {
    return this.state === "bound" || this.state === "draining";
  }

  private onClosed(reason: string | undefined): void {
    if (this.state === "ended") return;
    console.info(`${TAG} session.closed reason=${reason ?? "unknown"}`);
    if (this.accepting()) {
      void this.finish("error", { code: "api", message: "번역 세션이 종료되었습니다", turnId: this.turnId });
    }
    this.state = "ended";
    this.pending = null;
    this.cleanup();
    this.deps.events.onServerClosed(this, reason);
  }

  private onServerError(body: { type?: string; code?: string; message?: string; client_event_id?: string }): void {
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
    let peak = 0;
    for (let i = 0; i < frame.length; i++) {
      const a = Math.abs(frame[i] ?? 0);
      if (a > peak) peak = a;
    }
    if (!this.accepting() || !this.sink) {
      if (peak > QUIET_AMPLITUDE) this.logLate("remote audio");
      return;
    }
    if (peak > QUIET_AMPLITUDE) this.touch();
    this.sink.onAudio(frame, sampleRate);
  }

  /** Activity from output (transcript delta or audible remote audio) while a turn is bound. */
  private touch(): void {
    this.lastActivity = performance.now();
    if (this.state === "draining") this.sawAfterStop = true;
  }

  private logLate(what: string): void {
    this.lateDropped += 1;
    const now = performance.now();
    if (now - this.lateLoggedAt < LATE_LOG_INTERVAL_MS) return;
    this.lateLoggedAt = now;
    console.info(`${TAG} dropped ${what} arriving outside a turn (${this.lateDropped} dropped so far)`);
  }

  // TODO(api): GPT-Live has no documented turn-boundary or response-done event; whether session.input_audio.mute
  // flushes a pending translation is unknown, so the turn ends only when output goes quiet.
  private checkQuiet(): void {
    if (this.state !== "draining") return;
    const now = performance.now();
    if (now - this.stopAt >= TURN_CAP_MS) {
      void this.finish("timeout");
      return;
    }
    const needed = this.sawAfterStop ? QUIET_MS : QUIET_EMPTY_MS;
    if (now - this.lastActivity >= needed) void this.finish("completed");
  }

  private fail(err: EngineError): void {
    if (this.state === "ended") return;
    const pending = this.pending;
    if (this.accepting()) void this.finish("error", { ...err, turnId: this.turnId });
    this.state = "ended";
    this.pending = null;
    this.cleanup();
    if (pending) {
      pending.sink.onError({ ...err, turnId: pending.turnId });
      pending.sink.onEnd("error", undefined);
    }
    this.deps.events.onFailed(this, err);
  }

  /** End the bound turn once and return the session to READY (when it is still alive). */
  private async finish(reason: TurnEndReason, err?: EngineError): Promise<void> {
    const sink = this.sink;
    if (!sink || !this.accepting()) return;
    this.sink = null;
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.quietTimer = null;
    if (err) sink.onError(err);
    const alive = this.state !== "ended" && !err;
    if (alive) this.state = "ready";
    const post = await this.readBytesSent();
    const bytes = post !== undefined && this.preBytes !== undefined ? Math.max(0, post - this.preBytes) : undefined;
    if (post !== undefined) this.baselineBytes = post;
    sink.onEnd(reason, bytes);
    if (alive && this.state === "ready") this.deps.events.onReady(this);
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

  private cleanup(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    if (this.quietTimer) clearInterval(this.quietTimer);
    this.readyTimer = this.disconnectTimer = null;
    this.quietTimer = null;
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
