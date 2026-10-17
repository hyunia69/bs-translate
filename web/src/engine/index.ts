import type { EngineCallbacks, EngineId, TranslationEngine } from "../types";
import { GptLiveEngine } from "./gptLive";
import { MockEngine } from "./mockEngine";
import { RealtimeTranslateEngine } from "./realtimeTranslate";

export { mockStats } from "./mockEngine";
export { GptLiveEngine } from "./gptLive";
export { RealtimeTranslateEngine } from "./realtimeTranslate";

export function createEngine(id: EngineId, callbacks: EngineCallbacks): TranslationEngine {
  if (id === "gpt-live") return new GptLiveEngine(callbacks);
  return new RealtimeTranslateEngine(callbacks);
}

export function createMockEngine(callbacks: EngineCallbacks): TranslationEngine {
  return new MockEngine(callbacks);
}
