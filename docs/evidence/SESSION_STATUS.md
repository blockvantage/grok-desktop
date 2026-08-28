# Session status (2026-08-28)

**Honest claim:** Phases 0–4 of the upstream-sync / flagship program are implemented on `program/phase-4-trust-and-release`. Live ACP isolation + workspace PNG is proven against grok 1.0.5. Signing, GitHub publish, and grokdesk.app deploy remain owner-gated. Do **not** claim fully sandboxed, fully audited, or production-relay verified.

## Current product path

- Default engine is **ACP** (`grok agent stdio`) when the CLI probes agent stdio.
- Isolated `GROK_HOME` (user hooks not copied); Desk MCP/skills on `session/new`.
- Live fixture: `packages/gateway/src/services/acp-live-cli.fixture.test.ts` — successful prompt without workspace media **fails**. Evidence: `docs/evidence/phase4-exit/live-cli-ok.txt` (`workspacePng=true`).
- Crash recovery requeues `running` and `waiting_approval` when `providerSessionId` is set (no `interrupted_on_restart`).

## Gates (2026-08-28)

See `docs/evidence/phase4-exit/gates.md`.

| Command | Result |
|---|---|
| `pnpm typecheck` | Pass ×2 |
| `pnpm test` | Pass (desktop 1913; gateway 919; live-cli PNG) |
| `release-qa` | Pass 78 ×2 |
| `bundle-budget` | JS 2,102,309 ≤ 2.2 MB |
| `e2e:chat` | **18 passed** (seven flagship journeys including image **and** video) |

## Owner-gated / not claimed

| Item | Status |
|---|---|
| macOS notarization / Windows Authenticode | Owner (O-001) |
| Git tag + GitHub release upload | Owner |
| grokdesk.app O-005–007 deploy | In-repo copy ready; landing repo owner |
| Production relay vs live authenticated deploy | Local harness only |
| Independent security review | External |

## Do not claim

Fully sandboxed · fully audited · production-relay verified · credentials in OS Keychain · deletes always wait under Autopilot · memory never leaves the machine
