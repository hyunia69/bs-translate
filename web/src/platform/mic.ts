export type MicErrorKind = "denied" | "not_found" | "in_use" | "insecure_context" | "unknown";

export interface MicError {
  kind: MicErrorKind;
  message: string;
}

const MESSAGES: Record<MicErrorKind, string> = {
  denied: "마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요.",
  not_found: "마이크를 찾을 수 없습니다.",
  in_use: "마이크를 사용할 수 없습니다. 다른 앱이 사용 중인지 확인해 주세요.",
  insecure_context: "보안 연결(HTTPS)에서만 마이크를 사용할 수 있습니다.",
  unknown: "마이크를 열 수 없습니다.",
};

export function classifyMicError(err: unknown): MicError {
  let kind: MicErrorKind = "unknown";
  if (typeof window !== "undefined" && !window.isSecureContext) {
    kind = "insecure_context";
  } else {
    const name = (err as { name?: string } | null)?.name;
    if (name === "NotAllowedError" || name === "SecurityError") kind = "denied";
    else if (name === "NotFoundError" || name === "OverconstrainedError") kind = "not_found";
    else if (name === "NotReadableError") kind = "in_use";
  }
  return { kind, message: MESSAGES[kind] };
}

export class MicManager {
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private currentDeviceId: string | null = null;
  private ctx: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private lastTick = 0;

  async open(deviceId: string | null): Promise<MediaStreamTrack> {
    if (this.track && this.track.readyState === "live" && this.currentDeviceId === deviceId) {
      return this.track;
    }
    this.close();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("insecure"), { name: "SecurityError" });
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      this.stream = stream;
      this.track = stream.getAudioTracks()[0] ?? null;
      this.currentDeviceId = deviceId;
      if (!this.track) throw new Error("no audio track");
      return this.track;
    } catch (err) {
      throw classifyMicError(err);
    }
  }

  getTrack(): MediaStreamTrack | null {
    return this.track;
  }

  close(): void {
    this.stopLevel();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
    this.currentDeviceId = null;
  }

  startLevel(onLevel: (v: number) => void): void {
    this.stopLevel();
    if (!this.stream) return;
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    const source = ctx.createMediaStreamSource(this.stream);
    source.connect(analyser);
    this.ctx = ctx;
    this.source = source;
    void ctx.resume().catch(() => undefined);
    const buf = new Float32Array(analyser.fftSize);
    this.lastTick = 0;
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (now - this.lastTick < 50) return;
      this.lastTick = now;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      onLevel(Math.min(1, Math.max(0, rms * 4)));
    };
    this.raf = requestAnimationFrame(loop);
  }

  stopLevel(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.source?.disconnect();
    this.source = null;
    if (this.ctx) void this.ctx.close().catch(() => undefined);
    this.ctx = null;
  }
}
