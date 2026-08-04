# Ownership Ledger — Commerce/Entitlements Program

**Updated:** 2026-07-17

## Gates

| Gate | Status | Evidence under `{SCRATCH}` |
|---|---|---|
| **C1** | Pass (twice) | `verification-plan-run.log`, `c1-*.log` |
| **L1 commerce** | Pass focused (post portal merge) | 110/110 portal+fulfillment; 212/212 entitlement-api |
| **L1 desktop** | Pass focused (error-map + legacy codes) | packages/license 31, client 16, shared vectors 12; main entitlements/runtime/updates |
| **I1 API** | Pass synthetic 6/6 | `i1-commerce-ledger.json` |
| **Compose health** | Pass migrate-on-start | `compose-migrate-on-start.log` (8 migrations, healthz/readyz) |
| **I1 full** | Partial | No live Stripe/Resend/desktop package |
| **R1** | Not claimed | Needs hardware + KMS |

## Branch tips

| Lane | Branch | Tip |
|---|---|---|
| E service | `feat/entitlement-service` | `5c0a006` migrate-on-start + migration 8 tests |
| W commerce | `feat/commerce-portal` | `79ecf21` Stripe backfill |
| R rollout (landing) | `feat/commerce-runtime-rollout` | `d670d09` portal merge + magic-link lint |
| D+U desktop | `D+U desktop | `feat/desktop-entitlements` | `837b3be` fail-closed + admission + legacy path retired |
| U runtime only | `feat/managed-runtime-updates` | `28107ee` (merged into desktop-entitlements) |
| Contracts desktop | `feat/entitlement-contracts` | `57fd0da` generated client |
| Contracts landing | `feat/entitlement-contracts` | `40207ad` |

## Integration plan coverage

| Task | Status |
|---|---|
| 1 Compose boundary | Done + live health drill |
| 2 Cross-repo CI | Done |
| 3 Staging harness | I1 API ledger done; desktop scaffold soft-skip |
| 4 Stripe backfill | Done (merged into rollout) |
| 5 Desktop legacy migrate | Done (GD2 journaled path) |
| 6 Observability/runbooks | Done + restore drill dry path |
| 7 Release qualification CI | Done (automation; no hardware) |
| 8 Rollout cohort CLI | Done |

## Single-owner integration hotspots

Do not assign two live workers to the same file. Integration composition only on `feat/commerce-runtime-rollout` (landing) and `feat/desktop-entitlements` (desktop) after lane review.

## Never touch

- `grok-landing/.grok-media/`
- `grok-landing/improv.md`
