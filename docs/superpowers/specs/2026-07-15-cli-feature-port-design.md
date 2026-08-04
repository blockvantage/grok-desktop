# CLI Feature Port — Wave "Sticky + Magic" Design

**Date:** 2026-07-15
**Status:** Implemented on main (2026-07-17) — Tasks 1–14 + 16; Task 15 weekly recap deferred
**Source:** [xai-org/grok-build](https://github.com/xai-org/grok-build) (open-sourced Grok CLI), catalogued in `to_add.md`
**Sequencing:** Implementation starts after the conversation-orchestration work (`docs/superpowers/plans/2026-07-15-conversation-orchestration.md`) lands.

## 1. Summary

Grok Build is now open source. `to_add.md` catalogues 58 of its capabilities we could port into Grok Desk. This spec selects 15 of them (one as a minimal slice, one as a cuttable stretch) and defines their product shape.

Selection criteria, in order:

1. Helps users day to day
2. Adds little or no UI surface
3. Increases how much users return to the app

Chosen lens (user decision): **daily-driver stickiness + Grok magic showcase**. Trust items (sandbox, full permission rules) are deferred except where they are prerequisites.

## 2. Key technical finding

The headless engine path (`grok -p --output-format streaming-json`) emits only `text`, `thought`, `end`, and `error` events — no tool calls, no plan, no subagent lifecycle. The ACP path (`grok agent stdio`) streams `tool_call`, `tool_call_update`, `plan`, and `request_permission`.

Consequence: most user-visible features in this wave depend on making ACP the default engine path. Phase A therefore leads with ACP, and everything downstream arrives whole instead of degraded.

## 3. Phase A — Invisible reliability

Net-new UI: zero.

### A1. ACP as default engine path (to_add #3)

- When `probeGrokCli()` detects `agent stdio` support, new tasks run over ACP. Headless spawn remains the automatic fallback, decided per task — one flaky ACP session must not degrade the app.
- The gateway acts as permission broker: `session/request_permission` requests flow into the existing parked-approval pipeline (`runner.ts` → `pending-approvals.ts`), so approvals keep today's UI.
- One env flag forces headless for rollback.

### A2. Session resume / continue (to_add #4)

- Persist the engine session id on every Desk task: the ACP session id, or the `sessionId` field on the headless `end` event.
- Follow-up messages resume the session (ACP prompt, or `-r/--resume` on headless) instead of respawning with a reconstructed transcript.
- On gateway crash or restart, attempt resume first; reconstruct the transcript only if resume errors.
- This is the largest cost-and-latency win in the wave.

### A3. Sleep/wake token safety (to_add #9)

- Electron main subscribes to `powerMonitor` suspend/resume.
- On suspend: freeze token-refresh timers and scheduler dispatch.
- On resume: refresh auth before releasing any queued run.
- Kills the "closed laptop → reauth wall + failed scheduled runs" failure mode.

### A4. Effort and model honesty (to_add #21, #22)

- Expand `policy-to-grok-flags.ts` to the CLI's full canonical effort set (`none` → `max`); keep Desk's simple UI labels mapped onto it.
- Model picker populates from the live models endpoint, with the current hard-coded list as offline fallback. Existing UI, new data source.

### A5. Permission-mode semantics fix (to_add #2, minimal slice)

- `strict` approval mode stops mapping to `--permission-mode plan` (wrong semantics — plan mode is about to mean something real).
- Replace with default mode plus explicit `--allow`/`--deny` rules on headless, or broker-mediated permissions on ACP.
- The rest of the permission-rules work (fail-closed compilation, remembered grants) stays deferred.

## 4. Phase B — Sticky daily UX

All four features render inside the orchestration substrate (calm stream, live-work card, approval surface). Net-new UI: one composer toggle, one thin meter, one per-turn menu item.

### B1. "Draft a plan first" — plan mode (to_add #5)

- One toggle in the new-task composer, off by default.
- The plan streams in via ACP `plan` updates and renders as a plan card with **Approve / Request changes / Run anyway**, reusing the approval surface.
- A plan awaiting approval is a "waiting on you" state: it feeds the inbox and tray like any approval.

### B2. "Nudge while working" — interjection (to_add #6)

- The composer stays enabled during a run. A message sent mid-run is delivered as an interjection (`/btw` semantics) instead of killing the run or queueing behind it.
- The stream shows it as a small "noted while working" entry attached to the current turn.
- Degrades gracefully: headless-fallback tasks keep today's queue behavior.

### B3. Context meter + "summarize so far" (to_add #8)

- A thin context-usage indicator in the workspace bottom chrome, near the model/effort controls. Visible only when a task is running or resumable.
- Past a threshold, one suggestion chip appears: "Long conversation — summarize so far?" It triggers `/compact` with preserve rules.

### B4. "Undo last turn" — rewind (to_add #15)

- A per-turn overflow-menu action, shown only when the capability probe confirms rewind support.
- A confirmation dialog lists the files that will be restored (fs/git domains) before the conversation truncates back.
- Complements the in-flight edit-and-rerun: edit means "try again differently"; undo means "that never happened".

## 5. Phase C — Grok magic

### C1. Imagine images, then video (to_add #11, #12)

- No new input UI — users just ask. The agent's `image_gen` / `image_edit` / `image_to_video` tool calls stream as ACP tool events.
- Outputs are harvested into the existing artifacts gallery, shown inline in the answer (lightbox for video), and auto-saved into the task's workspace folder.
- Ship images first; video reuses the pipeline plus a player.

### C2. Web/X search citation cards (to_add #13)

- When a run used `web_search` / `x_search`, the answer footer shows compact source cards: favicon, title, domain. Maximum 4 visible; the rest collapse behind "+k sources". X results get X-styled treatment.
- The most Grok-differentiating item in the wave; rides entirely on ACP tool events.

### C3. Mermaid diagrams in-thread (to_add #20)

- Detect mermaid code fences in assistant output and render them inline with a bundled JS renderer in the renderer process (no need for the CLI's Rust crate), with a "view source" toggle.
- Zero input-side UI; plans and architectures start arriving as diagrams.

### C4. Memory "weekly recap" — stretch, cuttable (to_add #14)

- Reframe the CLI's `/dream` onto Desk's own memory store: a weekly scheduled task summarizes what the app learned (projects touched, preferences observed) into an inbox item with accept/edit controls per memory.
- Reuses the scheduler and inbox wholesale. Cut first if the wave runs long.

## 6. Deferred this wave (not rejected)

| Item | Reason |
|------|--------|
| Sandbox profiles, full permission rules, folder trust | Trust bucket; revisit before pushing autopilot/scheduled use |
| Skills platform, marketplace, hooks, create-skill | Ecosystem surface; needs its own design pass |
| Monitor / loop / in-engine scheduler tools, dashboard IA | Desk already has a scheduler; "watch until done" deserves a separate task-mode design |
| Fork session | In-flight edit-and-rerun covers the daily need |
| Goal mode, subagent HUD | Absorbed by the conversation-orchestration work |
| Pure API agent path (P5) | Long-term architectural bet; separate conversation |

## 7. Dependencies and sequencing

1. Conversation-orchestration work lands first (already decided).
2. Phase A next — ACP and resume unblock everything else.
3. Phases B and C then proceed in parallel: B is engine/UX work, C is mostly rendering.

## 8. Risks

| Risk | Mitigation |
|------|------------|
| ACP protocol instability | Per-task headless fallback; contract tests against a pinned CLI version; rollback env flag |
| Rewind semantics in git repos with uncommitted user changes | Capability-gating; file-list confirmation dialog before restore |
| Media artifact size (video) | Cap inline previews; artifacts gallery already handles large files |

## 9. Success signals

- Follow-up messages reuse sessions: engine spawn count per task drops.
- Zero post-sleep reauth failures in dogfood.
- Share of tasks started with "Draft a plan first".
- Interjections sent per active user.
- Media artifacts created per week.
- Session length after citation cards ship.

## 10. References

- Catalog: `to_add.md` (repo root)
- CLI clone: `/tmp/grok-build`; user guide at `crates/codegen/xai-grok-pager/docs/user-guide/`
- Product spec: `docs/superpowers/specs/2026-07-10-grok-desk-design.md`
- Orchestration design: `docs/superpowers/specs/2026-07-15-conversation-orchestration-design.md`
- Engine adapter: `packages/engine-grok/`; ACP provider: `packages/provider-grok/`
- Policy flags: `packages/shared/src/policy-to-grok-flags.ts`
