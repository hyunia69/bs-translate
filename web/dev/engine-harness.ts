// Loopback harness: the REAL RealtimeTranslateEngine against an in-page fake OpenAI. Not part of the production build.
import { RealtimeTranslateEngine } from "../src/engine/realtimeTranslate";
import type { ConnectionStatus, Direction, EngineError, TurnEndInfo } from "../src/types";

const KO_EN: Direction = { source: "ko", target: "en" };
const EN_KO: Direction = { source: "en", target: "ko" };
const CALLS_URL = "https://api.openai.com/v1/realtime/translations/calls";

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

/** Resolve when pred() is true, re-evaluated on every harness/engine event; false on timeout. */
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

// ---- engine log capture -------------------------------------------------------------------------------------
const engineLogs: string[] = [];
for (const level of ["info", "warn"] as const) {
  const orig = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    const text = args.map(String).join(" ");
    if (text.startsWith("[engine]")) {
      engineLogs.push(text);
      out.textContent += `  log: ${text}\n`;
      changed();
    }
    orig(...args);
  };
}

// ---- fake OpenAI --------------------------------------------------------------------------------------------
type CloseMode = "normal" | "unsupported";
let closeMode: CloseMode = "normal";

const fakeCtx = new AudioContext();
void fakeCtx.resume();
const serverOsc = fakeCtx.createOscillator();
serverOsc.frequency.value = 440;
serverOsc.start();

class Fake {
  readonly pc = new RTCPeerConnection();
  private dc: RTCDataChannel | null = null;
  private readonly gain = fakeCtx.createGain();
  private readonly dest = fakeCtx.createMediaStreamDestination();
  private poll: ReturnType<typeof setInterval> | null = null;
  createdSent = false;
  everReceivedAudio = false;
  closeReceived = false;
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
      const created = (): void => {
        this.send({
          type: "session.created",
          session: { id: `sess_${Math.random().toString(36).slice(2)}`, expires_at: Math.floor(Date.now() / 1000) + 600 },
        });
        this.createdSent = true;
        changed();
      };
      if (e.channel.readyState === "open") created();
      else e.channel.onopen = created;
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
    this.poll = setInterval(() => void this.watchInbound(), 100);
    return this.pc.localDescription?.sdp ?? "";
  }

  private async watchInbound(): Promise<void> {
    if (this.pc.connectionState === "closed") return;
    const bytes = await this.audioBytes();
    if (bytes > 0 && !this.everReceivedAudio) {
      this.everReceivedAudio = true;
      this.gain.gain.value = 1;
      changed();
    }
  }

  async audioBytes(): Promise<number> {
    if (this.pc.connectionState === "closed") return 0;
    const report = await this.pc.getStats();
    let total = 0;
    report.forEach((s) => {
      if (s.type === "inbound-rtp" && (s.kind ?? s.mediaType) === "audio") total += s.bytesReceived ?? 0;
    });
    return total;
  }

  send(obj: unknown): void {
    if (this.dc?.readyState === "open") this.dc.send(JSON.stringify(obj));
  }

  private onMessage(raw: string): void {
    const ev = JSON.parse(raw) as { type?: string; event_id?: string };
    if (ev.type !== "session.close") return;
    this.closeReceived = true;
    this.send({ type: "session.input_transcript.delta", delta: "안녕하세요" });
    if (closeMode === "unsupported") {
      this.send({
        type: "error",
        error: {
          type: "invalid_request_error",
          code: "unknown_event",
          message: "Unsupported client event: session.close",
          param: null,
          event_id: ev.event_id,
        },
      });
    }
    ["Hello", " there", "!"].forEach((delta, i) =>
      setTimeout(() => this.send({ type: "session.output_transcript.delta", delta }), 100 * (i + 1)),
    );
    if (closeMode === "normal") setTimeout(() => this.send({ type: "session.closed" }), 500);
    setTimeout(() => (this.gain.gain.value = 0), 800);
    changed();
  }

  dispose(): void {
    if (this.poll) clearInterval(this.poll);
    this.pc.close();
  }
}

const fakes: Fake[] = [];
const secretDirections = new Map<string, Direction>();
let secretCounter = 0;

const sessionRequests: unknown[] = [];
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (url.endsWith("/api/session")) {
    const body = JSON.parse(String(init?.body)) as { pin: string; source: Direction["source"]; target: Direction["target"] };
    sessionRequests.push(body);
    const ek = `ek_fake_${++secretCounter}`;
    secretDirections.set(ek, { source: body.source, target: body.target });
    return new Response(JSON.stringify({ translation: { value: ek, expires_at: Math.floor(Date.now() / 1000) + 600 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (url === CALLS_URL) {
    const headers = new Headers(init?.headers);
    const ek = (headers.get("Authorization") ?? "").replace("Bearer ", "");
    const direction = secretDirections.get(ek);
    if (!direction || headers.get("Content-Type") !== "application/sdp") return new Response("bad request", { status: 400 });
    const fake = new Fake(direction);
    fakes.push(fake);
    const sdp = await fake.answer(String(init?.body));
    return new Response(sdp, { status: 201, headers: { "Content-Type": "application/sdp" } });
  }
  throw new Error(`harness: unexpected fetch ${url}`);
};

// ---- engine under test --------------------------------------------------------------------------------------
const statuses: { status: ConnectionStatus; t: number }[] = [];
const lastStatus = (): ConnectionStatus | undefined => statuses[statuses.length - 1]?.status;
const audioEvents: { t: number; turnId: string; peak: number; rate: number }[] = [];
const text = new Map<string, { source: string; target: string }>();
const ends: { turnId: string; info: TurnEndInfo; t: number }[] = [];
const errors: EngineError[] = [];

const engine = new RealtimeTranslateEngine({
  onSourceText: (id, d) => {
    const t = text.get(id) ?? { source: "", target: "" };
    t.source += d;
    text.set(id, t);
    changed();
  },
  onTargetText: (id, d) => {
    const t = text.get(id) ?? { source: "", target: "" };
    t.target += d;
    text.set(id, t);
    changed();
  },
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

const liveSpares = (): Fake[] =>
  fakes.filter((f) => !f.everReceivedAudio && !f.closedByTest && !f.closeReceived && f.pc.connectionState !== "closed");
const sumBytes = async (list: Fake[]): Promise<number[]> => Promise.all(list.map((f) => f.audioBytes()));

async function main(): Promise<void> {
  // S1
  await engine.configure({ directions: [KO_EN, EN_KO], pin: "1234" });
  const ready = await waitFor(() => lastStatus() === "ready", 10_000);
  const dirs = fakes.map((f) => `${f.direction.source}-${f.direction.target}`).sort();
  report("S1 warm-up", ready && fakes.length === 2 && dirs.join() === "en-ko,ko-en", `status=${lastStatus()} fakes=${dirs.join("|")}`);

  // S2
  await sleep(2000);
  const idle = await sumBytes(fakes);
  report("S2 idle", idle.every((b) => b === 0), `fake inbound audio bytesReceived=[${idle.join(",")}]`);

  // S3
  const audioBefore = audioEvents.length;
  const t0 = performance.now();
  const id1 = engine.start(KO_EN, micTrack);
  await sleep(1500);
  engine.stop();
  const ended1 = await waitFor(() => ends.some((e) => e.turnId === id1), 12_000);
  const end1 = ends.find((e) => e.turnId === id1);
  const tEnd1 = end1?.t ?? 0;
  const mine = audioEvents.filter((a) => a.turnId === id1);
  const inWindow = mine.every((a) => a.t >= t0 && a.t <= tEnd1);
  const foreign = audioEvents.slice(audioBefore).filter((a) => a.turnId !== id1).length;
  const tone = mine.some((a) => a.peak > 0.1);
  const turnText = text.get(id1);
  const preLog = engineLogs.filter((l) => l.startsWith("[engine] pre-turn audio bytesSent="));
  const preZero = preLog[0] === "[engine] pre-turn audio bytesSent=0";
  const s3ok =
    ended1 &&
    end1?.info.reason === "completed" &&
    (end1.info.audioBytesSent ?? 0) > 0 &&
    (turnText?.target ?? "") === "Hello there!" &&
    mine.length > 0 &&
    tone &&
    inWindow &&
    audioBefore === 0 &&
    foreign === 0 &&
    preZero;
  report(
    "S3 turn",
    s3ok,
    `reason=${end1?.info.reason} audioBytesSent=${end1?.info.audioBytesSent} target="${turnText?.target}" source="${turnText?.source}" ` +
      `audioChunks=${mine.length} tone=${tone} inWindow=${inWindow} audioBeforeStart=${audioBefore} foreign=${foreign} preTurnLog="${preLog[0]}" rate=${mine[0]?.rate}`,
  );

  // S4
  const spareReady = await waitFor(() => lastStatus() === "ready" && liveSpares().filter((f) => f.createdSent).length === 2, 10_000);
  await sleep(1000);
  const spares = liveSpares();
  const spareBytes = await sumBytes(spares);
  report(
    "S4 new spare after turn",
    spareReady && spares.length === 2 && spareBytes.every((b) => b === 0),
    `liveSpares=${spares.map((f) => `${f.direction.source}-${f.direction.target}`).join("|")} inbound bytesReceived=[${spareBytes.join(",")}]`,
  );

  // S5
  const target = liveSpares().find((f) => f.direction.source === "ko");
  const idx = statuses.length;
  const tClose = performance.now();
  if (target) {
    target.closedByTest = true;
    target.pc.close();
  }
  const sawReconnecting = await waitFor(() => statuses.slice(idx).some((s) => s.status === "reconnecting"), 5000);
  const backReady = await waitFor(
    () => statuses.slice(idx).some((s) => s.status === "reconnecting") && lastStatus() === "ready",
    Math.max(0, 5000 - (performance.now() - tClose)),
  );
  const elapsed = Math.round(performance.now() - tClose);
  report("S5 reconnect", !!target && sawReconnecting && backReady && elapsed <= 5000, `reconnecting=${sawReconnecting} ready-again=${backReady} after ${elapsed} ms`);

  // S6
  await waitFor(() => lastStatus() === "ready" && liveSpares().filter((f) => f.createdSent).length === 2, 10_000);
  closeMode = "unsupported";
  const t6 = performance.now();
  const id2 = engine.start(EN_KO, micTrack);
  await sleep(1000);
  engine.stop();
  const ended2 = await waitFor(() => ends.some((e) => e.turnId === id2), 12_000);
  const end2 = ends.find((e) => e.turnId === id2);
  const took = Math.round((end2?.t ?? performance.now()) - t6);
  const quietLogged = engineLogs.some((l) => l.includes("session.close not accepted over WebRTC; using quiet detection"));
  report(
    "S6 session.close unsupported",
    ended2 && (end2?.info.reason === "completed" || end2?.info.reason === "timeout") && quietLogged,
    `reason=${end2?.info.reason} audioBytesSent=${end2?.info.audioBytesSent} target="${text.get(id2)?.target}" turn took ${took} ms quietLogged=${quietLogged}`,
  );
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
