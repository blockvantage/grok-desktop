# Phase-exit / residual report (current)

Date: 2026-07-15 (resumed)

## Commands

| Command | Exit | Notes |
|---|---|---|
| `pnpm typecheck` | 0 | |
| `pnpm test` | 0 | **1233** (`suite/test-phase6u.txt`) |
| `pnpm test:remote` | 0 | **115** |
| `pnpm build` | 0 | `suite/build-phase6u.txt` |
| `pnpm audit --prod` | non-zero | 2 moderate — `audit-exceptions.md` |
| `git diff --check` | 0 | |

## Residual Phase 6 (resume slice)

- **gateway-domain-deps** + **tasks-create-dispatch** — Gateway.dispatch thin path
- **run-task-host-config** + **run-task-preflight-apply** — runner runTask pure plans
- **create-task-form** + **sign-in-toast** — App pure UI helpers
- **audit-decision** — normalizeAuditDecision for domain deps

Gateway `index.ts` **~957 LOC**.

## Honest status

Full DoD **not** met. Authorization/access blockers remain for vault purge, production relay, and product-default ACP/AgentProvider cutover.

## Module sizes

| Module | LOC |
|---|---|
| gateway index | ~957 |
| runner | ~975 |
| App.tsx | ~1496 |
| task-workspace-view | ~2050 |
