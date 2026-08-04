# Claim-to-test matrix

Until the linked tests and phase-exit reports pass, **do not claim** the product is fully sandboxed, fully audited, remotely idempotent, provider-independent, or production-relay verified.

| Claim area | Invariant | Evidence owner | Automated tests / scripts | Last verified |
|---|---|---|---|---|
| **Sandboxing / policy** | Denied FS/shell/network/MCP/browser/desktop/secret ops cannot run via provider or hooks; unenforceable policy fails closed or visibly degrades | Gateway + engine-grok + provider-grok | `packages/shared/src/policy.test.ts`, `packages/shared/src/p0/sec01-policy-boundary.test.ts`, `packages/engine-grok/src/p0/sec01-executes-own-tools.test.ts`, `packages/gateway/src/p0/sec01-task-policy.test.ts`, `packages/gateway/src/p0/fail-closed-policy.test.ts`, `packages/gateway/src/services/policy-provider-gate.test.ts` (pure decision table), **ACP:** `packages/provider-grok/src/acp-session.test.ts`, `acp-policy-broker.test.ts`, `packages/gateway/src/provider-composition.test.ts` (deny shell ⇒ no tool; headless default; GROKDESK_ACP opt-in factory) | Phase 1 + ACP fake + gate extract 2026-07-14; product path still headless default |
| **Audit / receipts** | Every effect yields structured redacted `OperationReceipt` at authoritative broker | Gateway + ACP broker | `operation-receipts.ts` + redact tests; `p0/tool-operation-receipts.test.ts`; **`p0/browser-tool-receipts.test.ts`** (browser_open allow/deny); policy gates + `task.submit`; ACP `onAuthorizationReceipt` | Partial Phase 2–3 (FS/shell + browser host paths proven) |
| **Idempotency** | Replayed/retried remote mutations do not repeat effects; durable by principal+method+clientMutationId | Gateway + shared IPC | `packages/gateway/src/p0/remote-idempotency.test.ts`, `packages/shared/src/p0/client-mutation-id.schema.test.ts` | Phase 1.4 |
| **Remote principal / isolation** | Remote ops bound to authenticated device; no cross-device rekey/telepresence | Gateway remote session | `packages/gateway/src/p0/remote-principal.test.ts` | Phase 1.3 |
| **Credential storage** | No plaintext secrets in SQLite, renderer, logs, diagnostics, project config | Vault + settings + mcp-config | `packages/shared/src/p0/secret-canary.test.ts`, `packages/gateway/src/p0/secret-settings.test.ts`, desktop redact tests | Phase 1.2 |
| **Electron boundary** | No hostile navigation; only http(s) external; privileged IPC validates sender | Desktop main | `apps/desktop/src/main/p0/electron-security.test.ts` | Phase 1.1 |
| **Crash durability** | Crash cannot leave ambiguous task state or silent duplicate work | Gateway runner/tasks | `packages/gateway/src/p0/task-crash-recovery.test.ts` (characterization Phase 0; full leases Phase 2) | Partial |
| **Subprocess lifecycle** | Cancel awaits exit; SIGTERM then SIGKILL; budgets | engine-grok | `packages/engine-grok/src/p0/subprocess-lifecycle.test.ts` | Phase 1.6 |
| **Provider independence** | Neutral contracts; Grok is adapter one | agent-runtime + provider-grok | Conformance kit (fake); ACP fake peer; composition root Grok only; registry preflight; **AgentProviderEngine** dual-path (`agent-provider-engine.test.ts`: caps→executesOwnTools, session reuse, fail/done; env `GROKDESK_PROVIDER_ENGINE=1`); remote submit path; second provider blocked; **default executor still engine-grok** | Partial Phase 3 (bridge green; default cutover open) |
| **Production relay** | Content-blind + auth/limits verified against deploy source | remote-relay + grok-landing | `scripts/remote-live-smoke.mjs` (local/canary); production requires auth | Local harness only |
| **Dependency audit** | Known moderates reviewed or fixed | ops | `docs/evidence/audit-exceptions.md` (postcss, uuid mobile Expo) | 2026-07-14 exceptions |

## How to use

1. Before marketing or status-doc claims, require a green row with a dated phase-exit report under `docs/evidence/`.
2. Prefer linking test file + invariant ID over checkboxes.
3. Stale paths (test renamed/removed) invalidate the claim until re-verified.
