# Phase 2 completion progress + Phase 3 start

**Date:** 2026-07-14

## Phase 2 landed this session

| Item | Status | Evidence |
|---|---|---|
| Run attempts + leases wired into TaskRunner | Done | `runner.ts` claimForTask/heartbeat/complete |
| Explicit `RunContext` (no engine monkey-patch) | Done | `run-context.ts`, `runWithMemory` → `setRunContext` |
| Operation receipts on policy decisions | Done | `operation-receipts.ts`, kill-matrix deny test |
| Transactional event sequencing | Done | `tasks.appendEvent` transaction |
| Schedule occurrences uniqueness | Done | earlier + scheduler |
| Kill/restart matrix tests | Done | `p0/kill-restart-matrix.test.ts` |
| TaskSubmissionService | Done | wired to tasks.create |

### Phase 2 still open

- Provider session **resume** (real ACP sessions) — transcript fallback exists
- Declared artifacts replacing mtime harvest
- Schedule edit/delete/history/run-now full API

### Phase 2 also landed (conversations)

| Item | Status | Evidence |
|---|---|---|
| Schema v6 conversations/turns + task columns | Done | `db.ts` migration 6 |
| ConversationService + transcript fallback | Done | `conversations.ts`, tests survive reopen |
| Follow-up reuses conversation; preamble injects transcript | Done | `tasks.create` + `runWithMemory` |

## Phase 3 started

| Item | Status | Evidence |
|---|---|---|
| `packages/agent-runtime` neutral contracts | Done | types, events, provider, registry |
| Fake provider + conformance kit | Done | fake passes full suite (4 test file assertions) |
| `packages/provider-grok` headless adapter | Done (degraded) | fail-closed on unenforceable policy; stub turn |
| `packages/provider-grok` ACP | Not started | target caps documented in `capabilities.ts` |
| Move types out of engine-grok / gateway imports | Not started | composition root still uses engine-grok |

## Phase 4 foundations started

| Item | Status | Evidence |
|---|---|---|
| Directional keys (c2s/s2c/media) | Done | `deriveControlKeysV2` |
| AAD bind machine/device/channel/direction/epoch/seq | Done | `sealFrameV2` / `openFrameV2` |
| ReplayWindow | Done | unit tests reject exact replay |
| Wire v2 into RemoteSessionHost / mobile | Not started | v1 still on the wire |
| Production relay audit (`grok-landing`) | Blocked | out of workspace |

## Suite snapshot

- gateway: 144 tests
- agent-runtime: 4 tests
- provider-grok: 4 tests
- shared remote-crypto v2: 4 tests
- monorepo typecheck green for all packages
