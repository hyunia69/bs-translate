import { config as loadDotenv } from "dotenv";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/src/config.ts and server/dist/config.js are both two levels below the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");

// .env.local is loaded first so its values win (dotenv never overrides an already-set variable).
loadDotenv({ path: [path.join(REPO_ROOT, ".env.local"), path.join(REPO_ROOT, ".env")], quiet: true });

export interface Config {
  openaiApiKey: string;
  appPin: string;
  port: number;
  host: string;
  clientSecretTtlSeconds: number;
  sessionRateLimitPerMin: number;
  saveTranscripts: boolean;
  dataDir: string;
  webDist: string;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const appPin = (process.env.APP_PIN ?? "").trim();
  if (!/^\d{4,6}$/.test(appPin)) {
    throw new Error("APP_PIN must be set in .env and be 4-6 digits (e.g. APP_PIN=1234).");
  }
  const ttl = Math.min(7200, Math.max(10, intEnv("CLIENT_SECRET_TTL_SECONDS", 600)));
  const rate = Math.max(1, intEnv("SESSION_RATE_LIMIT_PER_MIN", 30));
  const dataDirRaw = process.env.DATA_DIR?.trim() || "./data";
  const webDist = path.join(REPO_ROOT, "web", "dist");
  return {
    // `chatgptkey` is the name the owner uses in .env.local.
    openaiApiKey: (process.env.OPENAI_API_KEY || process.env.chatgptkey || "").trim(),
    appPin,
    port: intEnv("PORT", 8787),
    host: process.env.HOST?.trim() || "0.0.0.0",
    clientSecretTtlSeconds: ttl,
    sessionRateLimitPerMin: rate,
    saveTranscripts: (process.env.SAVE_TRANSCRIPTS ?? "").trim().toLowerCase() === "true",
    dataDir: path.resolve(REPO_ROOT, dataDirRaw),
    webDist: existsSync(webDist) ? webDist : "",
  };
}
