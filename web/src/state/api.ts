export type AuthResult = "ok" | "invalid" | "rate_limited" | "error";

export async function postAuth(pin: string): Promise<AuthResult> {
  try {
    const res = await fetch("/api/auth", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    if (res.ok) return "ok";
    if (res.status === 401) return "invalid";
    if (res.status === 429) return "rate_limited";
    return "error";
  } catch (err) {
    console.error("[api] /api/auth failed", err);
    return "error";
  }
}

/** "ok" when the PIN is accepted; null on network/server error; "unauthorized" when the server rejects the PIN. */
export async function getConfig(pin: string): Promise<"ok" | "unauthorized" | null> {
  try {
    const res = await fetch("/api/config", { headers: { "x-app-pin": pin } });
    if (res.status === 401) return "unauthorized";
    if (!res.ok) return null;
    return "ok";
  } catch (err) {
    console.error("[api] /api/config failed", err);
    return null;
  }
}
