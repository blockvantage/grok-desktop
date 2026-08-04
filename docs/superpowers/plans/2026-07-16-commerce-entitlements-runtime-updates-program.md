# Commerce, Entitlements, Managed Runtime, and Updates Program Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved paid-before-download system across `grok-landing` and `grok-desktop`, including recoverable keys, three-device enforcement, protected downloads, automatic Grok installation, and compatible live updates for Grok Desk and Grok.

**Architecture:** PostgreSQL and a standalone entitlement API are authoritative for commerce, keys, devices, leases, release eligibility, and audit. The landing site is the Stripe/customer-facing adapter; the desktop main process owns secrets and runtime/update transactions; the gateway independently verifies signed leases at every real Grok operation. Work is divided into file-disjoint lanes with explicit contract and staging gates.

**Tech Stack:** Node.js 20, TypeScript, Fastify, PostgreSQL 16, `pg`, Zod, OpenAPI 3.1, Ed25519, Next.js 16 App Router, Stripe, Resend, Electron 33, React 18/19, Vitest, Playwright, electron-builder, electron-updater, Docker Compose, Caddy.

**Design:** `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Plan set and source-of-truth rule

Execute this file as the program controller. Detailed tasks live in:

1. `docs/superpowers/plans/2026-07-16-entitlement-contracts-and-service.md`
2. `docs/superpowers/plans/2026-07-16-commerce-portal-fulfillment.md`
3. `docs/superpowers/plans/2026-07-16-desktop-entitlement-enforcement.md`
4. `docs/superpowers/plans/2026-07-16-managed-grok-runtime-and-live-updates.md`
5. `docs/superpowers/plans/2026-07-16-integration-migration-and-rollout.md`

The approved design is authoritative for product behavior. The entitlement service OpenAPI document and crypto vectors become authoritative for wire and byte-level behavior after Contract Gate C1 passes. A worker must not invent a second status name, signature envelope, architecture name, or error code in another repository.

## Non-negotiable invariants

- No trial and no production `FakeEngine` path.
- Payment precedes product-key reveal and installer authorization.
- An active personal entitlement allows exactly three active device records.
- Product keys, device private keys, magic-link tokens, portal sessions, and private signing material never enter renderer state, URLs, analytics, SQLite, logs, diagnostics, or email-provider metadata.
- A 30-day signed lease is refreshed after 24 hours when online; expiry or successful revocation moves new Grok-backed operations to read-only without hiding local data.
- The desktop manages its own Grok runtime under `app.getPath("userData")`; it neither edits PATH nor invokes `grok update` on a global installation.
- Desk and Grok releases are resolved as a signed compatible pair using semantic precedence and architecture-specific artifacts.
- Qualified launch targets are `darwin-arm64`, `darwin-x64`, and `win32-x64`. `win32-arm64` remains unpublished until the complete native qualification matrix passes.
- The remote relay remains blind, stateless, and free of commerce, database, artifact, and signing credentials.

## Parallel ownership matrix

| Lane | Primary repository/files | May start after | Must not edit |
|---|---|---|---|
| C — contracts | `grok-landing/contracts/**`, crypto vectors; generated snapshot in `grok-desktop/packages/shared/src/entitlements/**` | immediately | product UI, runtime manager |
| E — entitlement service | `grok-landing/services/entitlement-api/**`, `deploy/**`, entitlement migrations | C0 naming freeze | landing pages/components, desktop |
| W — web commerce/portal | `grok-landing/src/**`, `tests/**` | C0 route/error freeze; mocks allow earlier UI work | service internals, desktop |
| D — desktop entitlement | `grok-desktop/packages/license/**`, desktop vault/IPC/license UI, gateway guard | C0 schemas; fixtures allow earlier local work | runtime/update modules |
| U — runtime/update | desktop runtime/update modules, packaging, release workflow | C0 manifest schema; signed fixtures allow earlier local work | license implementation and landing UI |
| R — rollout/integration | cross-repository test harnesses, runbooks, migration scripts | C1 plus lane-level green gates | feature internals except integration repairs |

If two lanes need the same composition file—especially `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/ipc-bridge.ts`, `apps/desktop/src/preload/index.ts`, `packages/shared/src/ipc.ts`, `packages/gateway/src/index.ts`, `src/lib/copy.ts`, or `docker-compose.yml`—the owning lane first adds a focused adapter module. A single integration worker then performs the small composition edit after both lane commits are ready.

## Dependency graph

```text
C0 names/routes/claims/errors/architectures
 ├── E1 database + crypto core ── E2 activation/lease ── E3 portal/release/download
 ├── W1 checkout/webhook adapter ── W2 success/email ── W3 portal
 ├── D1 device vault + local verifier ── D2 activation ── D3 gateway guard/migration
 └── U1 signed manifest resolver ── U2 runtime transaction ── U3 paired updater/release CI

C1 OpenAPI + byte vectors stable
 ├── E/W staging commerce E2E
 ├── E/D activation and lease contract E2E
 └── E/U release grant and manifest E2E

R1 historical backfill + installed-client migration
R2 platform qualification + security/adversarial tests
R3 cohort rollout + legacy removal
```

## Approved-design coverage map

| Design sections | Implementation owner |
|---|---|
| 1–4 purpose, decisions, gaps, architecture, signer isolation | this program plan; entitlement Tasks 1/3/4/9; integration Task 1 |
| 5 PostgreSQL model | entitlement Task 2 |
| 6 checkout and fulfillment | commerce Tasks 1–4; entitlement Task 5 |
| 7 GD3 recovery and rotation | entitlement Tasks 3/4/8; desktop Tasks 2/10/11 |
| 8 device activation and leases | entitlement Tasks 6/7; desktop Tasks 3–8 |
| 9 passwordless portal | entitlement Task 8; commerce Tasks 5/6 |
| 10 refund, chargeback, suspension | entitlement Tasks 5/7; commerce Task 6; integration Task 3 |
| 11 protected downloads | entitlement Task 9; commerce Task 7 |
| 12 desktop readiness/key UX | desktop Tasks 6/11; runtime Task 10 |
| 13 enforcement boundary/read-only | desktop Task 8; runtime Tasks 8/9 |
| 14 managed Grok runtime | runtime Tasks 3–6 |
| 15 signed compatibility manifest | entitlement Tasks 3/9; runtime Tasks 1/2 |
| 16 synchronized live updates | runtime Tasks 7–10 |
| 17 diagnostics and repair | runtime Task 10; desktop Task 11 |
| 18 failure behavior | focused failure tests in every lane; integration Tasks 3/6/7 |
| 19 operator tooling | entitlement Task 10; integration Task 8 |
| 20 security/privacy | entitlement Tasks 3/4/8/11; commerce Tasks 3–8; desktop Tasks 3/6/12 |
| 21 observability/recovery | entitlement Task 11; integration Task 6 |
| 22 cross-repository contracts | entitlement Task 3; desktop Tasks 1/2; integration Task 2 |
| 23 test strategy/adversarial/canaries/platform | every lane gate; integration Tasks 2/3/6/7 |
| 24 migration | integration Tasks 4/5; desktop Task 10 |
| 25 deployment/rollout | integration Tasks 1/8 |
| 26 stable release gates | program gates C1/L1/I1/R1; runtime Tasks 11/12 |
| 27 acceptance criteria | final acceptance sections in all six plans |

## Milestone gates

### Contract Gate C0 — names frozen

- [ ] Freeze canonical targets: `darwin-arm64`, `darwin-x64`, `win32-x64`, `win32-arm64`.
- [ ] Freeze public paths: `/.well-known/grokdesk-keys.json`, `/v1/activations/challenges`, `/v1/activations`, `/v1/activations/deactivation-challenges`, `/v1/activations/current`, `/v1/leases/challenges`, `/v1/leases/refresh`, `/v1/releases/manifest`, `/v1/releases/resolve`, `/v1/download-grants`, `/v1/downloads/redeem`, and portal/internal paths defined in the contracts plan.
- [ ] Freeze identifiers: UUIDv7 database IDs, base64url without padding, RFC 3339 UTC timestamps, lowercase SHA-256 hex, and SemVer 2 versions.
- [ ] Freeze stable error codes and entitlement/license states from the contracts plan.
- [ ] Freeze GD3 canonical JSON and detached Ed25519 signing rules.
- [ ] Record the freeze in both repository pull requests before implementation lanes consume the contracts.

Expected evidence: contract tests fail because only schemas and vectors exist; no feature lane is forced to guess names.

### Contract Gate C1 — generated clients and crypto vectors green

- [ ] Run in `grok-landing`: `pnpm --dir services/entitlement-api test -- src/contracts src/crypto`.
- [ ] Run in `grok-desktop`: `pnpm --filter @grokdesk/shared test -- src/entitlements`.
- [ ] Run the cross-repository drift checker: `pnpm exec tsx scripts/check-cross-repo-contracts.ts ../grok-desktop`.
- [ ] Confirm valid, tampered, expired, rotated, replayed, and wrong-device vectors produce the same result in both repositories.
- [ ] Tag the first contract as `entitlements-contract-v1` and pin the generated desktop snapshot to its SHA-256.

Expected evidence: all commands exit 0 and the generated-client diff is empty.

### Lane Gate L1 — independently deployable/testable lanes

- [ ] Entitlement service migrations apply to an empty database and roll back in a disposable database.
- [ ] Landing purchase, success, email, and portal tests pass against a deterministic fake entitlement client.
- [ ] Desktop activation and enforcement tests pass against a fake HTTP service and signed lease fixtures.
- [ ] Runtime/update tests pass against a local artifact server and signed manifest fixtures.
- [ ] Each lane has a focused commit history and no unrelated file changes.

### Integration Gate I1 — staging system

- [ ] Deploy PostgreSQL and the entitlement API with non-production signing keys.
- [ ] Route landing internal calls over service authentication; do not expose internal endpoints through Caddy.
- [ ] Configure Stripe test-mode webhooks and Resend test recipients.
- [ ] Upload signed test artifacts for every qualified target.
- [ ] Complete purchase → key reveal → protected download → three activations → fourth rejection → device transfer → lease refresh.
- [ ] Complete no-global-Grok first run → managed runtime install → SuperGrok auth → real task.
- [ ] Complete paired Grok/Desk staged update → restart → health commit → rollback injection.

### Release Gate R1 — production eligibility

- [ ] All requirements in design section 26 have machine-readable evidence attached to the release record.
- [ ] macOS ARM64, macOS Intel, and Windows x64 real-machine qualification passes.
- [ ] Backup restore, signing-key rotation, webhook replay, bad-release rollback, and email-outage drills pass.
- [ ] Privacy, terms, support, and purchase copy describe Stripe, Resend, device metadata, checks, downloads, three devices, lifetime stable updates, and separate SuperGrok billing.
- [ ] Rollout dashboards and alerts are live before the first production cohort.

## Program task sequence

### Task 1: Create isolated branches and declare ownership

- [ ] **Step 1: Record clean baselines**

  Run in both repositories:

  ```bash
  git status --short
  git rev-parse HEAD
  ```

  Expected: known user changes are documented; no worker discards or incorporates them accidentally.

- [ ] **Step 2: Create one worktree per lane**

  Use `superpowers:using-git-worktrees`. Suggested branch names are `feat/entitlement-contracts`, `feat/entitlement-service`, `feat/commerce-portal`, `feat/desktop-entitlements`, `feat/managed-runtime-updates`, and `feat/commerce-runtime-rollout`.

- [ ] **Step 3: Put the ownership table in every lane handoff**

  Expected: no two active workers are assigned the same composition file.

### Task 2: Execute the contract lane and open Contract Gate C1

- [ ] **Step 1: Execute the contracts and crypto tasks from the entitlement-service plan first.**
- [ ] **Step 2: Publish the generated desktop snapshot as its own reviewable commit.**
- [ ] **Step 3: Run the C1 commands twice to catch nondeterministic generation.**
- [ ] **Step 4: Merge or cherry-pick the contract commits into every lane before integration.**

### Task 3: Dispatch four implementation lanes in parallel

- [ ] **Step 1: Dispatch E using the entitlement service plan.**
- [ ] **Step 2: Dispatch W using the commerce and portal plan.**
- [ ] **Step 3: Dispatch D using the desktop entitlement plan.**
- [ ] **Step 4: Dispatch U using the managed runtime and live updates plan.**
- [ ] **Step 5: Require test-first commits and a spec-compliance review after every task.**

The W, D, and U lanes use contract-generated fakes until E is deployed. This keeps external-service latency off their critical path.

### Task 4: Integrate composition seams in a controlled order

- [ ] **Step 1: Integrate shared IPC contract additions before desktop main/gateway composition.**
- [ ] **Step 2: Integrate device identity, entitlement controller, runtime manager, then update coordinator into desktop main.**
- [ ] **Step 3: Integrate the entitlement guard before removing `FakeEngine`; the build must never have an unlicensed real-work gap.**
- [ ] **Step 4: Integrate service routing and PostgreSQL into Compose before switching landing webhooks away from Stripe metadata persistence.**
- [ ] **Step 5: Run all lane-focused tests after each composition commit.**

### Task 5: Execute migration, qualification, and rollout

- [ ] **Step 1: Execute every task in the integration/migration/rollout plan.**
- [ ] **Step 2: Hold new purchase enablement until I1 passes.**
- [ ] **Step 3: Hold legacy URL and activation removal until migration metrics reach the approved threshold and rollback remains available.**
- [ ] **Step 4: Roll out by allowlist, 1%, 5%, 25%, 50%, and 100%, with a recorded go/no-go at each stage.**

## Final verification commands

Run from `grok-landing`:

```bash
pnpm lint
pnpm test
pnpm build
pnpm --dir services/entitlement-api typecheck
pnpm --dir services/entitlement-api test
pnpm --dir services/entitlement-api build
docker compose config --quiet
```

Run from `grok-desktop`:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @grokdesk/desktop e2e
pnpm --filter @grokdesk/desktop exec vitest run src/packaging.smoke.test.ts
```

Expected: every command exits 0; the release gate additionally requires signed-package and real-machine evidence, not only automated tests.

## Completion definition

The program is complete only when a paid customer can recover a GD3 key, download through an expiring grant, activate and self-manage three devices, install Grok automatically on a clean qualified machine, run only real Grok work, receive compatible live updates for both products, continue through temporary service outages, and retain read/export access after lease loss. All audited gaps in design section 3 must be removed or covered by a measured, expiring migration path.
