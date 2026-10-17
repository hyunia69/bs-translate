// Dev-only REAL end-to-end driver: real GptLiveEngine against the real GPT-Live API (via our server). Not part of the production build.
import { GptLiveEngine } from "../src/engine/gptLive";
import type { ConnectionStatus, Direction, EngineError, Lang, TurnEndInfo } from "../src/types";

const params = new URLSearchParams(location.search);
const pin = params.get("pin") ?? "";
const dirParam = params.get("dir") ?? "ko-en";
const api = params.get("api") ?? "";
const [source, target] = dirParam.split("-") as [Lang, Lang];
const direction: Direction = { source, target };
const t0 = performance.now();
const now = (): number => Math.round(performance.now() - t0);
const redact = (s: string): string => s.replace(/(ek_|sk-)[A-Za-z0-9_\-.]+/g, "$1REDACTED");

const R = {
  dir: dirParam,
  wav: params.get("wav") ?? source,
  liveSessionStatuses: [] as { at: number; status: number }[],
  sessionStartedAtMs: null as number | null,
  sourceText: "",
  targetText: "",
  audio: { chunks: 0, maxAmplitude: 0, sampleRate: 0, firstAtMs: null as number | null },
  statuses: [] as { at: number; status: string; detail?: string }[],
  errors: [] as unknown[],
  engineLogs: [] as { at: number; text: string }[],
  dcEvents: [] as { at: number; dir: string; type: string; extra?: unknown }[],
  turnEnd: null as null | { reason: string; audioBytesSent?: number; at: number },
  startAtMs: null as number | null,
  stopAtMs: null as number | null,
  audioDurationMs: 0,
  stopToFirstAudioMs: null as number | null,
  stopToTurnEndMs: null as number | null,
  finished: false,
  fatal: null as string | null,
};
(window as unknown as { __e2eResult?: unknown }).__e2eResult = undefined;
const out = document.getElementById("out") as HTMLPreElement;
const finish = (): void => {
  R.finished = true;
  out.textContent = JSON.stringify(R, null, 2);
  (window as unknown as { __e2eResult?: unknown }).__e2eResult = JSON.parse(JSON.stringify(R));
};

for (const level of ["info", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.startsWith("[engine")) R.engineLogs.push({ at: now(), text: redact(text) });
    orig(...args);
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.startsWith("/api/")) {
    const res = await realFetch(api + url, init);
    R.liveSessionStatuses.push({ at: now(), status: res.status });
    return res;
  }
  return realFetch(input, init);
};

const origCreateDC = RTCPeerConnection.prototype.createDataChannel;
RTCPeerConnection.prototype.createDataChannel = function (this: RTCPeerConnection, ...a: Parameters<RTCPeerConnection["createDataChannel"]>) {
  const dc = origCreateDC.apply(this, a);
  dc.addEventListener("message", (e: MessageEvent) => {
    try {
      const ev = JSON.parse(String(e.data)) as { type?: string; error?: unknown; reason?: unknown };
      const type = ev.type ?? "?";
      if (type === "session.started" && R.sessionStartedAtMs === null) R.sessionStartedAtMs = now();
      const extra = type === "error" ? JSON.parse(redact(JSON.stringify(ev.error))) : type === "session.closed" ? ev.reason : undefined;
      const last = R.dcEvents[R.dcEvents.length - 1];
      if (last && last.type === type && last.dir === "in" && type.endsWith(".delta")) return;
      R.dcEvents.push({ at: now(), dir: "in", type, extra });
    } catch {
      /* ignore */
    }
  });
  const origSend = dc.send.bind(dc);
  dc.send = (data: never): void => {
    try {
      R.dcEvents.push({ at: now(), dir: "out", type: (JSON.parse(String(data)) as { type?: string }).type ?? "?" });
    } catch {
      /* ignore */
    }
    origSend(data);
  };
  return dc;
} as typeof RTCPeerConnection.prototype.createDataChannel;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
  let ready: () => void = () => undefined;
  const readyP = new Promise<void>((r) => (ready = r));
  let ended: () => void = () => undefined;
  const endedP = new Promise<void>((r) => (ended = r));

  const engine = new GptLiveEngine({
    onSourceText: (_id, dlt) => void (R.sourceText += dlt),
    onTargetText: (_id, dlt) => void (R.targetText += dlt),
    onAudio: (_id, pcm, rate) => {
      R.audio.chunks += 1;
      R.audio.sampleRate = rate;
      let peak = 0;
      for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i] ?? 0));
      if (peak > R.audio.maxAmplitude) R.audio.maxAmplitude = peak;
      if (R.audio.firstAtMs === null && peak > 0.004) {
        R.audio.firstAtMs = now();
        if (R.stopAtMs !== null) R.stopToFirstAudioMs = R.audio.firstAtMs - R.stopAtMs;
      }
    },
    onTurnEnd: (_id, info: TurnEndInfo) => {
      R.turnEnd = { ...info, at: now() };
      if (R.stopAtMs !== null) R.stopToTurnEndMs = now() - R.stopAtMs;
      ended();
    },
    onError: (err: EngineError) =>
      void R.errors.push({ at: now(), code: err.code, message: err.message, detail: JSON.parse(redact(JSON.stringify(err.detail ?? null))) }),
    onStatus: (status: ConnectionStatus, detail?: string) => {
      R.statuses.push({ at: now(), status, detail });
      if (status === "ready") ready();
    },
  });

  try {
    await engine.configure({ directions: [direction], pin });
    const ok = await Promise.race([readyP.then(() => true), sleep(20000).then(() => false)]);
    if (!ok) {
      R.fatal = "engine never reached ready within 20 s";
      return;
    }
    await sleep(500);

    const ctx = new AudioContext();
    await ctx.resume();
    const buf = await ctx.decodeAudioData(await (await realFetch(`/dev/e2e-audio/${R.wav}.wav`)).arrayBuffer());
    R.audioDurationMs = Math.round(buf.duration * 1000);
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest);
    const track = dest.stream.getAudioTracks()[0];
    if (!track) throw new Error("no mic track");

    R.startAtMs = now();
    engine.start(direction, track);
    // let bind (stats read + replaceTrack + unmute) settle before the audio begins
    await sleep(400);
    node.start();
    await new Promise<void>((r) => (node.onended = () => r()));
    await sleep(300);
    R.stopAtMs = now();
    engine.stop();
    await Promise.race([endedP, sleep(30000)]);
    await sleep(500);
    await ctx.close();
  } finally {
    engine.dispose();
  }
}

main()
  .catch((e: unknown) => void (R.fatal = String(e)))
  .finally(finish);
