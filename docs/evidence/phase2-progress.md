# Phase 2 progress (partial — not full exit gate)

**Date:** 2026-07-14

## Landed

| Piece | Status | Evidence |
|---|---|---|
| Schema v5: `task_run_attempts`, `schedule_occurrences`, `operation_receipts` | Done | `packages/gateway/src/db.ts`, migration fixtures upgrade to v5 |
| `RunAttemptService` lease claim/heartbeat/complete/recover | Done | `services/run-attempts.ts`, `p0/run-attempts.test.ts` |
| `ScheduleOccurrenceService` unique (scheduleId, scheduledFor) | Done | `services/schedule-occurrences.ts`; scheduler uses tryBegin |
| `TaskSubmissionService` (task + run attempt) | Done | Wired into `tasks.create` dispatch |
| Startup recovery uses run-attempt leases + task status interrupt | Done | `recoverInterruptedTasks` |

## Not yet at Phase 2 exit gate

- Full kill -9 / restart matrix at every task state boundary
- Conversations / turns / provider session continuation
- Explicit immutable `RunContext` replacing preamble monkey-patch
- Declared artifacts + transactional event sequencing (table exists; harvest still heuristic)
- Operation receipts generated at policy broker for every effect
- Schedule edit/delete/history/run-now APIs complete

## Honest claim

Phase 2 foundations are in place and tested. **Do not claim** full crash-durable task kernel or follow-up session continuity until the remaining Phase 2 exit items land.
