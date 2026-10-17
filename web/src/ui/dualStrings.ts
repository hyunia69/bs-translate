import type { ConnectionStatus, Lang } from "../types";

/** Marks where the booth PIN goes inside `pinInstruction`; GuestEntry renders the digits emphasized there. */
export const PIN_SLOT = "{pin}";
/** Stands in for the booth PIN while it is still unknown (booth info not fetched yet). */
export const PIN_UNKNOWN = "\u00b7\u00b7\u00b7\u00b7";

/**
 * Copy for the dual-mode screens (docs/dual-protocol.md, master / guest), written in the language the reader chose.
 * The master setup screen has no language yet: it shows the Korean table with the English one as a sub-line.
 * "ended", "declined", "wrong PIN" and other outcomes arrive from the controller as `notice`, already localized;
 * the screens only display them.
 */
export interface DualStrings {
  /** Master setup: title, the one-line instruction, the language group label. */
  masterTitle: string;
  masterSub: string;
  myLang: string;
  /** Master setup: start waiting for guests, its busy state, the way back to the one-phone mode, the gear label. */
  startWaiting: string;
  starting: string;
  basicMode: string;
  settings: string;
  /** Master waiting: header title, booth PIN and guest URL captions, requests heading and its empty state. */
  waitingTitle: string;
  boothPin: string;
  guestUrl: string;
  requests: string;
  noRequests: string;
  /** Master waiting: one request row ("게스트 123"), its two answers, and the stop-waiting control. */
  guestNumber(id: string): string;
  accept: string;
  decline: string;
  stop: string;
  /** Guest entry: title, PIN input label, the instruction with the PIN_SLOT placeholder, booth presence lines. */
  guestTitle: string;
  pinLabel: string;
  pinInstruction: string;
  masterReady: string;
  masterNotReady: string;
  /** Guest entry: request button and its busy state. Guest waiting: title, sub-line, cancel. */
  request: string;
  requesting: string;
  requestSent: string;
  waitingAccept: string;
  cancel: string;
  /** Paired: header words (screen-reader labels), the booth's short label (DualLayout myLabel on the master's phone, partnerLabel on a guest's), and the end-connection control. */
  me: string;
  partner: string;
  booth: string;
  end: string;
  /** Paired: empty conversation; `label` is the partner's short label ("게스트 123", "Booth"). */
  connectedWith(label: string): string;
  speakHint: string;
  /** Paired: the single talk key, idle and recording. */
  talkIdle: string;
  stopHint: string;
  /** Paired: connection dot labels. */
  status: Record<ConnectionStatus, string>;
}

export const DUAL_STRINGS: Record<Lang, DualStrings> = {
  ko: {
    masterTitle: "듀얼 모드",
    masterSub: "부스 폰입니다. 내 언어를 고르고 게스트를 기다리세요.",
    myLang: "내 언어",
    startWaiting: "게스트 기다리기",
    starting: "시작 중\u2026",
    basicMode: "기본 모드로",
    settings: "설정",
    waitingTitle: "게스트 대기 중",
    boothPin: "게스트 PIN",
    guestUrl: "게스트 접속 주소",
    requests: "연결 요청",
    noRequests: "게스트를 기다리는 중\u2026",
    guestNumber: (id) => `게스트 ${id}`,
    accept: "수락",
    decline: "거절",
    stop: "중지",
    guestTitle: "부스 통역",
    pinLabel: "PIN 코드",
    pinInstruction: "PIN 코드 {pin}를 입력하세요",
    masterReady: "부스가 준비됐어요",
    masterNotReady: "부스가 아직 준비되지 않았어요",
    request: "연결 요청",
    requesting: "요청 중\u2026",
    requestSent: "요청을 보냈어요",
    waitingAccept: "부스의 수락을 기다리는 중\u2026",
    cancel: "취소",
    me: "나",
    partner: "상대",
    booth: "부스",
    end: "종료",
    connectedWith: (label) => `${label}에 연결됐어요.`,
    speakHint: "아래 키를 누르고 말하세요.",
    talkIdle: "한국어 시작",
    stopHint: "중지하려면 누르세요",
    status: { idle: "대기", connecting: "연결 중", ready: "연결됨", reconnecting: "재연결 중", offline: "오프라인", error: "오류" },
  },
  en: {
    masterTitle: "Dual mode",
    masterSub: "This is the booth phone. Pick your language and wait for guests.",
    myLang: "My language",
    startWaiting: "Wait for guests",
    starting: "Starting\u2026",
    basicMode: "Basic mode",
    settings: "Settings",
    waitingTitle: "Waiting for guests",
    boothPin: "Guest PIN",
    guestUrl: "Guest URL",
    requests: "Requests",
    noRequests: "Waiting for guests\u2026",
    guestNumber: (id) => `Guest ${id}`,
    accept: "Accept",
    decline: "Decline",
    stop: "Stop",
    guestTitle: "Booth Interpreter",
    pinLabel: "PIN code",
    pinInstruction: "Enter PIN code {pin}",
    masterReady: "The booth is ready",
    masterNotReady: "The booth isn't ready yet",
    request: "Request",
    requesting: "Requesting\u2026",
    requestSent: "Request sent",
    waitingAccept: "Waiting for the booth to accept\u2026",
    cancel: "Cancel",
    me: "Me",
    partner: "Partner",
    booth: "Booth",
    end: "End",
    connectedWith: (label) => `Connected with ${label}.`,
    speakHint: "Tap the key below and speak.",
    talkIdle: "Start English",
    stopHint: "Tap to stop",
    status: { idle: "Idle", connecting: "Connecting", ready: "Connected", reconnecting: "Reconnecting", offline: "Offline", error: "Error" },
  },
  ja: {
    masterTitle: "デュアルモード",
    masterSub: "ブース側のスマホです。言語を選んでゲストを待ちましょう。",
    myLang: "自分の言語",
    startWaiting: "ゲストを待つ",
    starting: "開始中\u2026",
    basicMode: "基本モードへ",
    settings: "設定",
    waitingTitle: "ゲスト待機中",
    boothPin: "ゲストPIN",
    guestUrl: "ゲスト用URL",
    requests: "接続リクエスト",
    noRequests: "ゲストを待っています\u2026",
    guestNumber: (id) => `ゲスト ${id}`,
    accept: "承諾",
    decline: "辞退",
    stop: "停止",
    guestTitle: "ブース通訳",
    pinLabel: "PINコード",
    pinInstruction: "PINコード {pin} を入力してください",
    masterReady: "ブースの準備ができています",
    masterNotReady: "ブースはまだ準備中です",
    request: "接続をリクエスト",
    requesting: "リクエスト中\u2026",
    requestSent: "リクエストを送信しました",
    waitingAccept: "ブースの承諾を待っています\u2026",
    cancel: "キャンセル",
    me: "自分",
    partner: "相手",
    booth: "ブース",
    end: "終了",
    connectedWith: (label) => `${label}と接続しました。`,
    speakHint: "下のキーをタップして話してください。",
    talkIdle: "日本語で開始",
    stopHint: "停止するにはタップ",
    status: { idle: "待機", connecting: "接続中", ready: "接続済み", reconnecting: "再接続中", offline: "オフライン", error: "エラー" },
  },
  zh: {
    masterTitle: "双机模式",
    masterSub: "这是展位手机。选择你的语言，然后等待访客。",
    myLang: "我的语言",
    startWaiting: "等待访客",
    starting: "正在开始\u2026",
    basicMode: "基本模式",
    settings: "设置",
    waitingTitle: "等待访客中",
    boothPin: "访客 PIN",
    guestUrl: "访客链接",
    requests: "连接请求",
    noRequests: "正在等待访客\u2026",
    guestNumber: (id) => `访客 ${id}`,
    accept: "接受",
    decline: "拒绝",
    stop: "停止",
    guestTitle: "展位翻译",
    pinLabel: "PIN 码",
    pinInstruction: "请输入 PIN 码 {pin}",
    masterReady: "展位已准备好",
    masterNotReady: "展位尚未准备好",
    request: "请求连接",
    requesting: "正在请求\u2026",
    requestSent: "已发送请求",
    waitingAccept: "正在等待展位接受\u2026",
    cancel: "取消",
    me: "我",
    partner: "对方",
    booth: "展位",
    end: "结束",
    connectedWith: (label) => `已与 ${label} 连接。`,
    speakHint: "点击下方按键后说话。",
    talkIdle: "开始说中文",
    stopHint: "点击停止",
    status: { idle: "待机", connecting: "连接中", ready: "已连接", reconnecting: "重新连接中", offline: "离线", error: "错误" },
  },
};

export function dualStringsFor(lang: Lang): DualStrings {
  return DUAL_STRINGS[lang];
}

/** Splits a `pinInstruction` template into the text before and after the PIN slot. */
export function splitPinInstruction(template: string): [before: string, after: string] {
  const at = template.indexOf(PIN_SLOT);
  if (at < 0) return [template, ""];
  return [template.slice(0, at), template.slice(at + PIN_SLOT.length)];
}

/** Languages the master can pick, in the order of the setup screen. Guests get their list from the controller. */
export const DUAL_LANGS: readonly Lang[] = ["ko", "en", "ja", "zh"];
