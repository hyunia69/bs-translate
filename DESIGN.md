# 부스 통역 (bs-translator) Design System — "Paper & Ink"

Single source of truth for every visual decision in `web/src/ui/*`. Every color, size, radius, shadow and motion value in code is a CSS custom property declared in `web/src/ui/theme.css`; this file names those tokens, what they are for, and the rules around them. Owner decision 2026-10-16: direction 1 "Paper & Ink" from `/tmp/pttx/design/directions.md`, with the talk keys reduced to 72 px and stripped of their hint line.

## 0. Research Log

- Embedded refs: shortlisted `apple` / `mastercard` / `claude` (light, premium-utility candidates) → picked **`minimalist-skill`** (Layer A) + **`apple`** (Layer B). Apple supplies the neutral triad (`#f5f5f7` / `#ffffff` / `#1d1d1f`), capsule controls, blue reserved for focus; minimalist-skill supplies 1 px hairlines, sub-0.06 shadows, pastel spot colors for the two speakers and the dark-fill primary action. `layout-skill` stacked for the app shell (scroll ownership).
- Lazyweb: 4 queries ("voice translator conversation mobile app", "speech interpreter push to talk mobile", "live transcription voice recording mobile app", "AI voice assistant chat bubbles mobile dark"), 18 screens viewed (Gemini, Meta AI, Google Assistant, Otter ×2, Granola, Wisper Flow, Tolan, Speak, Translate Now, Capy ×2, Murmur, Perplexity, Grok ×2, Falou). Layout grammar taken: red stop control + timer + level while recording; source (small) and translation (large) paired inside one bubble; language pair readout in the header; time as metadata next to the speaker.
- StyleGallery: `scroll-body-shell` for one-hand mode (header / session strip / **the message list owns the scroll** / dock), `split-screen` for face-to-face mode (two halves, each half owns its own list scroll).
- Imagen drafts: skipped — no image-generation tool in the session. The three rendered HTML concepts (`/tmp/pttx/design/concept-{1,2,3}.html` + PNG) served as the reference-fidelity contract; concept-1 is the one implemented.
- Phase-2 QA: `/tmp/pttx/design/qa/` (3 viewports × 2 themes × 9 states, bounding-box checks, contact sheets).

## 1. Atmosphere & Identity

A quiet, precise tool for a loud room. White cards on a pale paper canvas, near-black ink, and color only where it carries meaning: a pale blue tag for the Korean rep, a pale yellow tag for the visitor, red only while a microphone is open. Structure comes from hairlines and tone, never from heavy borders. The signature is the editorial type hierarchy inside every turn — an 11 px tag + time line above a 26 px semibold translation — and the dark-fill "번역 시작하기" key that is the only heavy object on screen while nothing is happening.

## 2. Color

| Role | Token | Light (`contrast`, default) | Dark | Usage |
|---|---|---|---|---|
| Canvas | `--canvas` | `#f5f5f7` | `#000000` | App background, dock, header |
| Card | `--card` | `#ffffff` | `#272729` | Bubbles, chips' raised pill, fields |
| Ink | `--ink` | `#1d1d1f` | `#f5f5f7` | Translated text, key names, titles |
| Ink 2 | `--ink-2` | `#515154` | `#c7c7cc` | Source text, older facing rows, segment labels |
| Ink 3 | `--ink-3` | `#6e6e73` | `#98989d` | Meta, time, hints, empty state |
| Hairline | `--hair` | `rgb(0 0 0 / .08)` | `rgb(255 255 255 / .1)` | Dock/strip separators, facing rows |
| Hairline 2 | `--hair-2` | `rgb(0 0 0 / .14)` | `rgb(255 255 255 / .18)` | Field outlines, facing divider, desktop side borders |
| Track | `--track` / `--track-2` | `#e9e9eb` / `#dcdce0` | `#2c2c2e` / `#3a3a3c` | Segmented track, chips (pressed) |
| Rep wash / ink | `--me-wash` / `--me-ink` | `#e1f3fe` / `#1f6c9f` | `#0f2740` / `#8ec5ff` | Rep tag, rep key, rep status line |
| Visitor wash / ink | `--pt-wash` / `--pt-ink` | `#fbf3db` / `#845600` | `#33240a` / `#ffd27a` | Visitor tag, visitor key, visitor status line |
| Recording | `--rec` / `--rec-fg` / `--rec-glow` | `#d70015` / `#fff` / `rgb(215 0 21 / .32)` | `#e0302a` / `#fff` / `rgb(224 48 42 / .4)` | Recording key, screen frame, PIN error |
| Status dots | `--ok` `--warn` `--bad` `--idle` | `#34c759` `#ff9f0a` `#d70015` `#aeaeb2` | `#30d158` `#ffb340` `#ff6961` `#636366` | Connection dot only (non-text) |
| Tints | `--tint-bad(-ink)` `--tint-warn(-ink)` `--tint-info(-ink)` | `#fdebec/#9f2f2d` `#fbf3db/#845600` `#e1f3fe/#1f6c9f` | `#3a1216/#ffb3ba` `#33240a/#ffd27a` `#0f2740/#8ec5ff` | Banners, stop pill, danger button, error bubble |
| Invert | `--invert` / `--invert-fg` | `#1d1d1f` / `#fff` | `#f5f5f7` / `#000` | Start key, primary button, selected choice |
| Focus | `--focus` | `#0071e3` | `#2997ff` | `focus-visible` ring and PIN focus only — the single blue |
| Elevation | `--elev-1` `--elev-2` `--elev-rec` | hairline ring + 2/8 px soft shadow (≤ .06) | ring `rgb(255 255 255 / .08)` + black shadow | Section 7 |

Rules: speaker identity is alignment + pastel tag + key wash, never a colored border. Red appears only while recording (key, frame) and in the danger/error tints. Blue appears only as the focus ring. No gradients, no glass, no new hex outside this table.

## 3. Typography

Font: **Pretendard Variable** (OFL, self-hosted) for Korean, Latin and the UI; Japanese and Chinese text fall back to the device CJK fonts (`Hiragino Sans`, `PingFang SC`, `Noto Sans CJK`) through `--font-sans`. Timers and times use Pretendard with `font-variant-numeric: tabular-nums` — no separate mono font (decision: one family, zero extra bytes; the mm:ss stays steady because the digits are tabular).

Self-hosting strategy: the official Pretendard **dynamic subset** (92 `woff2` chunks split by `unicode-range`, `font-display: swap`) at `web/public/fonts/pretendard/`, linked from `index.html`, with chunk 91 (ASCII + the most frequent Hangul syllables) preloaded. 2.9 MB sit on disk; a phone fetches only the chunks whose characters it renders — measured in the QA run below.

| Level | Token | Size | Weight | Line height | Tracking | Usage |
|---|---|---|---|---|---|---|
| Translated | `--fs-tgt` × scale | 26 / 32.5 / 39 px | 600 | 1.3 | −0.012em | `.bubble__tgt` (spec ≥ 24 px at scale 1) |
| Facing | `--fs-facing` × scale | 28 / 35 / 42 px | 600 | 1.25 | −0.012em | `.facing-item__text` |
| Source | `--fs-src` × scale | 15 / 18.75 / 22.5 px | 400 | 1.4 | 0 | `.bubble__src` (spec 14–16 px) |
| PIN digits | `--fs-pin` | 34 px | 600 | 1 | 0.35em | `.pin__input` |
| PIN title | `--fs-title` | 28 px | 700 | 1.1 | −0.012em | `.pin__title` |
| Timer | `--fs-timer` | 26 px | 600 | 1 | −0.02em | `.ptt__timer` (fits a 72 px key) |
| CTA | `--fs-cta` | 20 px | 700 | 1.1 | −0.012em | `.start-btn__label` |
| Key name | `--fs-key` | 18 px | 700 | 1 | −0.012em | `.ptt__name`, sheet title, wait note |
| Body | `--fs-body` | 16 px | 400–700 | 1.4 | 0 | Settings, inputs (never below 16 px) |
| UI | `--fs-ui` | 13 px | 600 | 1 | 0 | Segments, chips, session strip, field labels, banner body |
| Hint | `--fs-hint` | 12 px | 600–700 | 1.4 | 0 | Recording "듣는 중…", start hint, stop pill, status lines |
| Meta | `--fs-meta` | 11 px | 600–700 | 1.2 | +0.02em | Tags, times |

Font scale: `--font-scale` 1 / 1.25 / 1.5 from `data-font-scale` 0 / 1 / 2 multiplies only the three reading sizes; chrome sizes stay fixed.

## 4. Spacing & Layout

Base unit 4 px: `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 20, `--sp-6` 24. Fixed sizes: `--hdr-h` 56, `--bar-h` 44, `--key-h` **72** (talk key), `--start-h` 96 (start key), `--chip-h` 38, `--tap` 44, `--meter-h` 4, flags 20×14 (tags) / 24×17 (keys), `--dot` 10.

Shell: `.app-shell` is a 100dvh flex column capped at 430 px, padded by the safe-area insets, `overflow: hidden`; above 431 px it gets `--hair-2` side borders. One-hand = `scroll-body-shell`: header → session strip → `.msg-list` (**the only scroll owner**, `min-height: 0`, `overscroll-behavior: contain`) → dock. Facing = `split-screen`: two `flex: 1 1 0` halves around a 6 px `--hair-2` divider; the top half is `rotate(180deg)`; each half's `.facing__list` owns its scroll. The dock is `padding: 12px 12px 16px` with a 10 px gap between the two keys; the start key replaces both keys (never shown together), which is why it may be taller (96 px: it carries the onboarding hint).

## 5. Components

- **Header** (`.hdr`): canvas background, 56 px; segmented language control (`.seg` capsule track, pressed cell = white pill with `--elev-1`), connection `.dot` with a 3 px halo in its own color, right-aligned chips (`.icon-btn`: 38 px capsule on `--track`, mode toggle with icon + "대면/한손", gear). States: pressed (`--track-2`), disabled segment (opacity .45), focus ring.
- **Session strip** (`.session-bar`): 44 px, hairline top/bottom inset 12 px, 8 px status dot, "번역 중 · engine · mm:ss" (engine in `--ink-3`, time tabular in `--ink`), and the **stop pill** (`.session-bar__stop`: 30 px capsule, `--tint-bad` / `--tint-bad-ink`, stop glyph).
- **Start key** (`.start-btn`): 96 px, `--invert` fill, radius 18, play glyph + "번역 시작하기" 20/700 + hint 12/600 at 70 %. Press: `scale(.97)`.
- **Talk key** (`.ptt`): 72 px, radius 18, `--me-wash` / `--pt-wash`, `--elev-2`; content = flag 24×17 + language name 18/700 (hint line removed by owner decision). Recording: `--rec` fill, white "듣는 중…" 12 px, mm:ss 26/600 tabular, 4 px level meter whose fill width follows `--level`, countdown `.ptt__left` blinking under 10 s, `--elev-rec` glow. Disabled: opacity .4 + `saturate(.3)`. Press: `scale(.97)`. Whole-screen edge: `.app-shell[data-recording]::after` 5 px `--rec` inset + 32 px glow, 1.1 s breath.
- **Wait note** (`.wait-note`): the visitor's key footprint while stopped — 72 px card, `--ink-3` text in the visitor's language.
- **Bubble** (`.bubble`): white card, radius 16 (6 px on the speaker-side bottom corner), max-width 88 %, `--elev-1`; rep rows right-aligned, visitor rows left. Meta row = `.tag` (20 px capsule in the speaker wash with flag + language name) + time + speaker glyph; then source, translation, and a status line (three stepping dots + "번역 중…"/"듣는 중…", or warning glyph + "번역 실패"). States: error (bad tint + ink on the tag), tappable (replay: `brightness(.96)` on press), playing (3 px wash ring + blinking glyph).
- **Facing item** (`.facing-item`): hairline-separated rows, meta (flag + time + glyph), text 28/600; the newest row in `--ink`, older rows in `--ink-2`; error and playing as in Bubble.
- **Banner** (`.banner`): card inset 8/12 px, radius 16, tint background, title in the tint ink, body in `--ink-2`, round close chip in 12 % tint ink. Kinds: bad (mic denied, offline, api error), warn (reconnecting), info.
- **Settings sheet** (`.sheet`): full-screen canvas, 56 px header with hairline, fields with 13/600 labels; `.select`/`.btn` radius 10 on `--card` with `--elev-1`; `.btn--primary` = invert, `.btn--danger` = bad tint; `.choice__btn` cards with a radio circle, selected = invert; latency `.log` card.
- **PIN screen** (`.pin`): centered column; title 28/700, 72 px input (radius 16, `--hair-2` outline, tabular digits, blue focus ring), error in `--rec`, block primary button.
- **Landscape guard**: canvas, 20/700 ink text, rotate glyph in `--ink-3`.
- **Flags** (`web/src/ui/flags.tsx`): inline SVG from lipis/flag-icons 7.3.2 (MIT), ids namespaced per language; rendered inside a `.flag` span with radius 3 and a 16 % outline. No emoji anywhere; icons are the inline SVG set in `icons.tsx`.

## 6. Motion & Interaction

| Token | Value | Usage |
|---|---|---|
| `--t-fast` | 120 ms ease-out | background/color/opacity state changes, recording frame fade |
| `--t-press` | 80 ms ease-out | press scale on keys, start, buttons (`scale(.97)` / `.98`) |
| `--blink` | 1 s steps(2, start) | busy dot, countdown, playing glyph (0.8 s) |
| `pending` | 1 s ease-in-out, 3 dots staggered 150 ms | "still arriving" |
| `rec-frame` | 1.1 s ease-in-out, box-shadow breath | recording edge |
| meter | 70 ms linear width | level fill |

Only `transform`, `opacity` and the recording frame's `box-shadow` animate; nothing reflows. `prefers-reduced-motion: reduce` stops the frame breath, dots, blinks and the busy dot (state stays visible through color).

## 7. Depth & Surface

Strategy: **hairline ring + soft shadow** (tonal, never borders). `--elev-1` = `0 0 0 1px rgb(0 0 0/.06), 0 1px 2px rgb(0 0 0/.04)` for cards and the selected pill; `--elev-2` = `0 0 0 1px rgb(0 0 0/.06), 0 2px 8px rgb(0 0 0/.06)` for keys; `--elev-rec` adds the red glow. Dark theme replaces the ring with `rgb(255 255 255/.08)`. Radius scale: `--r-sm` 10 (fields, buttons), `--r-md` 16 (bubbles, banners, PIN input), `--r-lg` 18 (keys), `--r-full` capsules, `--r-flag` 3. Nested corners are concentric (bubble 16 → 6 on the speaker corner).

## 8. Accessibility Constraints & Accepted Debt

Target WCAG 2.2 AA for all text, AAA for translated text; visible `focus-visible` ring (3 px `--focus`, offset 2 px) on every control; talk keys ≥ 72 px tall and ≥ 44 px wide, all other controls ≥ 44 px; `touch-action: manipulation`, no text selection and no long-press menu on buttons; inputs ≥ 16 px; UI copy Korean, visitor-facing strings in the visitor's language.

Measured contrast (WCAG formula, light / dark):

| pair | light | dark | floor | result |
|---|---|---|---|---|
| translated text (bubble__tgt 26px/600) on card | 16.83 | 13.69 | AAA | ok |
| facing text 28px/600 (newest) on canvas | 15.46 | 19.29 | AAA | ok |
| facing text older (ink-2) | 7.26 | 12.47 | AA | ok |
| source text 15px (ink-2) on card | 7.91 | 8.85 | AA | ok |
| meta/time 11px (ink-3) on card | 5.07 | 5.19 | AA | ok |
| hints on canvas (ink-3) | 4.66 | 7.31 | AA | ok |
| segment label (ink-2 on track) | 6.52 | 8.28 | AA | ok |
| chip label (ink on track) | 13.88 | 12.80 | AA | ok |
| rep tag (me-ink on me-wash) | 4.98 | 8.36 | AA | ok |
| visitor tag (pt-ink on pt-wash) | 5.72 | 10.56 | AA | ok |
| rep key name (ink on me-wash) | 14.79 | 13.93 | AA | ok |
| visitor key name (ink on pt-wash) | 15.18 | 13.80 | AA | ok |
| recording key text/timer (white on rec) | 5.38 | 4.54 | AA | ok |
| start key label (invert-fg on invert) | 16.83 | 19.29 | AA | ok |
| stop pill (tint-bad-ink on tint-bad) | 6.26 | 9.71 | AA | ok |
| pin error (rec on canvas) | 4.94 | 4.63 | AA | ok |
| banner bad title / body | 6.26 / 6.88 | 9.71 / 9.76 | AA | ok |
| banner warn title | 5.72 | 10.56 | AA | ok |
| banner info title | 4.98 | 8.36 | AA | ok |
| danger button (tint-bad-ink on tint-bad) | 6.26 | 9.71 | AA | ok |
| focus ring vs canvas (non-text) | 4.31 | 6.96 | 3:1 | ok |

Accepted debt:

| Item | Location | Why accepted | Owner / Exit |
|---|---|---|---|
| Japanese and Chinese glyphs render in the device CJK font, not Pretendard | `--font-sans` fallbacks | Pretendard JP is 5.3 MB and Pretendard has no Chinese; the visitor text is the only CJK on screen and Android/iOS ship Noto/Hiragino/PingFang | owner; add a subsetted Noto Sans JP/SC if a visitor font mismatch is reported |
| Recording key is 72 px, below the original ≥ 96 px spec | `--key-h` | owner decision 2026-10-16 (keys smaller, hint removed); still ≥ 44 px tap target | owner |
| `MOCK` badge keeps its yellow Tailwind styling | `web/src/App.tsx` | dev-only marker outside the UI folder's scope | n/a |
| PWA manifest `theme_color` stays `#000000` | `web/public/manifest.webmanifest` | file outside this change's write scope; `index.html` theme-color already follows the scheme | update with the next manifest change |
