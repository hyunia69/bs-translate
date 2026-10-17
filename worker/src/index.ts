import { type Config, loadConfig } from "./config.js";
import { DualHub, boothHub } from "./dualHub.js";
import { handleLive, handleSession } from "./engine.js";
import type { Env } from "./env.js";
import { bodyOf, clientIp, errorResponse, json, log, readBody } from "./http.js";
import { extractPin, pinMatches } from "./pin.js";

export { DualHub };

// About 30 requests/minute per client IP and route (RATE_LIMITER binding in wrangler.jsonc).
const RATE_LIMITED_POSTS = new Set([
  "/api/auth",
  "/api/session",
  "/api/live/session",
  "/api/dual/master/join",
  "/api/dual/guest/request",
  "/api/dual/booth-pin",
]);

async function handleAuth(request: Request, cfg: Config): Promise<Response> {
  const parsed = await readBody(request);
  if (parsed.kind === "error") return parsed.response;
  if (!pinMatches(bodyOf(parsed.body).pin, cfg.appPin)) return errorResponse(401, "invalid_pin");
  return json({ ok: true });
}

async function route(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  const method = request.method === "HEAD" ? "GET" : request.method;
  if (path === "/health" && method === "GET") {
    return json({ ok: true, openaiConfigured: (env.OPENAI_API_KEY ?? "").trim() !== "" });
  }
  if (!path.startsWith("/api/")) return errorResponse(404, "not_found");

  const cfg = loadConfig(env);
  if (!cfg) return errorResponse(503, "server_not_configured");

  if (method === "POST" && RATE_LIMITED_POSTS.has(path)) {
    const { success } = await env.RATE_LIMITER.limit({ key: `${path}|${clientIp(request)}` });
    if (!success) return errorResponse(429, "rate_limited");
  }

  if (path.startsWith("/api/dual/")) return boothHub(env).fetch(request);

  switch (`${method} ${path}`) {
    case "POST /api/auth":
      return handleAuth(request, cfg);
    case "GET /api/config":
      return pinMatches(extractPin(undefined, request.headers), cfg.appPin) ? json({}) : errorResponse(401, "invalid_pin");
    case "POST /api/session":
      return handleSession({ request, env, cfg });
    case "POST /api/live/session":
      return handleLive({ request, env, cfg });
    default:
      return errorResponse(404, "not_found");
  }
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (err) {
      log("error", "unhandled error", {
        name: err instanceof Error ? err.name : typeof err,
        message: err instanceof Error ? err.message : String(err),
      });
      return errorResponse(500, "internal_error");
    }
  },
} satisfies ExportedHandler<Env>;
