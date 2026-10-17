import type { EngineId, Lang, PartnerLang } from "../types";

/** Strings a speaker reads in their own language. The partner table is the contract; Korean mirrors it for the rep. */
export interface UiStrings {
  /** Language name written in that language (PTT button label). */
  name: string;
  /** Instruction shown when the conversation is empty. */
  speakHint: string;
  /** Shown on the PTT button while the microphone is capturing. */
  listening: string;
  /** Shown under streaming text while the translation is still arriving. */
  translating: string;
  /** Countdown shown when less than 10 s of recording time remain. */
  secondsLeft(n: number): string;
  /** Label of a turn that failed. */
  error: string;
  /** Shown to the partner while no translation session is active (facing mode, in place of their button). */
  waiting: string;
}

export const PARTNER_STRINGS: Record<PartnerLang, UiStrings> = {
  en: {
    name: "English",
    speakHint: "Tap the English button and speak.",
    listening: "Listening\u2026",
    translating: "Translating\u2026",
    secondsLeft: (n) => `${n}s left`,
    error: "Translation failed",
    waiting: "Please wait a moment",
  },
  ja: {
    name: "日本語",
    speakHint: "日本語ボタンを押して話してください。",
    listening: "聞き取り中\u2026",
    translating: "翻訳中\u2026",
    secondsLeft: (n) => `残り${n}秒`,
    error: "翻訳に失敗しました",
    waiting: "少々お待ちください",
  },
  zh: {
    name: "中文",
    speakHint: "请按下中文按钮后说话。",
    listening: "正在聆听\u2026",
    translating: "正在翻译\u2026",
    secondsLeft: (n) => `还剩${n}秒`,
    error: "翻译失败",
    waiting: "请稍候",
  },
};

export const KO_STRINGS: UiStrings = {
  name: "한국어",
  speakHint: "한국어 버튼을 누르고 말하세요.",
  listening: "듣는 중\u2026",
  translating: "번역 중\u2026",
  secondsLeft: (n) => `${n}초 남음`,
  error: "번역 실패",
  waiting: "잠시만 기다려 주세요",
};

export function stringsFor(lang: Lang): UiStrings {
  return lang === "ko" ? KO_STRINGS : PARTNER_STRINGS[lang];
}

/** Segmented-control captions in the header (fixed by the design spec). */
export const PARTNER_LANG_SHORT: Record<PartnerLang, string> = { en: "EN", ja: "日本語", zh: "中文" };

/** Engine names: full for the settings sheet, short for the session bar (must fit a 360 px row next to the stop button). */
export const ENGINE_LABEL: Record<EngineId, string> = { "gpt-live": "GPT-Live-1", "realtime-translate": "gpt-realtime-translate" };
export const ENGINE_SHORT: Record<EngineId, string> = { "gpt-live": "GPT-Live-1", "realtime-translate": "Realtime" };
