import type { ReactNode } from "react";
import type { Message, PartnerLang, Speaker } from "../types";

/** Live state of the microphone turn in progress, owned by the controller. */
export interface RecordingState {
  speaker: Speaker;
  /** Milliseconds since the turn started. */
  elapsedMs: number;
  /** Input level 0..1 for the meter. */
  level: number;
}

export interface MicDevice {
  deviceId: string;
  label: string;
}

/** Props shared by OneHandLayout and FacingLayout. */
export interface ConversationLayoutProps {
  /** Rendered at the top of the rep's area (normally <Header/>). */
  header?: ReactNode;
  /** Rendered directly under the header while a session is active (normally <SessionBar/> or null). */
  sessionBar?: ReactNode;
  /** Rendered under the header and session bar (normally <Banner/> or null). */
  banner?: ReactNode;
  messages: Message[];
  partnerLang: PartnerLang;
  /** Null when nobody is recording. */
  recording: RecordingState | null;
  /** Id of the message whose audio is playing, if any. */
  playingId?: string | null;
  /** Tap on a message that has audio. */
  onReplay?(id: string): void;
  /** Push-to-talk button pressed for the given speaker (pointer-down). */
  onPtt(speaker: Speaker): void;
  /** False while no translation session is active: the talk buttons give way to the single start control. */
  sessionActive: boolean;
  /** True once the engine reports "ready"; until then the talk buttons are visibly disabled. */
  engineReady: boolean;
  /** "번역 시작하기" tapped. */
  onStartSession(): void;
}
