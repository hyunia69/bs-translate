// Dual mode server client, v2 master/guest (contract: docs/dual-protocol.md).
import type { DualPeer, DualWireMessage, Lang } from "../types";

export type DualApiError =
  | "invalid_pin"
  | "rate_limited"
  | "unknown_token"
  | "unavailable"
  | "busy"
  | "not_paired"
  | "invalid_request"
  | "wrong_pin"
  | "master_offline"
  | "same_lang"
  | "network"
  | "server";

export type DualResult<T> = { ok: true; value: T } | { ok: false; error: DualApiError };

const KNOWN_ERRORS: readonly DualApiError[] = [
  "invalid_pin",
  "unknown_token",
  "unavailable",
  "busy",
  "not_paired",
  "invalid_request",
  "wrong_pin",
  "master_offline",
  "same_lang",
];

const LANGS: readonly Lang[] = ["ko", "en", "ja", "zh"];

async function call<T>(path: string, body: unknown, keepalive = false): Promise<DualResult<T>> {
  let res: Response;
  try {
    res = await fetch(`/api/dual/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive,
    });
  } catch (err) {
    console.error(`[dual] /api/dual/${path} failed`, err);
    return { ok: false, error: "network" };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (res.ok) return { ok: true, value: (json ?? {}) as T };
  if (res.status === 429) return { ok: false, error: "rate_limited" };
  const code = json?.error;
  const error = KNOWN_ERRORS.find((e) => e === code) ?? (res.status === 401 ? "invalid_pin" : "server");
  console.error(`[dual] /api/dual/${path} -> ${res.status} ${String(code ?? "")}`);
  return { ok: false, error };
}

type Ok = { ok: true };

export interface BoothInfo {
  boothPin: string | null;
  masterOnline: boolean;
  masterLang: Lang | null;
  /** The master is paired with a guest. */
  busy: boolean;
}

export async function getDualBooth(): Promise<DualResult<BoothInfo>> {
  let res: Response;
  try {
    res = await fetch("/api/dual/booth", { cache: "no-store" });
  } catch (err) {
    console.error("[dual] /api/dual/booth failed", err);
    return { ok: false, error: "network" };
  }
  if (!res.ok) {
    console.error(`[dual] /api/dual/booth -> ${res.status}`);
    return { ok: false, error: "server" };
  }
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!json) return { ok: false, error: "server" };
  return {
    ok: true,
    value: {
      boothPin: typeof json.boothPin === "string" ? json.boothPin : null,
      masterOnline: json.masterOnline === true,
      masterLang: LANGS.find((l) => l === json.masterLang) ?? null,
      busy: json.busy === true,
    },
  };
}

export function postBoothPin(pin: string, boothPin: string): Promise<DualResult<{ boothPin: string }>> {
  return call("booth-pin", { pin, boothPin });
}

/** APP_PIN required; replaces any existing master. */
export function postMasterJoin(pin: string, lang: Lang): Promise<DualResult<{ token: string; boothPin: string }>> {
  return call("master/join", { pin, lang });
}

export function postGuestRequest(boothPin: string, lang: Lang): Promise<DualResult<{ token: string; guestId: string }>> {
  return call("guest/request", { boothPin, lang });
}

export function postDualRespond(token: string, guestId: string, accept: boolean): Promise<DualResult<Ok>> {
  return call("respond", { token, guestId, accept });
}

export function postDualEnd(token: string): Promise<DualResult<Ok>> {
  return call("end", { token });
}

export function postDualMessage(token: string, message: DualWireMessage): Promise<DualResult<Ok>> {
  return call("message", { token, message });
}

export function postDualLeave(token: string): Promise<DualResult<Ok>> {
  return call("leave", { token }, true);
}

/** For pagehide: survives the page going away. Returns false if the browser refused to queue it. */
export function beaconDualLeave(token: string): boolean {
  const body = new Blob([JSON.stringify({ token })], { type: "application/json" });
  return navigator.sendBeacon("/api/dual/leave", body);
}

export type MasterEvent =
  | { type: "state"; role: "master"; boothPin: string; requests: DualPeer[]; partner: DualPeer | null }
  | { type: "requests"; requests: DualPeer[] }
  | { type: "booth_pin"; boothPin: string }
  | { type: "paired"; partner: DualPeer }
  | { type: "unpaired"; reason: "ended" | "guest_left" }
  | { type: "message"; message: DualWireMessage }
  | { type: "replaced" };

export type GuestEndReason = "master_ended" | "master_left" | "declined";

export type GuestEvent =
  | { type: "state"; role: "guest"; status: "pending" | "paired"; partner: DualPeer | null }
  | { type: "paired"; partner: DualPeer }
  | { type: "message"; message: DualWireMessage }
  | { type: "ended"; reason: GuestEndReason };

export type DualEventHandlers<E extends { type: string }> = {
  [K in E["type"]]: (e: Extract<E, { type: K }>) => void;
} & {
  /** The stream gave up for good (readyState CLOSED, e.g. the server answered 404 for an invalid token). */
  closed(): void;
};

const MASTER_EVENTS = [
  "state",
  "requests",
  "booth_pin",
  "paired",
  "unpaired",
  "message",
  "replaced",
] as const satisfies readonly MasterEvent["type"][];

const GUEST_EVENTS = ["state", "paired", "message", "ended"] as const satisfies readonly GuestEvent["type"][];

export interface DualEventStream {
  close(): void;
}

/** Opens the SSE stream; EventSource reconnects on its own after transient drops. */
function openEvents<T extends string>(
  token: string,
  types: readonly T[],
  handlers: { dispatch(type: T, data: unknown): void; closed(): void },
): DualEventStream {
  const es = new EventSource(`/api/dual/events?token=${encodeURIComponent(token)}`);
  let open = true;
  es.onmessage = (ev: MessageEvent<string>) => {
    if (!open) return;
    let data: unknown;
    try {
      data = JSON.parse(ev.data);
    } catch {
      console.error("[dual] bad event", ev.data);
      return;
    }
    const type = (data as { type?: unknown } | null)?.type;
    const known = types.find((t) => t === type);
    if (known === undefined) {
      console.warn("[dual] unknown event", data);
      return;
    }
    handlers.dispatch(known, data);
  };
  es.onerror = () => {
    if (!open || es.readyState !== EventSource.CLOSED) return;
    open = false;
    handlers.closed();
  };
  return {
    close() {
      open = false;
      es.close();
    },
  };
}

export function openMasterEvents(token: string, handlers: DualEventHandlers<MasterEvent>): DualEventStream {
  return openEvents(token, MASTER_EVENTS, {
    dispatch: (type, data) => (handlers[type] as (e: MasterEvent) => void)(data as MasterEvent),
    closed: handlers.closed,
  });
}

export function openGuestEvents(token: string, handlers: DualEventHandlers<GuestEvent>): DualEventStream {
  return openEvents(token, GUEST_EVENTS, {
    dispatch: (type, data) => (handlers[type] as (e: GuestEvent) => void)(data as GuestEvent),
    closed: handlers.closed,
  });
}
