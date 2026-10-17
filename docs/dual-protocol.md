# Dual mode protocol (v2: master / guest)

Booth flow. The **master** is the booth phone: a normal APP_PIN user whose `Settings.appMode` is `"dual"`. A **guest** is a visitor who scans the booth QR code, which opens `https://<host>/guest`. Guests never see the APP_PIN screen, the settings sheet, or basic mode.

1. The master picks their language and starts waiting. The waiting screen shows the booth PIN, the guest URL, and pending requests.
2. The guest opens `/guest` and picks a language. The screen says "PIN 코드 **1234**를 입력하세요" (localized), showing the master's current booth PIN. The guest types it and taps request.
3. The master sees the request and accepts or declines it.
4. On accept, both phones are paired. Each phone runs its own engine in ONE direction (my language -> partner's language) and relays its utterances as text to the other phone (no audio in dual mode).
5. The master ends the session. The guest is disconnected, its engine stops, and the server refuses further engine sessions for that guest. The guest returns to the entry screen with an "ended" notice. The master returns to waiting.

The booth PIN is 4 digits. The master changes it any time in settings. It is persisted in the Durable Object's storage; if none is stored yet, a random PIN is created and saved on first use. Guests see the current PIN, so the PIN is a confirmation code; the master's acceptance is the real gate.

Shared TypeScript types: `web/src/types.ts` (`DualRole`, `DualPeer`, `DualPhase`, `DualState`, `DualWireMessage`). UI props: `web/src/ui/dualProps.ts`.

## Server (Cloudflare Worker `worker/src/` + one Durable Object holding the hub)

In-memory state:
- `boothPin`, loaded from and saved to Durable Object storage.
- At most ONE master: `{ token, lang, stream, graceTimer, partnerId }`.
- Guests: `Map<guestId, { id: 3-digit string unique among current guests, token, lang, status: "pending" | "paired", stream, graceTimer, createdAt }>`.

Request rules:
- Tokens are 32 hex chars.
- All bodies are JSON.
- An unknown token returns `404 {"error":"unknown_token"}`. Bad input returns `400 {"error":"invalid_request"}`.
- APP_PIN (Worker secret) is checked with a constant-time compare.

| Route | Auth | Body | Result |
|---|---|---|---|
| `GET /api/dual/booth` | none | - | `{boothPin, masterOnline, masterLang, busy}`. `busy` = master is paired. |
| `POST /api/dual/booth-pin` | APP_PIN (`pin`) | `{pin, boothPin}` | `boothPin` must match `^\d{4}$`. Saves it to Durable Object storage. The master stream gets `booth_pin`. Returns `200 {"boothPin"}`. |
| `POST /api/dual/master/join` | APP_PIN, rate-limited like `/api/auth` | `{pin, lang}` | Becomes the master. If a master already exists, the old master's stream gets `{type:"replaced"}` and is ended, and its paired guest (if any) is ended with reason `master_left`; pending guests stay pending. Returns `200 {token, boothPin}`. |
| `POST /api/dual/guest/request` | none, rate-limited like `/api/auth` | `{boothPin, lang}` | Errors are checked in this order: `lang` invalid -> 400; no master -> `409 {"error":"master_offline"}`; wrong PIN -> `403 {"error":"wrong_pin"}`; `lang` equal to the master's -> `409 {"error":"same_lang"}`. On success, creates a pending guest; the master gets `requests`. Returns `200 {token, guestId}`. |
| `GET /api/dual/events?token=` | token | - | SSE stream for master or guest (`content-type: text/event-stream`, `cache-control: no-cache`, `x-accel-buffering: no`). The first event is `state`. A `: ping` comment every 15 s. A second stream for the same token replaces the first. |
| `POST /api/dual/respond` | master token | `{token, guestId, accept}` | The guest must be pending, else `409 {"error":"unavailable"}`. **Accept** while the master is already paired -> `409 {"error":"busy"}`. Otherwise both become partners: the master gets `paired` with `{id: guestId, lang}`, the guest gets `paired` with `{id: "master", lang: masterLang}`, and the master gets `requests`. **Decline:** the guest gets `{type:"ended", reason:"declined"}` and is removed; the master gets `requests`. |
| `POST /api/dual/end` | master or guest token | `{token}` | **Master:** if paired, the guest gets `ended` with reason `master_ended` and is REMOVED (its token becomes invalid, its stream is closed); the master gets `unpaired` with reason `ended`. **Guest:** the guest is removed; if it was paired, the master gets `unpaired` with reason `guest_left`; if it was pending, the master gets `requests`. Returns `200 {"ok":true}`. |
| `POST /api/dual/message` | master or guest token | `{token, message: DualWireMessage}` | Not paired -> `409 {"error":"not_paired"}`. Validation: `id` 1-64 chars; `source`/`target` in ko/en/ja/zh; texts <= 4000 chars; `status` in recording/translating/done/error; `createdAt` a finite number. The message is forwarded to the partner as `message`. Not rate-limited. |
| `POST /api/dual/leave` | master or guest token | `{token}` | Same as the member disappearing; also accepts a sendBeacon body (`application/json` Blob or `text/plain` JSON). **Master leaving:** every guest (paired and pending) gets `ended` with reason `master_left` and is removed. **Guest leaving:** same as guest `end`. |

Grace: when a stream closes, the member is kept for 20 s. If it does not reconnect in time, it is removed exactly as `leave`. A member that never opened a stream is removed 20 s after it was created.

### Engine authorization for guests (`/api/live/session`, `/api/session`)

`POST /api/live/session` and `POST /api/session` still accept APP_PIN in the `pin` field. If `pin` is NOT the APP_PIN, the server treats it as a guest token. It is accepted only when ALL of these hold:
- the guest exists;
- its status is `paired`;
- `source === guest.lang`;
- `target === master.lang`.

Anything else is `401 {"error":"invalid_pin"}`, the same response as today, so a guest whose session was ended can no longer open engine sessions. `/api/config` stays APP_PIN only.

### SSE events (`data: <json>\n\n`; dispatch on `type`)

To the master:

| `type` | Payload |
|---|---|
| `state` | `{role:"master", boothPin, requests: DualPeer[], partner: DualPeer \| null}` |
| `requests` | `{requests: DualPeer[]}` (pending guests, oldest first) |
| `booth_pin` | `{boothPin}` |
| `paired` | `{partner: DualPeer}` |
| `unpaired` | `{reason: "ended" \| "guest_left"}` |
| `message` | `{message: DualWireMessage}` |
| `replaced` | `{}` (another master took over; the stream then ends) |

To a guest:

| `type` | Payload |
|---|---|
| `state` | `{role:"guest", status: "pending" \| "paired", partner: DualPeer \| null}` |
| `paired` | `{partner: DualPeer}` |
| `message` | `{message: DualWireMessage}` |
| `ended` | `{reason: "master_ended" \| "master_left" \| "declined"}` (the stream then ends; the token is invalid) |

## Web client

- **Role.** `location.pathname` starting with `/guest` means guest role. Otherwise master role (APP_PIN login as today, then `settings.appMode === "dual"` shows the master screens, `"basic"` the existing basic screens).
- **Guest boot.**
  - Skip the APP_PIN screen entirely and fetch `GET /api/dual/booth`; refresh it whenever the guest is on the entry screen (on load, after an `ended`, after a failed request).
  - The default selected language is always `en` (owner decision 2026-10-17). A language equal to `masterLang` is not offered.
  - `?mock=1` works for guests too.
- **Guest request.**
  - Phase `requesting`. POST `guest/request`; on 200, store the token and open the EventSource.
  - On error, return to `setup` with a localized notice (wrong PIN, master offline, same language, network).
  - `paired` -> phase `paired`, `dualMessages = []`, start the engine session with directions `[{source: myLang, target: partner.lang}]`. **The engine credential is the guest token** (passed as `EngineConfig.pin`).
  - `ended` (any reason) or an engine `auth` error -> stop the engine session, close the stream, return to `setup` with an "ended"/"declined" notice, and refetch the booth info. A guest never calls `logout`.
- **Guest cancel or leave.** POST `end`, close the stream, stop the session, back to `setup`.
- **Master.**
  - `setup` -> `joining` -> POST `master/join` -> phase `waiting` + EventSource.
  - `requests` / `state` update `requests`; `booth_pin` updates `boothPin`.
  - Accept or decline -> POST `respond`. `paired` -> phase `paired` + auto-start the engine (APP_PIN credential).
  - `dualEnd` (the master's End button) -> POST `end`; on `unpaired`, stop the engine and go back to `waiting`.
  - Leaving dual (switching to basic, logout) -> POST `leave`.
  - `replaced` -> back to `setup` with a notice.
- **Booth PIN change.** Settings sheet (master role only): shows the current booth PIN with a 4-digit input and a change button. POST `booth-pin` with APP_PIN. Shows the guest URL (`location.origin + "/guest"`).
- **Relay.** Each change of my dual message is POSTed as `DualWireMessage`: throttled to 200 ms per message, flushed immediately on done/error. Incoming `message` events are upserted with speaker `"partner"`.
- **No audio** is played in dual mode.
- **pagehide:** `navigator.sendBeacon('/api/dual/leave')` when a token exists.
