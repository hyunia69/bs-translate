// Captures remote WebRTC audio as Float32 PCM without ever making it audible.
//
// Chrome only feeds a remote WebRTC stream into Web Audio when the stream is also attached to a media element,
// so each stream is attached to a MUTED HTMLAudioElement. The Web Audio graph is
//   MediaStreamSource -> AudioWorkletNode("pcm-capture") -> GainNode(gain 0) -> destination
// so nothing is ever routed audibly.

export interface CaptureHandle {
  detach(): void;
}

export type FrameHandler = (frame: Float32Array, sampleRate: number) => void;

const WORKLET_URL = `${import.meta.env.BASE_URL}worklets/pcm-capture.js`;

export class RemoteCapture {
  private ctx: AudioContext | null = null;
  private moduleReady: Promise<void> | null = null;

  get sampleRate(): number {
    return this.ctx?.sampleRate ?? 48000;
  }

  /** Create the shared context and load the worklet. Safe to call repeatedly. */
  async warm(): Promise<void> {
    if (!this.ctx) this.ctx = new AudioContext({ latencyHint: "interactive" });
    const ctx = this.ctx;
    if (!this.moduleReady) {
      this.moduleReady = ctx.audioWorklet.addModule(WORKLET_URL).catch((err: unknown) => {
        this.moduleReady = null;
        throw err;
      });
    }
    await this.moduleReady;
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
  }

  attach(stream: MediaStream, onFrame: FrameHandler): CaptureHandle {
    const sink = new Audio();
    sink.muted = true;
    sink.volume = 0;
    sink.autoplay = true;
    sink.srcObject = stream;
    void sink.play().catch(() => undefined);

    let closed = false;
    let source: MediaStreamAudioSourceNode | null = null;
    let node: AudioWorkletNode | null = null;
    let silencer: GainNode | null = null;

    this.warm()
      .then(() => {
        const ctx = this.ctx;
        if (closed || !ctx) return;
        source = ctx.createMediaStreamSource(stream);
        node = new AudioWorkletNode(ctx, "pcm-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
          channelCount: 1,
          channelCountMode: "explicit",
        });
        silencer = ctx.createGain();
        silencer.gain.value = 0;
        node.port.onmessage = (e: MessageEvent<Float32Array>) => {
          if (!closed) onFrame(e.data, ctx.sampleRate);
        };
        source.connect(node);
        node.connect(silencer);
        silencer.connect(ctx.destination);
      })
      .catch((err: unknown) => console.warn("[engine] remote capture setup failed", err));

    return {
      detach: () => {
        closed = true;
        if (node) node.port.onmessage = null;
        source?.disconnect();
        node?.disconnect();
        silencer?.disconnect();
        sink.pause();
        sink.srcObject = null;
      },
    };
  }

  close(): void {
    const ctx = this.ctx;
    this.ctx = null;
    this.moduleReady = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
  }
}
