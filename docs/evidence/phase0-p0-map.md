# Phase 0 — P0 finding map and Phase 0/1 execution order

**Date:** 2026-07-14  
**Authority:** `codex_improve.md`  
**Repo baseline:** typecheck/test/test:remote/build green; live smoke correlation bug confirmed.

## P0 map (code verified against current tree)

| ID | Current implementation | Gap | Missing / added tests |
|---|---|---|---|
| **SEC-01** | `GrokBuildEngine.executesOwnTools = true` (`packages/engine-grok/src/session.ts`); runner skips host mediation (`packages/gateway/src/services/runner.ts`); `TaskService.create` hard-codes `allowShell`/`allowNetworkTools` true (`tasks.ts`) | UI policy is not the execution authority | Characterization: policy flags vs real path; fail-closed/degraded when unenforceable |
| **SEC-02** | Settings persist full `mcpServers` JSON including env (`settings.ts`); `writeProjectMcpConfig` expands secrets into `.grok/config.toml` (`mcp-config-write.ts`); `settings.get` returns structure to renderer | Secrets in SQLite, project files, renderer | Secret-canary suite (DB, project config, redacted get, logs) |
| **REMOTE-01** | `RemoteSessionHost` calls `gateway.handle(req)` with no principal (`remote-session.ts`); `remote.rekey` / telepresence start trust body `deviceId` (`index.ts`) | Device A can target device B | Two-device rekey/telepresence adversarial tests |
| **REMOTE-02** | `sealFrame` nonce only; no counter/epoch AAD (`remote-crypto.ts`); mobile sends `clientMutationId` but IPC schema strips it; no receipt store | Replay + retry duplicates mutations | Idempotency store + duplicate delivery tests (crypto replay → protocol v2) |
| **SEC-03** | `sandbox: false`; `setWindowOpenHandler` → `openExternal(url)` unrestricted; no main-window `will-navigate`; IPC handlers ignore sender (`apps/desktop/src/main/index.ts`, `ipc-bridge.ts`) | Hostile navigation / schemes / IPC | URL allowlist + navigation + sender validation unit tests |
| **TASK-01** | Startup builds runner/scheduler; no reconcile of `queued`/`running`/`waiting_approval` (`gateway/src/index.ts` start); crash leaves rows | Phantom running / unpumped queue | Crash-recovery characterization; durable lease full fix in Phase 2 |

## Phase 0/1 execution order

1. **P0.0** Evidence docs: this map + claim-to-test matrix.
2. **P0.1** Repair `scripts/remote-live-smoke.mjs` (request-ID correlation, events, CLI, cleanup).
3. **P0.2** DB migration fixtures for schema versions 0→1→2→3 (+ upgrade tests).
4. **P0.3** Characterization / adversarial tests for SEC-01/02/03, REMOTE-01/02, TASK-01, TASK-03 (SIGTERM).
5. **P1.1** Electron boundary: navigation deny, http(s) external only, IPC sender validation, permission/CSP/Markdown hardening.
6. **P1.2** Credential vault interface + opaque refs + redaction + stop project literals + canaries.
7. **P1.3** `RequestContext` + principal-bound remote methods + telepresence ownership checks.
8. **P1.4** `clientMutationId` schemas + durable mutation receipts (survive restart).
9. **P1.5** Grok containment: version probe hooks, fail-closed/degraded when policy unenforceable, isolation defaults, no plan≡strict claim.
10. **P1.6** Subprocess lifecycle: await exit, SIGTERM→SIGKILL, stderr/line budgets, atomic preflight, `run_progress` not assistant heartbeats.
11. **P1.exit** Full suite + phase-exit report with proven invariants and residual risks.

## Notes

- Full gateway-mediated tool authorization (SEC-01 complete) requires ACP (Phase 3). Phase 1 fail-closed/degraded + honest policy surfaces only.
- Cryptographic frame replay is Phase 4 protocol v2; Phase 1 prevents duplicate **effects** via mutation receipts.
- Production relay source-of-truth (`grok-landing`) is out of workspace — record limits, do not claim production verification.
