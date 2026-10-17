# OpenAI API 조사 노트

조사일: 2026-10-16. 출처는 모두 developers.openai.com 공식 문서(.md 버전)이다.
문서에 없는 항목은 `UNCONFIRMED` 로 표시했고, 코드에서는 TODO 주석으로 남긴다.

주요 출처
- 번역 가이드: https://developers.openai.com/api/docs/guides/realtime-translation.md
- 번역 클라이언트 이벤트: https://developers.openai.com/api/reference/resources/realtime/translation-client-events.md
- 번역 서버 이벤트: https://developers.openai.com/api/reference/resources/realtime/translation-server-events.md
- Realtime 레퍼런스(번역 client secret 포함): https://developers.openai.com/api/reference/resources/realtime.md
- 실시간 전사 가이드: https://developers.openai.com/api/docs/guides/realtime-transcription.md
- VAD 가이드: https://developers.openai.com/api/docs/guides/realtime-vad.md
- Client secret 생성(일반 Realtime/전사): https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create.md
- WebRTC 가이드: https://developers.openai.com/api/docs/guides/voice-webrtc.md
- WebSocket 가이드: https://developers.openai.com/api/docs/guides/voice-websockets.md
- 모델 페이지: https://developers.openai.com/api/docs/models/gpt-realtime-translate.md, `.../gpt-live-transcribe.md`, `.../gpt-realtime-whisper.md`

---

## 1. gpt-realtime-translate

### 1.1 연결 방식과 URL
| 방식 | URL | 인증 |
| --- | --- | --- |
| WebRTC (브라우저 권장) | `POST https://api.openai.com/v1/realtime/translations/calls` (body = SDP offer, `Content-Type: application/sdp`) → 응답 body 가 SDP answer | `Authorization: Bearer <client secret>` |
| WebSocket (서버 미디어용) | `wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate` | `Authorization: Bearer <API key>` 헤더 |

- 가이드 원문: "Use WebRTC when the browser captures or plays audio ... Use WebSockets when your server already receives raw audio".
- WebRTC: 소스 오디오는 media track 으로 보내고, 번역 음성은 remote audio track 으로 받는다. JSON 이벤트는 data channel `oai-events` 로 받는다 (가이드 예제).
- WebSocket: 입력은 base64 24 kHz PCM16 mono little-endian. 200 ms 프레임 단위로 소비한다.
- 브라우저에서 WebSocket + ephemeral key 를 subprotocol(`openai-insecure-api-key.<key>`)로 쓰는 방법은 `/v1/realtime` 에 대해서만 문서화되어 있다. 번역 엔드포인트에서 이 방식이 되는지는 **UNCONFIRMED**.

### 1.2 브라우저용 ephemeral token
- **지원됨.** `POST https://api.openai.com/v1/realtime/translations/client_secrets` (서버에서 API 키로 호출)
- 요청 body:
  ```json
  {
    "expires_after": { "anchor": "created_at", "seconds": 600 },
    "session": {
      "model": "gpt-realtime-translate",
      "audio": {
        "input": { "transcription": { "model": "gpt-realtime-whisper" }, "noise_reduction": { "type": "near_field" } },
        "output": { "language": "en" }
      }
    }
  }
  ```
- 응답: `{ "value": "ek_...", "expires_at": <epoch s>, "session": { "id", "type": "translation", "model", "expires_at", "audio": {...} } }`
- `expires_after.seconds`: 10~7200, 기본 600. "A secret can be used to create multiple sessions until it expires." "The session itself may continue after that time once started."
- 가이드 예제는 `OpenAI-Safety-Identifier` 헤더(해시된 사용자 ID)를 함께 보낸다. 우리는 기기별 해시를 넣는다.

### 1.3 세션 설정 필드
- `session.model` — 생성 시에만 지정, `session.update` 로 변경 불가.
- `session.audio.output.language` — 출력 언어(번역 음성과 번역 자막). 문서 예제 값: `"es"`, `"fr"`. 우리는 `ko`/`en`/`ja`/`zh` 를 쓴다.
  - 출력 언어 코드 목록 자체는 문서에 표로 나와 있지 않다. ISO 639-1 `zh` 가 간체를 의미하는지는 **UNCONFIRMED** (전사 모델 쪽은 `zh-cn` 같은 지역 코드를 받는다고 명시).
- `session.audio.input.transcription` — `{ "model": string }` 또는 `null`. 설정하면 `session.input_transcript.delta` 가 나온다. 번역 세션 스키마에는 `model` 외 필드(`keywords`, `prompt`, `languages`)가 **없다**.
- `session.audio.input.noise_reduction` — `{ "type": "near_field" | "far_field" }` 또는 `null`.
- 오디오 포맷 필드: 번역 세션 스키마에는 입력/출력 format 필드가 없다. WebSocket 은 24 kHz PCM16 고정, 출력 delta 에 `sample_rate`/`channels`/`format: "pcm16"` 이 실려 온다. WebRTC 는 Opus media track.
- `session.update` 로 바꿀 수 있는 것: `audio.output.language`, `audio.input.transcription`, `audio.input.noise_reduction`.

### 1.4 송신 종료 후 남은 번역 받기
- 번역 세션에는 commit 이나 `response.create` 가 없다. "Translation starts from the audio stream itself."
- 문서화된 flush 방법은 **`session.close` 하나뿐**: "The server flushes pending input audio and emits any remaining translated output before closing the session." 이후 `session.closed` 가 온다. 즉 flush 하면 그 세션은 끝난다.
- 오디오를 멈췄다가 다시 보내면: "model time treats the resumed audio as contiguous with the previous audio rather than as a real-world pause." 문서는 "Keep appending silence while the session is active" 를 권장한다.
- `session.close` 는 "Close a WebSocket session" 절에서 설명된다. WebRTC data channel 로 보내도 동작하는지는 **UNCONFIRMED** (클라이언트 이벤트 레퍼런스는 "Realtime Translation WebSocket server" 기준으로 쓰여 있음).

### 1.5 수신 이벤트
| 용도 | 이벤트 | 주요 필드 |
| --- | --- | --- |
| 세션 생성 | `session.created` | `session.id`, `session.expires_at` |
| 설정 반영 | `session.updated` | `session` |
| 원문 자막 delta | `session.input_transcript.delta` | `delta`, `elapsed_ms` (transcription 설정 시에만) |
| 번역 자막 delta | `session.output_transcript.delta` | `delta`, `elapsed_ms` |
| 번역 음성 delta (WebSocket) | `session.output_audio.delta` | `delta`(base64 PCM16), `sample_rate`, `channels`, `format` |
| 종료(완료) | `session.closed` | — |
| 에러 | `error` | `error.type`, `error.code`, `error.message`, `error.param`, `error.event_id` |

- delta 는 append-only. "Clients should not insert unconditional spaces between deltas."
- 모든 클라이언트 이벤트(`session.update`, `session.input_audio_buffer.append`, `session.close`)에 선택 필드 `event_id`(클라이언트가 만든 ID)가 있고, `error.event_id` 는 "The event_id of the client event that caused the error" 이다.
- `session.created.session.expires_at` 는 "Expiration timestamp for the session, in seconds since epoch".
- 턴 단위 "완료" 이벤트는 없다. 완료 = `session.closed`.
- WebRTC 에서 `session.output_audio.delta` 가 data channel 로도 오는지는 **UNCONFIRMED** (가이드: 번역 음성은 remote audio track 으로 온다).
- 대부분의 `error` 는 복구 가능하고 세션이 유지된다.

### 1.6 instructions / 용어집 / keyword hints
- 번역 세션 스키마(`RealtimeTranslationSessionCreateRequest`)에는 `instructions`, `prompt`, `keywords` 같은 필드가 **없다**.
- 즉 **번역 엔진에는 용어집을 넣을 공식 방법이 없다.** (요구사항 10에 따라 우회 구현하지 않고 대안만 제안한다. 아래 4절.)
- 가이드의 권장: "If your use case depends on exact names or domain terms, build a golden set before launch and review failures manually."

### 1.7 기타
- 가격: 오디오 시간 기준 $0.034/분. 유휴 연결 시간이 과금되는지는 **UNCONFIRMED**.
- 출력 언어당 세션 1개. 대화형 통역은 "one translation session per direction".
- 세션 최대 수명: `session.expires_at` 로 내려온다(값은 문서에 없음, 수신값을 따른다).

---

## 2. 원문 자막: gpt-realtime-whisper vs gpt-live-transcribe

| 항목 | gpt-realtime-whisper | gpt-live-transcribe |
| --- | --- | --- |
| 번역 세션 안의 `audio.input.transcription.model` 로 사용 | **문서 예제로 확인됨** | **UNCONFIRMED** (번역 세션 문서·예제 어디에도 없음) |
| 별도 전사 세션(`type: "transcription"`) | 지원 | 지원 (가이드의 권장 모델) |
| keyword hints | 번역 세션 안에서는 필드 없음. 일반 Realtime 세션에서도 `keywords` 는 "Supported by `gpt-transcribe` and `gpt-live-transcribe`" 로 whisper 미지원 | **지원**: `keywords`(배열), `prompt`, `languages`, `delay` |
| prompt | "Prompt is not supported with `gpt-realtime-whisper` in GA Realtime sessions" | 지원 |
| VAD | 사용 불가 (`turn_detection: null`) | 사용 불가 (`turn_detection: null`), 턴 끝에 `input_audio_buffer.commit` |
| 이벤트 | 번역 세션 안: `session.input_transcript.delta` | 전사 세션: `conversation.item.input_audio_transcription.delta` / `.completed` |
| 가격 | $0.017/분 | $0.017/분 |

전사 세션 설정(문서 예제 그대로):
```json
{
  "type": "session.update",
  "session": {
    "type": "transcription",
    "audio": {
      "input": {
        "format": { "type": "audio/pcm", "rate": 24000 },
        "transcription": {
          "model": "gpt-live-transcribe",
          "prompt": "...",
          "keywords": ["..."],
          "languages": ["ko"],
          "delay": "low"
        },
        "turn_detection": null
      }
    }
  }
}
```
- keywords 제약: 한 줄, `<` `>` CR LF 금지. 어기면 session update 거부.
- 전사 세션은 `POST /v1/realtime/client_secrets` (session 에 `RealtimeTranscriptionSessionCreateRequest`) 로 ephemeral key 를 받고 WebRTC 로 연결할 수 있다고 가이드에 적혀 있다 ("Connect with WebSocket ... or WebRTC for browser audio"). WebRTC 전사 세션의 SDP 교환 URL 은 일반 Realtime 과 같은 `/v1/realtime/calls` 로 보이나 전사 세션 예제는 없음 → **부분 확인**.

**결론:** gpt-live-transcribe 는 keyword hints 를 지원하지만, 번역 세션 안에서 병행(같은 세션의 transcription 모델)하는 것은 문서로 확인되지 않는다. 병행하려면 같은 마이크 오디오를 두 번째 세션(전사 세션)으로 동시에 보내야 한다. → 질문 Q2.

---

## 3. 아키텍처 결정: 1안 (브라우저 ↔ OpenAI 직접 WebRTC)

근거
1. 번역 엔드포인트 전용 ephemeral token(`/v1/realtime/translations/client_secrets`) 이 공식 지원된다 → 요구사항 5 의 1안 조건 충족.
2. 공식 가이드가 브라우저 캡처/재생에 WebRTC 를 권장한다.
3. API 키는 서버의 `/api/session` 에서만 쓰고 브라우저는 `ek_...` 만 받는다.

1안에서의 세부 설계
- **송신 제어:** 피어 연결은 미리 만들되 오디오 sender 에는 트랙을 붙이지 않는다(`replaceTrack(null)`). 녹음 시작 시 마이크 트랙을 붙이고, 중지 시 다시 뗀다. 버튼 밖 구간에는 RTP 가 나가지 않으며 `getStats()` 의 `bytesSent` 를 턴마다 로그로 남겨 검증한다.
- **재생 제어(에코 방지):** remote track 은 음소거된 `<audio>` 에 붙이고(크롬에서 Web Audio 로 받으려면 필요), Web Audio 로 PCM 을 캡처해 버퍼에 쌓는다. 녹음 중에는 절대 스피커로 내보내지 않고, 턴 종료 후 버퍼를 재생한다.
- **턴 종료(flush):** 질문 Q1 의 결정에 따른다.
- **warm-up / 재연결:** 언어 방향별(예: ko→en, en→ko)로 연결된 세션을 미리 준비해 둔다. `connectionstatechange` 가 `failed`/`disconnected` 이거나 `expires_at` 이 가까우면 새로 연결한다.

2안(서버 WebSocket relay)은 1.4 의 `session.close` 가 WebRTC data channel 에서 거부되는 경우의 대비책으로 남긴다.

---

## 4. 용어집 연결 현황

| 대상 | 지원 방식 | 처리 |
| --- | --- | --- |
| 번역 (gpt-realtime-translate) | 없음 | 질문 Q3 (대안 제안, 승인 전 미구현) |
| 원문 자막 gpt-live-transcribe (별도 전사 세션) | `keywords`, `prompt` | Q2 승인 시 `glossary.json` 의 원문 언어 용어를 `keywords` 로 연결 |
| 원문 자막 gpt-realtime-whisper (번역 세션 내) | 없음 | — |
| GPT-Live-1 (실험 엔진) | `instructions` (5.4, 5.5절) | instructions 에 용어집 연결 (구현됨) |

---

## 5. GPT-Live-1 (`gpt-live-1`, `/v1/live/sessions`)

조사일: 2026-10-16. 출처는 developers.openai.com 공식 문서만 사용. 문서에 없는 내용은 `UNCONFIRMED:` 로 표시하며 추측하지 않는다.
`/v1/live/sessions` 단독 REST 레퍼런스 페이지(생성 엔드포인트)는 reference `llms.txt` 에서 찾지 못했고, Live 관련 레퍼런스는 WebSocket 이벤트 페이지(primary / sideband / fork)뿐이다.

약칭(URL):
- [LIVE] https://developers.openai.com/api/docs/guides/live
- [CONV] https://developers.openai.com/api/docs/guides/live-conversations
- [PROMPT] https://developers.openai.com/api/docs/guides/live-prompting
- [DELEG] https://developers.openai.com/api/docs/guides/live-delegation
- [MIG] https://developers.openai.com/api/docs/guides/live-migration
- [RTC] https://developers.openai.com/api/docs/guides/voice-webrtc?api=live
- [WS] https://developers.openai.com/api/docs/guides/voice-websockets?api=live
- [SRV] https://developers.openai.com/api/docs/guides/voice-server-controls?api=live
- [MODEL] https://developers.openai.com/api/docs/models/gpt-live-1
- [REF-PRIMARY] https://developers.openai.com/api/reference/resources/live/primary-websocket
- [REF-CS] https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets

---

### 5.1 연결 방식과 브라우저 인증

**방식.** WebRTC 권장, WebSocket 지원 ([LIVE], [RTC]).
- WebRTC: 브라우저가 SDP offer를 만들고, **우리 서버가** 프로젝트 API 키로 `POST /v1/live/sessions` 에 교환해 answer를 받는다 ([RTC]). 요청 JSON은 `session` 과 `transport: { type: "webrtc", sdp: ... }` ([RTC]). 응답에서 `result.session.id` 와 `result.transport.sdp`(answer)를 읽고, `transport.sdp` 를 `setRemoteDescription` 에 적용한다 ([RTC]). 마이크/음성은 미디어 트랙, JSON 이벤트는 데이터 채널(예제 라벨 `oai-events`)로 흐른다 ([RTC]). 데이터 채널에서 `session.start` 를 보내면 안 된다 ([RTC]). `session.started` 를 기다린 뒤 명령을 보낸다 ([RTC]). WebRTC에서는 `audio.format` 을 생략한다 ([CONV], [RTC]).
- WebSocket: `wss://api.openai.com/v1/live/sessions` (쿼리 파라미터 없음), `Authorization: Bearer $OPENAI_API_KEY` 헤더, 첫 메시지로 `session.start`(안에 `session` 객체), 이후 `session.started` 를 기다린 뒤 오디오 전송 ([WS], [REF-PRIMARY]). 키는 신뢰 서버에만 둔다 ([REF-PRIMARY]).
- 사이드밴드: `wss://api.openai.com/v1/live/sessions/{session_id}/attach` ([SRV]).

**브라우저 인증.** 문서화된 패턴은 "브라우저는 키를 갖지 않고 SDP offer만 우리 서버(`/api/session`)로 보내고, 서버가 API 키로 생성 요청" 이다 ([RTC] 서버 예제). 이 흐름에서 브라우저에 줄 단기 토큰은 필요 없다.
- `UNCONFIRMED:` Live 전용 ephemeral token / client secret 엔드포인트. 문서의 `POST /v1/realtime/client_secrets` 는 Realtime 세션(`type: "realtime"`)/전사 세션용으로 기술되어 있고, 요청 본문 `expires_after`(`anchor`, `seconds`: 10~7200초, 기본 600초)와 `ek_` 로 시작하는 값이 설명되지만 `gpt-live-1`/Live 세션에 쓸 수 있다는 서술은 없다 ([REF-CS]).
- `UNCONFIRMED:` 브라우저가 WebSocket으로 직접 Live에 붙는 방법(토큰 방식). WebSocket 가이드는 서버 연결만 다룬다 ([WS]).
- 세션 수명: `session.started` 의 `session.expires_at`(Unix 초) 이 세션 만료 시각이다 ([REF-PRIMARY]). `UNCONFIRMED:` 최대 세션 시간(분) 값.
- 비용 주의: WebRTC 세션 생성은 초기화 중 15초 분량을 청구하고 실행 시작 후 상계된다 ([RTC]).
- 브라우저 쪽 권한 축소: `client.data_channel.allowed_client_events` / `allowed_server_events` (`"all"` 또는 배열, 시작 시에만) ([REF-PRIMARY]).

### 5.2 백엔드 모델 연결 필수 여부 / 최소 설정

- 필수 아님. `delegation` 을 생략하거나 `null` 이면 client 모드가 선택된다 ([CONV]). 모드는 `delegation.type` 의 `client` 또는 `responses` ([CONV]).
- 필수 필드는 `model` ([CONV]). 나머지 기본값: `input` 은 `[]`, `audio.output.voice` 는 `marin`, `store` 는 `false` ([CONV]).
- 공식 WebSocket 예시 최소형(client 위임): `session.start` 안에 `model: "gpt-live-1"`, `instructions`, `audio.format`(`audio/pcm`, 24000), `audio.output.voice`, `delegation: { type: "client" }` ([REF-PRIMARY]).
- 번역 전용 프롬프트는 `NEVER DELEGATE, CHECK, ANSWER, SEARCH, OR USE TOOLS.` 로 시작해 위임을 금지한다 ([PROMPT] "Translation").
- 모델 페이지: GPT-Live 는 "delegate reasoning and tool use to a backend agent" 가 가능하다고 설명하지만 필수라고 하지는 않는다 ([MODEL]).
- `UNCONFIRMED:` client 위임 모드에서 모델이 그래도 위임 이벤트를 내보낼 때 애플리케이션이 무시해도 되는지(무응답 시 동작).
- `UNCONFIRMED:` `model` 만 담은 `session` 이 실제로 수락되는지(예제는 모두 추가 필드를 포함).

### 5.3 버튼 기반 명시적 턴 경계

- 문서상 GPT-Live 는 오디오를 **연속 스트리밍**하고 "GPT-Live decides when to speak" 이며, Realtime 의 수동 오디오 commit / 응답 트리거는 제거 대상이라고 명시한다 ([MIG]: "Stream audio continuously. GPT-Live decides when to speak; remove manual audio commits and voice-turn triggers."). WebSocket 가이드도 "GPT-Live manages when to listen and speak as audio streams continuously" ([WS]).
- `response.create` 는 **위임된 백엔드 작업**을 시작/재개하는 명령이지 음성 턴 트리거가 아니다 ([WS], [DELEG]; Responses 위임 필요).
- 자동 턴 감지를 끄는 설정: `UNCONFIRMED:` (`turn_detection` 류 필드는 Live 문서·레퍼런스에서 찾지 못함).
- "사용자 턴 종료"를 표시하는 클라이언트 이벤트: `UNCONFIRMED:` (문서에 commit/end-of-turn 이벤트 없음).
- 마이크 제어: `session.input_audio.mute` → `session.input_audio.muted`, `session.input_audio.unmute` → `session.input_audio.unmuted` (`client_event_id` 로 매칭). mute 는 모델에 무음을 보내며 세션/생성 중인 음성/위임 작업은 계속된다 ([CONV], [REF-PRIMARY]). 로컬 녹음·재생 중단은 앱이 별도로 해야 한다 ([CONV]).
- 푸시투토크: [CONV] 는 재시작 트리거 예시로 "push-to-talk control" 을 언급하지만, 이는 세션을 닫았다 다시 여는 맥락이다. 탭 구간 밖에서 mute 만 하거나 트랙을 멈췄을 때 모델이 턴을 종결하고 번역을 내는지는 `UNCONFIRMED:`.
- 번역 프롬프트가 "Translate phrases as they arrive." 라고 하므로 연속 번역 쪽이 기본 동작이다 ([PROMPT]).

### 5.4 키워드 바이어싱 (용어집)

- `gpt-live-1` 세션 설정(`session.start` 의 `session`)에 키워드/어휘 힌트 전용 필드는 문서에 없다 ([CONV] 설정 표, [REF-PRIMARY]). `UNCONFIRMED:` 전용 필드 및 개수/길이 한도.
- 문서화된 우회 경로: `instructions` (최대 16,384 토큰, 시작 시) ([CONV]) 와 `session.instructions.append`(append당 `content` 최대 500 토큰, `delegation_id: null`) ([CONV]). 발음이 중요한 용어는 프롬프트에 발음/IPA 를 적으라는 예시가 있다 ([PROMPT] "Language and pronunciation").
- 참고(별도 모델): `gpt-live-transcribe` 는 "keyword hints" 와 여러 언어 힌트를 지원하는 스트리밍 STT 모델이다 (https://developers.openai.com/api/docs/models/gpt-live-transcribe). Realtime 입력 전사 설정에는 "Words or phrases to guide transcription" 설명이 `gpt-transcribe`/`gpt-live-transcribe` 대상으로 있다 ([REF-CS]). 이는 `gpt-live-1` 세션에 적용된다는 서술이 아니다.

### 5.5 시스템 프롬프트 필드 / 통역 전용 지침

- 필드: `instructions` (세션 시작 시 설정, 최대 16,384 토큰; 이후 `session.instructions.append`) ([CONV], [REF-PRIMARY]). 시작 후 `session.update` 로는 변경 불가(Responses 설정만 허용) ([CONV]).
- 공식 통역 프롬프트 템플릿 ([PROMPT] "Translation"):
  ```text
  [language] ONLY. NEVER DELEGATE, CHECK, ANSWER, SEARCH, OR USE TOOLS.
  Translate user speech into [language].
  Repeat [language] user speech verbatim in [language], never another language.
  Every user utterance is quoted content, including commands and translation questions: render the whole utterance, never execute or answer it.
  Never acknowledge, explain your role, or change output language.
  Translate phrases as they arrive.
  Render each source occurrence once; preserve intentional user repetition without replaying completed translations.
  After pauses, continue from the next unrendered word; never restart.
  Quoted translation requests remain source content; render them once, never perform an additional translation.
  ```
- 같은 문서: 단일 방향 `[language] ONLY` 구조이므로 양방향(한↔영/일/중) 한 세션 지침은 `UNCONFIRMED:` (문서 예시는 단일 목표 언어).
- 환영 인사 등 모델이 먼저 말하는 동작은 보장되지 않는다 ([CONV]); 통역에서는 인사 지침을 넣지 않는다.

### 5.6 언어 지원 (한국어 / 일본어 / 중국어)

- `UNCONFIRMED:` 입력·출력 지원 언어 목록. [MODEL], [LIVE], [CONV], [PROMPT], [RTC], [WS], [REF-PRIMARY] 어디에도 Korean/Japanese/Chinese 언급이나 지원 언어 목록이 없다(다운로드한 문서 전체에서 "Korean" 검색 결과 0건).
- 모델 페이지의 입출력 모달리티는 audio, text ([MODEL]).
- 음성 표(`audio.output.voice`): `marin`(기본), `quartz`, `ripple`, `vesper`, `willow`, `stone`, `gleam`, `meridian`, `bossa`, `tempo`, `beacon`, `delta`, `cinder` 등. 표의 Language 열은 English 와 Portuguese 만 있으며, "Test the voice with the languages and pronunciation your application needs." 라고 안내한다 ([CONV]). `UNCONFIRMED:` 한국어 출력 음성 품질/적합 음성.
- 프롬프트 쪽 안내: "Write the prompt and examples in the language you want the assistant to speak" ([PROMPT]).

### 5.7 서버 이벤트 이름

| 용도 | 이벤트 / 방식 | 출처 |
| --- | --- | --- |
| 시작 | `session.started` (`session.id`, `session.expires_at`) | [REF-PRIMARY] |
| 출력 전사 델타 | `session.output_transcript.delta` (`delta`, `start_ms`, `end_ms`) | [CONV] |
| 입력 전사 델타 | `session.input_transcript.delta` (`delta`, `start_ms`, `end_ms`) | [CONV] |
| 출력 오디오 (WebSocket) | `session.output_audio.delta` (base64 `delta`, 타이밍 필드 없음, 출력 오디오 종료 이벤트 없음) | [WS], [CONV] |
| 출력 오디오 (WebRTC) | 이벤트 아닌 미디어 트랙 | [CONV], [RTC] |
| 입력 오디오 전송 (WS) | 클라이언트 `session.input_audio.append` (`audio`, 응답 없음) | [WS] |
| 응답/턴 완료 | 없음: 전사 델타에는 item ID나 완료된 턴 표시 이벤트가 없다. 전사 "done" 이벤트도 없다 | [CONV], [REF-PRIMARY] |
| 백엔드(Responses) 이벤트 | `response.event` 래퍼 안에 중첩 `event` | [WS], [DELEG] |
| 오류 | `error` (`error.type`, `error.code`, `error.message`, `error.client_event_id`) | [CONV], [REF-PRIMARY] |
| 갱신 확인 | `session.updated`, `session.input_audio.muted`, `session.input_audio.unmuted`, `session.instructions.appended`, `session.thinking.appended`, `session.commentary.appended` | [CONV], [REF-PRIMARY] |
| 사용량 | `session.usage.updated` (`usage.seconds`, `context_window.usage_ratio`) | [CONV] |
| 세션 종료 | `session.closed` (`reason`, `usage`, 세션 스냅샷) | [CONV], [REF-PRIMARY] |

- `UNCONFIRMED:` 응답 단위의 "turn done"/"response.done" 에 해당하는 Live 이벤트. 문서는 애플리케이션이 델타를 직접 묶으라고 한다 ([CONV]).
- 모더레이션: 일부는 세션을 종료하고(`session.closed` 의 `reason: content`), 일부는 어시스턴트 오디오를 끊고 `error` 만 내보낸다 ([CONV]).

### 5.8 정상 종료 / 드레인

[CONV] "Usage and graceful close":
1. 필요한 위임 작업을 마친다.
2. `session.close` 보내기 **전에** `session.closed` 리스너를 설치한다.
3. `session.close` 전송 후 새 작업 제출을 멈추고, 보류 이벤트가 드레인되는 동안 WebSocket/WebRTC 연결·데이터 채널·사이드밴드를 유지한다.
4. `session.closed` 에서 최종 `usage.seconds`, `reason`, 세션 스냅샷을 읽는다.
5. 그 이벤트 뒤에 전송 계층/오디오 장치를 정리한다. 실패하거나 앱이 정한 타임아웃을 넘으면 "종료 미확인"으로 처리하고 자원을 해제한다 (WebSocket 예제는 15초 대기 [WS]).

- `reason` 값: `close_requested`, `expired`, `content`, `remote_hangup`, `connection_lost` ([CONV], [REF-PRIMARY]).
- `session.close` 는 대기 중인 Responses 작업을 취소하고 이후 명령을 거부한다. 진행 중 응답은 끝낼 수 있다 ([CONV]).
- 소켓이 `session.closed` 이전에 끊기면 최종 사용량은 미확인이다 ([CONV]).
- `session.usage.updated` 는 누적 스냅샷이므로 합산하지 않는다 ([WS], [CONV]).
- `UNCONFIRMED:` WebRTC 에서 `session.close` 를 데이터 채널로 보내는 구체 방식(문서는 "session commands" 를 데이터 채널로 보낸다고만 서술 [RTC]). 사이드밴드 hangup 엔드포인트가 있다는 언급은 있으나([CONV] `close_requested` 설명의 "hangup endpoint") URL은 `UNCONFIRMED:`.

---

### 5.9 구현 시사점

1. **브라우저 키 보호**: Live 는 서버가 SDP offer 를 받아 `POST /v1/live/sessions` 를 대신 호출하는 구조로 문서화되어 있다. Live 용 단기 토큰은 `UNCONFIRMED:` 이므로 `/api/session` 형태의 서버 중계를 전제로 설계한다.
2. **푸시투토크 적합성 불확실**: Live 는 연속 스트리밍 + 모델 주도 발화 설계이고 수동 commit 이 없다. 탭 구간만 전송해도 번역이 끝까지 나오는지, `session.input_audio.mute` 로 종료를 유도할 수 있는지는 문서로 확인되지 않으므로 실험 엔진 가정으로 프로토타입에서 직접 검증해야 한다.
3. **위임 비활성**: 최소 설정은 `delegation: { type: "client" }`(또는 생략) + 번역 전용 `instructions`. 공식 번역 프롬프트(`NEVER DELEGATE ...`)를 기반으로 한다. 양방향 구성은 우리가 시험해야 한다.
4. **용어집**: 전용 필드가 없으므로 `instructions` 에 용어/발음을 넣는다(16,384 토큰 한도). 세션 중 추가는 `session.instructions.append`(500 토큰/회).
5. **언어 지원 미확인**: 한국어/일본어/중국어 공식 지원 표기가 없다. 실험 엔진 UI 에 "미검증" 표시를 하고 언어쌍별 품질 점검 후 활성화한다.
6. **턴 완료 신호 없음**: 응답 완료 이벤트가 없으므로 UI 상태(말하는 중/완료)는 `session.output_transcript.delta` 도착과 로컬 오디오 큐 상태로 추정해야 한다. WebSocket 오디오는 `session.output_audio.delta`, WebRTC 는 미디어 트랙이다.
7. **종료 절차**: 앱 종료/언어 전환 시 `session.close` → `session.closed` 대기(타임아웃 설정) → 정리. 최종 사용량은 `session.closed` 값을 사용한다.
8. **비용/수명**: 분당 $0.05(초 단위 과금) + WebRTC 생성 시 초기 15초 청구([MODEL], [RTC]). 탭마다 세션을 새로 만드는 설계는 초기화 비용을 키우므로, 세션 유지 + mute 설계와 비교해야 한다. 동시 세션 한도는 Build 50 / Launch 300 / Grow 500 ([MODEL]).

### 5.10 구현 결정

구현 파일: 서버 `server/src/routes/live.ts`, `server/src/glossary.ts`, `server/src/openai.ts`(`buildLiveSessionBody`, `requestLiveSession`). 웹 `web/src/engine/liveSession.ts`, `web/src/engine/gptLive.ts`. 줄 번호는 내려받은 문서 사본 기준이다.

1. **서버 SDP 중계.** Live 용 브라우저 토큰이 없으므로(5.1) 브라우저는 `POST /api/live/session` `{pin, source, target, sdp}` 만 보내고, 서버가 API 키로 `POST /v1/live/sessions` 를 호출해 `{sdp, sessionId}` 를 돌려준다. 브라우저는 `api.openai.com` 에 HTTP 요청을 보내지 않는다. 근거: [RTC] voice-webrtc.md:13 "exchanges it for an answer with `POST /v1/live/sessions`, using the project API key".
2. **요청 본문.** `{ session: { model: "gpt-live-1", instructions }, transport: { type: "webrtc", sdp } }` 만 보낸다. 그 밖의 session 필드는 보내지 않는다. 근거: voice-webrtc.md:30 (`session` + `transport`), :79 (`model: "gpt-live-1"`), :80 (`instructions`), :93 (`transport`, `type: "webrtc"`). 응답은 `result.session.id`, `result.transport.sdp` 를 읽는다(voice-webrtc.md:368). SDP 본문 한도 64 KB 는 공식 예제의 `express.json({ limit: "64kb" })` 를 따랐다(voice-webrtc.md:55).
3. **위임 없음.** `delegation` 을 생략해 client 모드로 둔다. 근거: live-conversations.md:25 "Omitted or `null` delegation selects client mode."
4. **지침과 용어집.** `instructions` 는 [PROMPT] "Translation" 템플릿(live-prompting.md:136-146)을 그대로 쓰고 `[language]` 만 방향의 목표 언어로 바꾼다. 그 뒤에 `Glossary: always render these source terms exactly as given.` 과 `<원문 용어> => <번역 용어>` 줄을 붙인다. 빈 항목은 건너뛰고 200줄에서 멈춘다. `glossary.json` 은 서버 시작 시 한 번 읽는다. 템플릿이 단일 목표 언어이므로(5.5) 방향마다 세션을 따로 만든다. `session.instructions.append` 는 쓰지 않는다.
5. **방향별 세션 1개, 턴 간 재사용.** 연결 시 데이터 채널 `oai-events` 를 offer 전에 만든다. `session.started` 를 받으면 바로 `session.input_audio.mute` 를 보내고 sender 에는 트랙을 붙이지 않은 채 대기한다. 턴 시작은 `replaceTrack(mic)` + `session.input_audio.unmute`, 중지는 `replaceTrack(null)` + `session.input_audio.mute` 다. 편집 확인 이벤트(`session.input_audio.muted` / `unmuted`)는 기다리지 않는다. 근거: 5.3 (mute/unmute, [CONV], [REF-PRIMARY]). 턴마다 새 세션을 만들면 WebRTC 초기화 15초 청구가 반복되므로(5.9 8번) 유지 + mute 를 골랐다.
6. **턴 종료는 출력 정적 시간.** Live 에는 턴/응답 완료 이벤트가 없다(5.7). 중지 후 `session.output_transcript.delta` 도 원격 오디오(레벨 0.004 초과)도 1500 ms 동안 없고 중지 후 출력이 한 번이라도 왔으면 `completed`, 중지 후 출력이 없으면 2500 ms 뒤 `completed`, 12초를 넘기면 `timeout`. 이후 세션은 대기 상태로 돌아간다. 턴 밖에서 온 출력은 버리고 로그를 남긴다.
7. **갱신과 재연결.** `session.started` 의 `session.expires_at`(Unix 초, [REF-PRIMARY]) 60초 전, 바인드된 턴이 없을 때 세션을 새로 만든다. 피어/데이터 채널 실패는 1, 2, 4, 8, 15초 백오프, 401 이면 재시도를 멈춘다. `session.closed`(어떤 `reason` 이든)를 받으면 진행 중 턴을 `error` 로 끝내고 그 방향을 바로 다시 만든다. 서버 `error` 이벤트는 치명적이지 않은 엔진 오류로 알린다(`error.type` / `code` / `message` / `client_event_id`, [CONV]).
8. **남은 `TODO(api)`** (코드 주석): 턴 경계 이벤트와 mute 시 flush 여부(`liveSession.ts`), 한국어/일본어/중국어 지원(`gptLive.ts`). Live 전용 브라우저 토큰과 최대 세션 길이도 미확인이지만 어느 코드 경로도 이에 기대지 않는다.
9. **검증 범위.** 서버 라우트는 가짜 키로 업스트림 401 까지 확인했고 로그에 키와 SDP 본문이 없다. 웹 엔진은 페이지 안 가짜 Live 서버로 `web/dev/live-harness.html` L1~L6 을 통과했다. 실제 OpenAI Live 에서의 동작은 검증하지 않았다.

---

## 5A. 실측으로 확인한 사항 (2026-10-16, 실제 API 키, 헤드리스 크롬 + macOS TTS 음성)

문서가 아닌 실험 결과이다. 모델/서비스 변경으로 달라질 수 있다.

- `session.close` 는 WebRTC data channel 에서도 받아들여지며 `session.closed` 가 온다 (6방향 6/6). `session.close` → `session.closed` 3.8~5.1 s.
- 턴 시작 전 outbound-rtp `bytesSent` = 0 (6/6).
- `audio.output.language: "zh"` → 간체 출력.
- ko→ja (기본 엔진): 9회 중 6회 번역 없음(무음, 에러 이벤트 없음, `session.created` 의 출력 언어는 `ja`). 다른 5방향은 정상.
- GPT-Live-1: `POST /v1/live/sessions` 서버 SDP 교환으로 ko→en/en→ko/ko→ja/ko→zh 모두 번역(방향당 1회). 모델이 대답하는 사례 없음. 중지→첫 음성 561~749 ms, 중지→턴 종료(조용 감지) 5.9~6.7 s.

## 6. 열린 질문 (사용자 결정 필요)

- **Q1. 턴 종료 방식.** 문서화된 flush 는 세션을 닫는 `session.close` 뿐이다.
  - (A, 권장) 턴마다 `session.close` → `session.closed` 까지 받고 그 세션은 버린다. 다음 턴은 미리 연결해 둔 예비 세션을 쓴다(연결 지연은 사용자에게 보이지 않음). 단점: 엄밀한 의미의 "세션 재사용"은 아님, 턴마다 세션 생성. WebRTC data channel 에서 `session.close` 가 동작하는지는 실측 필요.
  - (B) 세션을 유지하고, 중지 후 몇 초간 무음 프레임을 보내 남은 출력을 밀어낸다. 단점: 버튼 밖에서도 (무음) 오디오 패킷이 나감, 종료 시점이 문서화되지 않아 타임아웃 추정에 의존.
- **Q2. 원문 자막 모델.** gpt-live-transcribe 를 번역 세션 안에서 쓰는 것은 문서로 확인되지 않는다.
  - (A) 번역 세션 안의 gpt-realtime-whisper (연결 1개, keyword 없음)
  - (B) gpt-live-transcribe 별도 전사 세션을 병렬로 (연결 2개, 업로드 2배, keyword hints 사용 가능, +$0.017/분)
- **Q3. 번역 용어집.** 번역 세션에는 instructions/keywords 가 없다. 대안:
  - (A) 번역에는 적용하지 않음 (가장 단순, 용어 오역 가능)
  - (B) 번역 자막 텍스트만 용어집으로 사후 치환 (화면 텍스트는 맞지만 음성과 불일치)
  - (C) 용어가 중요한 경우 GPT-Live-1 실험 엔진으로 전환 (instructions + keyword biasing 사용, 5절 확인 후)
