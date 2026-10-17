import { timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

export function pinMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string") return false;
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Reads the PIN from body.pin, then the x-app-pin header, then (opt-in) ?pin=. */
export function extractPin(req: FastifyRequest, allowQuery = false): unknown {
  const body = req.body as { pin?: unknown } | null | undefined;
  if (body && typeof body === "object" && "pin" in body) return body.pin;
  const header = req.headers["x-app-pin"];
  if (typeof header === "string") return header;
  if (allowQuery) {
    const q = (req.query as { pin?: unknown } | undefined)?.pin;
    if (typeof q === "string") return q;
  }
  return undefined;
}

/** Shared guard for protected routes. Replies 401 and returns false when the PIN is wrong. */
export function requirePin(req: FastifyRequest, reply: FastifyReply, expected: string, allowQuery = false): boolean {
  if (pinMatches(extractPin(req, allowQuery), expected)) return true;
  void reply.code(401).send({ error: "invalid_pin" });
  return false;
}
