import type { Message, TurnLatencyLog } from "../types";

export type AuthResult = "ok" | "invalid" | "rate_limited" | "error";

export async function postAuth(pin: string): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) return "ok";
    if (res.status === 401) return "invalid";
    if (res.status === 429) return "rate_limited";
    return "error";
  } catch (err) {
    console.error("[api] /api/auth failed", err);
    return "error";
  }
}

export interface AppConfig {
  saveTranscripts: boolean;
}

/** null on network/server error; "unauthorized" when the server rejects the PIN. */
export async function getConfig(pin: string): Promise<AppConfig | "unauthorized" | null> {
  try {
    const res = await fetch("/api/config", { headers: { "x-app-pin": pin } });
    if (res.status === 401) return "unauthorized";
    if (!res.ok) return null;
    const body = (await res.json()) as { saveTranscripts?: unknown };
    return { saveTranscripts: body.saveTranscripts === true };
  } catch (err) {
    console.error("[api] /api/config failed", err);
    return null;
  }
}

function postJson(url: string, body: unknown): void {
  fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
    .then((res) => {
      if (!res.ok) console.error(`[api] ${url} -> ${res.status}`);
    })
    .catch((err) => console.error(`[api] ${url} failed`, err));
}

export function postLatencyLog(pin: string, log: TurnLatencyLog): void {
  postJson("/api/log", { pin, turns: [log] });
}

export function postTranscript(pin: string, message: Message): void {
  postJson("/api/transcripts", { pin, message });
}

export function transcriptsCsvHref(pin: string): string {
  return `/api/transcripts.csv?pin=${encodeURIComponent(pin)}`;
}
