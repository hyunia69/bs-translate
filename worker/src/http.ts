const BODY_LIMIT = 1024 * 1024;

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export const errorResponse = (status: number, error: string): Response => json({ error }, status);

export type BodyResult = { readonly kind: "ok"; readonly body: unknown } | { readonly kind: "error"; readonly response: Response };

/**
 * Reads the request body.
 * - application/json: parsed; empty or malformed -> 400 bad_request.
 * - text/plain: the raw string, or with `textPlainAsJson` (sendBeacon on dual routes) JSON-parsed, null when malformed.
 * - no body: undefined. Any other media type with a body -> 415 bad_request.
 */
export async function readBody(request: Request, textPlainAsJson = false): Promise<BodyResult> {
  if (request.method === "GET" || request.method === "HEAD") return { kind: "ok", body: undefined };
  const declared = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declared) && declared > BODY_LIMIT) {
    return { kind: "error", response: errorResponse(413, "payload_too_large") };
  }
  const text = request.body === null ? "" : await request.text();
  if (text.length > BODY_LIMIT) return { kind: "error", response: errorResponse(413, "payload_too_large") };
  const mediaType = (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (mediaType === "") {
    return text === "" ? { kind: "ok", body: undefined } : { kind: "error", response: errorResponse(415, "bad_request") };
  }
  if (mediaType === "application/json") {
    try {
      return { kind: "ok", body: JSON.parse(text) };
    } catch {
      return { kind: "error", response: errorResponse(400, "bad_request") };
    }
  }
  if (mediaType === "text/plain") {
    if (!textPlainAsJson) return { kind: "ok", body: text };
    try {
      return { kind: "ok", body: JSON.parse(text) };
    } catch {
      return { kind: "ok", body: null };
    }
  }
  return { kind: "error", response: errorResponse(415, "bad_request") };
}

export type Body = Readonly<Record<string, unknown>>;

export function bodyOf(raw: unknown): Body {
  return raw && typeof raw === "object" ? (raw as Body) : {};
}

export function clientIp(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

export function log(level: "info" | "error", msg: string, fields: Readonly<Record<string, unknown>> = {}): void {
  const line = JSON.stringify({ level, msg, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}
