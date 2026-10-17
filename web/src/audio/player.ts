import { concatFloat32, resampleLinear, trimSilence } from "./pcm";

export type PlayerEvent = "playbackstart" | "playbackend";
type StartListener = (turnId: string, atMs: number) => void;
type EndListener = (turnId: string) => void;

interface TurnAudio {
  chunks: Float32Array[];
  rates: number[];
}

const MAX_TURNS = 50;
const STOP_FADE_S = 0.01;
/** Same amplitude threshold trimSilence uses; leading chunks below it are skipped when streaming. */
const AUDIBLE = 0.004;
/** Scheduling headroom for the first streamed chunk. */
const STREAM_LEAD_S = 0.05;

interface Stream {
  turnId: string;
  gain: GainNode;
  sources: Set<AudioBufferSourceNode>;
  /** Index of the next stored chunk to schedule. */
  next: number;
  /** AudioContext time at which the next chunk starts. */
  nextTime: number;
  started: boolean;
  ended: boolean;
}

function isAudible(c: Float32Array): boolean {
  for (let i = 0; i < c.length; i++) if (Math.abs(c[i]) >= AUDIBLE) return true;
  return false;
}

interface Active {
  turnId: string;
  source: AudioBufferSourceNode;
  gain: GainNode;
  finish: () => void;
}

export class AudioPlayer {
  private ctx: AudioContext | null = null;
  private turns = new Map<string, TurnAudio>();
  private active: Active | null = null;
  private streaming: Stream | null = null;
  private playToken = 0;
  private startListeners = new Set<StartListener>();
  private endListeners = new Set<EndListener>();

  private getContext(): AudioContext {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "interactive" });
    return this.ctx;
  }

  /** Call from a user gesture (every talk-button tap) to satisfy autoplay rules. */
  async resume(): Promise<void> {
    const ctx = this.getContext();
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // Not in a gesture yet; a later call will retry.
      }
    }
  }

  /** Stores a copy of the chunk. Never plays. */
  append(turnId: string, pcm: Float32Array, sampleRate: number): void {
    let t = this.turns.get(turnId);
    if (!t) {
      t = { chunks: [], rates: [] };
      this.turns.set(turnId, t);
      while (this.turns.size > MAX_TURNS) {
        const oldest = this.turns.keys().next().value;
        if (oldest === undefined) break;
        this.turns.delete(oldest);
      }
    }
    t.chunks.push(pcm.slice());
    t.rates.push(sampleRate);
    if (this.streaming?.turnId === turnId) this.pump();
  }

  /**
   * Start playing a turn's audio now and keep playing chunks appended later, gap-free,
   * until endStream(turnId). Leading silence is skipped. Call only when nobody is recording.
   */
  stream(turnId: string): void {
    this.stop();
    const ctx = this.getContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    this.streaming = { turnId, gain, sources: new Set(), next: 0, nextTime: 0, started: false, ended: false };
    this.pump();
  }

  /** No more audio will arrive for this turn; playback ends when the scheduled audio has played. */
  endStream(turnId: string): void {
    const s = this.streaming;
    if (!s || s.turnId !== turnId) return;
    s.ended = true;
    if (s.sources.size === 0) this.finishStream();
  }

  isStreaming(turnId: string): boolean {
    return this.streaming?.turnId === turnId;
  }

  private pump(): void {
    const s = this.streaming;
    const t = s && this.turns.get(s.turnId);
    if (!s || !t || !this.ctx) return;
    const ctx = this.ctx;
    while (s.next < t.chunks.length) {
      const chunk = t.chunks[s.next];
      const rate = t.rates[s.next];
      s.next++;
      if (chunk.length === 0) continue;
      if (!s.started) {
        if (!isAudible(chunk)) continue;
        s.started = true;
        s.nextTime = ctx.currentTime + STREAM_LEAD_S;
        const at = performance.now() + STREAM_LEAD_S * 1000;
        for (const cb of [...this.startListeners]) cb(s.turnId, at);
      }
      const buffer = ctx.createBuffer(1, chunk.length, rate);
      buffer.getChannelData(0).set(chunk);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(s.gain);
      const when = Math.max(s.nextTime, ctx.currentTime);
      source.start(when);
      s.nextTime = when + buffer.duration;
      s.sources.add(source);
      source.onended = () => {
        s.sources.delete(source);
        try {
          source.disconnect();
        } catch {
          // already disconnected
        }
        if (this.streaming === s && s.ended && s.sources.size === 0) this.finishStream();
      };
    }
  }

  private finishStream(): void {
    const s = this.streaming;
    if (!s) return;
    this.streaming = null;
    try {
      s.gain.disconnect();
    } catch {
      // already disconnected
    }
    if (s.started) for (const cb of [...this.endListeners]) cb(s.turnId);
  }

  hasAudio(turnId: string): boolean {
    const t = this.turns.get(turnId);
    return !!t && t.chunks.some((c) => c.length > 0);
  }

  durationMs(turnId: string): number {
    const t = this.turns.get(turnId);
    if (!t) return 0;
    let s = 0;
    for (let i = 0; i < t.chunks.length; i++) s += t.chunks[i].length / t.rates[i];
    return s * 1000;
  }

  async play(turnId: string): Promise<void> {
    this.stop();
    const token = ++this.playToken;
    const t = this.turns.get(turnId);
    if (!t || t.chunks.length === 0) return;

    const rate = t.rates[0];
    const parts = t.chunks.map((c, i) => (t.rates[i] === rate ? c : resampleLinear(c, t.rates[i], rate)));
    const samples = trimSilence(concatFloat32(parts), rate);
    if (samples.length === 0) return;

    const ctx = this.getContext();
    if (ctx.state !== "running") {
      try {
        await ctx.resume();
      } catch {
        // fall through; start() below will simply be silent until resumed
      }
    }
    // Superseded by a newer play()/stop() while resuming.
    if (token !== this.playToken) return;

    const buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(ctx.destination);

    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        if (this.active?.source === source) this.active = null;
        source.onended = null;
        try {
          source.disconnect();
          gain.disconnect();
        } catch {
          // already disconnected
        }
        for (const cb of [...this.endListeners]) cb(turnId);
        resolve();
      };
      source.onended = finish;
      this.active = { turnId, source, gain, finish };
      source.start();
      const at = performance.now();
      for (const cb of [...this.startListeners]) cb(turnId, at);
    });
  }

  /** Stops current playback immediately (<= 15 ms fade). */
  stop(): void {
    this.playToken++;
    const s = this.streaming;
    if (s && this.ctx) {
      const now = this.ctx.currentTime;
      try {
        s.gain.gain.cancelScheduledValues(now);
        s.gain.gain.setValueAtTime(s.gain.gain.value, now);
        s.gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_S);
      } catch {
        // context closing
      }
      for (const src of s.sources) {
        src.onended = null;
        try {
          src.stop(now + STOP_FADE_S);
        } catch {
          // not started or already ended
        }
      }
      s.sources.clear();
      this.finishStream();
    }
    const a = this.active;
    if (!a || !this.ctx) return;
    this.active = null;
    const now = this.ctx.currentTime;
    try {
      a.gain.gain.cancelScheduledValues(now);
      a.gain.gain.setValueAtTime(a.gain.gain.value, now);
      a.gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_S);
      a.source.stop(now + STOP_FADE_S);
    } catch {
      // source may already have ended
    }
    a.finish();
  }

  isPlaying(): boolean {
    return this.active !== null || this.streaming !== null;
  }

  currentTurnId(): string | null {
    return this.active?.turnId ?? this.streaming?.turnId ?? null;
  }

  delete(turnId: string): void {
    if (this.active?.turnId === turnId) this.stop();
    this.turns.delete(turnId);
  }

  clear(): void {
    this.stop();
    this.turns.clear();
  }

  on(event: "playbackstart", cb: StartListener): () => void;
  on(event: "playbackend", cb: EndListener): () => void;
  on(event: PlayerEvent, cb: StartListener | EndListener): () => void {
    if (event === "playbackstart") {
      const l = cb as StartListener;
      this.startListeners.add(l);
      return () => void this.startListeners.delete(l);
    }
    const l = cb as EndListener;
    this.endListeners.add(l);
    return () => void this.endListeners.delete(l);
  }
}
