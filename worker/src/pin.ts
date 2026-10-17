import type { Body } from "./http.js";

const encoder = new TextEncoder();

/** Constant-time comparison (for equal lengths) of a supplied PIN against the expected one. */
export function pinMatches(supplied: unknown, expected: string): boolean {
  if (typeof supplied !== "string") return false;
  const a = encoder.encode(supplied);
  const b = encoder.encode(expected);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

export function extractPin(body: unknown, headers: Headers): unknown {
  if (body && typeof body === "object" && "pin" in body) return (body as Body).pin;
  return headers.get("x-app-pin") ?? undefined;
}
