import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { loadGlossary } from "../glossary.js";
import { type DualHub, isDualLang } from "../dual.js";
import { requestLiveSession } from "../openai.js";
import { extractPin, pinMatches } from "../pin.js";
import { rateLimitOptions } from "./auth.js";

const LANGS = ["ko", "en", "ja", "zh"];
const MAX_SDP_BYTES = 64 * 1024;

export function registerLiveRoutes(app: FastifyInstance, cfg: Config, hub: DualHub): void {
  const glossary = loadGlossary();

  app.post("/api/live/session", { config: rateLimitOptions(cfg) }, async (req, reply) => {
    const { pin, source, target, sdp } = (req.body ?? {}) as {
      pin?: unknown;
      source?: unknown;
      target?: unknown;
      sdp?: unknown;
    };
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
      source === target ||
      typeof sdp !== "string" ||
      !sdp.trim() ||
      Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES
    ) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const result = await requestLiveSession({ apiKey: cfg.openaiApiKey, source, target, sdp, glossary });

    if (result.kind === "unreachable") {
      req.log.error("openai live unreachable");
      return reply.code(502).send({ error: "upstream_unreachable" });
    }
    if (result.kind === "upstream_error") {
      req.log.error({ upstreamStatus: result.status, upstreamBody: result.body.slice(0, 500) }, "openai live error");
      return reply.code(502).send({ error: "upstream_error", status: result.status });
    }
    req.log.info({ upstreamStatus: result.status, sessionId: result.sessionId }, "openai live session created");
    return { sdp: result.sdp, sessionId: result.sessionId };
  });
}
