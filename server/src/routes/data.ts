import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { requirePin } from "../pin.js";
import { appendJsonl, readJsonl, toCsv } from "../storage.js";

const LOG_FIELDS = [
  "turnId",
  "engine",
  "source",
  "target",
  "recordMs",
  "stopToFirstAudioMs",
  "stopToPlaybackMs",
  "stopToEndMs",
  "endReason",
  "audioBytesSent",
  "at",
] as const;

const MESSAGE_FIELDS = [
  "id",
  "speaker",
  "source",
  "target",
  "sourceText",
  "targetText",
  "status",
  "createdAt",
  "engine",
  "hasAudio",
] as const;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pick(src: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (f in src) out[f] = src[f];
  return out;
}

export function registerDataRoutes(app: FastifyInstance, cfg: Config): void {
  app.post("/api/log", async (req, reply) => {
    if (!requirePin(req, reply, cfg.appPin)) return reply;
    const turns = (req.body as { turns?: unknown } | null)?.turns;
    if (!Array.isArray(turns) || turns.length > 500 || !turns.every(isObject)) {
      return reply.code(400).send({ error: "invalid_request" });
    }
    const entries = turns.map((t) => pick(t, LOG_FIELDS));
    await appendJsonl(cfg.dataDir, "latency.jsonl", entries);
    for (const e of entries) {
      req.log.info(
        {
          engine: e.engine,
          direction: `${String(e.source)}->${String(e.target)}`,
          stopToFirstAudioMs: e.stopToFirstAudioMs,
          stopToEndMs: e.stopToEndMs,
          audioBytesSent: e.audioBytesSent,
        },
        "turn latency",
      );
    }
    return reply.code(204).send();
  });

  app.post("/api/transcripts", async (req, reply) => {
    if (!requirePin(req, reply, cfg.appPin)) return reply;
    if (!cfg.saveTranscripts) return reply.code(404).send({ error: "disabled" });
    const message = (req.body as { message?: unknown } | null)?.message;
    if (!isObject(message)) return reply.code(400).send({ error: "invalid_request" });
    await appendJsonl(cfg.dataDir, "transcripts.jsonl", [
      { ...pick(message, MESSAGE_FIELDS), savedAt: new Date().toISOString() },
    ]);
    return reply.code(204).send();
  });

  app.get("/api/transcripts.csv", async (req, reply) => {
    if (!requirePin(req, reply, cfg.appPin, true)) return reply;
    if (!cfg.saveTranscripts) return reply.code(404).send({ error: "disabled" });
    const rows = await readJsonl(cfg.dataDir, "transcripts.jsonl");
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="transcripts.csv"')
      .header("Cache-Control", "no-store")
      .send(toCsv(rows));
  });
}
