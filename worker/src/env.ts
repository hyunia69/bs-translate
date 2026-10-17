import type { DualHub } from "./dualHub.js";

export interface Env {
  readonly OPENAI_API_KEY?: string;
  readonly APP_PIN?: string;
  readonly CLIENT_SECRET_TTL_SECONDS?: string;
  readonly DUAL_HUB: DurableObjectNamespace<DualHub>;
  readonly RATE_LIMITER: RateLimit;
}
