import type { Env } from "./env.js";

export interface Config {
  readonly openaiApiKey: string;
  readonly appPin: string;
  readonly clientSecretTtlSeconds: number;
}

const APP_PIN_RE = /^\d{4,6}$/;

export function loadConfig(env: Env): Config | null {
  const appPin = (env.APP_PIN ?? "").trim();
  if (!APP_PIN_RE.test(appPin)) return null;
  const rawTtl = Number.parseInt((env.CLIENT_SECRET_TTL_SECONDS ?? "").trim(), 10);
  const ttl = Number.isFinite(rawTtl) ? rawTtl : 600;
  return {
    openaiApiKey: (env.OPENAI_API_KEY ?? "").trim(),
    appPin,
    clientSecretTtlSeconds: Math.min(7200, Math.max(10, ttl)),
  };
}
