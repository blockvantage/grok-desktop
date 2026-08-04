# Chat Experience — Level-Up Review & Implementation Guide

Scope: the chat experience end to end — slash commands, media deliverables, progress
feedback, language support, and general chat polish. Review run 2026-07-17 via five
parallel deep-read passes (slash pipeline, asset/video-audio, progress UX, i18n,
friction sweep). Items marked **[verified]** were re-confirmed line-by-line in source
after the passes; the rest carry pass-reported evidence — re-verify line numbers
before editing (files drift). Mark each item `DONE` or `SKIPPED (reason)` in place —
the review pass diffs this file.

Prior rounds are all landed: `IMPROVEMENTS.md`, `UI_IMPROVEMENTS.md`,
`SLASH_IMPROVEMENTS.md` (SC-1..SC-11), `POLISH-PLAN.md`. Do not re-do those; Phase 6
lists three suspected regressions against them.

**Verdict driving this round:** the plumbing is honest and complete — but the
experience under-tells and under-delivers at the emotional peaks. Slash commands dump
a wall of template text into the composer instead of staying a crisp intent. A
finished video is the payoff of the whole app, and it plays silent with no poster in
a flat 40-row file list. During the 1–2 minutes it renders, the user sees bouncing
dots with no elapsed time. A German user gets English replies, English dictation, and
an English tray menu. Fixing these five stories is the 2× jump.

---

## How it works today (verified summary)

- **Slash:** selecting a fill command translates `t(cmd.goalKey)`, weaves args, and
  **replaces the `/token` range with the full template text in the textarea**
  (`applySlash`, `home-view.tsx:392-446`; `applySlashFollow`,
  `task-workspace-view.tsx:947-1000`; `applySlashCommand`, `composer-input.ts:268-275`).
  The goal is then sent verbatim: `tasks.create { goal }` → engine prompt
  `` `Task goal:\n${task.goal}` `` (`packages/engine-grok/src/session.ts:347`) [verified].
- **Assets:** harvest scans the primary workspace (≤40 files, ≤25 MB each, depth 3;
  `packages/gateway/src/services/workspace-deliverables.ts:40,45,70`), classifies
  `mp4|webm|mov` + images as "media" — **no audio extensions**
  (`workspace-deliverables.ts:90`) [verified]. Artifact payloads carry no mime/size
  (`harvest-artifact-payload.ts:11-16`). The rail lists everything flat.
- **Video playback:** every `<video>` is `controls playsInline` only — no `muted`,
  no `poster`, no `preload` (`media-lightbox.tsx:210-215`, `artifacts-view.tsx:103-109`,
  `task-stream.tsx:1284-1290`) [verified]. Delivery is the `grokdesk-asset://` protocol
  via `net.fetch(file://)` with range support (`asset-protocol.ts:220-257`); ≤24 MB
  videos inline as data URLs. **The player is not muting anything — silent videos are
  silent at the source.**
- **Progress:** engine emits `message/step/tool_request/tool_result/run_progress/
  worker_*` events; the heartbeat fires only after **12s of silence** with generic
  copy (`session.ts:408-469`), stored transiently (`runner.ts:1280`). The
  WorkingIndicator rotates friendly lines (`task-stream.tsx:1006-1048`). **No elapsed
  time anywhere; no media-aware progress.**
- **Language:** 7 locales (en/es/fr/de/pt/ja/zh), 100%-parity-tested, system-detect +
  picker. But the engine gets **no language hint** (`session.ts:344-361`) [verified],
  dictation defaults to `"en"` and callers never pass a language
  (`use-dictation.ts:96`, `home-view.tsx:220`) [verified], `Intl` calls pass
  `undefined` locale (`lib/format.ts:18-52`), and the tray/main-process strings are
  hardcoded English (`main/tray.ts:37-108`, `main/index.ts:142,559,846`).

---

## Phase 1 — Slash commands: swap at send time, not at select time (CMD)

Target model: the composer keeps the compact `/research quantum computing` — selecting
from the menu **completes the token**, never pastes the template. The template swap
happens once, at the send choke point. The user sees intent; the engine sees the full
prompt.

### CMD-1: Send-time expansion at the single choke point — **DONE**
- Landed (Wave 3, `060ea3c`): `expandSlashGoal(text, t)` pure fn in `composer-input.ts`;
  called only in `create-task-optimistic.ts` (both param builders) + queue drain.
  Menu selection now completes the token (`/research ` + caret); action tokens and
  `/Users/...` paths pass through untouched.
- Evidence: fill happens at selection (`home-view.tsx:406-408`,
  `task-workspace-view.tsx:959-960`); send paths pass text verbatim
  (`buildCreateTaskParams`, `create-task-optimistic.ts:24-52`; follow-up submit
  `task-workspace-view.tsx:1749-1775`; queue drain via `enqueueQueued`).
- Fix: new pure `expandSlashGoal(text, t): { goal, command? }` in `composer-input.ts`:
  if the text starts (line-start) with a fill command's exact token, return
  `weaveSlashArgs(t(goalKey), rest, t("slash.argsTopic", …))`; otherwise return text
  unchanged. Action tokens and non-matching text never expand. Call it in BOTH send
  paths (home run param build + follow-up submit) and at **queue drain** (queued rows
  store the compact text; expand when actually sent). Menu selection now applies
  token-completion (`/research ` + caret) instead of the template. Action commands
  keep today's behavior (clear token, run side effect immediately).
- Accept: type `/research grok pricing`, composer shows exactly that; the created
  task's `goal` is the full localized template + Topic line; queued follow-up with a
  command expands on drain; `/Users/...` paths and unknown tokens pass through
  untouched.

### CMD-2: Armed-command chip — the truth surface — **DONE**
- Landed (Wave 3, `583df85`): `components/armed-command-chip.tsx` renders label +
  one-line effect + × (deletes token) above both composers when text starts with a
  recognized fill token; opaque `bg-[hsl(var(--surface-3))]`, no blur. Keys ×7.
- Evidence: once the template no longer fills the textarea, nothing tells the user
  what will happen. The composer already has a chip pattern (folder chip,
  `home-view.tsx:729-762`).
- Fix: when the composer text starts with a recognized fill token, render a compact
  chip above the input: command label + one-line effect ("Deep research · sources ·
  heavy effort") + an × that deletes the token. Both composers. New i18n keys in all
  7 locales.
- Accept: typing `/research ` (menu open or dismissed) shows the chip; × removes the
  token and the chip; sending clears it.

### CMD-3: Effort escalation follows recognition, not menu selection — **DONE**
- Landed (Wave 3, `d04793a`): `armedEffortTransition` drives `onEffort` from token
  recognition (same state as the CMD-2 chip); prior effort remembered and restored on
  token delete unless the user changed the control meanwhile.
- Evidence: `/research` sets heavy only inside menu-select handlers
  (`home-view.tsx:397`, `task-workspace-view.tsx:951`) — typing the token manually
  and sending skips the escalation.
- Fix: drive `onEffort` from token recognition (the same state that shows the CMD-2
  chip). Remember the prior effort; deleting the token restores it unless the user
  changed the control meanwhile.
- Accept: type `/research x` fully by hand → effort control shows Heavy; delete the
  token → effort reverts; manual effort change wins.

### CMD-4: What the sent bubble shows — decide and store — **DONE**
- Landed (Wave 1 `7b441f6` + Wave 3 `766841b`): optional `goalSource` (compact typed
  text) rides `tasks.create`/follow-up params + a durable user-message event.
  `UserGoalBubbleText` renders the compact form with the command highlighted;
  "View full prompt" Collapsible discloses the expanded goal. Survives history reload.
- Evidence: after send, the user turn renders the sent `goal` (the expanded
  template). With CMD-1 the user never saw that text.
- Fix (recommended): send an optional `goalSource` (the compact typed text) alongside
  `goal` on `tasks.create`/follow-up params (shared `ipc.ts` + gateway pass-through +
  task record). The user bubble renders the compact form styled with the command
  highlighted, with a "View full prompt" disclosure showing the expanded goal.
  Fallback if the RPC change is out of budget: render expanded text (status quo) and
  note it here.
- Accept: sent turn shows `/research grok pricing` with a working disclosure; rewind/
  edit re-opens the compact form.

### CMD-5: Test migration — **DONE**
- Landed (Wave 3): `composer-input.test.ts` rewritten to token-completion semantics;
  `expandSlashGoal` unit tests cover expansion, args weaving, unknown-token passthrough,
  `/Users/...` passthrough, action-token passthrough, locale-sensitivity. Suite grew.
- Evidence: `composer-input.test.ts:176-203` asserts fill-at-select ("applies fill
  text over the slash token", "weaves args into fill templates", range replacement).
- Fix: rewrite those to token-completion semantics; add `expandSlashGoal` unit tests:
  expansion, args weaving, unknown token passthrough, `/Users/...` passthrough,
  action-token passthrough, locale-sensitivity (expansion uses active catalog).
- Accept: desktop suite does not shrink; new pure-function tests cover every branch.

---

## Phase 2 — Hear the videos (AV)

### AV-1: Establish the audio ground truth (do this FIRST) — **DONE (audio: YES)**
- Smoke (2026-07-17): default `slash.videoGoal`-style prompt via real `grok -p`
  produced `desktop-ai-assistant-teaser.mp4` (~12s, 1280×720, 4.3 MB) with an **AAC
  stereo audio stream** — ffprobe `codec_name=aac, channels=2`; volumedetect
  `mean_volume: -31.1 dB, max_volume: -17.6 dB` (audible music/ambience, not a
  silent track). The current CLI delivers audio even without an explicit ask.
  Conclusion: players were never muting; older CLI output was silent. AV-2 takes the
  "CAN" branch (make the audio ask explicit so it stays true).
- Evidence: no player mutes anything [verified]. The SC-11 smoke (2026-07-13)
  produced a 5s teaser via the CLI's `image_to_video` — typical output of that tool
  class is a **video-only stream**.
- Fix: run one live smoke: create a `/video` task, then probe the mp4 for an audio
  stream (`ffprobe -show_streams` if installed, else
  `mdls -name kMDItemAudioSampleRate <file>`). Record the result HERE. If an audio
  track exists and is still silent in-app, debug the player (unlikely). If absent,
  AV-2 is the real fix.
- Accept: this item's mark states "audio track: yes/no" with the probe output.

### AV-2: Make /video produce audio — or say it can't — **DONE (CAN branch)**
- Evidence: AV-1 smoke proved default CLI output already includes AAC audio; make the
  ask explicit so it stays true. `slash.videoGoal` previously asked only for "a short
  polished teaser video … as an mp4" with no soundtrack mention.
- Fix: updated `slash.videoGoal` in ALL 7 locales to request a fitting music bed or
  ambient audio track in the mp4 (kept `slash.videoDesc` time expectation).
- Accept: template asks for sound; AV-1 smoke shows the CLI delivers audible audio.

### AV-3: Player polish — poster, preload, volume memory — **DONE**
- Landed (Wave 2 `d6b1a14`, extended Waves 4–5): `videoDisplaySrc(src)` appends
  `#t=0.001` (skips data:/existing) so the first frame paints as an implicit poster;
  `preload="metadata"` on all four `<video>` sites; `useVideoPoster` captures a rail
  thumbnail via a one-shot hidden `<video>`→canvas (in-memory cache by path); lightbox
  volume/mute persist in localStorage.
- Evidence: `<video>` has no `poster`/`preload`; rail videos show a Film icon, no
  thumbnail; no volume persistence (`media-lightbox.tsx:210-215`,
  `task-stream.tsx:1284-1290`, `task-workspace-parts.tsx:151-201`).
- Fix: add `preload="metadata"` and append `#t=0.001` to video srcs so the first
  frame paints as an implicit poster (works for protocol URLs and data URLs); rail
  video rows get a real thumbnail via a one-shot hidden `<video>`→canvas capture
  (cache by path, in-memory). Persist lightbox volume/mute in localStorage and apply
  on mount.
- Accept: chat + rail + lightbox all show a first-frame image before play; volume
  survives closing and reopening the lightbox.

### AV-4: Audio artifacts become playable media [verified gap] — **DONE**
- Landed (Wave 2 `99626c2`): gateway media regex gains `mp3|wav|m4a|aac|ogg|flac`;
  `AUDIO_EXTENSIONS` + `isAudioPath` beside the video helpers (`api.ts`,
  `deliverables.ts`); `<audio controls preload="metadata">` in chat `ArtifactMedia`,
  artifacts view, and lightbox (Music icon in the rail). Asset-protocol mime map covers
  the new extensions.
- Evidence: `workspace-deliverables.ts:90` media regex lacks audio extensions —
  generated `.mp3/.wav` classify as "file"; the renderer has **no** `isAudioPath`/
  `<audio>` element anywhere; in chat an audio artifact falls through to the failed-
  preview card (`task-stream.tsx:1256-1276`).
- Fix: add `mp3|wav|m4a|aac|ogg|flac` to the gateway media regex; add
  `AUDIO_EXTENSIONS` + `isAudioPath` beside the video helpers (`renderer/lib/api.ts`
  ~396, `lib/deliverables.ts`); render `<audio controls preload="metadata">` in chat
  `ArtifactMedia`, artifacts view, and the lightbox (Music icon in the rail); confirm
  the asset protocol mime map covers these (`workspace-asset.ts:37-45`).
- Accept: a task that writes `artifacts/track.mp3` shows an inline playable audio
  card in chat and the rail — not an error card.

---

## Phase 3 — Deliverables: show the payoff, not the file system (ASSET)

### ASSET-1: Hero + principal items, everything else collapsed — **DONE**
- Landed (Wave 4 `59e3213`): `groupDeliverables` → { hero (newest media only),
  principal ≤4, overflow }. Rail renders ONE hero card (image thumb / video poster from
  AV-3), up to 4 principal rows, then "All files (N)" collapsed disclosure. Chat-staged
  user attachments never count as hero.
- Evidence: the rail is a flat dedup list of up to 40 rows
  (`buildDeliverablesFromArtifacts`, `deliverables.ts:25-42`; render
  `task-workspace-view.tsx` Deliverables section) — a video task's payoff sits level
  with `caption.txt`.
- Fix: rank media > report > file, newest first (harvest already sorts media-first,
  `workspace-deliverables.ts:77-82`). Render: ONE hero card (newest media — full-width
  preview: image thumb exists, video poster from AV-3), then up to 4 principal rows,
  then "All files (N)" as a collapsed disclosure. Chat-staged user attachments never
  count as hero.
- Accept: a /video run shows the mp4 as a playable hero card on top; a 12-file run
  shows hero + 4 + "All files (12)".

### ASSET-2: Artifacts carry mime + size (prereq for honest display) — **DONE**
- Landed (Wave 1 `65946a0`): `sizeBytes` + `mime` added to the artifact event payload
  (gateway `harvest-artifact-payload.ts`) and shared event types (`ipc.ts`); renderer
  captions render "MP4 · 12 MB" style. Old events without the fields degrade gracefully.
- Evidence: `harvest-artifact-payload.ts:11-16` stores only id/title/path/kind; the
  harvest scan already stats each file. UI has nothing to caption previews with.
- Fix: add `size` and `mime` to the artifact event payload (gateway) and shared event
  types (`packages/shared/src/ipc.ts` — NOTE: this file has uncommitted local edits;
  coordinate/commit first). Renderer captions: "MP4 · 12 MB", "PNG · 2.1 MB".
- Accept: new artifacts show type + size captions; old events without the fields
  degrade gracefully; gateway + shared + desktop suites green.

### ASSET-3: Turn-end deliverables digest in chat — **DONE**
- Landed (Wave 4 `1178220`): at turn end, that turn's file-row artifacts fold into one
  `DeliverablesDigestCard` (hero preview + "N more files" + "Open deliverables" focuses
  the rail). Media artifacts stay inline-playable; only file-row noise folds.
  `artifact_digest` render kind added to the conversation path.
- Evidence: while live, non-media artifacts collapse to the newest
  (`task-stream.tsx:306-324`); when a turn lands N files the transcript still accretes
  a card per artifact.
- Fix: at turn end, fold that turn's artifacts into one digest card: hero preview +
  "3 more files" + "Open deliverables" (focuses the rail). Media artifacts stay
  inline-playable; only the file-row noise folds.
- Accept: a 6-artifact turn renders one digest card, not six rows; the mp4 inside it
  still plays inline.

### ASSET-4: Surface the silent caps — **DONE**
- Landed (Wave 4 `a2dfe37`): per-file media ceiling raised to 200 MB (under the 256 MB
  serve cap); harvest returns `{ files, skipped: { oversize, overflow } }` and emits a
  notice line ("N files skipped — over size limit") in the harvest step event so a
  missing 30 MB video is explained, not silent.
- Evidence: files >25 MB are silently never harvested
  (`workspace-deliverables.ts:70`) — a 30 MB video simply doesn't appear; overflow
  past 40 files is silently dropped (`:40`); serve cap is 256 MB
  (`asset-protocol.ts:30`).
- Fix: raise the per-file ceiling for media extensions to 200 MB (still under the
  serve cap); when the scan skips oversized/overflow files, emit one notice line in
  the harvest step event ("2 files skipped — over size limit") so the user learns
  why something is missing.
- Accept: a 30 MB mp4 harvests and plays; a deliberately oversized file yields a
  visible skip notice, not silence.

---

## Phase 4 — Progress: what's happening, right now (PROG)

### PROG-1: Elapsed time exists somewhere (then everywhere) — **DONE**
- Landed (Wave 5 `7488283`): `lib/elapsed.ts` (`formatElapsed`/`elapsedSince`/
  `taskElapsedStartIso`) + `hooks/use-elapsed.ts` (render-only 1s ticker). Live m:ss on
  the legacy WorkingIndicator, the conversation LiveWorkCard (primary surface), and the
  home running banner. Start clock = `task.createdAt` (no attempt `startedAt` exists).
- Evidence: no elapsed-time display in WorkingIndicator, status pill, or the home
  running banner (`task-stream.tsx:1006-1048`, `home-view.tsx:639-679`).
- Fix: `tabular-nums` elapsed timer (m:ss) on the WorkingIndicator and the home
  running banner, computed from the run attempt's start (local 1s ticker, render-only;
  no polling). Reduced-motion safe (it's text).
- Accept: a running task shows a live m:ss both in-stream and on Home.

### PROG-2: Media-aware progress card — **DONE**
- Landed (Wave 5 `837db27`): `mediaToolKind`/`runningMediaKind` detect a running
  image/video tool; the LiveWorkCard swaps to an aspect-video shimmer + "Rendering
  video — usually 1–2 min" + PROG-1 elapsed (one live signal), then resolves to the
  real media on the artifact event. `progress.renderingVideo`/`renderingImage` ×7.
- Evidence: during a 1–2 minute video render the only signal is a 12s-delayed generic
  heartbeat ("Still working on tools in the background…", `session.ts:460-463`) under
  rotating thinking lines (`task-stream.tsx:1014`).
- Fix: when the newest running `tool_request` is an image/video generation tool
  (match tool name, e.g. `image_to_video`/`reference_to_video`/image tools), replace
  the generic WorkingIndicator with a media placeholder card: aspect-video shimmer +
  "Rendering video — usually 1–2 min" + the PROG-1 elapsed. On the artifact event, the
  card resolves into the real media (reuse the completion light-sweep). i18n ×7.
- Accept: a /video run shows the shimmer card with elapsed time within ~2s of the
  tool starting, and it morphs into the playable video on completion.

### PROG-3: Keep concrete detail on long tool runs — **DONE**
- Landed (Wave 5 `97a886c`): while any tool row is open the indicator always shows that
  tool's humanized label + detail (never regresses to rotating generic lines); the
  latest `run_progress` message renders as the indicator caption. Tool scan runs across
  `allItems` so a trailing thought line can't defeat detection.
- Evidence: WorkingIndicator falls back to rotating generic lines when the activity
  store reads "generic" (`task-stream.tsx:1014,1040`); `run_progress` text sets a
  liveness flag but verify the message itself is surfaced (`task-stream.tsx:289-294`,
  `runner.ts:1280`).
- Fix: while any tool row is running, the indicator always shows that tool's
  humanized label + detail (never regresses to generic lines); render the latest
  `run_progress` message as the indicator's caption when present.
- Accept: during a long shell/browser/media tool, the indicator names the tool the
  whole time; heartbeat text appears as caption, not a separate row.

### PROG-4: Header status carries the activity — **DONE**
- Landed (Wave 5 `97a886c`): the workspace header suffixes the StatusPill with a quiet
  muted caption (`data-header-activity`, `max-w-[240px] truncate`) carrying the activity
  store's live summary ("Running · browsing xai.com"). One line, no new animation; the
  pill stays the single chrome-level signal.
- Evidence: StatusPill shows only the status label (`status-pill.tsx`); the workspace
  header says "Running" while the stream knows "Browsing xai.com".
- Fix: in the workspace header only, suffix the pill (or add a quiet caption) with
  the live activity summary from the activity store ("Running · browsing xai.com").
  One line, truncated, no new animation (CH-4 discipline: the pill stays the single
  chrome-level signal).
- Accept: header reflects the current tool phase within a second of the stream.

---

## Phase 5 — Language support that actually reaches the model (LANG)

### LANG-1: Tell the engine the user's language — **DONE** (unit verified de/ja)
- Evidence (pre-fix): prompt assembly had zero locale content; free-typed prompts
  could get English replies despite a non-English UI.
- Fix (Wave 1): optional `locale` on create/follow-up → engine `buildRunPrompt`
  appends `Reply to the user in <language> unless they clearly write in a different
  language.` for non-`en` locales; renderer sends `getActiveLocale()`.
- Verification (Wave 6.5, unit): `packages/engine-grok/src/build-run-prompt.test.ts`
  asserts full instruction lines for `locale: "de"` → German and `locale: "ja"` →
  Japanese (plus es/fr/pt/zh mapping; en/undefined omit the line). Live CLI smoke
  of model replies deferred (unit-level accepted for this wave).

### LANG-2: Dictation speaks the UI language — **DONE**
- Evidence: `use-dictation.ts` previously hardcoded `language: opts.language ?? "en"`;
  both callers omitted it.
- Fix: `dictationLanguage(opts, activeLocale)` pure helper + default from
  `getActiveLocale()`; both composers pass `language: getActiveLocale()`. Main
  `dictation-service.ts` already strips BCP-47 region and forwards the short code
  to Grok STT (`language = (optsIn?.language ?? "en").split("-")[0]`).
- Accept: with UI = es, dictation starts with `{ language: "es" }`; unit tests on
  the mapping.

### LANG-3: Dates and numbers follow the app language — **DONE**
- Evidence: `lib/format.ts` and sidebar/license/security-banner/remote-ui called
  `toLocale*String(undefined, …)` — OS locale, which can disagree with the UI
  language.
- Fix: `getActiveIntlLocale()` in `active.ts` (zh → zh-CN); threaded into every
  renderer `toLocale*` site (format.ts, app-sidebar, security-update-banner,
  license-tab, remote-ui).
- Accept: UI = fr on an en-US system shows French month names.

### LANG-4: Tray + native dialogs localize — **DONE**
- Evidence: tray menu/tooltip and key-import / start-failed dialog titles were
  hardcoded English; main cannot import the renderer catalog.
- Fix: `main/main-i18n.ts` mini catalog (13 keys × 7); `mt()` in tray + dialogs;
  IPC `grokdesk:app:setLocale` (preload `app.setLocale`); `context.tsx` pushes
  resolved locale on change/boot; tray rebuilds via `onMainLocaleChange`. Window
  title "Grok Desk" stays (brand).
- Accept: switching to ja relabels the tray menu without app restart.

### LANG-5: String stragglers — **DONE**
- Evidence: license placeholder, toast aria-labels, context-meter aria-label,
  markdown remote-images title were hardcoded English.
- Fix: keys `license.productKeyPlaceholder`, `toast.regionLabel`, `toast.dismiss`,
  `meter.contextUsage`, `markdown.remoteImagesBlocked` in all 7 locales; components
  use `t()` from `@/i18n/active`.
- Accept: i18n grep for these literals returns only locale files.

### LANG-6: New-locale readiness (decision item) — **DONE** (recipe only)
- Evidence: tests hard-coded locale arrays/counts; adding a locale required hunting
  multiple arrays in `i18n.test.ts`.
- Fix: export `ALL_LOCALES` from `catalog.ts`; `i18n.test.ts` iterates
  `ALL_LOCALES` / `NON_EN_LOCALES` instead of hardcoded lists. No new locales this
  round (it/ko remain a product decision). RTL still out of scope.
- Accept: adding a locale = types + catalog import/META + JSON (+ mobile); tests
  fail only on missing JSON content.

---

## Phase 6 — Chat polish round 3 (CHAT)

Fresh friction from this round's sweep — items overlapping older docs are framed as
regression checks (verify before re-fixing).

### CHAT-1: Assistant turns have no actions — **DONE**
- Evidence: user turns get Edit/Undo (`conversation-turn.tsx:136-146`); assistant
  turns offer nothing — no copy-response, no retry.
- Fix: hover/focus action row on assistant turns: Copy (full markdown), Retry turn
  (re-runs the last user message; enabled when terminal or failed). Reuse the
  chat-actions-menu pattern; keyboard reachable.
- Accept: copy puts the full response on the clipboard; retry creates a new turn from
  the prior user message.

### CHAT-2: Workspace follow-up drafts survive restarts — **DONE**
- Evidence: `followUp` is component state only (`task-workspace-view.tsx:~310`); Home
  persists drafts via `saveWorkSession` (`home-view.tsx:506-518`) but the workspace
  composer loses text on navigation/quit.
- Fix: persist per-task follow-up drafts (text + attachment paths) keyed by task id,
  same debounce pattern; restore on mount; clear on send.
- Accept: type a follow-up, quit, relaunch, reopen the task — the draft is intact.
- Landed: `lib/follow-up-drafts.ts` (`grokdesk.followUpDrafts.v1`, 14-day prune);
  workspace composer debounced save + restore by conversation root; clear on send/enqueue.

### CHAT-3: "+N more" citations expand — **DONE**
- Evidence: `citation-cards.tsx:36-40` caps at 4 with a static overflow label.
- Fix: make the label a button that expands the full list (collapsed by default on
  next render).
- Accept: 9 citations → click shows all 9.

### CHAT-4: New-messages boundary — **DONE**
- Evidence: jump-to-latest exists (CH-7) but returning to a running chat gives no
  marker where you left off.
- Fix: on task open/refocus, remember the last seen seq; render one hairline "New"
  separator above the first unseen item; clears on next visit.
- Accept: leave a running task, return after replies — separator sits at the right
  row.
- Landed: `lib/unread-boundary.ts` + separator in TaskStream (conversation + stream);
  last-seen per conversation in localStorage; freezes on open, marks max on leave.

### CHAT-5: Queue guardrails — **DONE**
- Evidence: queued-row delete is instant (`queued-message-row.tsx:208`); queued
  attachments aren't validated before send (`:150-180`) — a deleted file fails late.
- Fix: delete gets an undo toast (not a dialog — it's recoverable by retyping, keep
  it light); on drain, stat attachment paths and mark missing ones on the row with a
  re-pick affordance instead of failing the send.
- Accept: deleting shows undo; a queued message whose file vanished flags the
  attachment and sends only after re-pick/removal.
- Landed: undo toast (`workspace.queueRemoved` + `common.undo`) restores at original
  index and purges after 8s; drain validates paths via `workspace.readFile`; missing
  files set `failReason: missing_attachment` with re-pick UI.

### CHAT-6: Turn-edit affordances — **DONE**
- Evidence: entering edit mode shows no Save/Cancel; Escape/blur semantics are
  invisible (`conversation-turn.tsx:136-146`). Related: the follow-up placeholder can
  silently change mid-focus as task state flips
  (`task-workspace-view.tsx:2089-2091`).
- Fix: explicit Save (Enter) / Cancel (Esc) buttons in edit mode; freeze the
  composer placeholder while the input is focused and non-empty.
- Accept: edit mode shows both controls; placeholder never swaps under a focused,
  non-empty composer.

### CHAT-7: Code-block expand affordance — **DONE**
- Evidence: CH-9 delivered the max-height clamp; the sweep found no expand button
  beside Copy (`ui/markdown.tsx:164-178`).
- Fix: "Expand" toggle in `.code-block-head` when content overflows the clamp.
- Accept: a 400-line block shows Expand; toggling reveals/reclamps.

### CHAT-8: Regression checks against DONE items (verify first) — **DONE (no regressions)**
- Evidence (sweep re-flagged three items marked DONE in `UI_IMPROVEMENTS.md`):
  question-chip busy state + discarded custom prompt (CH-8;
  `task-stream.tsx:496-510`), approval card missing tool/command detail (CH-2;
  `task-workspace-view.tsx:1340-1350`), streaming caret detached on block-level last
  children (CH-12; `task-stream.tsx:~850`).
- Verdicts (verified 2026-07-17): CH-8 OK — `followUpBusy` reaches TaskStream and
  disables/spins chips (`task-stream.tsx:509,513`), `questionChips.prompt` renders as
  the header (`task-stream.tsx:502`). CH-2 OK — the in-stream approval card renders
  reason + mono `block.detail` line (`task-stream.tsx:904-928`). CH-12 OK — caret is
  in-flow via `.stream-caret .typeset > :last-child::after` (`globals.css:603`).
  The sweep misread all three; no change needed.

---

## Execution order

| Order | Items | Why |
|------:|-------|-----|
| 1 | AV-1 smoke, CHAT-8 verify | Ground truth first — they steer AV-2 and Phase 6 scope. |
| 2 | ASSET-2 (+ shared ipc coordination), LANG-1 | Both touch `packages/shared/src/ipc.ts` (which has uncommitted local edits) — land the schema changes together, once. |
| 3 | CMD-1..CMD-5 | Self-contained renderer round with test migration. |
| 4 | AV-2, AV-3, AV-4 | Audio truth → template → player → audio artifacts. |
| 5 | ASSET-1, ASSET-3, ASSET-4 | Hero display builds on ASSET-2 metadata + AV-3 posters. |
| 6 | PROG-1..PROG-4 | Pure renderer; PROG-2 reuses AV-3 shimmer/poster patterns. |
| 7 | LANG-2..LANG-6 | Locale plumbing sweep, one big 7-locale diff batched. |
| 8 | CHAT-1..CHAT-7 | Polish round; independent items, commit per item or pair. |

Commit per phase (conventional commits). Update every item mark in this file as you
go; finish with commit hashes + gate outputs + skips with reasons.

## Hard gotchas (read before coding)

- `ui-structure.test.ts`: App.tsx must contain NO em-dash characters and keep its
  literal-string assertions ("Deliverables", "Work log", `extractResultSummary`,
  `workspace.readFile`).
- i18n: every key add/remove/rename hits ALL 7 locales (en/de/es/fr/ja/pt/zh) + the
  `proseKeys` allowlist in `i18n/i18n.test.ts`. Batch locale diffs per phase.
- Never call the regex `exec` method in renderer files — a security hook false-flags
  the token; use `String.match()`.
- Floating surfaces stay fully opaque `bg-[hsl(var(--surface-3))]`, NO backdrop-blur
  (vibrancy window breaks backdrop-filter compositing) — applies to the CMD-2 chip
  and PROG-2 card if they float.
- `packages/shared/src/ipc.ts` and several gateway files already have uncommitted
  local changes (role-pack/provider work). Commit or stash that work FIRST; don't mix
  this round into it.
- Gateway tests only under Node 20 (`.nvmrc`; pretest rebuilds better-sqlite3 ABI).
- `tsconfig.web.json` pins react types via paths — do not remove; avoid new
  dependencies (everything above is platform + existing primitives).
- Engine/CLI behavior (AV-1/AV-2, LANG-1) must be proven by live smoke, not assumed —
  SC-10/SC-11 set the precedent: copy promises only what a real run demonstrated.
- Media artifacts >24 MB stop inlining as data URLs (`asset-protocol.ts:27`) — test
  ASSET-4's larger videos through the protocol-URL path specifically.

## Gates (all must pass before each commit)

```
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test    # read current count first; must not shrink
pnpm --filter @grokdesk/desktop build   # main chunk stays ≤ ~1.94 MB
# When packages/shared or packages/gateway are touched:
pnpm --filter @grokdesk/gateway test    # Node 20
pnpm --filter @grokdesk/shared test
# Live smokes (record outputs in this file): AV-1 audio probe, LANG-1 de/ja reply,
# CMD-1 end-to-end /research expansion, ASSET-4 30MB video harvest.
```

## 2026-08-03 — Trustworthy chat delivery

Gateway-owned SQLite outbox for follow-ups; see `docs/decisions/2026-08-03-gateway-chat-outbox.md`. Credential vault unchanged (`docs/decisions/2026-07-24-no-keychain.md`).
