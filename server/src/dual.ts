import { randomBytes, randomInt } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pinMatches } from "./pin.js";

// In-memory hub for dual mode v2: one master (booth phone) and guests (contract: docs/dual-protocol.md).
// The only I/O is booth.json persistence and the stream interface.

export const DUAL_LANGS = ["ko", "en", "ja", "zh"] as const;
export type DualLang = (typeof DUAL_LANGS)[number];

const STATUSES = ["recording", "translating", "done", "error"] as const;
const GRACE_MS = 20_000;
const MAX_TEXT = 4000;
const MAX_GUEST_IDS = 1000;
const BOOTH_FILE = "booth.json";
const BOOTH_PIN_RE = /^\d{4}$/;

export interface DualPeer {
  readonly id: string;
  readonly lang: DualLang;
}

export interface DualWireMessage {
  readonly id: string;
  readonly source: DualLang;
  readonly target: DualLang;
  readonly sourceText: string;
  readonly targetText: string;
  readonly status: (typeof STATUSES)[number];
  readonly createdAt: number;
}

type EndReason = "master_ended" | "master_left" | "declined";
type UnpairReason = "ended" | "guest_left";

export type HubResult = "ok" | "unknown_token" | "unavailable" | "busy" | "not_paired";
export type GuestRequestResult =
  | { readonly kind: "ok"; readonly token: string; readonly guestId: string }
  | { readonly kind: "error"; readonly error: "master_offline" | "wrong_pin" | "same_lang" | "unavailable" };

/** Minimal sink the hub writes SSE frames to; the route adapts a raw HTTP response to it. */
export interface DualStream {
  write(chunk: string): void;
  end(): void;
}

// Members are mutable on purpose: the hub updates streams, timers and pairing in place.
interface Member {
  readonly token: string;
  readonly lang: DualLang;
  stream: DualStream | null;
  graceTimer: NodeJS.Timeout | null;
}
interface Master extends Member {
  partnerId: string | null;
}
interface Guest extends Member {
  readonly id: string;
  readonly createdAt: number;
  status: "pending" | "paired";
}

type Resolved = { readonly role: "master"; readonly m: Master } | { readonly role: "guest"; readonly g: Guest };

export function isDualLang(v: unknown): v is DualLang {
  return typeof v === "string" && (DUAL_LANGS as readonly string[]).includes(v);
}

export function isBoothPin(v: unknown): v is string {
  return typeof v === "string" && BOOTH_PIN_RE.test(v);
}

/** Returns a clean copy of a valid wire message, or null. */
export function parseWireMessage(v: unknown): DualWireMessage | null {
  if (!v || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  if (typeof m.id !== "string" || m.id.length < 1 || m.id.length > 64) return null;
  if (!isDualLang(m.source) || !isDualLang(m.target)) return null;
  if (typeof m.sourceText !== "string" || m.sourceText.length > MAX_TEXT) return null;
  if (typeof m.targetText !== "string" || m.targetText.length > MAX_TEXT) return null;
  if (typeof m.status !== "string" || !(STATUSES as readonly string[]).includes(m.status)) return null;
  if (typeof m.createdAt !== "number" || !Number.isFinite(m.createdAt)) return null;
  return {
    id: m.id,
    source: m.source,
    target: m.target,
    sourceText: m.sourceText,
    targetText: m.targetText,
    status: m.status as DualWireMessage["status"],
    createdAt: m.createdAt,
  };
}

const newToken = (): string => randomBytes(16).toString("hex");

async function saveBoothPin(dataDir: string, boothPin: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await writeFile(path.join(dataDir, BOOTH_FILE), JSON.stringify({ boothPin }) + "\n", "utf8");
}

/** Reads booth.json; when it is missing (or holds no valid PIN) a random PIN is created and saved. */
async function loadBoothPin(dataDir: string): Promise<string> {
  let stored: unknown = null;
  try {
    stored = JSON.parse(await readFile(path.join(dataDir, BOOTH_FILE), "utf8"));
  } catch (err) {
    const missing = err instanceof Error && "code" in err && err.code === "ENOENT";
    if (!missing && !(err instanceof SyntaxError)) throw err;
  }
  if (stored && typeof stored === "object" && "boothPin" in stored && isBoothPin(stored.boothPin)) {
    return stored.boothPin;
  }
  const boothPin = String(randomInt(0, 10_000)).padStart(4, "0");
  await saveBoothPin(dataDir, boothPin);
  return boothPin;
}

export class DualHub {
  private master: Master | null = null;
  private readonly guests = new Map<string, Guest>();

  private constructor(
    private readonly dataDir: string,
    private boothPin: string,
    private readonly graceMs: number,
  ) {}

  static async load(dataDir: string, graceMs = GRACE_MS): Promise<DualHub> {
    return new DualHub(dataDir, await loadBoothPin(dataDir), graceMs);
  }

  booth() {
    const m = this.master;
    return { boothPin: this.boothPin, masterOnline: m !== null, masterLang: m?.lang ?? null, busy: m?.partnerId != null };
  }

  hasToken(token: string): boolean {
    return this.resolve(token) !== null;
  }

  async setBoothPin(boothPin: string): Promise<void> {
    await saveBoothPin(this.dataDir, boothPin);
    this.boothPin = boothPin;
    if (this.master) this.send(this.master, { type: "booth_pin", boothPin });
  }

  masterJoin(lang: DualLang): string {
    const old = this.master;
    if (old) {
      this.master = null;
      this.clearGrace(old);
      this.send(old, { type: "replaced" });
      this.closeStream(old);
      const partner = this.partnerOf(old);
      if (partner) this.endGuest(partner, "master_left");
    }
    const m: Master = { token: newToken(), lang, stream: null, graceTimer: null, partnerId: null };
    this.master = m;
    this.startGrace(m);
    return m.token;
  }

  guestRequest(boothPin: string, lang: DualLang): GuestRequestResult {
    const m = this.master;
    if (!m) return { kind: "error", error: "master_offline" };
    if (!pinMatches(boothPin, this.boothPin)) return { kind: "error", error: "wrong_pin" };
    if (lang === m.lang) return { kind: "error", error: "same_lang" };
    if (this.guests.size >= MAX_GUEST_IDS) return { kind: "error", error: "unavailable" };
    let id = "";
    do id = String(randomInt(0, 1000)).padStart(3, "0");
    while (this.guests.has(id));
    const g: Guest = { id, token: newToken(), lang, status: "pending", createdAt: Date.now(), stream: null, graceTimer: null };
    this.guests.set(id, g);
    this.startGrace(g);
    this.sendRequests();
    return { kind: "ok", token: g.token, guestId: id };
  }

  /** Attaches a stream (replacing and ending any previous one) and sends the initial state event. */
  attach(token: string, stream: DualStream): boolean {
    const who = this.resolve(token);
    if (!who) return false;
    const member = who.role === "master" ? who.m : who.g;
    this.clearGrace(member);
    const old = member.stream;
    member.stream = stream;
    old?.end();
    switch (who.role) {
      case "master": {
        const p = this.partnerOf(who.m);
        this.send(who.m, {
          type: "state",
          role: "master",
          boothPin: this.boothPin,
          requests: this.requests(),
          partner: p ? { id: p.id, lang: p.lang } : null,
        });
        return true;
      }
      case "guest":
        this.send(who.g, { type: "state", role: "guest", status: who.g.status, partner: this.masterPeerFor(who.g) });
        return true;
    }
  }

  /** Called when a stream closed. Ignored if that stream was already replaced. */
  detach(token: string, stream: DualStream): void {
    const who = this.resolve(token);
    if (!who) return;
    const member = who.role === "master" ? who.m : who.g;
    if (member.stream !== stream) return;
    member.stream = null;
    this.startGrace(member);
  }

  /** Master only: a guest token (or any non-master token) is treated as unknown. */
  respond(token: string, guestId: string, accept: boolean): HubResult {
    const m = this.master;
    if (!m || m.token !== token) return "unknown_token";
    const g = this.guests.get(guestId);
    if (!g || g.status !== "pending") return "unavailable";
    if (!accept) {
      this.endGuest(g, "declined");
      this.sendRequests();
      return "ok";
    }
    if (m.partnerId !== null) return "busy";
    g.status = "paired";
    m.partnerId = g.id;
    this.send(m, { type: "paired", partner: { id: g.id, lang: g.lang } });
    this.send(g, { type: "paired", partner: { id: "master", lang: m.lang } });
    this.sendRequests();
    return "ok";
  }

  end(token: string): HubResult {
    const who = this.resolve(token);
    if (!who) return "unknown_token";
    switch (who.role) {
      case "master": {
        const partner = this.partnerOf(who.m);
        if (partner) {
          this.endGuest(partner, "master_ended");
          who.m.partnerId = null;
          this.send(who.m, { type: "unpaired", reason: "ended" satisfies UnpairReason });
        }
        return "ok";
      }
      case "guest":
        this.leaveGuest(who.g);
        return "ok";
    }
  }

  message(token: string, message: DualWireMessage): HubResult {
    const who = this.resolve(token);
    if (!who) return "unknown_token";
    switch (who.role) {
      case "master": {
        const partner = this.partnerOf(who.m);
        if (!partner) return "not_paired";
        this.send(partner, { type: "message", message });
        return "ok";
      }
      case "guest": {
        const m = this.master;
        if (who.g.status !== "paired" || !m || m.partnerId !== who.g.id) return "not_paired";
        this.send(m, { type: "message", message });
        return "ok";
      }
    }
  }

  leave(token: string): HubResult {
    const who = this.resolve(token);
    if (!who) return "unknown_token";
    if (who.role === "master") this.leaveMaster(who.m);
    else this.leaveGuest(who.g);
    return "ok";
  }

  /** Engine authorization: the token is a paired guest speaking its own language toward the master's. */
  guestEngineAllowed(token: string, source: DualLang, target: DualLang): boolean {
    const g = this.findGuest(token);
    const m = this.master;
    return g !== undefined && g.status === "paired" && source === g.lang && m !== null && target === m.lang;
  }

  /** Drops every member and timer (shutdown / tests). */
  close(): void {
    const members: Member[] = [...this.guests.values()];
    if (this.master) members.push(this.master);
    for (const member of members) {
      this.clearGrace(member);
      this.closeStream(member);
    }
    this.master = null;
    this.guests.clear();
  }

  private resolve(token: string): Resolved | null {
    if (this.master && this.master.token === token) return { role: "master", m: this.master };
    const g = this.findGuest(token);
    return g ? { role: "guest", g } : null;
  }

  private findGuest(token: string): Guest | undefined {
    for (const g of this.guests.values()) if (g.token === token) return g;
    return undefined;
  }

  private partnerOf(m: Master): Guest | undefined {
    return m.partnerId === null ? undefined : this.guests.get(m.partnerId);
  }

  private masterPeerFor(g: Guest): DualPeer | null {
    return g.status === "paired" && this.master ? { id: "master", lang: this.master.lang } : null;
  }

  private requests(): DualPeer[] {
    return [...this.guests.values()]
      .filter((g) => g.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((g) => ({ id: g.id, lang: g.lang }));
  }

  private sendRequests(): void {
    if (this.master) this.send(this.master, { type: "requests", requests: this.requests() });
  }

  private send(member: Member, payload: Record<string, unknown>): void {
    member.stream?.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  private closeStream(member: Member): void {
    const stream = member.stream;
    member.stream = null;
    stream?.end();
  }

  private endGuest(g: Guest, reason: EndReason): void {
    this.send(g, { type: "ended", reason });
    this.removeGuest(g);
  }

  private removeGuest(g: Guest): void {
    this.clearGrace(g);
    this.guests.delete(g.id);
    this.closeStream(g);
  }

  private leaveGuest(g: Guest): void {
    this.removeGuest(g);
    const m = this.master;
    if (!m) return;
    if (m.partnerId === g.id) {
      m.partnerId = null;
      this.send(m, { type: "unpaired", reason: "guest_left" satisfies UnpairReason });
    } else if (g.status === "pending") {
      this.sendRequests();
    }
  }

  private leaveMaster(m: Master): void {
    this.master = null;
    this.clearGrace(m);
    this.closeStream(m);
    for (const g of [...this.guests.values()]) this.endGuest(g, "master_left");
  }

  private startGrace(member: Member): void {
    this.clearGrace(member);
    member.graceTimer = setTimeout(() => {
      member.graceTimer = null;
      if (member.stream) return;
      if (this.master === member) this.leaveMaster(this.master);
      else {
        const g = this.findGuest(member.token);
        if (g === member) this.leaveGuest(g);
      }
    }, this.graceMs);
    member.graceTimer.unref();
  }

  private clearGrace(member: Member): void {
    if (member.graceTimer) clearTimeout(member.graceTimer);
    member.graceTimer = null;
  }
}
