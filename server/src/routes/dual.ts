import type { FastifyInstance, FastifyReply } from "fastify";
import type { Config } from "../config.js";
import { type DualHub, type DualStream, type HubResult, isBoothPin, isDualLang, parseWireMessage } from "../dual.js";
import { pinMatches } from "../pin.js";
import { rateLimitOptions } from "./auth.js";

const PING_MS = 15_000;

type Body = Record<string, unknown>;

function bodyOf(raw: unknown): Body {
  return raw && typeof raw === "object" ? (raw as Body) : {};
}

function invalid(reply: FastifyReply) {
  return reply.code(400).send({ error: "invalid_request" });
}

function finish(reply: FastifyReply, result: HubResult) {
  switch (result) {
    case "ok":
      return { ok: true };
    case "unknown_token":
      return reply.code(404).send({ error: "unknown_token" });
    case "unavailable":
    case "busy":
    case "not_paired":
      return reply.code(409).send({ error: result });
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

export function registerDualRoutes(app: FastifyInstance, cfg: Config, hub: DualHub): void {
  app.addHook("onClose", async () => hub.close());

  // Own plugin scope so the text/plain parser (sendBeacon) applies only to these routes.
  void app.register(async (scope) => {
    scope.addContentTypeParser("text/plain", { parseAs: "string" }, (_req, body, done) => {
      try {
        done(null, JSON.parse(body as string));
      } catch {
        done(null, null);
      }
    });

    /** Resolves the token from the body; replies 400/404 and returns null on failure. */
    function tokenOf(b: Body, reply: FastifyReply): string | null {
      if (typeof b.token !== "string" || b.token === "") {
        void invalid(reply);
        return null;
      }
      if (!hub.hasToken(b.token)) {
        void reply.code(404).send({ error: "unknown_token" });
        return null;
      }
      return b.token;
    }

    scope.get("/api/dual/booth", async () => hub.booth());

    scope.post("/api/dual/booth-pin", { config: rateLimitOptions(cfg) }, async (req, reply) => {
      const b = bodyOf(req.body);
      if (!pinMatches(b.pin, cfg.appPin)) return reply.code(401).send({ error: "invalid_pin" });
      if (!isBoothPin(b.boothPin)) return invalid(reply);
      await hub.setBoothPin(b.boothPin);
      return { boothPin: b.boothPin };
    });

    scope.post("/api/dual/master/join", { config: rateLimitOptions(cfg) }, async (req, reply) => {
      const b = bodyOf(req.body);
      if (!pinMatches(b.pin, cfg.appPin)) return reply.code(401).send({ error: "invalid_pin" });
      if (!isDualLang(b.lang)) return invalid(reply);
      const token = hub.masterJoin(b.lang);
      return { token, boothPin: hub.booth().boothPin };
    });

    scope.post("/api/dual/guest/request", { config: rateLimitOptions(cfg) }, async (req, reply) => {
      const b = bodyOf(req.body);
      if (!isDualLang(b.lang) || typeof b.boothPin !== "string") return invalid(reply);
      const result = hub.guestRequest(b.boothPin, b.lang);
      switch (result.kind) {
        case "ok":
          return { token: result.token, guestId: result.guestId };
        case "error":
          return reply.code(result.error === "wrong_pin" ? 403 : 409).send({ error: result.error });
      }
    });

    scope.get("/api/dual/events", (req, reply) => {
      const token = (req.query as { token?: unknown } | undefined)?.token;
      if (typeof token !== "string" || !hub.hasToken(token)) {
        return reply.code(404).send({ error: "unknown_token" });
      }
      reply.hijack();
      const raw = reply.raw;
      raw.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        "x-accel-buffering": "no",
        connection: "keep-alive",
      });
      raw.socket?.setNoDelay(true);
      const stream: DualStream = {
        write: (chunk) => {
          if (!raw.destroyed && !raw.writableEnded) raw.write(chunk);
        },
        end: () => {
          if (!raw.destroyed && !raw.writableEnded) raw.end();
        },
      };
      const ping = setInterval(() => stream.write(": ping\n\n"), PING_MS);
      req.raw.on("close", () => {
        clearInterval(ping);
        hub.detach(token, stream);
      });
      hub.attach(token, stream);
    });

    scope.post("/api/dual/respond", async (req, reply) => {
      const b = bodyOf(req.body);
      const token = tokenOf(b, reply);
      if (!token) return reply;
      if (typeof b.guestId !== "string" || typeof b.accept !== "boolean") return invalid(reply);
      return finish(reply, hub.respond(token, b.guestId, b.accept));
    });

    scope.post("/api/dual/end", async (req, reply) => {
      const token = tokenOf(bodyOf(req.body), reply);
      if (!token) return reply;
      return finish(reply, hub.end(token));
    });

    scope.post("/api/dual/message", async (req, reply) => {
      const b = bodyOf(req.body);
      const token = tokenOf(b, reply);
      if (!token) return reply;
      const message = parseWireMessage(b.message);
      if (!message) return invalid(reply);
      return finish(reply, hub.message(token, message));
    });

    scope.post("/api/dual/leave", async (req, reply) => {
      const token = tokenOf(bodyOf(req.body), reply);
      if (!token) return reply;
      return finish(reply, hub.leave(token));
    });
  });
}
