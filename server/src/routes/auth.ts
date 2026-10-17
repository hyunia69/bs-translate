import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { pinMatches, requirePin } from "../pin.js";

export function rateLimitOptions(cfg: Config) {
  return { rateLimit: { max: cfg.sessionRateLimitPerMin, timeWindow: "1 minute" } };
}

export function registerAuthRoutes(app: FastifyInstance, cfg: Config): void {
  app.get("/health", async () => ({ ok: true, openaiConfigured: cfg.openaiApiKey !== "" }));

  app.post("/api/auth", { config: rateLimitOptions(cfg) }, async (req, reply) => {
    const body = req.body as { pin?: unknown } | null;
    if (!pinMatches(body?.pin, cfg.appPin)) return reply.code(401).send({ error: "invalid_pin" });
    return { ok: true };
  });

  app.get("/api/config", async (req, reply) => {
    if (!requirePin(req, reply, cfg.appPin)) return reply;
    return { saveTranscripts: cfg.saveTranscripts };
  });
}
