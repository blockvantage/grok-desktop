# Conversation Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Grok Desk conversations exactly-once, concurrency-safe, calm by default, fully inspectable on demand, truthful about subagents, and editable without rewriting history.

**Architecture:** First close the live queue duplication defect by carrying a stable mutation identity through renderer remounts to the gateway. Then introduce a pure canonical conversation projector keyed by turn, run, worker, and activity identities; feed it truthful engine worker events; and render a conversation-first surface with expandable work detail. Accepted-message edits create explicit revision tasks rather than mutating history.

**Tech Stack:** TypeScript, React, Electron, SQLite, Zod, Vitest, Testing Library, pnpm, Grok Build streaming JSON.

**Design:** `docs/superpowers/specs/2026-07-15-conversation-orchestration-design.md`

---

## Implementation status (2026-07-16)

Tasks 1–7 are implemented, independently reviewed, and committed. Their historical TDD checklists remain unchecked below because this status section records the integrated result without rewriting the execution transcript after the fact.

| Task | Status | Commit |
|------|--------|--------|
| 1. Exactly-once queued follow-ups | Complete | `046f7fd` |
| 2. Revision and worker lifecycle contracts | Complete | `f5d027a` |
| 3. Truthful worker event normalization | Complete | `4290a17` |
| 4. Canonical conversation projector | Complete | `d31d857` |
| 5. Calm conversation UI and expandable work | Complete | `88bd0e2` |
| 6. Edit-and-rerun revisions | Complete | `83732cd` |
| 7. Connected approvals, browser activity, artifacts, and failures | Complete | `13829cd` |
| 8. Full verification, signed package, and live matrix | **Pending** | — |

Post-task integration hardening is committed in `76f3cec`, `78f90a9`, `c3215d3`, `e9bdf26`, `8f6ded7`, `26cec39`, `ad9f20c`, `e14a0f8`, and `253dc00`. These changes cover native ABI probing, multi-chat event integrity, queue teardown/recovery, complete cold histories, truthful queued presentation, reliable in-app HTML opening, policy/state preservation, and confirmed-open semantics.

No completion claim should be made until Task 8 produces current full-suite, package/signature, packaged live-QA, and exactly-once database evidence.

---

## File responsibility map

- `apps/desktop/src/renderer/lib/message-queue-store.ts`: durable pre-acceptance queue state and leases.
- `apps/desktop/src/renderer/hooks/use-workspace-queue.ts`: queue claim/accept/retry orchestration independent of the selected turn.
- `apps/desktop/src/renderer/lib/create-task-optimistic.ts`: task-create payloads, including stable mutation and revision IDs.
- `packages/shared/src/types.ts` and `packages/shared/src/ipc.ts`: worker/revision contracts shared across processes.
- `packages/engine-grok/src/events.ts`: normalize truthful provider worker lifecycle events.
- `packages/gateway/src/services/runner.ts`: persist normalized worker events without collapsing their identity.
- `apps/desktop/src/renderer/lib/conversation-projector.ts`: the single pure projection from tasks/events/queue/artifacts to UI state.
- `apps/desktop/src/renderer/components/conversation/*`: default turn, live work, worker strip, and work-detail presentation.
- `apps/desktop/src/renderer/App.tsx`: application-level queue ownership, revision submission, and canonical snapshot composition.
- `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`: workspace layout and composer integration only.

### Task 1: Make queued follow-ups exactly-once across remounts

**Files:**
- Modify: `apps/desktop/src/renderer/lib/message-queue-store.ts`
- Modify: `apps/desktop/src/renderer/lib/message-queue-store.test.ts`
- Modify: `apps/desktop/src/renderer/hooks/use-workspace-queue.ts`
- Create: `apps/desktop/src/renderer/hooks/use-workspace-queue.test.tsx`
- Modify: `apps/desktop/src/renderer/lib/create-task-optimistic.ts`
- Modify: `apps/desktop/src/renderer/lib/create-task-optimistic.test.ts`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`

- [ ] **Step 1: Add the remount regression test**

  Add a hook test that queues one message, begins submission, unmounts/remounts with the same storage, and asserts `onFollowUp` is called once. Use a deferred promise so remount occurs before acceptance resolves.

  ```ts
  const accepted = deferred<boolean>();
  const onFollowUp = vi.fn(() => accepted.promise);
  const first = renderHook(() => useWorkspaceQueue(options(onFollowUp)));
  act(() => first.result.current.enqueue("send once"));
  rerenderTerminal(first);
  first.unmount();
  renderHook(() => useWorkspaceQueue(options(onFollowUp)));
  expect(onFollowUp).toHaveBeenCalledTimes(1);
  accepted.resolve(true);
  ```

- [ ] **Step 2: Run the regression and confirm the current failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/hooks/use-workspace-queue.test.tsx src/renderer/lib/message-queue-store.test.ts`

  Expected: FAIL because loading a stored `sending` item converts it immediately to `pending`, permitting another claim.

- [ ] **Step 3: Replace `sending` recovery with an expiring submission lease**

  Change the durable item to preserve its mutation ID and lease:

  ```ts
  export type DurableQueuedMessage = Omit<QueuedMessage, "status"> & {
    conversationId: string;
    status: "pending" | "submitting" | "failed";
    clientMutationId: string;
    claimedAt: string | null;
  };

  export const QUEUE_CLAIM_LEASE_MS = 2 * 60_000;

  export function recoverExpiredClaims(
    store: QueueStoreSnapshot,
    nowMs = Date.now(),
  ): QueueStoreSnapshot;
  ```

  `normalizeDurable` must preserve an unexpired `submitting` state. `recoverExpiredClaims` alone may move an expired claim to `pending`. `enqueueDurable` sets `clientMutationId` to the generated queue item ID.

- [ ] **Step 4: Persist claims before calling the gateway and accept by ID**

  Refactor the hook so both automatic drain and Send now call one function:

  ```ts
  async function submitClaim(item: DurableQueuedMessage) {
    const accepted = await opts.onFollowUp?.(
      item.text,
      toAttachments(item.attachmentPaths),
      item.clientMutationId,
    );
    setStore((current) =>
      completeDurableSend(
        current,
        conversationId,
        item.id,
        accepted === false ? "failed" : "sent",
      ),
    );
  }
  ```

  Persist the claimed store synchronously through `saveQueueStore(claimed.store)` before invoking `onFollowUp`. Move `useWorkspaceQueue` into `App.tsx`, where it is keyed by the selected `conversationId`, and pass its returned controller into `TaskWorkspaceView`. A task/turn replacement must not unmount the owner of an in-flight queue claim.

- [ ] **Step 5: Carry the stable mutation ID into `tasks.create`**

  Extend `buildFollowUpTaskParams` and `followUpTask`:

  ```ts
  export function buildFollowUpTaskParams(input: {
    // existing fields
    clientMutationId?: string;
    revisionOfTaskId?: string;
  }) {
    return {
      // existing payload
      ...(input.clientMutationId
        ? { clientMutationId: input.clientMutationId }
        : {}),
      ...(input.revisionOfTaskId
        ? { revisionOfTaskId: input.revisionOfTaskId }
        : {}),
    };
  }
  ```

  Update the `onFollowUp` prop to accept the third argument and pass it unchanged to `tasks.create`.

- [ ] **Step 6: Verify the queue repair**

  Run the focused hook/store/payload tests twice in one command. Expected: every test passes and the spy remains at one call after remount.

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/hooks/use-workspace-queue.test.tsx src/renderer/lib/message-queue-store.test.ts src/renderer/lib/create-task-optimistic.test.ts && pnpm --filter @grokdesk/desktop exec vitest run src/renderer/hooks/use-workspace-queue.test.tsx src/renderer/lib/message-queue-store.test.ts src/renderer/lib/create-task-optimistic.test.ts`

- [ ] **Step 7: Commit the queue safety repair**

  ```bash
  git add apps/desktop/src/renderer/lib/message-queue-store.ts apps/desktop/src/renderer/lib/message-queue-store.test.ts apps/desktop/src/renderer/hooks/use-workspace-queue.ts apps/desktop/src/renderer/hooks/use-workspace-queue.test.tsx apps/desktop/src/renderer/lib/create-task-optimistic.ts apps/desktop/src/renderer/lib/create-task-optimistic.test.ts apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx
  git commit -m "fix(chat): make queued follow-ups exactly once"
  ```

### Task 2: Add revision and worker lifecycle contracts

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`
- Modify: `packages/gateway/src/db.ts`
- Modify: `packages/gateway/src/db.test.ts`
- Modify: `packages/gateway/src/services/tasks.ts`
- Modify: `packages/gateway/src/services/tasks.test.ts`

- [ ] **Step 1: Write failing shared-contract tests**

  Assert `CreateTaskInputSchema` accepts `revisionOfTaskId`, and `TaskEventKind` includes the five worker kinds.

  ```ts
  expect(CreateTaskInputSchema.parse({
    goal: "revised",
    revisionOfTaskId: "task-old",
  }).revisionOfTaskId).toBe("task-old");
  expect(TASK_EVENT_KINDS).toEqual(expect.arrayContaining([
    "worker_started", "worker_activity", "worker_message",
    "worker_completed", "worker_failed",
  ]));
  ```

- [ ] **Step 2: Add revision fields and a database migration**

  Add `revisionOfTaskId: string | null` to `Task`, `revisionOfTaskId` to the create schema, and `revision_of_task_id TEXT` to the tasks table through the existing additive migration path. Map it in `TaskService.create`, `get`, and `list`.

- [ ] **Step 3: Add explicit worker event kinds**

  Export a `TASK_EVENT_KINDS` constant and derive `TaskEventKind` from it. Include:

  ```ts
  "worker_started" | "worker_activity" | "worker_message" |
  "worker_completed" | "worker_failed"
  ```

- [ ] **Step 4: Verify contracts and migration fixtures**

  Run: `pnpm --filter @grokdesk/shared test && pnpm --filter @grokdesk/gateway exec vitest run src/db.test.ts src/db.migration-fixtures.test.ts src/services/tasks.test.ts`

  Expected: all tests pass for fresh and upgraded databases.

- [ ] **Step 5: Commit the shared contract**

  ```bash
  git add packages/shared/src/types.ts packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts packages/gateway/src/db.ts packages/gateway/src/db.test.ts packages/gateway/src/services/tasks.ts packages/gateway/src/services/tasks.test.ts
  git commit -m "feat(chat): add revision and worker event contracts"
  ```

### Task 3: Normalize truthful subagent events from the engine

**Files:**
- Modify: `packages/engine-grok/src/types.ts`
- Modify: `packages/engine-grok/src/events.ts`
- Modify: `packages/engine-grok/src/events.test.ts`
- Modify: `packages/gateway/src/services/engine-event-payloads.ts`
- Modify: `packages/gateway/src/services/engine-event-payloads.test.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Modify: `packages/gateway/src/services/runner.test.ts`

- [ ] **Step 1: Add parser fixtures for worker lifecycle envelopes**

  Cover the exact normalized shapes Grok Desk accepts:

  ```ts
  { type: "worker_started", workerId: "w1", label: "Research", objective: "Find evidence" }
  { type: "worker_activity", workerId: "w1", summary: "Reading sources" }
  { type: "worker_message", workerId: "w1", text: "Found three sources" }
  { type: "worker_completed", workerId: "w1", summary: "Research complete" }
  { type: "worker_failed", workerId: "w2", summary: "Connector unavailable" }
  ```

  Unknown or incomplete worker envelopes must produce no worker event rather than a fabricated ID.

- [ ] **Step 2: Run the parser tests red**

  Run: `pnpm --filter @grokdesk/engine-grok exec vitest run src/events.test.ts`

  Expected: FAIL because `NormalizedEngineEvent` does not include worker events.

- [ ] **Step 3: Implement worker normalization**

  Extend `NormalizedEngineEvent` with the five discriminated variants. In `normalizeJsonEvent`, accept both `worker_*` and provider `subagent_*` names, require a non-empty worker ID, and map fields without inferring lifecycle from ordinary thoughts or child tasks.

- [ ] **Step 4: Persist worker events unchanged in the runner**

  Add payload helpers and runner cases:

  ```ts
  case "worker_started":
  case "worker_activity":
  case "worker_message":
  case "worker_completed":
  case "worker_failed":
    this.tasks.appendEvent(task.id, event.type, workerEventPayload(event));
    return "continue";
  ```

  Payloads retain `workerId`, `label`, `objective`, `summary`, and parent worker ID when supplied.

- [ ] **Step 5: Verify parser-to-database identity**

  Run: `pnpm --filter @grokdesk/engine-grok test && pnpm --filter @grokdesk/gateway exec vitest run src/services/engine-event-payloads.test.ts src/services/runner.test.ts`

- [ ] **Step 6: Commit worker ingestion**

  ```bash
  git add packages/engine-grok/src/types.ts packages/engine-grok/src/events.ts packages/engine-grok/src/events.test.ts packages/gateway/src/services/engine-event-payloads.ts packages/gateway/src/services/engine-event-payloads.test.ts packages/gateway/src/services/runner.ts packages/gateway/src/services/runner.test.ts
  git commit -m "feat(chat): ingest truthful worker lifecycle events"
  ```

### Task 4: Build the canonical concurrency-safe conversation projector

**Files:**
- Create: `apps/desktop/src/renderer/lib/conversation-projector.ts`
- Create: `apps/desktop/src/renderer/lib/conversation-projector.test.ts`
- Modify: `apps/desktop/src/renderer/lib/activity-store.ts`
- Modify: `apps/desktop/src/renderer/lib/activity-store.test.ts`
- Modify: `apps/desktop/src/renderer/lib/events-to-activity.ts`
- Modify: `apps/desktop/src/renderer/lib/events-to-activity.test.ts`

- [ ] **Step 1: Define the UI-facing projection types in the failing test**

  Test `projectConversation({ conversationId, tasks, eventsByTask, queue, artifacts })` for:

  - one turn per task,
  - one primary run per turn,
  - workers keyed by worker ID,
  - final answer separate from work notes,
  - approvals/errors/artifacts attached to their turn,
  - pending queue items outside accepted turns.

- [ ] **Step 2: Add permutation tests for concurrent updates**

  Feed the same primary-run and two-worker events in several arrival orders. Sort only for display; reduce terminal state monotonically.

  ```ts
  for (const events of permutations(concurrentFixture)) {
    expect(project(events)).toEqual(expectedSnapshot);
  }
  ```

- [ ] **Step 3: Implement identity-keyed monotonic reducers**

  Add helpers:

  ```ts
  export function mergeRunState(previous: RunState, incoming: RunState): RunState;
  export function mergeWorker(previous: WorkerView | undefined, event: ActivityEvent): WorkerView;
  export function projectConversation(input: ConversationProjectionInput): ConversationSnapshot;
  ```

  Terminal states win over later running/progress events. Answers are selected only from assistant `channel: "text"`; thoughts and diagnostics go to `work`.

- [ ] **Step 4: Centralize noise filtering**

  Create an exported predicate inside the projector module:

  ```ts
  const PROVIDER_NOISE = [
    /^Grok Build session$/i,
    /^Session ready/i,
    /^Still working on tools in the background/i,
    /^Grok CLI .* probing capabilities/i,
    /^Isolated Grok profile/i,
  ];
  ```

  Noise remains available as diagnostic work detail but never becomes a milestone or conversation row.

- [ ] **Step 5: Verify projector determinism**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/lib/conversation-projector.test.ts src/renderer/lib/activity-store.test.ts src/renderer/lib/events-to-activity.test.ts`

- [ ] **Step 6: Commit the projector**

  ```bash
  git add apps/desktop/src/renderer/lib/conversation-projector.ts apps/desktop/src/renderer/lib/conversation-projector.test.ts apps/desktop/src/renderer/lib/activity-store.ts apps/desktop/src/renderer/lib/activity-store.test.ts apps/desktop/src/renderer/lib/events-to-activity.ts apps/desktop/src/renderer/lib/events-to-activity.test.ts
  git commit -m "feat(chat): add canonical conversation projection"
  ```

### Task 5: Render calm turns with expandable work and connected workers

**Files:**
- Create: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/live-work-card.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/worker-strip.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/work-details.tsx`
- Create: `apps/desktop/src/renderer/components/conversation/conversation-turn.test.tsx`
- Modify: `apps/desktop/src/renderer/components/task-stream.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/components/subagent-hud.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/de.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/es.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/fr.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/ja.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/pt.json`
- Modify: `apps/desktop/src/renderer/i18n/locales/zh.json`

- [ ] **Step 1: Write renderer tests for the default hierarchy**

  Assert a running turn shows the user message, exactly one live work card, worker counts, and no raw thoughts/session rows. Assert “View work” reveals thoughts, tools, and diagnostics.

- [ ] **Step 2: Implement the four focused components**

  Component contracts:

  ```ts
  <ConversationTurn turn={turn} onEdit={onEdit} />
  <LiveWorkCard run={turn.primaryRun} workers={turn.workers} />
  <WorkerStrip workers={turn.workers} onSelect={setSelectedWorkerId} />
  <WorkDetails entries={turn.work} selectedWorkerId={selectedWorkerId} />
  ```

  `LiveWorkCard` uses one polite live region. `WorkDetails` defaults open only while the user explicitly keeps it open; completion does not force it open.

- [ ] **Step 3: Replace heuristic stream composition at the workspace boundary**

  Pass `ConversationSnapshot` or projected `ConversationTurn[]` into `TaskStream`. Retain Markdown/artifact/approval renderers, but remove `ThinkingTrail` as a top-level default row. Keep the old full-log rendering only inside `WorkDetails` during migration.

- [ ] **Step 4: Move worker interaction into the turn**

  Replace the numeric header-only subagent popover with the connected `WorkerStrip`. Clicking a worker filters work detail in place and never changes the selected task ID.

- [ ] **Step 5: Add complete localized copy**

  Add keys for “View work,” “Hide work,” “Grok is working,” worker counts, “Waiting for your approval,” “Submitting message,” “Edited,” and recovery states in every locale.

- [ ] **Step 6: Verify default calmness and disclosure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/components/conversation/conversation-turn.test.tsx src/renderer/lib/conversation-projector.test.ts src/renderer/ui-structure.test.ts`

- [ ] **Step 7: Commit the conversation presentation**

  ```bash
  git add apps/desktop/src/renderer/components/conversation apps/desktop/src/renderer/components/task-stream.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx apps/desktop/src/renderer/components/subagent-hud.tsx apps/desktop/src/renderer/i18n/locales
  git commit -m "feat(chat): render calm concurrent conversations"
  ```

### Task 6: Add edit-and-rerun revision semantics

**Files:**
- Create: `apps/desktop/src/renderer/lib/turn-revision.ts`
- Create: `apps/desktop/src/renderer/lib/turn-revision.test.ts`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `packages/gateway/src/services/run-context.ts`
- Modify: `packages/gateway/src/services/run-context.test.ts`

- [ ] **Step 1: Test revision eligibility and lineage**

  The first version permits only the latest accepted, non-running user turn. Assert the edit payload preserves conversation membership and sets `revisionOfTaskId`.

  ```ts
  expect(revisionIntent(latestTurn)).toEqual({
    sourceTaskId: latestTurn.taskId,
    initialText: latestTurn.userMessage,
    allowed: true,
  });
  ```

- [ ] **Step 2: Add the turn Edit action and revision composer state**

  “Edit” loads the message and attachments into the existing composer with a visible “Editing message” banner and Cancel action. Submission uses a new mutation ID and `revisionOfTaskId`; it never updates the old task row.

- [ ] **Step 3: Exclude the superseded request from revision context**

  Update run-context construction so a revision receives conversation history through the source turn’s parent, followed by the revised goal. It must not include the original goal twice.

  ```ts
  const historyCutoffId = task.revisionOfTaskId
    ? tasks.get(task.revisionOfTaskId)?.parentTaskId
    : task.parentTaskId;
  ```

- [ ] **Step 4: Project revision markers**

  Mark the original turn `superseded` and the new turn `revisionOfTurnId`. Show the original collapsed with “Edited”; keep it accessible in history.

- [ ] **Step 5: Verify revision behavior**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/lib/turn-revision.test.ts src/renderer/components/conversation/conversation-turn.test.tsx && pnpm --filter @grokdesk/gateway exec vitest run src/services/run-context.test.ts`

- [ ] **Step 6: Commit edit-and-rerun**

  ```bash
  git add apps/desktop/src/renderer/lib/turn-revision.ts apps/desktop/src/renderer/lib/turn-revision.test.ts apps/desktop/src/renderer/components/conversation/conversation-turn.tsx apps/desktop/src/renderer/components/views/task-workspace-view.tsx apps/desktop/src/renderer/App.tsx packages/gateway/src/services/run-context.ts packages/gateway/src/services/run-context.test.ts
  git commit -m "feat(chat): add edit and rerun revisions"
  ```

### Task 7: Connect approvals, browser activity, artifacts, and failures to turns

**Files:**
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.ts`
- Modify: `apps/desktop/src/renderer/lib/conversation-projector.test.ts`
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx`
- Modify: `apps/desktop/src/renderer/components/recovery-banner.tsx`
- Modify: `apps/desktop/src/renderer/components/browser-pane-slot.tsx`
- Modify: `apps/desktop/src/renderer/lib/browser-activity-from-events.ts`
- Modify: `apps/desktop/src/renderer/lib/browser-activity-from-events.test.ts`

- [ ] **Step 1: Add mixed-concurrency projection tests**

  Build a fixture where one worker finishes, another fails, the browser opens, an artifact is created, and the primary run waits for approval. Assert each state attaches to the correct turn/worker and the turn state is `waiting_approval`, not failed.

- [ ] **Step 2: Render one authoritative action surface**

  Put approval/question controls inside the affected turn. The top strip may remain as a jump cue, but cannot duplicate the decision controls. Browser activity opens the pane and appears as one work entry; artifacts remain beside the answer.

- [ ] **Step 3: Make failure containment explicit**

  Worker failure produces a worker badge and work-detail error. Turn failure appears only from the primary task terminal state. Recovery actions are derived from the turn error and do not overwrite completed answers.

- [ ] **Step 4: Verify connected state**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/renderer/lib/conversation-projector.test.ts src/renderer/lib/browser-activity-from-events.test.ts src/renderer/components/conversation/conversation-turn.test.tsx`

- [ ] **Step 5: Commit connected turn state**

  ```bash
  git add apps/desktop/src/renderer/lib/conversation-projector.ts apps/desktop/src/renderer/lib/conversation-projector.test.ts apps/desktop/src/renderer/components/conversation/conversation-turn.tsx apps/desktop/src/renderer/components/recovery-banner.tsx apps/desktop/src/renderer/components/browser-pane-slot.tsx apps/desktop/src/renderer/lib/browser-activity-from-events.ts apps/desktop/src/renderer/lib/browser-activity-from-events.test.ts
  git commit -m "feat(chat): connect task activity to conversation turns"
  ```

### Task 8: Verify concurrency, package the app, and run the live matrix

**Files:**
- Create: `docs/analysis/2026-07-15-conversation-orchestration-qa.md`
- Verify all modified files.

- [ ] **Step 1: Run whitespace, type, and full test verification**

  ```bash
  git diff --check
  pnpm typecheck
  pnpm test
  ```

  Expected: all commands exit 0 with no failing tests.

- [ ] **Step 2: Build and verify the signed macOS package**

  ```bash
  pnpm --filter @grokdesk/desktop dist:mac
  codesign --verify --deep --strict --verbose=2 "apps/desktop/release/mac-arm64/Grok Desk.app"
  shasum -a 256 apps/desktop/release/Grok\ Desk-*.dmg apps/desktop/release/Grok\ Desk-*.zip
  ```

  Expected: distribution exits 0, signature verification reports valid code, and checksums are printed.

- [ ] **Step 3: Run the packaged live QA matrix against disposable conversations**

  Record each result in the QA document:

  1. Two-sentence answer: no redundant thought row.
  2. Long read-only run: one meaningful live card and a complete final answer.
  3. Queue one follow-up during the long run: exactly one accepted task row.
  4. Edit the queued item before acceptance: only edited text runs.
  5. Two concurrent workers: independent state, connected results, no navigation away.
  6. One failed worker plus successful primary run: parent can still complete.
  7. Approval: working state becomes waiting and exposes one decision surface.
  8. Browser activity: in-app pane opens and the event appears in work detail.
  9. Edit latest user message: original is marked Edited and revised context excludes the original request.
  10. Restart during queue submission: no duplicate task is created.

- [ ] **Step 4: Inspect the database for exactly-once acceptance**

  Query the disposable conversation and assert every queue `clientMutationId` maps to one mutation receipt and one task ID. Do not include credentials or private prompt content in the QA report.

- [ ] **Step 5: Commit QA evidence**

  ```bash
  git add docs/analysis/2026-07-15-conversation-orchestration-qa.md
  git commit -m "test(chat): document conversation orchestration QA"
  ```

## Follow-on project: browser preview Edit mode

After this plan passes its live matrix, create a separate design for rendered-element selection, source mapping, screenshot/DOM context, annotations, and sending those annotations as structured conversation context. Do not add DOM editing to Tasks 1–8.
