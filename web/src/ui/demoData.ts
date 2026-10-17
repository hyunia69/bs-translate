import type { Message, MessageStatus, PartnerLang, Speaker } from "../types";
import type { MicDevice } from "./props";

interface Line {
  speaker: Speaker;
  src: string;
  tgt: string;
  status?: MessageStatus;
  hasAudio?: boolean;
}

const KO = {
  hello: "안녕하세요, 저희 부스에 오신 것을 환영합니다.",
  what: "실시간으로 음성을 통역하는 기기입니다. 지연 시간은 1초 이내예요.",
  price: "기본 모델은 월 49달러이고, 기업용은 별도 견적입니다.",
  card: "네, 여기 명함과 브로슈어 드릴게요. 이메일로도 자료를",
  q1: "안녕하세요! 이 기기는 어떤 기능을 하나요?",
  q2: "인상적이네요. 가격이 얼마인가요?",
  q3: "브로슈어와 연락처를 받을 수 있을까요?",
};

const SCRIPT: Record<PartnerLang, Line[]> = {
  en: [
    { speaker: "me", src: KO.hello, tgt: "Hello, welcome to our booth." },
    { speaker: "partner", src: "Hi! What does this device do?", tgt: KO.q1 },
    { speaker: "me", src: KO.what, tgt: "It interprets speech in real time, with under one second of delay." },
    { speaker: "partner", src: "That's impressive. How much does it cost?", tgt: KO.q2, hasAudio: false },
    { speaker: "me", src: KO.price, tgt: "The basic model is $49 a month; enterprise pricing is quoted separately." },
    { speaker: "partner", src: "Could you repeat the enterprise part?", tgt: "", status: "error" },
    { speaker: "partner", src: "Can I get a brochure and your contact?", tgt: KO.q3 },
    { speaker: "me", src: KO.card, tgt: "Sure, here is my business card and brochure. I'll also send", status: "translating" },
  ],
  ja: [
    { speaker: "me", src: KO.hello, tgt: "こんにちは、私たちのブースへようこそ。" },
    { speaker: "partner", src: "こんにちは！この機器は何ができますか？", tgt: KO.q1 },
    { speaker: "me", src: KO.what, tgt: "リアルタイムで音声を通訳する機器です。遅延は1秒以内です。" },
    { speaker: "partner", src: "すごいですね。価格はいくらですか？", tgt: KO.q2, hasAudio: false },
    { speaker: "me", src: KO.price, tgt: "基本モデルは月49ドルで、法人向けは別途お見積りです。" },
    { speaker: "partner", src: "法人向けの部分をもう一度お願いします。", tgt: "", status: "error" },
    { speaker: "partner", src: "パンフレットと連絡先をいただけますか？", tgt: KO.q3 },
    { speaker: "me", src: KO.card, tgt: "はい、名刺とパンフレットをお渡しします。メールでも資料を", status: "translating" },
  ],
  zh: [
    { speaker: "me", src: KO.hello, tgt: "您好，欢迎来到我们的展位。" },
    { speaker: "partner", src: "你好！这个设备有什么功能？", tgt: KO.q1 },
    { speaker: "me", src: KO.what, tgt: "这是一台实时语音翻译设备，延迟在一秒以内。" },
    { speaker: "partner", src: "很厉害。价格是多少？", tgt: KO.q2, hasAudio: false },
    { speaker: "me", src: KO.price, tgt: "基础款每月49美元，企业版另行报价。" },
    { speaker: "partner", src: "能再说一遍企业版的部分吗？", tgt: "", status: "error" },
    { speaker: "partner", src: "可以给我一份宣传册和您的联系方式吗？", tgt: KO.q3 },
    { speaker: "me", src: KO.card, tgt: "好的，这是我的名片和宣传册。我也会通过邮件把资料", status: "translating" },
  ],
};

/** Eight sample turns (both speakers, one error, one still translating, most with audio). */
export function sampleMessages(lang: PartnerLang): Message[] {
  const now = Date.now();
  const lines = SCRIPT[lang];
  return lines.map((l, i) => {
    const status = l.status ?? "done";
    return {
      id: `demo-${i}`,
      speaker: l.speaker,
      source: l.speaker === "me" ? "ko" : lang,
      target: l.speaker === "me" ? lang : "ko",
      sourceText: l.src,
      targetText: l.tgt,
      status,
      createdAt: now - (lines.length - i) * 20_000,
      engine: "gpt-realtime-translate",
      hasAudio: l.hasAudio ?? status === "done",
    };
  });
}

/** The partner turn used for the "currently playing" preset. */
export const PLAYING_ID = "demo-6";

export const SAMPLE_MICS: MicDevice[] = [
  { deviceId: "default", label: "기본 - 내장 마이크" },
  { deviceId: "bt-1", label: "Galaxy Buds2 Pro" },
  { deviceId: "usb-1", label: "" },
];
