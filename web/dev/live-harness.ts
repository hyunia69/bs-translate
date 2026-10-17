// Loopback harness: the REAL GptLiveEngine against an in-page fake GPT-Live server. Not part of the production build.
import { GptLiveEngine } from "../src/engine/gptLive";
import type { ConnectionStatus, Direction, EngineError, TurnEndInfo } from "../src/types";

const KO_EN: Direction = { source: "ko", target: "en" };
const EN_KO: Direction = { source: "en", target: "ko" };

const out = document.getElementById("out") as HTMLPreElement;
const bus = new EventTarget();
const changed = (): void => void bus.dispatchEvent(new Event("change"));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function line(text: string): void {
  console.log(text);
  out.textContent += `${text}\n`;
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function report(name: string, ok: boolean, detail: string): void {
  results.push({ name, ok, detail });
  line(`${ok ? "PASS" : "FAIL"} ${name} - ${detail}`);
}

function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (pred()) return resolve(true);
    const done = (v: boolean): void => {
      clearTimeout(timer);
      bus.removeEventListener("change", check);
      resolve(v);
    };
    const check = (): void => {
      if (pred()) done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    bus.addEventListener("change", check);
  });
}

const engineLogs: string[] = [];
for (const level of ["info", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.startsWith("[engine")) {
      engineLogs.push(text);
      out.textContent += `  log: ${text}\n`;
      changed();
    }
    orig(...args);
  };
}

// ---- fake GPT-Live server -----------------------------------------------------------------------------------
const fakeCtx = new AudioContext();
void fakeCtx.resume();
const serverOsc = fakeCtx.createOscillator();
serverOsc.frequency.value = 440;
serverOsc.start();

class FakeLive {
  readonly pc = new RTCPeerConnection();
  private dc: RTCDataChannel | null = null;
  private readonly gain = fakeCtx.createGain();
  private readonly dest = fakeCtx.createMediaStreamDestination();
  /** Client events in arrival order. */
  readonly received: string[] = [];
  /** Interleaved server/client sequence: "started" is pushed when session.started is sent. */
  readonly sequence: string[] = [];
  closedByTest = false;

  constructor(readonly direction: Direction) {
    this.gain.gain.value = 0;
    serverOsc.connect(this.gain);
    this.gain.connect(this.dest);
  }

  async answer(offerSdp: string): Promise<string> {
    this.pc.ondatachannel = (e) => {
      this.dc = e.channel;
      e.channel.onmessage = (m) => this.onMessage(String(m.data));
      const started = (): void => {
        this.sequence.push("started");
        this.send({
          type: "session.started",
          session: { id: `live_${Math.random().toString(36).slice(2)}`, expires_at: Math.floor(Date.now() / 1000) + 600 },
        });
        changed();
      };
      if (e.channel.readyState === "open") started();
      else e.channel.onopen = started;
    };
    await this.pc.setRemoteDescription({ type: "offer", sdp: offerSdp });
    const tr = this.pc.getTransceivers().find((t) => t.receiver.track.kind === "audio");
    if (!tr) throw new Error("fake: no audio transceiver in offer");
    tr.direction = "sendrecv";
    const track = this.dest.stream.getAudioTracks()[0];
    if (!track) throw new Error("fake: no oscillator track");
    await tr.sender.replaceTrack(track);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    await new Promise<void>((resolve) => {
      if (this.pc.iceGatheringState === "complete") return resolve();
      this.pc.onicegatheringstatechange = () => this.pc.iceGatheringState === "complete" && resolve();
    });
    return this.pc.localDescription?.sdp ?? "";
  }

  async audioBytes(): Promise<number> {
    if (this.pc.connectionState === "closed") return 0;
    const stats = await this.pc.getStats();
    let total = 0;
    stats.forEach((s) => {
      if (s.type === "inbound-rtp" && (s.kind ?? s.mediaType) === "audio") total += s.bytesReceived ?? 0;
    });
    return total;
  }

  send(obj: unknown): void {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(obj));
  }

  sendClosed(reason: string): void {
    this.send({ type: "session.closed", reason });
  }

  private onMessage(raw: string): void {
    const ev = JSON.parse(raw) as { type?: string; event_id?: string };
    if (!ev.type) return;
    this.received.push(ev.type);
    this.sequence.push(ev.type);
    if (ev.type === "session.input_audio.mute") {
      this.send({ type: "session.input_audio.muted", client_event_id: ev.event_id });
      setTimeout(() => (this.gain.gain.value = 0), 800);
    } else if (ev.type === "session.input_audio.unmute") {
      this.send({ type: "session.input_audio.unmuted", client_event_id: ev.event_id });
      setTimeout(() => (this.gain.gain.value = 1), 300);
      this.send({ type: "session.input_transcript.delta", delta: "안녕하세요" });
      ["Hello", " there", "!"].forEach((delta, i) =>
        setTimeout(() => this.send({ type: "session.output_transcript.delta", delta }), 400 + 200 * i),
      );
    }
    changed();
  }

  dispose(): void {
    this.pc.close();
  }
}

const fakes: FakeLive[] = [];
const liveRequests: { pin: string; source: string; target: string; hasSdp: boolean }[] = [];
const forbiddenCalls: string[] = [];
const latest = (d: Direction): FakeLive | undefined =>
  [...fakes].reverse().find((f) => f.direction.source === d.source && f.direction.target === d.target);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/api/live/session")) {
    const body = JSON.parse(String(init?.body)) as { pin: string; source: Direction["source"]; target: Direction["target"]; sdp: string };
    liveRequests.push({ pin: body.pin, source: body.source, target: body.target, hasSdp: body.sdp.startsWith("v=0") });
    const fake = new FakeLive({ source: body.source, target: body.target });
    fakes.push(fake);
    const sdp = await fake.answer(body.sdp);
    return new Response(JSON.stringify({ sdp, sessionId: `live_${fakes.length}` }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  forbiddenCalls.push(url);
  throw new Error(`harness: unexpected fetch ${url}`);
};

// ---- engine under test --------------------------------------------------------------------------------------
const statuses: { status: ConnectionStatus; t: number }[] = [];
const lastStatus = (): ConnectionStatus | undefined => statuses[statuses.length - 1]?.status;
const audioEvents: { t: number; turnId: string; peak: number; rate: number }[] = [];
const text = new Map<string, { source: string; target: string }>();
const ends: { turnId: string; info: TurnEndInfo; t: number }[] = [];
const errors: EngineError[] = [];

const append = (id: string, key: "source" | "target", d: string): void => {
  const t = text.get(id) ?? { source: "", target: "" };
  t[key] += d;
  text.set(id, t);
  changed();
};

const engine = new GptLiveEngine({
  onSourceText: (id, d) => append(id, "source", d),
  onTargetText: (id, d) => append(id, "target", d),
  onAudio: (id, pcm, rate) => {
    let peak = 0;
    for (const v of pcm) peak = Math.max(peak, Math.abs(v));
    audioEvents.push({ t: performance.now(), turnId: id, peak, rate });
  },
  onTurnEnd: (id, info) => {
    ends.push({ turnId: id, info, t: performance.now() });
    changed();
  },
  onError: (err) => {
    errors.push(err);
    line(`  engine error: ${err.code} ${err.message}`);
    changed();
  },
  onStatus: (status, detail) => {
    statuses.push({ status, t: performance.now() });
    line(`  status: ${status}${detail ? ` (${detail})` : ""}`);
    changed();
  },
});

const micOsc = fakeCtx.createOscillator();
micOsc.frequency.value = 300;
const micDest = fakeCtx.createMediaStreamDestination();
micOsc.connect(micDest);
micOsc.start();
const micTrack = micDest.stream.getAudioTracks()[0] as MediaStreamTrack;

const preTurnLogs = (): string[] => engineLogs.filter((l) => l.startsWith("[engine:live] pre-turn audio bytesSent="));

interface TurnResult {
  ok: boolean;
  detail: string;
}

async function runTurn(direction: Direction, speakMs: number, fake: FakeLive, expectedPreLogs: number): Promise<TurnResult> {
  const audioBefore = audioEvents.length;
  const t0 = performance.now();
  const id = engine.start(direction, micTrack);
  await waitFor(() => fake.received.includes("session.input_audio.unmute"), 3000);
  await sleep(speakMs);
  engine.stop();
  const tStop = performance.now();
  const ended = await waitFor(() => ends.some((e) => e.turnId === id), 15_000);
  const end = ends.find((e) => e.turnId === id);
  const tEnd = end?.t ?? 0;
  const mine = audioEvents.slice(audioBefore).filter((a) => a.turnId === id);
  const inWindow = mine.every((a) => a.t >= t0 && a.t <= tEnd);
  const tone = mine.some((a) => a.peak > 0.1);
  const target = text.get(id)?.target ?? "";
  const pre = preTurnLogs()[expectedPreLogs - 1];
  const preZero = pre === "[engine:live] pre-turn audio bytesSent=0";
  const seq = fake.sequence.join(">");
  const unmuteBeforeMute = fake.received.lastIndexOf("session.input_audio.unmute") < fake.received.lastIndexOf("session.input_audio.mute");
  const ok =
    ended &&
    end?.info.reason === "completed" &&
    (end.info.audioBytesSent ?? 0) > 0 &&
    target === "Hello there!" &&
    mine.length > 0 &&
    tone &&
    inWindow &&
    preZero &&
    unmuteBeforeMute;
  return {
    ok,
    detail:
      `reason=${end?.info.reason} audioBytesSent=${end?.info.audioBytesSent} target="${target}" source="${text.get(id)?.source}" ` +
      `audioChunks=${mine.length} tone=${tone} inWindow=${inWindow} preTurnLog="${pre}" stopToEnd=${Math.round(tEnd - tStop)}ms clientEvents=${seq}`,
  };
}

async function main(): Promise<void> {
  // L1
  await engine.configure({ directions: [KO_EN, EN_KO], pin: "1234" });
  const ready = await waitFor(() => lastStatus() === "ready" && fakes.length === 2 && fakes.every((f) => f.received.length > 0), 10_000);
  const dirs = fakes.map((f) => `${f.direction.source}-${f.direction.target}`).sort();
  const muteAfterStarted = fakes.every((f) => f.sequence[0] === "started" && f.sequence[1] === "session.input_audio.mute" && f.sequence.length === 2);
  report(
    "L1 warm-up",
    ready && dirs.join() === "en-ko,ko-en" && muteAfterStarted && liveRequests.every((r) => r.hasSdp && r.pin === "1234") && forbiddenCalls.length === 0,
    `status=${lastStatus()} fakes=${dirs.join("|")} sequences=${fakes.map((f) => f.sequence.join(">")).join(" | ")} requests=${liveRequests.length} openaiCalls=${forbiddenCalls.length}`,
  );

  // L2
  await sleep(2000);
  const idle = await Promise.all(fakes.map((f) => f.audioBytes()));
  report("L2 idle", idle.every((b) => b === 0), `fake inbound audio bytesReceived=[${idle.join(",")}]`);

  // L3
  const fakeKoEn = latest(KO_EN) as FakeLive;
  const fakesBefore = fakes.length;
  const r3 = await runTurn(KO_EN, 1500, fakeKoEn, 1);
  report("L3 turn", r3.ok && fakes.length === fakesBefore, r3.detail);

  // L4
  const r4 = await runTurn(KO_EN, 1200, fakeKoEn, 2);
  const sameSession = fakes.length === fakesBefore && latest(KO_EN) === fakeKoEn;
  report("L4 second turn same session", r4.ok && sameSession, `${r4.detail} sameSession=${sameSession} fakes=${fakes.length}`);

  // L5
  await waitFor(() => lastStatus() === "ready", 5000);
  const victim = latest(EN_KO) as FakeLive;
  const idx = statuses.length;
  const countBefore5 = fakes.length;
  const tClose = performance.now();
  victim.closedByTest = true;
  victim.pc.close();
  const sawReconnecting = await waitFor(() => statuses.slice(idx).some((s) => s.status === "reconnecting"), 6000);
  const back = await waitFor(
    () => fakes.length > countBefore5 && lastStatus() === "ready" && (latest(EN_KO)?.received.includes("session.input_audio.mute") ?? false),
    8000,
  );
  const elapsed = Math.round(performance.now() - tClose);
  report("L5 reconnect", sawReconnecting && back && latest(EN_KO) !== victim, `reconnecting=${sawReconnecting} ready-again=${back} after ${elapsed} ms fakes=${fakes.length}`);

  // L6
  const target6 = latest(KO_EN) as FakeLive;
  const countBefore6 = fakes.length;
  const t6 = performance.now();
  target6.sendClosed("expired");
  const rebuilt = await waitFor(
    () => fakes.length > countBefore6 && lastStatus() === "ready" && (latest(KO_EN)?.received.includes("session.input_audio.mute") ?? false),
    10_000,
  );
  const fresh = latest(KO_EN);
  report("L6 server session.closed rebuild", rebuilt && fresh !== target6, `rebuilt=${rebuilt} after ${Math.round(performance.now() - t6)} ms fakes=${fakes.length} freshSequence=${fresh?.sequence.join(">")}`);
}

main()
  .catch((err: unknown) => report("HARNESS", false, `exception: ${String(err)}`))
  .finally(() => {
    const failed = results.filter((r) => !r.ok).length;
    line(`SUMMARY ${results.length - failed}/${results.length} PASS`);
    engine.dispose();
    fakes.forEach((f) => f.dispose());
    line("HARNESS DONE");
  });
