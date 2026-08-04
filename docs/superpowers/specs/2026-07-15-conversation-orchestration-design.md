# Conversation Orchestration Design

**Date:** 2026-07-15
**Status:** Approved direction
**Primary outcome:** Grok Desk conversations remain calm, useful, and trustworthy while primary runs, queued follow-ups, subagents, browser work, approvals, and deliverables progress concurrently.

## Why this project exists

The current conversation surface derives a chat-like view from low-level task events. That works for simple runs, but breaks down when several representations change at once. Live QA reproduced the failure clearly:

- A two-sentence answer still displayed a redundant thought-process card.
- A completed answer, the next user message, the queue entry, and the next run were visible simultaneously without a clear handoff state.
- Repeated provider setup events appeared as multiple identical “Grok Build session” rows.
- A single queued message created 13 identical follow-up runs because renderer remounting recovered `sending` back to `pending` before the accepted item was removed.
- Subagent UI exists, but the backend event contract does not currently guarantee truthful worker lifecycle data.

The problem is therefore both correctness and presentation. A calmer renderer is insufficient if the underlying state can submit work twice or disagree about which run owns a message.

## Product principles

1. **Conversation first.** The default surface contains the user request, meaningful progress, the result, and any decision the user must make.
2. **Truth before animation.** Every visible state comes from an explicit lifecycle state. The UI never invents a worker, completion, or progress phase.
3. **Depth on demand.** Full reasoning, tool receipts, provider logs, and worker activity remain available under “View work.” They do not compete with the answer.
4. **One message, one turn.** A queued message can be accepted at most once, even across remounts, retries, restarts, and concurrent callbacks.
5. **Independent concurrency.** Primary runs, workers, browser activity, approvals, file updates, and queue submission update independent keyed records rather than a shared last-status string.
6. **The app owns completion.** The user can always tell whether work is queued, running, waiting for them, blocked, failed, or complete—and what to do next.
7. **History is preserved.** Editing an accepted message creates an explicit revised turn; it never silently rewrites completed history.

## Scope

### Included

- Exactly-once queued follow-up acceptance and crash-safe recovery.
- A canonical conversation projection built from tasks, events, workers, artifacts, approvals, and local queue state.
- Explicit primary-run and worker lifecycle events.
- A conversation-first renderer with expandable work details.
- Turn-local errors, approvals, artifacts, browser activity, and recovery actions.
- Edit queued messages and edit-and-rerun accepted user turns.
- Concurrency and event-ordering tests.
- Packaged-app live QA scenarios.

### Deferred

- Browser preview element selection, source mapping, and visual comments. The conversation model will accept future `annotation` context, but browser editing will receive its own design and plan.
- Authentication/onboarding redesign.
- Replacing the provider’s private reasoning. Grok Desk only shows thought events the provider actually emits and labels them as work detail.

## Canonical domain model

The renderer receives one `ConversationSnapshot` rather than independently deriving chat, queue, subagent, browser, and status views.

```ts
type ConversationSnapshot = {
  conversationId: string;
  title: string;
  turns: ConversationTurn[];
  queued: QueueItemView[];
  activeTurnId: string | null;
  needsUserAction: boolean;
};

type ConversationTurn = {
  id: string;
  taskId: string;
  userMessage: string;
  revisionOfTurnId: string | null;
  state:
    | "queued"
    | "running"
    | "waiting_user"
    | "waiting_approval"
    | "blocked"
    | "done"
    | "failed"
    | "cancelled";
  primaryRun: RunView;
  workers: WorkerView[];
  answer: string | null;
  work: WorkEntry[];
  artifacts: ArtifactView[];
  approval: ApprovalView | null;
  error: TurnErrorView | null;
};
```

Each record is keyed. Updating worker `w2` cannot replace the primary run’s status, browser activity, or worker `w1`. Events are deduplicated by stable identity and reduced monotonically.

## Queue lifecycle and exactly-once behavior

Queue items use these states:

```text
pending → submitting → accepted
    ↑          ↓
  retry ← failed
```

- The queue item ID is passed to `tasks.create` as `clientMutationId`.
- Gateway mutation receipts make repeated acceptance calls idempotent.
- `accepted` means the gateway returned a durable task ID. The item leaves the visible queue immediately and is represented by its turn.
- `submitting` carries a lease timestamp. Normal React remounts preserve it. Only an expired lease or an explicit startup recovery can return it to `pending`.
- Removing a pending item remains undoable. A submitting item cannot be edited or removed until acceptance resolves.
- “Send now” and automatic drain use the same claim function and mutation ID.

## Concurrency semantics

Concurrency is partitioned by identity:

- `conversationId` owns ordered turns and pending queue items.
- `turnId` owns one user request, its result, approval, error, and artifacts.
- `runId` owns primary execution state and progress.
- `workerId` owns a subagent objective, status, current activity, and result summary.
- `activityId` owns one deduplicated receipt or log entry.

Reducers must be safe when events arrive late or out of order. Terminal worker/run states cannot regress to running. A late progress event cannot replace an answer. A queue callback from an unmounted turn can complete the durable queue item because ownership is external to the task workspace component.

The gateway remains the authority for accepted tasks and run concurrency. Local storage is only the authority for messages not yet accepted by the gateway.

## Conversation presentation

### Default view

Each turn renders in this order:

1. User message.
2. One live work card when active.
3. A compact worker strip when workers exist.
4. Approval/question card when action is needed.
5. Final assistant answer.
6. Deliverables and concrete next actions.

The live work card answers:

- **What:** the latest meaningful milestone.
- **Who:** Grok or named workers, with active/completed counts.
- **State:** working, waiting for approval, blocked, or recovering.

Provider boot messages, repeated heartbeats, raw event counts, and duplicate session bookends never appear in the default conversation.

### View work

“View work” expands a chronological, filterable detail panel for the turn:

- Progress updates and provider-emitted thoughts.
- Worker lifecycle and worker messages.
- Tool calls and receipts.
- Browser navigation and screenshots.
- File writes and artifacts.
- Provider/system diagnostics.

The panel defaults closed after completion and may stay open while a user is actively inspecting it. “Thoughts” are labeled as model work notes, not guaranteed chain-of-thought.

### Subagents

Workers appear only when lifecycle events identify them. The worker strip shows names, active/done/failed state, and the latest meaningful activity. Expanding a worker reveals its objective, activity timeline, result, and artifacts. Selecting a worker does not navigate away from the parent conversation.

## Edit semantics

### Queued message

Pending and failed queue items support inline text and attachment edits. Submitting items are locked with clear “Submitting…” copy.

### Accepted user turn

“Edit and rerun” opens the original text in the composer. Submitting it creates a new task with `revisionOfTaskId` pointing to the original. The original remains in history with an “Edited” marker. The revised turn becomes the active continuation, and the context builder excludes superseded descendants from the new branch.

The first implementation supports editing the latest accepted user turn. Editing arbitrary historical turns is enabled only after branch projection is proven by tests.

### Browser preview edit

A later browser project will let the user select a rendered element, attach a comment, map it to source, and send that annotation as structured turn context. No DOM/source annotation logic belongs in this conversation implementation.

## Errors and recovery

- Errors attach to the turn or worker that produced them.
- A failed worker does not mark the parent turn failed if the primary run can recover or complete.
- Queue acceptance failures remain editable and retryable with the same mutation identity.
- Stale submitting leases show “Recovering queued message…” before retry.
- Waiting approvals replace generic working animation and remain visible until resolved.
- Renderer refresh or navigation cannot duplicate accepted work.
- If event normalization cannot identify a worker, the event remains in work detail as a run-level event rather than inventing worker ownership.

## Accessibility and interaction

- Live status uses `aria-live="polite"`; token/thought streams do not announce every update.
- Worker and work-detail disclosures are keyboard reachable and expose expanded state.
- Status is never encoded by color alone.
- Edit-and-rerun explains that it creates a revision before submission.
- Focus returns to the revised composer, approval action, or final answer as appropriate.

## Testing strategy

1. Pure reducer tests permute concurrent event ordering and assert identical snapshots.
2. Queue tests reproduce remount-during-submit and verify exactly one `tasks.create` result.
3. Gateway tests repeat a `clientMutationId` and verify one task row/run attempt.
4. Engine parser tests cover worker lifecycle envelopes and unknown-event fallback.
5. Renderer tests assert default calmness and full detail disclosure.
6. Edit tests verify revision lineage and context exclusion.
7. Packaged-app QA covers simple answer, long run, queued follow-up, queue edit, worker concurrency, approval, failure/retry, browser activity, and edit-and-rerun.

## Delivery order

1. Queue safety hotfix and regression tests.
2. Shared event/revision contracts.
3. Canonical conversation projector.
4. Truthful worker event ingestion.
5. Conversation-first components.
6. Edit-and-rerun.
7. Full verification and packaged live QA.

Each stage must ship testable behavior and must not depend on browser preview editing.
