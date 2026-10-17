import type { Config } from "./config.js";
import { isDualLang } from "./dual.js";
import { boothHub } from "./dualHub.js";
import type { Env } from "./env.js";
import { glossary } from "./glossary.js";
import { type Body, bodyOf, clientIp, errorResponse, json, log, readBody } from "./http.js";
import { requestLiveSession, requestTranslationSecret } from "./openai.js";
import { extractPin, pinMatches } from "./pin.js";

const MAX_SDP_BYTES = 64 * 1024;

export interface EngineRequest {
  readonly request: Request;
  readonly env: Env;
  readonly cfg: Config;
}

// APP_PIN wins; otherwise `pin` is treated as a guest token (docs/dual-protocol.md, engine authorization).
async function authorized(req: EngineRequest, b: Body): Promise<boolean> {
  if (pinMatches(extractPin(b, req.request.headers), req.cfg.appPin)) return true;
  const { pin, source, target } = b;
  return (
    typeof pin === "string" &&
    isDualLang(source) &&
    isDualLang(target) &&
    (await boothHub(req.env).guestEngineAllowed(pin, source, target))
  );
}

type Prepared =
  | { readonly kind: "ok"; readonly b: Body; readonly source: string; readonly target: string }
  | { readonly kind: "reject"; readonly response: Response };

async function prepare(req: EngineRequest): Promise<Prepared> {
  const parsed = await readBody(req.request);
  if (parsed.kind === "error") return { kind: "reject", response: parsed.response };
  const b = bodyOf(parsed.body);
  if (!(await authorized(req, b))) return { kind: "reject", response: errorResponse(401, "invalid_pin") };
  if (!req.cfg.openaiApiKey) return { kind: "reject", response: errorResponse(503, "server_not_configured") };
  const { source, target } = b;
  if (!isDualLang(source) || !isDualLang(target) || source === target) {
    return { kind: "reject", response: errorResponse(400, "invalid_request") };
  }
  return { kind: "ok", b, source, target };
}

function upstreamFailure(what: string, failure: { kind: "unreachable" } | { kind: "upstream_error"; status: number; body: string }): Response {
  switch (failure.kind) {
    case "unreachable":
      log("error", `${what} unreachable`);
      return errorResponse(502, "upstream_unreachable");
    case "upstream_error":
      log("error", `${what} error`, { upstreamStatus: failure.status, upstreamBody: failure.body.slice(0, 500) });
      return json({ error: "upstream_error", status: failure.status }, 502);
  }
}

export async function handleSession(req: EngineRequest): Promise<Response> {
  const p = await prepare(req);
  if (p.kind === "reject") return p.response;
  const result = await requestTranslationSecret({
    apiKey: req.cfg.openaiApiKey,
    ip: clientIp(req.request),
    appPin: req.cfg.appPin,
    target: p.target,
    ttl: req.cfg.clientSecretTtlSeconds,
  });
  if (result.kind !== "ok") return upstreamFailure("openai", result);
  log("info", "translation secret issued", { direction: `${p.source}->${p.target}` });
  return json({ translation: { value: result.value, expires_at: result.expiresAt } });
}

export async function handleLive(req: EngineRequest): Promise<Response> {
  const p = await prepare(req);
  if (p.kind === "reject") return p.response;
  const { sdp } = p.b;
  if (typeof sdp !== "string" || !sdp.trim() || new TextEncoder().encode(sdp).byteLength > MAX_SDP_BYTES) {
    return errorResponse(400, "invalid_request");
  }
  const result = await requestLiveSession({ apiKey: req.cfg.openaiApiKey, source: p.source, target: p.target, sdp, glossary });
  if (result.kind !== "ok") return upstreamFailure("openai live", result);
  log("info", "openai live session created", {
    sessionId: result.sessionId,
    direction: `${p.source}->${p.target}`,
    upstreamStatus: result.status,
  });
  return json({ sdp: result.sdp, sessionId: result.sessionId });
}
