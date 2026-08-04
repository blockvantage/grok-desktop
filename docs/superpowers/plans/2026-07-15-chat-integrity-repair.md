# Chat Integrity Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make chat histories isolated, deduplicated, correctly sequenced, honest about queued work, recoverable when queue pumping is missed, and complete across all conversation artifacts.

**Architecture:** Restore the full `TaskEvent` contract at the gateway boundary, then make the renderer defensive by validating and merging events per task and serializing fetches. Treat queued and running as distinct presentation states, periodically re-pump durable queued work, key the workspace by conversation, and aggregate deliverables across the whole thread.

**Tech Stack:** TypeScript, React, Electron, Vitest, pnpm, SQLite-backed gateway.

---

### Task 1: Restore the gateway event identity contract

**Files:**
- Modify: `packages/gateway/src/services/gateway-domain-deps.test.ts`
- Modify: `packages/gateway/src/services/gateway-domain-deps.ts`
- Modify: `packages/gateway/src/services/events-export-dispatch.ts`
- Modify: `packages/gateway/src/services/events-export-dispatch.test.ts`

- [x] Add a failing domain-dispatch test whose event includes `id`, `taskId`, and `seq`, and assert those fields survive `events.list`.
- [x] Run `pnpm --filter @grokdesk/gateway test -- gateway-domain-deps.test.ts events-export-dispatch.test.ts` and confirm the identity assertion fails.
- [x] Type the event export boundary as full `TaskEvent` objects and return `g.tasks.listEvents(taskId, afterSeq)` without lossy mapping.
- [x] Re-run the focused gateway tests and confirm they pass.

### Task 2: Make renderer event ingestion isolated and idempotent

**Files:**
- Modify: `apps/desktop/src/renderer/lib/chat-events-cache.test.ts`
- Modify: `apps/desktop/src/renderer/lib/chat-events-cache.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-chat-events.ts`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Add failing tests proving malformed/cross-task events are rejected and duplicate `(taskId, seq)` events are merged once in sequence order.
- [x] Add a failing structure assertion that the task workspace is keyed by conversation id.
- [x] Run the focused desktop tests and confirm the new assertions fail for the intended reasons.
- [x] Implement `mergeTurnEvents`, event validation, sequence calculation, and per-turn in-flight fetch serialization in the cache/hook.
- [x] Capture the selected turn set per effect rather than sharing a mutable turns ref across chat subscriptions.
- [x] Key `TaskWorkspaceView` by the selected chat root so stateful stream rows cannot survive a conversation switch.
- [x] Re-run the focused desktop tests and confirm they pass.

### Task 3: Present queued work truthfully

**Files:**
- Modify: `apps/desktop/src/renderer/lib/event-status.test.ts`
- Modify: `apps/desktop/src/renderer/lib/event-status.ts`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/de.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/es.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/fr.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/ja.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/pt.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh.json`

- [x] Add failing tests proving only `running` is actively working and queued empty-state copy is non-spinning and explicitly queued.
- [x] Run the event-status tests and confirm the new assertions fail.
- [x] Use the status helper in `TaskStream`, keep the working animation exclusive to running work, and add localized queued waiting copy.
- [x] Re-run event-status and stream tests and confirm they pass.

### Task 4: Recover stranded durable queue items

**Files:**
- Create: `packages/gateway/src/services/queue-watchdog.test.ts`
- Create: `packages/gateway/src/services/queue-watchdog.ts`
- Modify: `packages/gateway/src/index.ts`

- [x] Add a failing test for a watchdog that pumps immediately, pumps periodically, swallows/reports transient pump failures, and stops cleanly.
- [x] Run the watchdog test and confirm it fails because the implementation is absent.
- [x] Implement the watchdog and wire it into gateway start/stop around `runner.pumpQueue()`.
- [x] Re-run watchdog, concurrency, crash-recovery, and runner queue tests.

### Task 5: Keep deliverables connected across the conversation

**Files:**
- Modify: `apps/desktop/src/renderer/lib/task-workspace-meta.test.ts`
- Modify: `apps/desktop/src/renderer/lib/task-workspace-meta.ts`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`

- [x] Add a failing test for filtering artifacts by all task IDs in a chat thread.
- [x] Run the focused test and confirm it fails.
- [x] Implement thread-wide artifact filtering and use it in the workspace rail.
- [x] Re-run the focused test and confirm it passes.

### Task 6: Verify the complete repair

**Files:**
- Verify all modified source and test files.

- [x] Run `git diff --check` and resolve only whitespace introduced by this implementation.
- [x] Run all focused gateway and desktop regression tests.
- [x] Run `pnpm typecheck` and the full monorepo test suite.
- [x] Build the signed macOS package with `pnpm --filter @grokdesk/desktop dist:mac`.
- [x] Verify the signature and launch the packaged app.
- [x] Inspect the live app while switching Panda, Payverge, and Cuban chats; confirm each header renders only its own database-backed conversation and queued work no longer claims to be thinking.
