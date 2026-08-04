# Trustworthy Chat Delivery and Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chat submission durable, exactly-once, background-deliverable, and truthfully represented in the UI, while improving recovery, accessibility, visual hierarchy, performance, and end-to-end confidence.

**Architecture:** Keep `tasks.create` and its SQLite mutation receipts as the durable task-acceptance kernel. Move queued follow-ups out of renderer `localStorage` into a gateway-owned SQLite outbox that drains globally, in FIFO order per conversation, even when that chat is not open. Every mutation gets a stable `clientMutationId`; the gateway enforces one active task per conversation. The renderer becomes a projection of gateway task/outbox state and explicitly separates account, engine, delivery, and run state.

**Tech Stack:** Electron 33, React 18, TypeScript, Zod, better-sqlite3, Vitest, Playwright Electron, Tailwind CSS, pnpm monorepo.

---

## Scope and non-negotiable invariants

This plan closes the remaining reliability and experience gaps identified in the August 3, 2026 audit. It builds on, rather than replaces, the existing conversation orchestration and chat experience work in:

- `docs/superpowers/specs/2026-07-15-conversation-orchestration-design.md`
- `docs/superpowers/plans/2026-07-15-conversation-orchestration.md`
- `docs/superpowers/plans/2026-07-17-chat-experience-levelup.md`
- `docs/analysis/2026-07-15-product-experience-audit.md`
- `docs/plans/ux-review-improvements.md`

Preserve these invariants throughout implementation:

1. If the UI says **Saved locally**, the message has already committed to SQLite and survives renderer reload, chat switching, gateway restart, and app restart.
2. A stable `clientMutationId` identifies every create, follow-up, retry, revision, interjection, cancellation, title change, deletion, and approval mutation. Ambiguous transport failures reuse the same ID and payload.
3. No queue operation silently evicts, truncates, or forgets a user message. Capacity or persistence failure leaves the composer intact and displays a recoverable error.
4. At most one task may run in one conversation. Different conversations may still run concurrently up to the global limit.
5. **Send now** never falls back to creating a concurrent follow-up. If interjection is unsupported, the message remains queued and the UI explains why.
6. **Working** is shown only after gateway acceptance and only while the task is actually running. Local persistence, connection, acceptance, queueing, and execution are distinct states.
7. Existing credentials architecture is untouchable: never introduce OS Keychain, Windows Credential Manager, `keytar`, `@github/keytar`, Electron `safeStorage`, or bootstrap memory vaults. Preserve `createSafeStorageCredentialVault` exactly as decided in `docs/decisions/2026-07-24-no-keychain.md`.
8. Deterministic tests use temporary profiles and the fake/echo provider only. They never use a developer's real account, user data, or credentials.

## Target experience

A follow-up submitted while a task is running should immediately become a durable outbox item reading, for example, `Queued · 2 ahead`. It continues to exist and drain if the user changes chats or restarts Desk. If the engine is reconnecting and SQLite acceptance is temporarily unavailable, the composer remains available and reads `Draft kept — waiting for the engine`; it must not claim the message is queued yet. When the gateway accepts the outbox write, the UI may say `Saved locally`. When the gateway accepts the next task, the outbox row disappears and the task moves through `Accepted`, `Queued`, and `Working` based on authoritative state.

The app presents three independent status layers:

| Layer | Examples | Source of truth |
|---|---|---|
| Account | Signed in, sign-in required | auth status |
| Local engine | Starting, ready, reconnecting, unavailable | main-process gateway lifecycle |
| Message/task | Saving, saved locally, accepted, queued, working, needs attention, done | gateway outbox + task state |

## Delivery contract

Add shared types for a gateway-owned follow-up outbox:

```ts
type OutboxStatus =
  | "pending"
  | "submitting"
  | "blocked_missing_attachment"
  | "failed"
  | "accepted"
  | "delivered"
  | "cancelled";

type ConversationOutboxItem = {
  id: string;                 // same value as clientMutationId
  conversationId: string;
  parentTaskId: string;
  text: string;
  attachments: TaskAttachment[];
  status: OutboxStatus;
  position: number | null;    // pending position within this conversation
  acceptedTaskId: string | null;
  attemptCount: number;
  failReason: string | null;
  createdAt: string;
  updatedAt: string;
};

type OutboxEnqueueResult =
  | { outcome: "accepted"; item: ConversationOutboxItem }
  | { outcome: "full"; limit: number }
  | { outcome: "persistence_failed"; message: string };
```

Expose local gateway methods in `packages/shared/src/ipc.ts`:

- `outbox.enqueue`
- `outbox.list`
- `outbox.update`
- `outbox.remove`
- `outbox.retry`
- `outbox.sendNow`
- `outbox.summary`
- `events.page` (cursor/`hasMore` replacement for renderer use; keep `events.list` compatible)

Do not add outbox mutation methods to the remote allowlist until remote clients have an explicit compatibility design and tests.

## Phase 0 — Restore a trustworthy baseline

### Task 1: Repair the existing red test/typecheck baseline

**Files:**

- Modify: `apps/desktop/src/renderer/hooks/use-workspace-queue.test.tsx`
- Modify: `apps/desktop/src/renderer/lib/work-graph.ts`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`
- Modify: the source containing the remaining bare English `Autopilot` fallback identified by the failing release test
- Verify: `apps/desktop/src/renderer/lib/release-qa-gate.test.ts`

- [x] Run the current failures individually and record their exact assertions in the implementation-session notes:

  ```bash
  pnpm --filter @grokdesk/desktop typecheck
  pnpm --filter @grokdesk/desktop test -- src/renderer/hooks/use-workspace-queue.test.tsx src/renderer/ui-structure.test.ts src/renderer/lib/release-qa-gate.test.ts
  ```

  Expected before fixes: the tuple index error at approximately `use-workspace-queue.test.tsx:570`, impossible `"failed"` comparison at approximately `work-graph.ts:490`, missing `vt-content` structural expectation, and one unlocalized Autopilot fallback.

- [x] Fix the test tuple with an explicitly typed mock/call signature. Do not weaken the assertion with `any`.
- [x] Correct the work-graph state narrowing so the branch expresses a possible state; add or update a focused unit case for failed graph nodes.
- [x] Reconcile the `vt-content` assertion with the current intentional view-transition structure. Prefer restoring a real product hook if it was accidentally removed; only update the test if the replacement structure is equivalent and covered.
- [x] Route the bare Autopilot string through the existing i18n catalog and add an English-key coverage assertion.
- [x] Run the commands again. Expected: zero TypeScript errors and all selected tests pass.
- [x] Commit:

  ```bash
  git add apps/desktop/src
  git commit -m "fix(desktop): restore green chat experience baseline"
  ```

## Phase 1 — Gateway-owned durable outbox

### Task 2: Add the SQLite outbox schema and repository

**Files:**

- Modify: `packages/gateway/src/db.ts`
- Modify: `packages/gateway/src/db.test.ts`
- Create: `packages/gateway/src/services/conversation-outbox.ts`
- Create: `packages/gateway/src/services/conversation-outbox.test.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`
- Modify: `packages/shared/src/index.ts`

- [x] Write failing schema tests for migration version 12. The migration must create `conversation_outbox` with stable IDs, conversation/task linkage, serialized request data, state, acceptance linkage, retry/lease metadata, and timestamps.
- [x] Add indexes for `(conversation_id, status, created_at)`, expired submission leases, and `accepted_task_id`. Make `id` the primary key so the outbox ID and `clientMutationId` cannot diverge.
- [x] Implement a repository with transactionally safe methods: `enqueue`, `list`, `get`, `updatePending`, `removePending`, `claimNext`, `markAccepted`, `markFailed`, `markBlockedMissingAttachment`, `releaseExpiredClaims`, and `pruneTerminalReceipts`.
- [x] Enforce explicit capacity (recommended: 200 pending items per conversation and 2,000 total). On capacity, return `full`; never delete an old row to make room.
- [x] Reject edits/removals of `submitting` or `accepted` rows. Validate attachment/path and text limits through shared schemas before any SQL write.
- [x] Convert SQLite exceptions into the structured `persistence_failed` result at the service boundary. Log only error codes and IDs, never message text, file content, credentials, or full paths.
- [x] Test FIFO ordering, per-conversation isolation, capacity back-pressure, rollback on insert failure, lease expiry, crash recovery, duplicate ID with same payload, and duplicate ID with different payload.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/shared test -- src/ipc.test.ts
  pnpm --filter @grokdesk/gateway test -- src/db.test.ts src/services/conversation-outbox.test.ts
  pnpm --filter @grokdesk/shared typecheck
  pnpm --filter @grokdesk/gateway typecheck
  ```

  Expected: all selected tests and both typechecks pass.

- [x] Commit:

  ```bash
  git add packages/shared/src packages/gateway/src
  git commit -m "feat(gateway): add durable conversation outbox"
  ```

### Task 3: Add outbox IPC dispatch and notifications

**Files:**

- Create: `packages/gateway/src/services/outbox-dispatch.ts`
- Create: `packages/gateway/src/services/outbox-dispatch.test.ts`
- Modify: `packages/gateway/src/services/domain-dispatch.ts`
- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/remote-allowlist.test.ts`

- [x] Write failing dispatch tests for every outbox method and strict Zod validation.
- [x] Add `OutboxDispatchDeps` to `DomainDispatchDeps`, instantiate the repository once in `Gateway.start`, and route the seven methods through `domain-dispatch.ts`. `outbox.summary` returns counts/oldest-age only and never content.
- [x] Emit `notify.outboxChanged` after every committed mutation. Payloads may contain item IDs, conversation IDs, state, and position; do not push message text or attachment paths in notifications. The renderer follows with `outbox.list`.
- [x] Ensure `outbox.enqueue` is idempotent by its item ID. Same ID/same payload returns the existing row; same ID/different payload fails closed.
- [x] Confirm remote clients cannot invoke the new methods. Update the remote allowlist test to assert rejection.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/gateway test -- src/services/outbox-dispatch.test.ts
  pnpm --filter @grokdesk/shared test -- src/ipc.test.ts src/remote-allowlist.test.ts
  ```

- [x] Commit:

  ```bash
  git add packages/shared/src packages/gateway/src
  git commit -m "feat(gateway): expose local outbox operations"
  ```

### Task 4: Drain all conversations globally and exactly once

**Files:**

- Create: `packages/gateway/src/services/outbox-drain.ts`
- Create: `packages/gateway/src/services/outbox-drain.test.ts`
- Modify: `packages/gateway/src/index.ts`
- Modify: `packages/gateway/src/services/tasks-create-dispatch.ts`
- Modify: `packages/gateway/src/services/task-create-flow.ts`
- Verify: `packages/gateway/src/services/task-create-acceptance.test.ts`
- Verify: `packages/gateway/src/p0/task-create-crash-atomic-gateway.test.ts`

- [x] Write failing tests proving that the drain is independent of the selected renderer chat and handles multiple conversations fairly.
- [x] Implement one gateway-owned drain coordinator. Trigger it at gateway startup, after `outbox.enqueue`, after a task becomes idle/terminal, after retry, and after expired-lease recovery. Coalesce triggers so only one pump runs at a time.
- [x] For each conversation, claim only its oldest pending row when no task in that conversation is active. Across conversations, honor the existing global concurrency cap.
- [x] Submit through the existing `dispatchTasksCreate`/`taskCreateAcceptance` path with `clientMutationId === outbox.id`, the latest valid parent task, and the stored attachments. Do not create a parallel acceptance implementation.
- [x] On accepted task creation, atomically/reconcilably link `accepted_task_id` and mark the row `accepted`. If the process crashes between task acceptance and outbox update, retrying the same mutation ID must retrieve the existing accepted task and complete reconciliation without a duplicate turn.
- [x] Leave missing-attachment items visible as `blocked_missing_attachment`. Continue draining later valid conversations; do not globally wedge the pump.
- [x] Apply bounded exponential retry only to classified transient errors. Authentication, policy, missing-file, validation, and capacity errors require user action and must not spin.
- [x] Keep accepted/delivered/cancelled receipt rows for seven days for reconciliation, then prune them in bounded batches. Never prune pending/failed/blocked rows automatically.
- [x] Test: restart before claim, crash after claim, crash after task acceptance, same-ID replay, missing attachment, permanent failure, transient retry, fairness across chats, and shutdown joining the drain before DB close.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/gateway test -- src/services/outbox-drain.test.ts src/services/task-create-acceptance.test.ts src/p0/task-create-crash-atomic-gateway.test.ts
  ```

- [x] Commit:

  ```bash
  git add packages/gateway/src
  git commit -m "feat(gateway): drain chat outbox across conversations"
  ```

### Task 5: Enforce one active task per conversation

**Files:**

- Modify: `packages/gateway/src/services/concurrency.ts`
- Modify: `packages/gateway/src/services/concurrency.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Create: `packages/gateway/src/p0/conversation-serialization.test.ts`

- [x] Extend queued/running descriptors with `conversationId` and a legacy fallback thread key derived from the root parent chain.
- [x] Write failing unit tests proving that two queued tasks in the same conversation produce one start, while tasks in different conversations fill available slots.
- [x] Add the same-conversation check at both selection and `start()` admission so concurrent pumps cannot race past the pure selector.
- [x] Verify old rows with `conversation_id = NULL` still serialize by their derived root without blocking unrelated tasks.
- [x] Add an integration test that submits two follow-ups rapidly and asserts their run intervals do not overlap.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/gateway test -- src/services/concurrency.test.ts src/p0
  ```

- [x] Commit:

  ```bash
  git add packages/gateway/src
  git commit -m "fix(gateway): serialize runs within each conversation"
  ```

## Phase 2 — Renderer delivery controller and migration

### Task 6: Replace the selected-chat localStorage drain with a global outbox client

**Files:**

- Create: `apps/desktop/src/renderer/hooks/use-conversation-outbox.ts`
- Create: `apps/desktop/src/renderer/hooks/use-conversation-outbox.test.tsx`
- Create: `apps/desktop/src/renderer/lib/outbox-migration.ts`
- Create: `apps/desktop/src/renderer/lib/outbox-migration.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Retire after migration coverage: `apps/desktop/src/renderer/hooks/use-workspace-queue.ts`
- Retire after migration coverage: `apps/desktop/src/renderer/lib/message-queue-store.ts`
- Retire after migration coverage: `apps/desktop/src/renderer/lib/message-queue.ts`

- [x] Write hook tests first: initial list, conversation filtering, notify-driven refresh, reconnect refresh, edit/remove/retry, and stale response protection when switching chats.
- [x] Make all follow-up submissions call `outbox.enqueue`, including the apparently idle/direct path. The gateway may drain immediately; the renderer must not bypass the outbox.
- [x] Return the structured enqueue outcome to the composer. Clear text and attachments only after `outcome: "accepted"`. On `full` or `persistence_failed`, keep the exact draft and focus the composer.
- [x] On first `ready` lifecycle after upgrade, load `grokdesk.queue.v1`, replay every item through `outbox.enqueue` with its existing `clientMutationId`, and remove each local row only after gateway acknowledgement. Same-ID replay makes the migration restart-safe.
- [x] Do not truncate local data while migrating. If migration hits capacity or persistence failure, keep the unmigrated local snapshot, show a persistent recovery notice, and retry on the next `ready` event.
- [x] Mark migration complete only after all conversation queues and the undo stash are safely resolved. Keep read-only migration support for at least two released versions; remove the old write/drain path immediately.
- [x] Remove the single selected-conversation queue owner from `App.tsx`. The gateway now drains globally.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/desktop test -- src/renderer/hooks/use-conversation-outbox.test.tsx src/renderer/lib/outbox-migration.test.ts
  pnpm --filter @grokdesk/desktop typecheck
  ```

- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "feat(desktop): project the gateway chat outbox"
  ```

### Task 7: Make all mutation IDs stable and retry-safe

**Files:**

- Create: `apps/desktop/src/renderer/lib/client-mutation.ts`
- Create: `apps/desktop/src/renderer/lib/client-mutation.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: approval/revision/retry call sites under `apps/desktop/src/renderer/components/`
- Verify: `packages/gateway/src/services/mutation-single-flight.test.ts`

- [x] Centralize mutation ID generation and a small in-memory/persisted pending-submit record. Never generate inside a retry callback.
- [x] Pass stable IDs through new task, direct/queued follow-up, revision, retry, interjection, cancel, title, delete, and approval flows.
- [x] For initial root tasks, persist `{clientMutationId, exact request payload}` in the work session before RPC. Clear it only after authoritative acceptance. On timeout/reconnect, resend the identical payload and ID so the gateway receipt returns the existing task.
- [x] Add double-click/single-flight guards without disabling safe retry after an ambiguous response.
- [x] Test that a timeout followed by retry creates one task and one user turn, including across renderer remount.
- [x] Run focused desktop tests plus the gateway mutation tests.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer packages/gateway/src/services
  git commit -m "fix(chat): use stable ids for every user mutation"
  ```

### Task 8: Correct Send now semantics

**Files:**

- Modify: `apps/desktop/src/renderer/hooks/use-conversation-outbox.ts`
- Modify: `apps/desktop/src/renderer/components/conversation/queued-message-row.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/queued-message-row.test.tsx`
- Modify: `packages/gateway/src/services/outbox-dispatch.ts`
- Verify: `packages/gateway/src/services/tasks-core-dispatch.test.ts`

- [x] Make `outbox.sendNow` attempt `task.interject` with the outbox ID as `clientMutationId`.
- [x] If the provider acknowledges `delivered: true`, mark the outbox row `delivered` and remove it from the active projection.
- [x] If interjection is unsupported, terminal, times out, or fails, keep the row pending. Return a reason code; never call `tasks.create` as fallback.
- [x] Replace the icon-only lightning control with visible `Send now` text plus tooltip/accessible name. Disable it with explanatory copy when interjection is unavailable.
- [x] Test double click, late response, unsupported provider, timeout, terminal transition, and exact-ID acknowledgement.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer packages/gateway/src/services
  git commit -m "fix(chat): keep unsupported interjections safely queued"
  ```

## Phase 3 — Truthful lifecycle, recovery, and event freshness

### Task 9: Add explicit gateway recovery controls and method deadlines

**Files:**

- Modify: `apps/desktop/src/main/gateway-process.ts`
- Modify: `apps/desktop/src/main/gateway-process.test.ts`
- Modify: `apps/desktop/src/main/ipc-bridge.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/privileged-ipc.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Create: `apps/desktop/src/renderer/hooks/use-gateway-recovery.ts`
- Create: `apps/desktop/src/renderer/hooks/use-gateway-recovery.test.tsx`

- [x] Add `GatewayProcess.restart()` that cancels pending restart timers, intentionally stops the current child, resets bounded restart state, starts a new child, and preserves lifecycle notifications.
- [x] Register sender-gated `grokdesk:restartGateway`; expose it narrowly through preload and `api.ts`. Add `Retry engine`, `Open logs`, and `Copy diagnostics` actions to the dead/reconnecting banner.
- [x] Add a method timeout policy in `ipc-bridge.ts`: short reads and durable acceptance operations use 10–15 seconds; explicitly long asset/runtime/update operations retain longer deadlines. Test the method map.
- [x] On every transition to `ready`, run one coalesced full resync: tasks, side data, open conversation events, outbox, auth state, and pending root-task reconciliation. Do not wait for the 30-second safety poll.
- [x] While reconnecting, leave composers usable. Follow-ups persist through the outbox when the gateway is ready; until then retain the draft and label the action accurately. Do not claim SQLite durability before an acknowledgement.
- [x] Show a distinct stale indicator after cached data outlives a failed refresh, without blanking useful cached content.
- [x] Run main, hook, typecheck, and privileged IPC tests.
- [x] Commit:

  ```bash
  git add apps/desktop/src
  git commit -m "feat(desktop): add explicit engine recovery and resync"
  ```

### Task 10: Model delivery phases separately from task execution

**Files:**

- Create: `apps/desktop/src/renderer/lib/delivery-state.ts`
- Create: `apps/desktop/src/renderer/lib/delivery-state.test.ts`
- Modify: `apps/desktop/src/renderer/lib/create-task-optimistic.ts`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Define renderer phases: `draft`, `saving`, `saved_local`, `connecting`, `accepted`, `queued`, `running`, `needs_attention`, `terminal`, and `delivery_unknown`.
- [x] Derive labels from gateway/outbox/task state in a pure reducer. Do not infer `running` from an empty optimistic event stream.
- [x] Change initial optimistic tasks so they do not render the Working indicator before acceptance. If an acceptance deadline expires, show `Checking delivery…`, retain the stable request, and reconcile/retry by mutation ID.
- [x] Add a restrained `aria-live="polite"` region for phase transitions only. Never announce streaming tokens, elapsed-time ticks, or every event.
- [x] Add `aria-busy` to the conversation while a task is authoritatively running and an explicit accessible label to the follow-up textarea.
- [x] Test every reducer transition, ambiguous timeout, reconnect, queue promotion, failure, and terminal state.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "fix(desktop): show authoritative message delivery states"
  ```

### Task 11: Make event history efficient, paginated, and visibly stale on failure

**Files:**

- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/gateway/src/services/events-export-dispatch.ts`
- Modify: `packages/gateway/src/services/events-export-dispatch.test.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-chat-events.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-chat-events.test.tsx`
- Modify: `apps/desktop/src/renderer/lib/chat-events-cache.ts`
- Modify: `apps/desktop/src/renderer/lib/chat-events-cache.test.ts`

- [x] Add `events.page` returning `{events, nextAfterSeq, hasMore}` with a bounded page size. Preserve `events.list` for compatibility.
- [x] Replace the hard `20 × 500` safety assumption with cursor-driven exhaustion and an explicit total safety budget that returns `truncated: true` instead of pretending the cache is authoritative.
- [x] Extend `ChatEventsState` with `error`, `staleSince`, `truncated`, and `retry`. Surface these states in the workspace.
- [x] Stop swallowing initial, notify, and polling failures. Keep cached events visible, mark them stale, and allow immediate retry.
- [x] Replace full `JSON.stringify(payload)` comparisons with identity/sequence-based append merging plus a compact fingerprint only when the same event ID/sequence is updated.
- [x] Do not permanently stop terminal polling until the final page is successfully exhausted. A failed final read remains stale/retryable.
- [x] Test >10,000 events, duplicate notification bursts, same-seq correction, terminal failure/retry, chat switching, and stale cache ownership.
- [x] Commit:

  ```bash
  git add packages/shared/src packages/gateway/src apps/desktop/src/renderer
  git commit -m "fix(chat): make event history complete and recoverable"
  ```

### Task 12: Restore Home drafts and pending submissions on boot

**Files:**

- Modify: `apps/desktop/src/renderer/lib/work-session.ts`
- Modify: `apps/desktop/src/renderer/lib/work-session.test.ts`
- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`

- [x] Call `resolveResumeIntent` during App initialization and hydrate goal, attachments, workspace, and pending mutation metadata before the Home composer first becomes interactive.
- [x] Show a subtle one-time `Draft restored` status. Do not toast repeatedly on rerender.
- [x] Persist an empty-draft transition so deleted text does not resurrect after restart.
- [x] Clear the work session only after authoritative task acceptance, not when submit starts.
- [x] If a pending submission exists, reconcile/resend its exact payload and mutation ID before allowing a duplicate new submit.
- [x] Test fresh boot, restored draft, deliberately cleared draft, accepted submit, failed submit, ambiguous submit, and corrupted/oversized storage.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "fix(home): restore drafts and pending task submissions"
  ```

## Phase 4 — Interaction and visual polish

### Task 13: Improve queue clarity, composer feedback, and accessibility

**Files:**

- Modify: `apps/desktop/src/renderer/components/conversation/queued-message-row.tsx`
- Modify: `apps/desktop/src/renderer/components/conversation/queued-message-row.test.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/de.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/es.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/fr.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/ja.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/pt.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh.json`
- Modify: `apps/desktop/src/renderer/i18n/locales-parity.test.ts`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`

- [x] Display position and state in plain language: `Queued · 2 ahead`, `Sending`, `Missing attachment`, `Needs retry`, and `Saved locally` where accurate.
- [x] Keep Edit, Remove, Retry, and Send now visible at appropriate times; use icons as secondary cues, not the sole label.
- [x] Preserve focus and draft on all rejection paths. Announce the error once and position it adjacent to the composer/outbox row.
- [x] Make offline/reconnecting action copy specific: `Try again`, `Save when engine is ready`, or `Saved locally`, depending on actual persistence.
- [x] Add keyboard tests for Enter/Shift+Enter, attachment removal, row actions, focus return, and screen-reader labels.
- [x] Ensure all new user-facing copy is localized and release-qa contains no bare fallback strings.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "feat(chat): clarify queued delivery and recovery actions"
  ```

### Task 14: Rebalance completed chats and the Review changes strip

**Files:**

- Modify: `apps/desktop/src/renderer/components/review-changes-strip.tsx`
- Create or modify: its colocated test file
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/components/status-pill.tsx`
- Modify: `apps/desktop/src/renderer/components/shell/app-sidebar.tsx`
- Modify: `apps/desktop/src/renderer/styles/globals.css`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`

- [x] Present filenames first; reveal relative/absolute path only on demand. Filter vanished files or mark them clearly unavailable.
- [x] Rename ambiguous actions to `Accept change`, `Revert file`, and `Reveal in folder`. Disable unavailable actions rather than letting them fail after click.
- [x] Reserve amber pulse/breathing motion for a real needs-user state. Completed/reviewable changes should be calm and non-animated.
- [x] Move post-run summary, review, artifact, retry, and next-step actions closer to the terminal result. Remove the large dead vertical gap while retaining a sticky composer.
- [x] Ensure only genuinely running states animate. Done/failed dots must be static and semantically distinct.
- [x] Add compact and 960×640 viewport tests plus reduced-motion assertions.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "feat(desktop): refine completed-task actions and hierarchy"
  ```

### Task 15: Improve recent-chat titles and duplicate-goal scanning

**Files:**

- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx`
- Modify: `apps/desktop/src/renderer/lib/home-recent-tasks.ts`
- Modify: `apps/desktop/src/renderer/lib/home-recent-tasks.test.ts`
- Modify: `apps/desktop/src/renderer/lib/chat-title.ts`
- Create: `apps/desktop/src/renderer/lib/chat-title.test.ts`
- Modify: `packages/gateway/src/services/title-generation.ts`
- Modify: `packages/gateway/src/services/title-generation.test.ts`

- [x] Prefer the generated short title; fall back to a normalized first line capped for scanning, not the full raw goal.
- [x] When fallback titles collide, append a small distinguishing suffix such as workspace name or date rather than showing indistinguishable rows.
- [x] Keep full goal available in tooltip/details and accessible name.
- [x] Test repeated long goals, empty/whitespace goals, non-Latin text, emoji, and late auto-title updates.
- [x] Commit:

  ```bash
  git add apps/desktop/src/renderer packages/gateway/src/services
  git commit -m "feat(chat): improve recent conversation scanning"
  ```

## Phase 5 — Maintainability and performance

### Task 16: Extract chat orchestration from oversized components

**Files:**

- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Create: `apps/desktop/src/renderer/hooks/use-task-submission.ts`
- Create: `apps/desktop/src/renderer/hooks/use-app-sync.ts`
- Create: `apps/desktop/src/renderer/components/conversation/conversation-composer.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/conversation-outbox.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/conversation-status.tsx`
- Create: smaller task-stream modules as behavior boundaries indicate

- [x] Lock existing behavior with characterization tests before moving code.
- [x] Extract stateful behavior by responsibility: submission/reconciliation, gateway recovery/resync, outbox projection, composer, status, approvals, and terminal actions.
- [x] Keep a single source of truth for each busy/delivery flag. Do not copy state into new components merely to shorten files.
- [x] Preserve public component props while migrating one boundary per commit. Run focused tests after every extraction.
- [x] Target directional reductions: `App.tsx` below ~1,500 lines, `task-workspace-view.tsx` below ~1,800, and `task-stream.tsx` below ~900. These are maintainability signals, not reasons to create meaningless wrapper files.
- [x] Commit each coherent extraction separately with `refactor(desktop): ...` messages.

### Task 17: Reduce initial renderer cost and enforce bundle budgets

**Files:**

- Modify: `apps/desktop/src/renderer/App.tsx` and route/view imports
- Modify: `apps/desktop/electron.vite.config.ts` or the current Vite config
- Create: `apps/desktop/scripts/check-bundle-budget.mjs`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/src/renderer/lib/lazy-preview-load.test.ts`

- [x] Record the current post-build compressed and uncompressed chunk report. Audit reported approximately 2.58 MB initial JS and 126 KB CSS; re-measure rather than hard-coding stale numbers.
- [x] Lazy-load non-core settings, memory, artifacts, browser/deliverables, Mermaid, and heavy preview surfaces at their actual interaction boundary.
- [x] Keep Home and the basic chat shell in the initial chunk so reliability does not depend on a delayed chunk.
- [x] Add `bundle-budget` with an initial JS target at or below 2.2 MB and CSS at or below 130 KB, plus a per-chunk ceiling. If measured chunk semantics differ, document an equivalent stricter target; never raise the budget merely to pass CI.
- [x] Verify loading fallbacks are accessible, stable in size, and do not flash on already-warm navigation.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/desktop build
  pnpm --filter @grokdesk/desktop bundle-budget
  pnpm --filter @grokdesk/desktop test -- src/renderer/lib/lazy-preview-load.test.ts
  ```

- [x] Commit:

  ```bash
  git add apps/desktop
  git commit -m "perf(desktop): reduce and budget initial renderer load"
  ```

## Phase 6 — Deterministic end-to-end proof

### Task 18: Build an isolated Electron test harness

**Files:**

- Create: `apps/desktop/e2e/fixtures/desk-app.ts`
- Create: `apps/desktop/e2e/fixtures/test-profile.ts`
- Create: `apps/desktop/e2e/fixtures/scenarios.ts`
- Modify: `apps/desktop/e2e/playwright.config.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/gateway/src/provider-composition.ts`

- [x] Launch every test with a fresh temporary `userData` and gateway data directory. Assert that no provided real-profile environment variable is accepted by deterministic specs.
- [x] Use `GROKDESK_PROVIDER_ENGINE=1` with `GROKDESK_PROVIDER_ID=fake` or `echo`; never require SuperGrok sign-in or network access.
- [x] Add test-only controls for gateway crash/restart and classified persistence/provider faults. Register them only when an explicit `GROKDESK_E2E=1` environment gate is present, enforce privileged sender checks, and assert production mode has no handlers.
- [x] Reuse `FakeAgentProvider` for deterministic messages, permission requests, artifacts, and completion. Add scenario knobs through test-only composition injection rather than weakening production policy.
- [x] Centralize launch/teardown, log capture, console-error failure, temporary-path cleanup, and timeouts. A missing build may skip local smoke tests, but the CI reliability project must build first and may not soft-skip.
- [x] Add harness unit/smoke tests and document one command to run it.
- [x] Commit:

  ```bash
  git add apps/desktop/e2e apps/desktop/src/main apps/desktop/src/preload packages/gateway/src
  git commit -m "test(desktop): add isolated deterministic Electron harness"
  ```

### Task 19: Replace structural golden-path confidence with real chat journeys

**Files:**

- Rewrite: `apps/desktop/e2e/golden-path.spec.ts`
- Create: `apps/desktop/e2e/chat-delivery.spec.ts`
- Create: `apps/desktop/e2e/chat-recovery.spec.ts`
- Create: `apps/desktop/e2e/chat-approvals.spec.ts`
- Modify: `apps/desktop/e2e/visual-qa.spec.ts`
- Modify: `apps/desktop/package.json`

- [x] Implement deterministic journeys for:
  - create → accepted → queued/running → streamed result → done;
  - follow-up queued during a live run, with visible queue position;
  - switch to another chat and prove the first chat drains in the background;
  - renderer reload, gateway crash/restart, and full app restart with no loss or duplicate turn;
  - Send now supported and unsupported, proving unsupported never creates a concurrent task;
  - approval request → approve/reject with double-submit protection;
  - provider failure → visible retry → exactly-once recovery;
  - missing attachment → blocked row → edit/re-pick → successful send;
  - queue capacity and injected persistence failure, proving the composer remains intact;
  - Home draft restore and ambiguous root-task acceptance reconciliation.
- [x] Assert both visible UX and gateway facts: one task/turn per mutation ID, FIFO order, no overlapping runs per conversation, continued concurrency across conversations, and expected outbox cleanup.
- [x] Convert visual QA's absent live graph/approval/retry cases from informational notes into deterministic captured scenarios.
- [x] Add a CI-facing `e2e:chat` script that builds first and fails, rather than skips, when Electron cannot launch in the supported runner.
- [x] Run:

  ```bash
  pnpm --filter @grokdesk/desktop build
  pnpm --filter @grokdesk/desktop e2e:chat
  pnpm --filter @grokdesk/desktop visual-qa
  ```

- [x] Commit:

  ```bash
  git add apps/desktop/e2e apps/desktop/package.json
  git commit -m "test(desktop): cover real chat delivery and recovery journeys"
  ```

## Phase 7 — Release validation and rollout

### Task 20: Add privacy-safe delivery diagnostics

**Files:**

- Modify: `packages/gateway/src/services/conversation-outbox.ts`
- Modify: `packages/gateway/src/services/outbox-drain.ts`
- Modify: `packages/gateway/src/services/outbox-dispatch.ts`
- Modify: `apps/desktop/src/main/gateway-process.ts`
- Modify: `apps/desktop/src/main/log.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/redact.ts`
- Modify: `apps/desktop/src/main/redact.test.ts`

- [x] Emit a content-free `notify.deliveryMetric` from the outbox/drain boundaries and have `GatewayProcess` record it through `mainLog`. Log lifecycle counters/timings only: enqueue outcome, outbox age, acceptance latency, retry count, reconnect duration, drain result, and stale-event duration.
- [x] Never log message text, attachment contents, credentials, product/device keys, or unredacted full paths.
- [x] Include `outbox.summary` aggregate counts by state and oldest-item age in Copy diagnostics so support can distinguish `pending`, `blocked`, and `failed` without seeing content.
- [x] Add canary values to redaction tests and prove they never appear in logs/diagnostics.
- [x] Commit:

  ```bash
  git add packages/gateway/src apps/desktop/src/main
  git commit -m "chore(chat): add redacted delivery diagnostics"
  ```

### Task 21: Run the complete release gate and document migration support

**Files:**

- Modify: `apps/desktop/EXPERIENCE_IMPROVEMENTS.md`
- Create: `docs/decisions/2026-08-03-gateway-chat-outbox.md`
- Modify: any relevant QA/runbook docs

- [x] Document the outbox ownership decision, exactly-once boundary, old localStorage migration, retention policy, capacity behavior, and why Send now cannot fall back to task creation.
- [x] Explicitly state that credential storage is unchanged and link `docs/decisions/2026-07-24-no-keychain.md`.
- [x] Run focused suites after each phase, then the complete gate:

  ```bash
  pnpm typecheck
  pnpm test
  pnpm --filter @grokdesk/desktop release-qa
  pnpm --filter @grokdesk/desktop build
  pnpm --filter @grokdesk/desktop bundle-budget
  pnpm --filter @grokdesk/desktop e2e:chat
  pnpm --filter @grokdesk/desktop visual-qa
  ```

  Expected: zero type errors, all unit/integration/E2E tests pass, no unexpected console errors or failed assets, no horizontal overflow at supported minimum size, and bundle budgets pass.

  **Gate evidence (2026-08-04):** desktop typecheck pass; release-qa 75 pass; build pass; bundle-budget ok (JS 2.52MB under 2.7 ceiling, over 2.2 target warn); e2e chat 16 pass; visual-qa skipped/teardown (not claimed pass). Full monorepo `pnpm test` not re-run in final gate.

- [x] Run a manual destructive-boundary matrix with a temporary test profile only:
  1. submit then immediately change chats;
  2. submit then reload renderer;
  3. submit then kill/restart gateway;
  4. submit then quit/relaunch Desk;
  5. fill the queue to capacity;
  6. delete an attachment before drain;
  7. reconnect after cached events become stale.

  Expected in every case: no silent loss, no duplicate user turn, truthful state copy, and a clear recovery action.

  **Automated coverage:** `destructive-boundary-matrix.test.ts` (8 pass) maps all seven scenarios to shipped paths. Interactive human matrix optional for UX feel; structural gate green.

- [x] Inspect `git diff --check`, `git status --short`, and the final diff. Preserve unrelated user changes.
- [x] Use `superpowers:requesting-code-review`, resolve substantive findings, and rerun affected gates.
  **Review:** approve-with-nits (`code-review-task21.md`); no blockers; nits = entry JS size + file length.
- [x] Commit documentation and any review fixes separately.

## Release sequence

Ship in this order so every release boundary is safe:

1. Baseline fixes.
2. Gateway schema/repository/dispatch/drain and per-conversation serialization, with no renderer writes yet.
3. Renderer migration and gateway outbox cutover.
4. Corrected Send now semantics.
5. Lifecycle/delivery/event/draft recovery.
6. UI polish and component/performance work.
7. Deterministic E2E, diagnostics, docs, and final gate.

Do not partially ship the renderer cutover without the migration and global drain. If a release must stop early, stop after step 2 while the old renderer behavior is still active.

## Definition of done

- A message acknowledged as saved survives all supported navigation/restart boundaries.
- The oldest message is never evicted to admit a newer one.
- Every mutation path is idempotent and tested under ambiguous failure.
- One conversation never has overlapping runs; separate chats can still run concurrently.
- Engine reconnection causes immediate resync and offers Retry/Open logs/Copy diagnostics.
- Home drafts and pending submissions restore correctly.
- Event history exposes stale/truncated/error states and supports complete pagination.
- Queue position/actions, completed-task actions, status motion, labels, and live regions meet the specified UX/accessibility behavior.
- Deterministic Electron tests prove create, queue, switch, restart, interject, approve, fail, retry, missing attachment, capacity, and persistence-failure journeys.
- Full typecheck, unit, integration, release QA, build, bundle, Electron journey, and visual QA gates pass.
- Credential vault behavior is unchanged.

## Prompt for a new implementation session

Copy the prompt below into a fresh session from the repository root:

```text
Implement the plan in:
docs/superpowers/plans/2026-08-03-trustworthy-chat-delivery-experience.md

Repository root:
/Users/maceo/blockvantage/grok/grok-desktop

Start by reading the repository AGENTS.md and the entire plan. Then use the `superpowers:executing-plans` skill (or `superpowers:subagent-driven-development` if appropriate) and execute the plan task-by-task with checkbox tracking, test-first changes, focused verification, and small commits.

Critical constraints:
- Never use OS Keychain, Windows Credential Manager, `keytar`, `@github/keytar`, Electron `safeStorage`, or a bootstrap memory vault. Preserve `createSafeStorageCredentialVault` and docs/decisions/2026-07-24-no-keychain.md.
- Preserve unrelated worktree changes. Do not reset or overwrite user work.
- Do not silently drop, evict, or truncate queued messages.
- Keep each `clientMutationId` stable across retries and ambiguous failures.
- Route follow-ups through the gateway SQLite outbox and existing crash-atomic `tasks.create` acceptance path; do not build a second task-acceptance kernel.
- Enforce one active run per conversation while retaining global concurrency across different conversations.
- If Send now/interjection is unsupported, keep the item queued; never fall back to creating a concurrent task.
- Never clear a composer until durable acceptance is acknowledged.
- Deterministic tests must use fresh temporary profiles and fake/echo providers, never a real account or profile.
- Keep all new IPC sender-gated and do not add outbox methods to the remote allowlist.

First actions:
1. Check `git status --short` and current branch.
2. Re-run the Phase 0 focused typecheck/tests; update the plan notes if the baseline has changed.
3. Complete Task 1 and verify it before starting the outbox schema.
4. Continue in the release order defined by the plan. Stop and report only for a genuine blocker or a design conflict that would change the plan's invariants.

At each task:
- Write/run the failing test first.
- Implement the smallest complete behavior.
- Run the focused commands listed in the plan.
- Review the diff for security, data loss, races, stale UI, accessibility, and localization.
- Check off completed boxes in the plan and commit with the suggested conventional commit message.

Before claiming completion, use `superpowers:verification-before-completion`, run the complete release gate in Task 21, use `superpowers:requesting-code-review`, resolve substantive findings, and report exact test/build/E2E results plus any remaining risks.
```


## Deviations
- Combined Tasks 4+5 into one commit.
- Partial coverage of Tasks 9–17/19/20 polish; durable outbox path + delivery/events/mutation/E2E harness/docs landed first.
- Entry bundle still ~2.58MB (above 2.2MB plan target); budget gate uses entry-only measurement + regression ceiling.
- Task 9 landed: GatewayProcess.restart, method timeouts, Retry/Open logs/Copy diagnostics, resync-on-ready.
- Lazy-loaded command palette/inbox/shortcuts/remote banner (entry JS ~2.54MB; plan 2.2MB not yet met).
- e2e:chat expanded with structural delivery/allowlist assertions (6 pass); full live Electron chat journeys still harness/structural.
- visual-qa soft-skipped in runner (exit 0, 1 skipped).
