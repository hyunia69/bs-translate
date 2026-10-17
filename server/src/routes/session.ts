import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { type DualHub, isDualLang } from "../dual.js";
import { requestTranslationSecret } from "../openai.js";
import { extractPin, pinMatches } from "../pin.js";
import { rateLimitOptions } from "./auth.js";

const LANGS = ["ko", "en", "ja", "zh"];

export function registerSessionRoutes(app: FastifyInstance, cfg: Config, hub: DualHub): void {
  app.post("/api/session", { config: rateLimitOptions(cfg) }, async (req, reply) => {
    const { pin, source, target } = (req.body ?? {}) as { pin?: unknown; source?: unknown; target?: unknown };
    const guestAllowed =
      typeof pin === "string" && isDualLang(source) && isDualLang(target) && hub.guestEngineAllowed(pin, source, target);
    if (!pinMatches(extractPin(req), cfg.appPin) && !guestAllowed) {
      return reply.code(401).send({ error: "invalid_pin" });
    }
    if (!cfg.openaiApiKey) return reply.code(503).send({ error: "server_not_configured" });

    if (
      typeof source !== "string" ||
      typeof target !== "string" ||
      !LANGS.includes(source) ||
      !LANGS.includes(target) ||
      source === target
    ) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = await requestTranslationSecret({
      apiKey: cfg.openaiApiKey,
      ip: req.ip,
      appPin: cfg.appPin,
      target,
      ttl: cfg.clientSecretTtlSeconds,
    });

    if (result.kind === "unreachable") {
      req.log.error("openai unreachable");
      return reply.code(502).send({ error: "upstream_unreachable" });
    }
    if (result.kind === "upstream_error") {
      req.log.error({ upstreamStatus: result.status, upstreamBody: result.body.slice(0, 1000) }, "openai error");
      return reply.code(502).send({ error: "upstream_error", status: result.status });
    }
    return { translation: { value: result.value, expires_at: result.expiresAt } };
  });
}
