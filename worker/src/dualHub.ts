import { DurableObject } from "cloudflare:workers";
import { loadConfig } from "./config.js";
import {
  type DualLang,
  type DualStream,
  DualHubState,
  type HubResult,
  isBoothPin,
  isDualLang,
  parseWireMessage,
  randomBoothPin,
} from "./dual.js";
import type { Env } from "./env.js";
import { type Body, bodyOf, errorResponse, json, readBody } from "./http.js";
import { pinMatches } from "./pin.js";

const PING_MS = 15_000;
const BOOTH_PIN_KEY = "boothPin";

export function boothHub(env: Env): DurableObjectStub<DualHub> {
  return env.DUAL_HUB.get(env.DUAL_HUB.idFromName("booth"));
}

const invalid = (): Response => errorResponse(400, "invalid_request");

function finish(result: HubResult): Response {
  switch (result) {
    case "ok":
      return json({ ok: true });
    case "unknown_token":
      return errorResponse(404, "unknown_token");
    case "unavailable":
    case "busy":
    case "not_paired":
      return errorResponse(409, result);
    default: {
      const unreachable: never = result;
      return unreachable;
    }
  }
}

/**
 * The single "booth" instance owns the whole dual hub in memory; only the booth PIN is persisted
 * (synchronous SQLite-backed KV). The Worker forwards every /api/dual/* request here unchanged.
 */
export class DualHub extends DurableObject<Env> {
  private readonly hub: DualHubState;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const kv = ctx.storage.kv;
    const stored = kv.get<unknown>(BOOTH_PIN_KEY);
    const boothPin = isBoothPin(stored) ? stored : randomBoothPin();
    if (stored !== boothPin) kv.put(BOOTH_PIN_KEY, boothPin);
    this.hub = new DualHubState(boothPin, async (pin) => kv.put(BOOTH_PIN_KEY, pin));
  }

  guestEngineAllowed(token: string, source: DualLang, target: DualLang): boolean {
    return this.hub.guestEngineAllowed(token, source, target);
  }

  override async fetch(request: Request): Promise<Response> {
    const cfg = loadConfig(this.env);
    if (!cfg) return errorResponse(503, "server_not_configured");
    const url = new URL(request.url);
    const method = request.method === "HEAD" ? "GET" : request.method;
    if (method === "GET") {
      switch (url.pathname) {
        case "/api/dual/booth":
          return json(this.hub.booth());
        case "/api/dual/events":
          return this.events(request, url.searchParams.get("token"));
        default:
          return errorResponse(404, "not_found");
      }
    }
    if (method !== "POST") return errorResponse(404, "not_found");
    const parsed = await readBody(request, true);
    if (parsed.kind === "error") return parsed.response;
    const b = bodyOf(parsed.body);
    switch (url.pathname) {
      case "/api/dual/booth-pin": {
        if (!pinMatches(b.pin, cfg.appPin)) return errorResponse(401, "invalid_pin");
        if (!isBoothPin(b.boothPin)) return invalid();
        await this.hub.setBoothPin(b.boothPin);
        return json({ boothPin: b.boothPin });
      }
      case "/api/dual/master/join": {
        if (!pinMatches(b.pin, cfg.appPin)) return errorResponse(401, "invalid_pin");
        if (!isDualLang(b.lang)) return invalid();
        const token = this.hub.masterJoin(b.lang);
        return json({ token, boothPin: this.hub.booth().boothPin });
      }
      case "/api/dual/guest/request":
        return this.guestRequest(b);
      case "/api/dual/respond":
        return this.withToken(b, (token) => {
          if (typeof b.guestId !== "string" || typeof b.accept !== "boolean") return invalid();
          return finish(this.hub.respond(token, b.guestId, b.accept));
        });
      case "/api/dual/end":
        return this.withToken(b, (token) => finish(this.hub.end(token)));
      case "/api/dual/message":
        return this.withToken(b, (token) => {
          const message = parseWireMessage(b.message);
          return message ? finish(this.hub.message(token, message)) : invalid();
        });
      case "/api/dual/leave":
        return this.withToken(b, (token) => finish(this.hub.leave(token)));
      default:
        return errorResponse(404, "not_found");
    }
  }

  private guestRequest(b: Body): Response {
    if (!isDualLang(b.lang) || typeof b.boothPin !== "string") return invalid();
    const result = this.hub.guestRequest(b.boothPin, b.lang);
    switch (result.kind) {
      case "ok":
        return json({ token: result.token, guestId: result.guestId });
      case "error":
        return errorResponse(result.error === "wrong_pin" ? 403 : 409, result.error);
    }
  }

  private withToken(b: Body, handle: (token: string) => Response): Response {
    if (typeof b.token !== "string" || b.token === "") return invalid();
    if (!this.hub.hasToken(b.token)) return errorResponse(404, "unknown_token");
    return handle(b.token);
  }

  /**
   * SSE stream. A disconnect is detected three ways, whichever fires first: the client aborting the
   * request (request.signal), the response body being cancelled (writer.closed rejects), or a failed
   * write (pings every 15 s guarantee one). Each hands the stream back to the hub, which starts the grace timer.
   */
  private events(request: Request, token: string | null): Response {
    if (token === null || !this.hub.hasToken(token)) return errorResponse(404, "unknown_token");
    const hub = this.hub;
    const memberToken = token;
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    let open = true;
    const stop = (): boolean => {
      if (!open) return false;
      open = false;
      clearInterval(ping);
      return true;
    };
    const stream: DualStream = {
      write: (chunk) => {
        if (open) writer.write(encoder.encode(chunk)).catch(gone);
      },
      end: () => {
        // Closing can only fail when the client already went away; nothing is left to clean up then.
        if (stop()) writer.close().catch(() => undefined);
      },
    };
    function gone(): void {
      if (stop()) hub.detach(memberToken, stream);
    }
    const ping = setInterval(() => stream.write(": ping\n\n"), PING_MS);
    writer.closed.catch(gone);
    request.signal.addEventListener("abort", gone);
    hub.attach(memberToken, stream);
    return new Response(readable, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache", "x-accel-buffering": "no" },
    });
  }
}
