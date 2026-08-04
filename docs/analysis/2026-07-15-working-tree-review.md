# Grok Desk conversation and browser integration review

**Started:** 2026-07-15
**Updated:** 2026-07-16
**Scope:** Integrated conversation orchestration, chat continuity, durable queue recovery, and in-app browser opening
**Kind:** Implementation status review; packaged live QA remains pending

---

## Executive summary

The working-tree findings that motivated this review have now been integrated. The app has one canonical conversation projection, truthful provider-backed worker lifecycle events, durable exactly-once follow-up submission, per-conversation event caching, edit-and-rerun revisions, turn-local approvals/artifacts/errors, and a host-owned path for opening HTML in the in-app browser.

The default conversation stays calm: the user sees the request, one live status surface, workers only when they actually exist, the answer, and connected deliverables. Detailed progress, provider-emitted work notes, tools, browser activity, and receipts remain available through the canonical turn's expandable **View work** disclosure. The removed legacy `TaskStream` data-work-phase chips are not part of the implemented design.

The remaining release gate is Task 8 of the [conversation orchestration plan](../superpowers/plans/2026-07-15-conversation-orchestration.md): full verification, packaging/signature checks, and the packaged-app live matrix. This document does not claim that those checks have completed.

North star:

> One conversation, one continuous activity timeline, one clear current state, and every side effect visible where it matters.

---

## Current implementation status

| Area | Status | Evidence |
|------|--------|----------|
| Exactly-once queued follow-ups | Implemented and reviewed | `046f7fd` (`fix(chat): make queued follow-ups exactly once`) |
| Revision and worker contracts | Implemented and reviewed | `f5d027a` (`feat(chat): add revision and worker event contracts`) |
| Truthful worker lifecycle | Implemented and reviewed | `4290a17` (`feat(chat): ingest truthful worker lifecycle events`) |
| Canonical conversation projection | Implemented and reviewed | `d31d857` (`feat(chat): add canonical conversation projection`) |
| Calm conversation UI and expandable work | Implemented and reviewed | `88bd0e2` (`feat(chat): render calm concurrent conversations`) |
| Edit and rerun | Implemented and reviewed | `83732cd` (`feat(chat): add edit and rerun revisions`) |
| Turn-local approvals, browser activity, artifacts, and failures | Implemented and reviewed | `13829cd` (`feat(chat): connect task activity to conversation turns`) |
| Multi-chat cache, event identity, queue recovery, thread deliverables | Implemented and reviewed | `78f90a9` and follow-up hardening in `c3215d3`, `8f6ded7`, `26cec39`, and `e14a0f8` |
| One-click in-app HTML opening and visible browser pin | Implemented and reviewed | `e9bdf26` with policy/state hardening in `ad9f20c` and `253dc00` |
| Native database ABI probe | Implemented and reviewed | `76f3cec` (`fix(gateway): probe lazy native database ABI`) |
| Packaged live QA matrix | **Pending** | Task 8; no QA evidence document committed yet |

## What changed from the original review

### Conversation continuity

- `chat-events-cache.ts` and `use-chat-events.ts` retain bounded per-conversation histories, merge events by stable identity, and paint a warm conversation without clearing it during a switch.
- Cold histories remain visibly loading until the authoritative turn set has been fetched completely.
- Late responses are gated by the selected conversation and authoritative task set, preventing events from a previous chat from leaking into the current one.
- Gateway event exports preserve full `TaskEvent` identity (`id`, `taskId`, and `seq`).

### Subagents and progressive disclosure

- The engine normalizes real worker start, progress, completion, failure, and cancellation envelopes; the gateway persists them without collapsing worker identity.
- The UI never invents workers from task ancestry. Worker UI is absent when no truthful worker event exists.
- The canonical `ConversationTurn` owns the live work card, worker strip, approval, answer, deliverables, error, and expandable work detail.
- Progressive work disclosure is provided by `conversation/work-details.tsx`, not the removed legacy `data-work-phase` chips.

### Queue and edit behavior

- Follow-ups carry a stable `clientMutationId` through durable queue claims and gateway receipts.
- Submission leases survive renderer remounts; expired work is recovered by the gateway queue watchdog.
- Queued work is described as waiting and never shown with an active thinking animation.
- Pending/failed queue items remain editable. Accepted latest turns use explicit edit-and-rerun revision lineage rather than mutating history.

### In-app browser

- HTML deliverables expose a localized **Open** action that calls the gateway-owned `browser.openHtml` path.
- The browser pane opens only after a confirmed host result; failed or blocked requests do not create false open state.
- Policy decisions are authorized and revalidated immediately before navigation, including canonical workspace containment for local files.
- The visible browser pin and localized capability labels replace the prior context-menu-only affordance and English hardcodes.
- Model-facing session instructions use the actual underscore tool names, while host-side opening removes tool discovery as a requirement for HTML deliverables.

### Errors, approvals, and artifacts

- Approvals are keyed and rendered once on their owning turn.
- Worker failure remains local to that worker and does not incorrectly fail a successful primary run.
- Browser requests/results are coalesced by stable identity.
- Deliverables are filtered across all task IDs in the conversation and displayed beside the corresponding answer.

---

## Resolved findings

| Original finding | Resolution |
|------------------|------------|
| Browser opening depended entirely on model tool discovery | Host-owned `browser.openHtml` plus deliverable **Open** action; model MCP remains available for agent-driven browsing |
| Chat cleared on every conversation switch | Bounded multi-chat cache with cold/warm loading semantics and authoritative snapshot gates |
| Worker HUD could not receive production events | Provider worker lifecycle normalization and identity-preserving gateway persistence |
| Work detail was missing from the calm stream | Canonical per-turn **View work** disclosure |
| Browser pin was hidden behind right-click | Visible pin control and localized state labels |
| Queue work appeared active while only waiting | Explicit queued/waiting presentation without active animation |
| Gateway browser receipt test crashed during collection | Resolved; current focused run passes 5/5 |

## Remaining work

### Required before declaring the plan complete

1. Run repository whitespace, typecheck, and complete test gates from a clean integrated tree.
2. Build the macOS distribution and verify its signature.
3. Exercise the packaged app with disposable conversations: simple answer, long run, queued follow-up, queued edit, concurrent workers, worker failure containment, approval, browser opening, and edit-and-rerun.
4. Inspect durable receipts/database state for exactly-once acceptance.
5. Commit the resulting QA evidence document.

### Explicitly deferred

- Browser-pane **Edit** mode for selecting rendered elements and attaching source-aware comments.
- Authentication and onboarding redesign.
- Queue reordering.
- Arbitrary historical conversation branching beyond the supported latest-turn edit.
- Claiming access to private chain-of-thought; the UI shows only provider-emitted work notes and observable activity.

---

## Verification evidence for this update

The implementation commits above contain their focused regression suites and independent reviews. During this documentation reconciliation, the previously unstable browser receipt test was re-run directly:

```text
pnpm --filter @grokdesk/gateway test -- src/p0/browser-tool-receipts.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

This focused result closes the stale worker-crash finding. It is not a substitute for Task 8's complete repository and packaged-app verification.

## Related documents

- [Conversation orchestration design](../superpowers/specs/2026-07-15-conversation-orchestration-design.md)
- [Conversation orchestration implementation plan](../superpowers/plans/2026-07-15-conversation-orchestration.md)
- [Chat integrity repair plan](../superpowers/plans/2026-07-15-chat-integrity-repair.md)
- [Product experience audit](2026-07-15-product-experience-audit.md)
