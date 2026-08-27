# Grok Desk — Upstream Sync & Flagship Experience Program

**Date:** 2026-08-27
**Inputs:** four deep investigations run this day — (1) desktop renderer/UX audit, (2) packages engine-integration audit, (3) docs/backlog consolidation, (4) grok-build upstream delta `c68e39f` (2026-07-16) → HEAD (2026-08-27, CLI 1.0.10).
**North star:** the best-value desktop app for SuperGrok — chat and interactions first, clean and legible for **non-coding users**, honest about what it enforces.
**Hard constraints (do not violate):**
- Credential storage is untouchable: `createSafeStorageCredentialVault` only. Never Keychain / Credential Manager / keytar / `safeStorage` (see `docs/decisions/2026-07-24-no-keychain.md`, AGENTS.md).
- Status tracking: update `docs/evidence/claim-to-test-matrix.md` rows with evidence links — checkboxes alone are not completion (DOC-01).
- Upstream constraint: requesting any non-`off` sandbox profile forces an in-process agent (leader mode refused). Pick one launch model per session kind and state it in Settings.

---

## Executive summary

Three findings dominate everything else:

1. **The production-default engine path (ACP) silently lost the product's scaffolding.** `engine-grok` (headless) owns isolated `GROK_HOME`, MCP injection, skills install, media promotion, prompt shaping, and budgets — none of which run under `provider-grok` ACP, which is now the default. Worse, the protection chip *claims* profile isolation that the ACP factory never applies (`envWithGrokPath(process.env)`, no `GROK_HOME` set). This is a correctness + honesty P0.
2. **Upstream moved massively in our favor.** Since July, `grok agent stdio` gained a complete desktop-host protocol: `SessionStatus` (live model/context/cost/turn header, zero polling), `TurnCompleted` + `x.ai/runningPromptId` (correct reattach), `session/resume`/`session/close`, `x.ai/session/usage`, `PendingInteraction`/`InteractionResolved` (one "needs you" signal for permissions, questions, plan approval, MCP elicitation), workflows with `WorkflowUpdated`, session roster + FTS5 search, client-registered hooks over ACP, fuzzy file search, and per-client remembered permission grants. Headless `-p` remains structurally blind to permissions/subagents/status — ACP is the only path with product-grade fidelity. Meanwhile Desk pins `x-grok-client-version: 0.2.93` against a 1.0.x CLI and probes capabilities by substring-matching `--help`.
3. **A short list of user-visible chat bugs undermines the "trustworthy delivery" story.** Drag-and-drop of files is silently broken on Electron 43 (`File.path` removed; no `webUtils` bridge). Queued follow-ups are re-submitted with hardcoded defaults (wrong model, approval downgraded to balanced, skills/MCP dropped). "Revert file" doesn't revert. The in-conversation composer can't change model/approval/plan-first. Five native `window.confirm()` dialogs remain.

The program below is five phases. Phase 0 is bug-fix honesty; Phase 1 is protocol adoption; Phases 2–3 are the chat/interaction and non-coder experience payoff; Phase 4 is trust + release engineering. Each task lists anchor files and acceptance criteria.

---

## Phase 0 — Make the default path true (P0 correctness, ~1 week)

### 0.1 ACP environment parity (the big one) ✅ (2026-08-27; unit + live-CLI presence probe)
The ACP factory must provide the same controlled environment as headless.
- `packages/gateway/src/services/acp-transport-factory.ts`: stop using deprecated `findGrokBinary()` + `envWithGrokPath(process.env)`. Use `resolveManagedGrokBinary` (same discipline as headless) and set `GROK_HOME` to the isolated home unless `inheritUserConfig` is true — mirroring `packages/engine-grok/src/session.ts:406`.
- `packages/provider-grok/src/acp-session.ts` `start()`: pass Desk's `mcpServers` param on `session/new` (the param exists in `acp-jsonrpc.ts:322-328` and is never used). Source it from `desk-mcp-planes.ts` output.
- Install skills into the isolated home before session start (reuse `installSkillsIntoGrokHome` from `packages/shared/src/mcp-config-write.ts`; today call sites are headless-only, `session.ts:462,472`).
- Media: port `promoteSessionMediaToWorkspace` (`packages/engine-grok/src/session-media.ts`) to the ACP session teardown, or prove with a live fixture that the ACP `tool_call` artifact path covers `image_gen`/`video_gen` outputs end-to-end and promote from tool-call locations.
- Prompt shaping: apply `buildRunPrompt`/`classifyRunIntent` (currently `engine-grok/session.ts`-only) on the ACP path too.
- **Accept:** a run on the default path demonstrably (a) does not read the user's `~/.grok` hooks/plugins when isolation is on, (b) sees Desk's MCP servers and skills, (c) lands generated media in the workspace. Add a live-CLI integration fixture; update the protection-chip test so `isolateGrokHome` in the chip is derived from the actual spawn env (extend `projectAcpProtection` to take the real env).

### 0.2 Queued follow-ups must carry the user's settings
- `packages/gateway/src/services/outbox-drain.ts`: follow-up task input hardcodes `model: "grok-4.5", effort: "normal", approvalMode: "balanced", workspaceRoots: [], skills: [], mcpServerIds: []`. Persist the conversation's effective settings on the outbox row (or read the root task) and reuse them. The approval-mode downgrade is a policy bug: a strict-mode user's queued message currently runs balanced.
- `createFollowUp` in `packages/gateway/src/index.ts` always returns `kind: "fresh"` — wire continuation via the persisted `providerSessionId` (see 1.3).
- **Accept:** unit test — queue a message with model X / strict / skills S while a run is live; drained task carries X/strict/S. E2E: settings visible on the drained turn.

### 0.3 Real session continuity on ACP
- `packages/provider-grok/src/provider.ts:159-200` fakes resume by overwriting `providerSessionId` on a fresh `session/new`. Replace with feature-detected `session/resume` (capability `sessionCapabilities.resume` from `initialize`) falling back to `session/load`, then fresh-with-context as last resort — and *say which happened* in a `run_progress` event.
- Honor `session/load`'s `_meta["x.ai/runningPromptId"]` and the `TurnCompleted` update so a reattaching client can finalize a turn it didn't watch.
- Call `session/close` on conversation close / app quit (idempotent upstream).
- **Accept:** kill the app mid-run, relaunch → conversation resumes (or finalizes from `TurnCompleted`) instead of `interrupted_on_restart` failure. Crash-recovery (`crash-recovery.ts`) tries resume before marking failed.

### 0.4 Fix drag & drop (silent data loss)
- `apps/desktop/src/renderer/lib/follow-up-submit.ts:38` reads `File.path`, removed in Electron 32; app is on 43. Expose `webUtils.getPathForFile` via `src/preload/index.ts` and use it in `filePathsFromDropFiles`. Both drop sites affected (`task-workspace-view.tsx:2504`, `home-view.tsx:1156`).
- **Accept:** real Playwright e2e that drops a file and asserts the attachment chip appears.

### 0.5 "Revert file" must revert or must not exist
- `task-workspace-view.tsx:2152-2183` — `onUndoFile` only mutates the local view and opens the file manager. Either implement per-file restore via file snapshots (coworker plan Phase E: `file_snapshots` table + `workspace.revertFile`) or rename the action to "Reveal" and keep only "Undo turn". Note upstream `/rewind` is now **conversation-only** — copy must say "rewind conversation", never imply file restore it doesn't do.
- **Accept:** clicking the action does exactly what its label says; regression test.

### 0.6 Native dialogs → owned AlertDialog
- Replace 5 `window.confirm()` sites (`App.tsx:1414,1417,2479`; `task-workspace-view.tsx:1843,2102`) with the owned AlertDialog; the undo-turn dialog renders its file list as a real list.

### 0.7 Version-assumption sweep
- Unpin `x-grok-client-version: "0.2.93"` (`billing-client.ts:197`, `stt-client.ts:240`) — report the actual managed CLI version.
- Deduplicate the three drifting `clientInfo {name:"grok-desk", version:"0.1.2"}` literals (`acp-jsonrpc.ts:308`, `acp-session.ts:322`, `acp-transport.ts:240`) into one shared constant sourced from the app version; stamp `clientIdentifier`/`clientType`/`clientVersion` session `_meta` per upstream.
- Re-verify the logged-out heuristic in `auth-bridge.ts:155` against 1.0.x output.
- Fix stale docstrings that contradict behavior: `agent-provider-engine.ts` header ("default is headless" — false), `capabilities.ts:19` ("not yet implemented" on the live capability object).
- Manage the runtime: Desk's managed CLI should track latest (1.0.10+) with a minimum-version gate; surface "runtime updated" in Settings.

### 0.8 Small leaks and dead guards
- `packages/agent-runtime/src/permission-bridge.ts`: module-global waiter `Map` with no TTL — add timeout/cleanup so a missed exit path can't wedge a CLI permission request forever.
- Delete dead code: `probeAcpAvailable` / `AcpStdioSession` (gated on unused `GROKDESK_ACP=1`), no-op `assertSafeAgentProviderDefault`, deprecated binary-discovery trio once 0.1 lands; renderer dead stream path (`task-workspace-view.tsx:955` pins `density="chat"` — the legacy `StreamItemList` branch and `@tanstack/react-virtual` are unreachable), `subagent-hud.tsx` deprecated re-export.

---

## Phase 1 — Upstream protocol adoption (Tier 1, ~1–2 weeks)

### 1.1 Capability negotiation instead of substring probing ✅ (2026-08-27)
- Replace `packages/engine-grok/src/discover.ts:255-329` (three `String.includes` checks over `--help`; `supportsSandbox` true if the word "sandbox" appears anywhere) with an `initialize`-based capability read: `sessionCapabilities {close,list,resume}`, `_meta["x.ai/hooks"]` (blockingEvents/decisions/stopSignals), `_meta["x.ai/capabilities"]` (toolOverrides), `availableCommands`, `x.ai/statusLine` support, plus version from `agentVersion`. Keep the help-text probe only as a pre-spawn sanity check.
- Adopt the upstream forward-compat rule everywhere we decode: unknown `session/update` variants and unknown `ToolKind`s must decode to an `unknown`/`other` sink, never throw (mirror `#[serde(other)]`).
- **Accept:** capability table in the audit/protection snapshot comes from `initialize`, and a newer CLI with new event types cannot break an older Desk.

### 1.2 Live status header from `SessionStatus` ✅ (2026-08-27)
- Advertise `x.ai/statusLine` in `initialize` client capabilities (and `clientStatusLine` in session `_meta` under leader mode). Render the conversation header from the `SessionStatus` update: model display name, context gauge with `auto_compact_threshold_percent`, running cost (`total_cost_usd`), turn timer, branch/worktree. Payload is snake_case (`schema_version: 1`); absent values are `None`, never zero — render honestly ("—", not 0).
- This supersedes the 8s context-meter polling (`task-workspace-view.tsx:566-600`) on ACP; keep polling as headless fallback. Fixes the "meter hides when contextWindow unknown" gap (`components/context-meter.tsx`) with a degraded state.
- **Accept:** header updates live with zero polling on ACP; degraded-but-visible state on headless.

### 1.3 Turn finalization + cost truth
- Consume `TurnCompleted` (durable `{prompt_id, stop_reason, agent_result, usage, elapsed_ms}`) as the authoritative end-of-turn record; treat `stopReason` as snake_case tokens (`end_turn`, `max_tokens`, `max_turn_requests`, `refusal`, `cancelled`); include `cache_creation_input_tokens` in all usage math.
- Add `x.ai/session/usage` per-conversation cost/token panel (folds subagent spend; fails closed — never under-reports).
- Effort tiers: `packages/shared/src/policy-to-grok-flags.ts` maps heavy and max both → `high`. CLI now supports `xhigh` and `max`; map `heavy → high`, `max → max` (feature-detected), and expose the tier honestly in UI.

### 1.4 One "Waiting on you" signal
- Subscribe to `PendingInteraction` / `InteractionResolved` (`kind: permission | question | plan_approval | mcp_elicitation`). Drive from this one stream: the inbox badge, dock/tray badge, sidebar row state (`needs_input`), and OS notification. Delete per-surface heuristics.
- Handle `ask_user_question` and MCP elicitation (`x.ai/mcp/elicit`) as inline form cards in the conversation — the same friendly card pattern as approvals.
- **Accept:** every blocking state (permission, question, plan approval, connector form) surfaces in ≤1s in one consistent visual language, and clears on resolution.

### 1.5 Interject & queue coexistence
- Replace the three-method shotgun in `acp-session.ts` `interject()` with `x.ai/interject` using `content: ContentBlock[]` (text + images — interjections with screenshots become possible).
- Stamp Desk's `owner`/client id on all `x.ai/queue/*` calls so Desk coexists with the TUI/VS Code against a shared leader; adopt `hold_edit`/`release_edit` for queue-row editing.
- Send-now honesty on headless fallback: currently `outbox-dispatch.ts` `sendNow` can never succeed when `interject` returns `false` — disable the button with an explanatory tooltip in that state instead of failing silently.

### 1.6 Real subagent HUD
- Replace the speculative `worker_*`/`subagent_*` streaming-json mapping (`packages/engine-grok/src/events.ts`, no fixtures) with ACP `SubagentSpawned` / `SubagentProgress` / `SubagentFinished`; wire into the existing `WorkerStrip`. Add live fixtures.
- **Accept:** spawning a subagent in a live run shows a chip with real progress; no chips invented from `parentTaskId` heuristics.

---

## Phase 2 — Chat & interaction experience (~2 weeks)

### 2.1 Composer parity in-conversation
- Bring model, approval mode, plan-first, and role pack into the follow-up composer (today effort-only, `task-workspace-view.tsx:2633-2692`); reuse the Home advanced popover (`home-view.tsx:1546-1650`). Model list from `x.ai/models/list` (live catalog), not the hardcoded `grok-4.5` defaults (`models-list.ts:12`, `scheduler.ts:159`).
- Mid-conversation changes apply to the *next* turn and say so ("Next reply will use Grok 4.5 · heavy").

### 2.2 Tool-call rendering by kind (non-coder legibility)
Upstream `ToolKind` is now rich enough to drive renderers without name matching:
- `edit`/`write` → filename-first diff card (port `xai-grok-pager-diff` line-tagging logic to TS; input shape is what arrives in `tool_call_update.rawOutput`). Collapsed by default with a one-line plain-language summary ("Updated launch-brief.md — 12 lines changed").
- `execute` → command card with friendly title, collapsed output.
- `task`/`active_agent_message` → subagent card. `web_search`/`web_fetch` → citation cards (already exist). `image_gen`/`video_gen`/`image_to_video`/`reference_to_video` → media card + lightbox. `ask_user` → inline form (1.4). `plan` → plan card (exists).
- Everything defaults to a calm one-line summary; "show details" reveals raw. Non-coders should never see a raw JSON envelope (the quarantine work from 2026-08-05 holds; this is the presentation layer on top).

### 2.3 Conversation navigation for long runs
- Timeline rail (upstream `/jump`+`/timeline` concept): clickable tick rail of turns on the right edge of the stream; "back to start of answer" arrow on long replies. Reintroduce virtualization for long conversations (it was removed with the dead stream path — nothing virtualizes today).

### 2.4 Compaction as a calm, legible event
- Surface `auto_compact_started/completed/failed` as a friendly inline marker ("Tidied up earlier conversation to keep going — nothing is lost"). Optional "view what was summarized" backed by the compaction transcript segments (upstream `xai-compaction-transcript`, `compaction/INDEX.md`).

### 2.5 Goal & progress binding
- Consume `GoalUpdated` → objective/progress line in the conversation header and tray tooltip (`lib/goal-progress.ts` exists; bind it to real events). "Send now" during goals works upstream since 1.0.1 — verify.

### 2.6 Interaction polish sweep
- i18n leaks: mermaid chrome (`components/ui/mermaid-block.tsx:56-72`) and both OS-notification bodies (`src/main/index.ts:675,991`) through the catalogs.
- `shortcuts-help.tsx`: platform-aware modifier glyphs; add Esc-to-stop and queue Cmd+Enter entries.
- Light theme + system-follow (app is dark-only; DESIGN.md tokens make this tractable — define the light palette on the token layer, keep dark as the crafted default).
- Slash surface expansion in `packages/shared/src/command-registry.ts` (today: brief/research/image/video/schedule only). Add product-language commands mapped to real RPCs: "Summarize so far" (`compact`), "Undo last turn" (rewind), "Remember this" (memory), "Watch this until…" (monitor, Phase 3), "Deep research" (workflows, Phase 3). Non-coders get these as palette/menu actions, not just slash.

### 2.7 Test engineering for the chat surface (enables everything above)
- Switch component tests to jsdom + Testing Library (today `vitest.config.ts` is `environment: "node"`; 16 files assert on `renderToStaticMarkup` strings — zero interaction coverage on approve/send-now/edit-turn/slash menu). **Started 2026-08-27:** jsdom is limited to `*.interaction.test.tsx`.
- Convert the three grep-only "e2e" specs (`chat-delivery`, `chat-recovery`, `chat-approvals`) into real Playwright journeys on the fake provider: queue+interject, retry-on-failed, missing-attachment repick, drag-drop, undo turn, compact. ✅ (2026-08-27; `pnpm --filter @grokdesk/desktop e2e:chat` 11 passed ×2)
- Un-soft-skip `visual-qa` (it currently exits 0 with "1 skipped"); run full `pnpm test` in the release gate.

---

## Phase 3 — Non-coder value: new surfaces (~2–3 weeks)

### 3.1 Deep Research & Workflows — "a team working for you"
- Wire `/deep-research` and `/workflow` (agent-side builtins, gated by `WorkflowLaunches`/`WorkflowManagement`) with a run panel driven entirely by `WorkflowUpdated`: objective, phases with the active one highlighted, per-agent rows, budget gauge (`agents_used/reserved/remaining`), pause/resume/stop. The payload already carries everything — this is a rendering task, and it is the single most "wow" non-coder feature available.
- Home gets a "Research deeply" recipe tile that maps to it.

### 3.2 Media studio
- Surface upstream video-gen upgrades: preset voices, single-image input, 1–15s durations, 4:3/3:4 aspect ratios; call-count limits are handled upstream. Image/video generation gets a first-class Home tile and composer affordance ("Create an image/video…"), with results auto-saved to the workspace + Artifacts (Phase 0.1 media parity makes this reliable on the default path).

### 3.3 Memory that compounds (the 4×-deferred recap)
- One-tap "Remember this" on any answer; weekly recap card ("Learn from this week") per coworker plan C1–C3 (`weekly-recap.ts`, `"recap"` InboxKind).
- Bridge to engine memory where it helps: `x.ai/memory/flush` / `x.ai/memory/rewrite` exist over ACP; keep Desk's store authoritative, present engine memory events (`Memory*` updates) as takeaway suggestions. Present recalled memory as historical context to verify (upstream 1.0.9 language).

### 3.4 Conversations you can find and trust
- Global search over past conversations via `x.ai/session/search` (FTS5; show `bootstrapping` as "still indexing"; default `headless: "exclude"`).
- Sidebar upgraded with roster semantics: `x.ai/sessions/list` + `sessions/changed`, two-line rows with `lastTurnSummary`, activity states (`working / idle / needs_input / dormant / completed`), pin + rename (with `resetToAuto` unpin), delete with confirmation.
- "Continue from elsewhere": foreign-session import (Claude Code / Codex / Cursor) via the `xai-grok-foreign-sessions` data (read-only, metadata-only; not exposed over ACP — read from disk with the same caps). Strong onboarding magnet.

### 3.5 Watch-until & schedules refresh
- Monitor tool + `MonitorEvent` → "Watch this until…" task mode (parity C6); `/loop`-style recurring in-conversation checks bridged to Desk's scheduler (C7); `ScheduledTask{Created,Fired,Deleted}` events reconcile the Schedules view with engine-created schedules. Morning-brief strip (coworker B1–B3) turns overnight schedule outcomes into a Home digest.

### 3.6 Onboarding & explainability for non-coders
- Guided tour modeled on upstream `/tutorial` (nine-topic opt-in): 5-scene Desk version — what approvals are, where files land, how to queue follow-ups, what memory does, where to change trust.
- Fix the two worst first-run bugs from the July audit if still present: fresh signed-out state rendering as "session expired" (`getGrokAuthStatus` sets `needsReauth = !signedIn`) and sign-out deleting `~/.grok/auth.json` (kills the user's CLI session outside the app — scope sign-out to Desk).
- "What's new" surface: render Desk release notes + relevant runtime release notes in-app (upstream ships per-version changelog md/json we can reuse).
- Plain-language error banners: adopt upstream's 429/limit specificity (capacity vs team limit vs free-usage) instead of generic failures; API errors as clean banners, never raw JSON.

---

## Phase 4 — Trust, enforcement & release (~1–2 weeks, partly owner-gated)

### 4.1 Finish coworker Phase A (A3–A6)
- A3 effective-protection snapshot per run (now derivable from the real spawn env after 0.1); A4 fail-closed sandbox for Autopilot (`requireSandboxForAutopilot`); A5 remembered permission grants — align with upstream `remember_tool_approvals` (on by default, repo-root-scoped `permission_<client>.toml`): Desk writes to its **own client file**, and the audit drawer shows grants with revoke. A6 verification gate updates `claim-to-test-matrix.md`.
- Client hooks over ACP as the enforcement upgrade path: register PreToolUse (with `updatedInput` rewriting) and Stop gates from the gateway — this is the first real mechanism to make gateway policy *binding* on a CLI that executes its own tools. Read `initialize._meta["x.ai/hooks"]` first; only `deny` blocks, everything else fails open — design accordingly.

### 4.2 Honesty closure
- Site claims O-005 (keychain), O-006 (deletes always ask — false under Autopilot), O-007 (memory locality): ship the corrected copy and redeploy grokdesk.app.
- Retire the five zero-checkbox plans in favor of matrix rows; mark the four-times-deferred items as scheduled here.

### 4.3 Release completion
- readme-v1 Tasks 7–8 (history rewrite, tag, GitHub release, installers + SHA256SUMS) — everything upstream of publish is done.
- O-001 signing/notarization; opt-in crash telemetry (none exists today); bundle split I21 (entry is ~2.5MB vs 2.2MB target — lazy-split Home/Workspace/stream); begin `App.tsx` decomposition (90KB, ~60 useState, no router) with a nav/route module + task-selection store so Phases 2–3 don't widen the prop cone.

---

## Sequencing & effort

| Phase | Duration | Parallelizable? |
|---|---|---|
| 0 Correctness | ~1 wk | 0.4–0.8 parallel with 0.1–0.3 |
| 1 Protocol | ~1–2 wk | 1.2/1.3/1.4 independent after 1.1 |
| 2 Chat UX | ~2 wk | 2.7 starts day one alongside Phase 0 |
| 3 New surfaces | ~2–3 wk | 3.1/3.2/3.4 independent |
| 4 Trust/release | ~1–2 wk | 4.2/4.3 partly owner-gated (secrets, site deploy) |

Suggested order of *impact for non-coders*: 0.4 (drag-drop) → 1.2 (live header) → 1.4 (one "waiting on you") → 2.1 (composer parity) → 2.2 (legible tool cards) → 3.1 (deep research) → 3.2 (media) → 3.3 (memory recap).

## Success criteria
- Default-path run provably isolated + fully provisioned (0.1 fixture green).
- Zero silent failures in the attach/queue/settings pipeline (0.2, 0.4 tests green).
- A non-coder can: change model mid-conversation, approve/answer everything from one inbox, watch a deep-research run with live progress, generate media that lands in their folder, search old conversations, and read every error in plain language.
- `claim-to-test-matrix.md` rows updated for every claim this program touches.
