import type { ReactNode } from "react";
import type { ConnectionStatus, DualPeer, Lang, Message } from "../types";
import type { RecordingState } from "./props";

/** Master, phases "setup"/"joining": pick my language and start waiting for guests. */
export interface MasterSetupProps {
  initialLang: Lang;
  busy: boolean;
  notice: string | null;
  onStart(lang: Lang): void;
  onBasicMode(): void;
  onOpenSettings(): void;
}

/** Master, phase "waiting": booth PIN and guest URL on screen, pending guest requests with accept/decline. */
export interface MasterWaitingProps {
  myLang: Lang;
  boothPin: string | null;
  /** Absolute URL guests open (the QR target), e.g. https://host/guest. */
  guestUrl: string;
  requests: DualPeer[];
  notice: string | null;
  onAccept(guestId: string): void;
  onDecline(guestId: string): void;
  /** Stop waiting (back to setup). */
  onStop(): void;
  onOpenSettings(): void;
}

/** Guest, phase "setup": language choice + "PIN 코드 XXXX를 입력하세요" + PIN input + request. No settings, no basic mode. */
export interface GuestEntryProps {
  boothPin: string | null;
  masterOnline: boolean;
  /** Languages the guest may pick: every language except the master's. */
  langs: Lang[];
  initialLang: Lang;
  /** True while the request POST is in flight. */
  busy: boolean;
  notice: string | null;
  onRequest(pin: string, lang: Lang): void;
}

/** Guest, phase "requesting": waiting for the master to accept. */
export interface GuestWaitingProps {
  myLang: Lang;
  onCancel(): void;
}

/** Paired conversation, both roles. */
export interface DualLayoutProps {
  myLang: Lang;
  /** Short label for me, e.g. "부스" for the master or "게스트 123" / "Guest 123" for a guest. */
  myLabel: string;
  partner: DualPeer;
  /** Short label for the partner, e.g. "게스트 123" (master's view) or "Booth" (guest's view). */
  partnerLabel: string;
  /** Both sides' utterances; mine have speaker "me", the partner's "partner". */
  messages: Message[];
  /** My recording turn, or null. Only speaker "me" ever records in dual mode. */
  recording: RecordingState | null;
  /** Engine reported "ready": until then the talk key is visibly disabled. */
  engineReady: boolean;
  status: ConnectionStatus;
  /** Rendered under the header (normally <Banner/> or null). */
  banner?: ReactNode;
  /** Talk key tapped: starts my turn, or stops it while recording. */
  onTalk(): void;
  /** End the session (both sides). */
  onEnd(): void;
  /** Settings gear; omitted for guests (no gear rendered). */
  onOpenSettings?(): void;
}
