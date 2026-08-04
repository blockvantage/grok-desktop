# Phase 0 + Phase 1 exit report

**Date:** 2026-07-14  
**Authority:** `codex_improve.md`, goal plan acceptance criteria  
**Branch:** `main` (local uncommitted work — no commit without authorization)

## Commands run (captured under session scratch)

| Command | Result | Notes |
|---|---|---|
| `pnpm typecheck` | Pass | All workspace packages |
| `pnpm test` | Pass | **714** tests (baseline 671) |
| `pnpm test:remote` | Pass | **101** tests (shared remote + gateway remote/telepresence e2e + relay + mobile) |
| `pnpm build` | Pass | shared, license, engine, gateway, desktop production |
| `pnpm audit --prod` | Fail (expected) | 2 moderate transitive mobile: postcss, uuid — Phase 6 |
| `git diff --check` | Pass | |
| `node --test scripts/remote-live-smoke.test.mjs` | Pass | ID correlation harness static checks |

Evidence paths: session `scratch/suite/{typecheck,test,test-remote,build,audit,diff-check}.txt`.

## Phase 0 deliverables

| Item | Status | Evidence |
|---|---|---|
| P0 map + Phase 0/1 order | Done | `docs/evidence/phase0-p0-map.md` |
| Claim-to-test matrix | Done | `docs/evidence/claim-to-test-matrix.md` |
| `scripts/remote-live-smoke.mjs` ID correlation, events, CLI, cleanup | Done | script + `scripts/remote-live-smoke.test.mjs` |
| Migration fixtures v1–v3 + empty v0 | Done | `packages/gateway/testdata/migrations/*`, `db.migration-fixtures.test.ts` |
| Characterization / adversarial tests | Done | `**/p0/**` across shared, gateway, engine-grok, desktop |

## Phase 1 deliverables vs exit gate

| Gate | Status | Proof |
|---|---|---|
| Secret canary (project config, renderer settings.get) | **Pass (partial vault)** | `secret-canary.test.ts`, `secret-settings.test.ts`; project write keeps `${ENV}`; settings.get redacts; main-process vault interface + unit tests |
| Cross-device cannot rekey/stop foreign telepresence | **Pass** | `remote-two-device.test.ts`, `remote-principal.test.ts` |
| Duplicate `clientMutationId` does not re-effect | **Pass** | `remote-idempotency.test.ts` + schema; durable `mutation_receipts` v4 |
| Crypto frame replay | **Deferred Phase 4** | Receipts prevent mutation *effects*; AEAD counters not yet |
| Hostile navigation / schemes / IPC sender | **Pass** | `electron-security.test.ts`; main `will-navigate`, `decideExternalUrl`, IPC sender validation, CSP/img/Markdown hardened |
| Denied ops cannot execute via real Grok tools | **Not fully proven** | FakeEngine still mediated; Grok `executesOwnTools=true`; degraded step emitted; fail-closed ACP is Phase 3 |
| SIGTERM→SIGKILL await | **Pass** | `subprocess-lifecycle.test.ts` |
| Crash recovery partial | **Pass (Phase 2 full leases)** | `task-crash-recovery.test.ts` marks running/waiting_approval failed; pumps queued |

## Invariants now proven (automated)

1. Remote principal identity is taken from the authenticated channel; conflicting body `deviceId` is rejected (REMOTE-01).
2. Queueable mutations with `clientMutationId` return durable receipts and do not re-apply on duplicate (REMOTE-02 effects).
3. Electron external open allows only http(s); navigation away from trusted renderer is denied; Markdown blocks dangerous schemes and remote images (SEC-03 partial + SEC-04 partial).
4. Settings IPC and project MCP config do not emit secret canaries as literals (SEC-02 partial).
5. Subprocess cancel awaits exit and escalates to SIGKILL (TASK-03 partial).
6. Unclean restart does not leave permanent phantom-running tasks (TASK-01 partial).
7. Schema upgrades from fixtures v1–v3 reach current version 4.

## Invariants **not** claimed yet

- Full gateway-mediated tool authorization for real Grok CLI (SEC-01 complete → Phase 3 ACP).
- OS keychain durable secret persistence + purge of all historical SQLite literals (SEC-02 complete).
- Cryptographic remote replay window (REMOTE-02 crypto → Phase 4).
- Provider-neutral runtime / second provider (PORT-01 → Phase 3/5).
- Production relay equivalence (REMOTE-05 → Phase 4; requires `grok-landing`).
- Full run-attempt leases, conversations, schedule occurrences (Phase 2).

## Residual risks

- Grok headless path still executes tools inside the CLI; UI policy can over-promise without ACP.
- Vault is main-process interface + redaction; settings may still *store* literals until migration purge is authorized and dual-written.
- `sandbox: true` enabled for renderer; full packaged Electron security e2e not yet run.
- `pnpm audit --prod` still reports Expo transitive moderates.

## Next (Phase 2+)

Per `codex_improve.md`: durable conversations/turns/run attempts/leases, one TaskSubmissionService, schedule occurrences, operation receipts, then agent-runtime + provider-grok ACP.
