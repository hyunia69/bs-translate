import type { Direction, EngineCallbacks, EngineConfig, EngineId, Lang, TranslationEngine } from "../types";

export const mockStats = {
  turns: 0,
  audioChunksDuringRecording: 0,
  audioChunksTotal: 0,
  audioBytesSent: 0,
};

const SAMPLE_RATE = 48000;
const CHUNK = 960;
const CHUNK_COUNT = 60;
const AUDIO_SPAN_MS = 800;

const SAMPLES: Record<Lang, string[]> = {
  ko: ["안녕하세요, ", "저희 부스에 ", "오신 것을 ", "환영합니다."],
  en: ["Hello, ", "welcome to ", "our booth, ", "please have a look."],
  ja: ["こんにちは、", "私たちの", "ブースへ", "ようこそ。"],
  zh: ["你好，", "欢迎来到", "我们的", "展位。"],
};

interface MockTurn {
  id: string;
  direction: Direction;
  recording: boolean;
  timers: ReturnType<typeof setTimeout>[];
  intervals: ReturnType<typeof setInterval>[];
}

export class MockEngine implements TranslationEngine {
  readonly id: EngineId = "realtime-translate";
  readonly name = "mock";

  private turn: MockTurn | null = null;
  private readyTimer: ReturnType<typeof setTimeout> | null = null;
  private all = new Set<MockTurn>();

  constructor(private readonly cb: EngineCallbacks) {}

  async configure(_config: EngineConfig): Promise<void> {
    this.cb.onStatus("connecting");
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = setTimeout(() => this.cb.onStatus("ready"), 300);
  }

  start(direction: Direction, _micTrack: MediaStreamTrack): string {
    const turn: MockTurn = { id: crypto.randomUUID(), direction, recording: true, timers: [], intervals: [] };
    this.turn = turn;
    this.all.add(turn);
    mockStats.turns += 1;
    const words = SAMPLES[direction.source];
    let i = 0;
    turn.intervals.push(
      setInterval(() => {
        const w = words[i % words.length];
        i += 1;
        if (w) this.cb.onSourceText(turn.id, w);
      }, 300),
    );
    return turn.id;
  }

  stop(): void {
    const turn = this.turn;
    if (!turn) return;
    this.turn = null;
    turn.recording = false;
    turn.intervals.forEach(clearInterval);
    turn.intervals = [];

    SAMPLES[turn.direction.target].forEach((w, i) => {
      turn.timers.push(setTimeout(() => this.cb.onTargetText(turn.id, w), 100 + i * 150));
    });

    for (let n = 0; n < CHUNK_COUNT; n++) {
      turn.timers.push(
        setTimeout(
          () => {
            const pcm = new Float32Array(CHUNK);
            for (let k = 0; k < CHUNK; k++) {
              pcm[k] = 0.3 * Math.sin((2 * Math.PI * 440 * (n * CHUNK + k)) / SAMPLE_RATE);
            }
            mockStats.audioChunksTotal += 1;
            if (turn.recording) mockStats.audioChunksDuringRecording += 1;
            this.cb.onAudio(turn.id, pcm, SAMPLE_RATE);
          },
          100 + (n * AUDIO_SPAN_MS) / CHUNK_COUNT,
        ),
      );
    }
    turn.timers.push(
      setTimeout(
        () => {
          this.all.delete(turn);
          this.cb.onTurnEnd(turn.id, { reason: "completed", audioBytesSent: 0 });
        },
        100 + AUDIO_SPAN_MS + 100,
      ),
    );
  }

  dispose(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    for (const t of this.all) {
      t.timers.forEach(clearTimeout);
      t.intervals.forEach(clearInterval);
    }
    this.all.clear();
    this.turn = null;
  }
}
