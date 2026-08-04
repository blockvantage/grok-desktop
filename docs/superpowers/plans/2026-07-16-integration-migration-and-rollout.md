# Cross-Repository Integration, Migration, Qualification, and Rollout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the commerce, entitlement, desktop-license, runtime, and updater lanes; migrate historical customers and installed clients safely; qualify supported platforms; and roll out with measurable rollback gates.

**Architecture:** A disposable full-stack test environment proves cross-repository contracts before production data is touched. Idempotent, resumable migration tools backfill Stripe purchases and exchange only allowlisted legacy keys. Release evidence, observability, incident runbooks, and cohort controls are required artifacts rather than manual assumptions.

**Tech Stack:** TypeScript, Vitest, Playwright, Stripe test clocks/CLI, PostgreSQL 16, Docker Compose, Caddy, GitHub Actions, macOS codesign/notarytool, Windows SignTool/NSIS, OpenTelemetry-compatible JSON metrics/logs.

**Design:** `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Entry criteria

Start Task 1 after Contract Gate C1. Start migrations only after all four lane gates are green. Production enablement additionally requires real signed artifacts and real-machine evidence for `darwin-arm64`, `darwin-x64`, and `win32-x64`.

## File responsibility map

- `../grok-landing/docker-compose.yml`: PostgreSQL, entitlement API, outbox worker, health dependencies, and private network boundaries.
- `../grok-landing/deploy/Caddyfile`: public entitlement API allowlist while keeping internal/operator paths private.
- `../grok-landing/scripts/backfill-stripe-entitlements.ts`: resumable historical-purchase backfill.
- `../grok-landing/scripts/audit-backfill.ts`: read-only reconciliation and discrepancy report.
- `../grok-landing/services/entitlement-api/src/cli.ts`: authenticated operator and release commands.
- `scripts/check-cross-repo-contracts.ts`: OpenAPI/crypto drift gate.
- `scripts/e2e/commerce-runtime-flow.ts`: full staging happy-path and failure-path harness.
- `apps/desktop/e2e/paid-readiness.spec.ts`: packaged desktop activation/runtime/read-only flow.
- `.github/workflows/commerce-runtime-integration.yml`: disposable integration environment.
- `.github/workflows/release-desktop.yml`: signed target matrix and release evidence.
- `docs/runbooks/*.md`: database, signing, email, Stripe, release, and entitlement outage procedures.
- `docs/releases/qualification-template.md`: release-gate evidence schema.

### Task 1: Compose the production service boundaries

**Files:**
- Modify: `../grok-landing/docker-compose.yml`
- Modify: `../grok-landing/deploy/Caddyfile`
- Modify: `../grok-landing/.env.example`
- Create: `../grok-landing/tests/deployment-contract.test.ts`

- [ ] **Step 1: Write a failing deployment contract test**

  Parse Compose and Caddy as text/YAML and assert:

  ```ts
  expect(services).toHaveProperty("postgres");
  expect(services).toHaveProperty("entitlement-api");
  expect(services).toHaveProperty("email-worker");
  expect(services.relay.environment).not.toHaveProperty("DATABASE_URL");
  expect(caddy).not.toContain("/internal/v1");
  expect(caddy).not.toContain("/operator/v1");
  ```

- [ ] **Step 2: Verify failure**

  Run from `grok-landing`: `pnpm test -- tests/deployment-contract.test.ts`

  Expected: FAIL because the new services are absent.

- [ ] **Step 3: Add PostgreSQL and service health dependencies**

  Add PostgreSQL 16 with a named volume, `POSTGRES_INITDB_ARGS=--data-checksums`, health check using `pg_isready`, no host port, and secrets supplied through environment/secret store. Add entitlement API and email worker from the same image with distinct commands and tokens. `web` depends on healthy entitlement API; API and worker depend on healthy PostgreSQL.

  Expose only the API's documented public `/v1` activation/lease/release routes through Caddy. Keep portal commands behind web service authentication. Preserve `/relay/*` behavior and give `relay` no new volume, database, key, Stripe, Resend, or artifact environment.

- [ ] **Step 4: Validate the composed graph**

  Run:

  ```bash
  docker compose config --quiet
  pnpm test -- tests/deployment-contract.test.ts
  docker compose up -d --build postgres entitlement-api email-worker web relay edge
  docker compose ps
  ```

  Expected: config and tests pass; every service becomes healthy; PostgreSQL and internal API ports are not published on the host.

- [ ] **Step 5: Commit in `grok-landing`**

  ```bash
  git add docker-compose.yml deploy/Caddyfile .env.example tests/deployment-contract.test.ts
  git commit -m "feat: compose entitlement production boundary"
  ```

### Task 2: Add cross-repository drift and crypto gates

**Files:**
- Create: `scripts/check-cross-repo-contracts.ts`
- Create: `scripts/check-cross-repo-contracts.test.ts`
- Create: `.github/workflows/commerce-runtime-integration.yml`

- [ ] **Step 1: Write a failing deterministic drift test**

  ```ts
  expect(checkContracts({ landing: fixtureA, desktop: fixtureA })).toEqual({ ok: true });
  expect(checkContracts({ landing: fixtureA, desktop: fixtureB })).toEqual({
    ok: false,
    differences: ["openapiSha256", "cryptoVectorsSha256"],
  });
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm exec vitest run scripts/check-cross-repo-contracts.test.ts`

- [ ] **Step 3: Implement byte-based comparison**

  Normalize line endings only; compare SHA-256 for the OpenAPI file, error registry, crypto vectors, and manifest vectors. Print file names and expected/actual digests, never contract bearer fixtures. Exit 1 on drift.

- [ ] **Step 4: Add CI orchestration**

  The workflow checks out both repositories at explicitly supplied SHAs, starts PostgreSQL and the entitlement API, runs migrations, executes both vector suites, runs the drift checker, then runs commerce/desktop contract tests. Pin action versions and Node 20; grant read-only repository contents except for artifact upload.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm exec vitest run scripts/check-cross-repo-contracts.test.ts && pnpm exec tsx scripts/check-cross-repo-contracts.ts ../grok-landing`

  Expected: PASS with identical digest summary.

  ```bash
  git add scripts/check-cross-repo-contracts.ts scripts/check-cross-repo-contracts.test.ts .github/workflows/commerce-runtime-integration.yml
  git commit -m "ci: gate cross-repository entitlement contracts"
  ```

### Task 3: Build the commerce-to-runtime staging harness

**Files:**
- Create: `scripts/e2e/commerce-runtime-flow.ts`
- Create: `scripts/e2e/commerce-runtime-flow.test.ts`
- Create: `apps/desktop/e2e/paid-readiness.spec.ts`
- Modify: `apps/desktop/e2e/playwright.config.ts`

- [ ] **Step 1: Write a failing scenario ledger test**

  ```ts
  expect(requiredScenarios.map((x) => x.id)).toEqual([
    "purchase-and-recover",
    "three-devices-and-transfer",
    "rotate-key",
    "refund-and-expire",
    "clean-managed-runtime-install",
    "paired-update-and-rollback",
  ]);
  ```

- [ ] **Step 2: Verify failure**

  Run: `pnpm exec vitest run scripts/e2e/commerce-runtime-flow.test.ts`

- [ ] **Step 3: Implement the API harness**

  Use Stripe test fixtures/CLI to create paid, duplicate, refunded, and disputed events. Poll by correlation ID until entitlement/outbox state is durable. Exchange success and magic-link sessions, reveal a key, obtain per-target grants, activate devices A/B/C concurrently, assert D receives `seat_limit`, deactivate B, activate D, rotate the key, assert old-key activation fails, refresh A by device proof, refund, and assert new refresh/download denial.

  Every assertion writes a safe JSON ledger containing IDs, status codes, elapsed time, and artifact digests; it must redact keys/tokens using the shared secret-canary matcher.

- [ ] **Step 4: Implement packaged desktop readiness E2E**

  Launch with no global Grok on PATH and an empty user-data directory. Activate through the real main-process seam, install a small signed test runtime fixture, authenticate a non-billable fake account boundary only in the test build, run a deterministic provider smoke call, expire the lease clock, and assert task submission is blocked while conversation view/export still work. Production composition must reject the test runtime signer.

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  pnpm exec vitest run scripts/e2e/commerce-runtime-flow.test.ts
  pnpm --filter @grokdesk/desktop e2e -- paid-readiness.spec.ts
  ```

  Expected: PASS against the disposable stack; failure injection produces the declared safe codes.

  ```bash
  git add scripts/e2e apps/desktop/e2e/paid-readiness.spec.ts apps/desktop/e2e/playwright.config.ts
  git commit -m "test: cover paid readiness end to end"
  ```

### Task 4: Backfill historical Stripe purchases safely

**Files:**
- Create: `../grok-landing/scripts/backfill-stripe-entitlements.ts`
- Create: `../grok-landing/scripts/audit-backfill.ts`
- Create: `../grok-landing/tests/backfill-stripe-entitlements.test.ts`
- Modify: `../grok-landing/package.json`

- [ ] **Step 1: Write failing resume/idempotency tests**

  Feed two pages containing duplicates, an unpaid session, a refunded payment, missing email, and a transient API failure. Assert a rerun creates no duplicate order/entitlement and resumes from a durable cursor.

  ```ts
  expect(report).toMatchObject({ scanned: 6, inserted: 2, skippedUnpaid: 1, manualReview: 1 });
  expect(secondRun.inserted).toBe(0);
  expect(secondRun.alreadyPresent).toBe(2);
  ```

- [ ] **Step 2: Verify failure**

  Run from `grok-landing`: `pnpm test -- tests/backfill-stripe-entitlements.test.ts`

- [ ] **Step 3: Implement dry-run-first backfill**

  Require `--mode=dry-run|apply`, `--starting-after`, `--ending-before`, `--limit`, and `--report`. List Checkout sessions from Stripe, retrieve required payment/refund details, normalize locale/email, and call the internal backfill command with Stripe IDs as idempotency keys. Persist the last completed page cursor only after the batch transaction succeeds.

  The output report contains counts and safe Stripe/entitlement references, never keys. Missing/ambiguous email or multiple conflicting purchases enters `manual_review`; the script never auto-merges unrelated customers.

- [ ] **Step 4: Add reconciliation**

  `audit-backfill.ts` compares eligible paid sessions to orders/entitlements and reports missing, duplicate, status-mismatch, and locale-mismatch records without mutation.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm test -- tests/backfill-stripe-entitlements.test.ts && pnpm exec tsx scripts/backfill-stripe-entitlements.ts --mode=dry-run --limit=10 --report=/tmp/gd-backfill.json`

  Expected: tests pass and dry-run writes a redacted report without database mutation.

  ```bash
  git add scripts/backfill-stripe-entitlements.ts scripts/audit-backfill.ts tests/backfill-stripe-entitlements.test.ts package.json
  git commit -m "feat: backfill historical paid entitlements"
  ```

### Task 5: Migrate installed desktop licenses without exposing secrets

**Files:**
- Create: `apps/desktop/src/main/license-migration.ts`
- Create: `apps/desktop/src/main/license-migration.test.ts`
- Modify: `packages/gateway/src/services/settings.ts`
- Modify: `packages/gateway/src/services/settings.test.ts`
- Create: `docs/runbooks/legacy-license-migration.md`

- [ ] **Step 1: Write failing migration state tests**

  Cover no legacy row, allowlisted GD2 exchange, rejected GD1/H1, unrecognized GD2, vault failure, interrupted exchange, successful SQLite purge, and restart after success. Assert conversations, artifacts, preferences, and SuperGrok credentials are untouched.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/license-migration.test.ts && pnpm --filter @grokdesk/gateway test -- src/services/settings.test.ts`

- [ ] **Step 3: Implement a durable migration journal**

  Use states `detected`, `exchange_started`, `vault_written`, `lease_received`, `legacy_purged`, and `complete`. Send GD2 only to the explicit exchange endpoint; never locally transform it into GD3. Reject GD1/H1 and development keys with `legacy_key_unsupported` plus recovery/support links.

  Write GD3/device private material to OS credential storage before deleting the SQLite legacy row. After a successful reread and lease verification, purge the full key and activation signature columns and vacuum only during idle maintenance. Store only safe migration status and entitlement/activation IDs in the journal.

- [ ] **Step 4: Verify secret canaries and preservation**

  Run:

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/license-migration.test.ts
  pnpm --filter @grokdesk/gateway test -- src/services/settings.test.ts src/p0/secret-settings.test.ts
  ```

  Expected: PASS; database fixture scan finds neither `GD1.`, `GD2.`, `GD3.`, nor activation secret material after completion.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/desktop/src/main/license-migration.ts apps/desktop/src/main/license-migration.test.ts packages/gateway/src/services/settings.ts packages/gateway/src/services/settings.test.ts docs/runbooks/legacy-license-migration.md
  git commit -m "feat: migrate legacy desktop licenses"
  ```

### Task 6: Add observability, alerts, backups, and restore evidence

**Files:**
- Create: `../grok-landing/services/entitlement-api/src/observability/metrics.ts`
- Create: `../grok-landing/services/entitlement-api/src/observability/safe-log.ts`
- Create: `../grok-landing/services/entitlement-api/src/observability/alerts.yml`
- Create: `../grok-landing/tests/observability.test.ts`
- Create: `docs/runbooks/database-backup-restore.md`
- Create: `docs/runbooks/entitlement-outage.md`
- Create: `docs/runbooks/email-outage.md`
- Create: `docs/runbooks/stripe-replay.md`

- [ ] **Step 1: Write failing metric and redaction tests**

  Assert counters/histograms for checkout completion, webhook backlog, email retries, activation outcomes, seat limits, lease refresh, magic links, grants, manifest checks, runtime install, update adoption, and rollback. Feed every secret class to the safe logger and assert replacement with `[REDACTED]`.

- [ ] **Step 2: Implement bounded-cardinality telemetry**

  Labels may include stable code, product, channel, platform, architecture, and release version. They must not include email, product key, token, session, IP, device ID, entitlement ID, activation ID, artifact URL, or request body.

- [ ] **Step 3: Configure alerts**

  Define alerts for webhook age, email backlog, database health, signing failure, invalid-signature spike, backup failure, restore-point age, manifest approaching expiry, revoked artifact request, runtime-install failure, and rollback spike. Every alert links to a checked-in runbook.

- [ ] **Step 4: Execute a restore drill**

  Restore an encrypted backup into an isolated PostgreSQL instance, run schema checksum and order/entitlement/activation counts, verify one reconstructed key and one lease public-key check, then destroy the isolated instance. Record duration, RPO, RTO, backup ID, and safe checksums.

- [ ] **Step 5: Verify and commit**

  Run from `grok-landing`: `pnpm test -- tests/observability.test.ts && pnpm --dir services/entitlement-api test`

  ```bash
  git add services/entitlement-api/src/observability tests/observability.test.ts ../grok-desktop/docs/runbooks
  git commit -m "ops: add entitlement observability and recovery"
  ```

### Task 7: Qualify signed packages and managed updates on real machines

**Files:**
- Modify: `.github/workflows/release-desktop.yml`
- Create: `docs/releases/qualification-template.md`
- Modify: `docs/packaging-macos.md`
- Modify: `docs/packaging-windows.md`
- Create: `docs/runbooks/bad-release-rollback.md`
- Create: `docs/runbooks/artifact-revocation.md`

- [ ] **Step 1: Make the CI matrix explicit**

  Build `darwin-arm64`, `darwin-x64`, and `win32-x64`; do not publish portable Windows or Windows ARM64. Require tests, typecheck, contract/vector checks, package smoke, codesign/Authenticode verification, notarization/stapling on macOS, malware scan, SHA-256, artifact catalog import, and release approval before manifest signing.

- [ ] **Step 2: Execute the macOS matrix**

  On real Apple silicon and Intel Macs: clean install with no global Grok; Gatekeeper; activation; Keychain persistence; runtime install; first real task; update from previous stable; interrupted download; runtime probe failure; rollback; repair; and uninstall choice. Record OS build, hardware, Desk/Grok versions, signatures, hashes, and evidence links.

- [ ] **Step 3: Execute the Windows x64 matrix**

  On a standard user: NSIS install; Verified Publisher; activation; Credential Manager persistence; runtime install; real task; update/restart/rollback; antivirus quarantine simulation; file lock; proxy; long path; non-ASCII username; repair; and uninstall data choice.

- [ ] **Step 4: Enforce Windows ARM64 holdback**

  Add a release assertion that rejects `win32-arm64` unless the release record contains a native Desk artifact, native Grok artifact, full suite evidence, real hardware ID, signing evidence, and explicit approval. Browser and portal selectors must omit it meanwhile.

- [ ] **Step 5: Verify and commit**

  Run:

  ```bash
  pnpm typecheck
  pnpm test
  pnpm build
  pnpm --filter @grokdesk/desktop exec vitest run src/packaging.smoke.test.ts
  ```

  Expected: automated gates pass; release remains blocked until manual evidence fields are complete.

  ```bash
  git add .github/workflows/release-desktop.yml docs/releases/qualification-template.md docs/packaging-macos.md docs/packaging-windows.md docs/runbooks/bad-release-rollback.md docs/runbooks/artifact-revocation.md
  git commit -m "ci: enforce qualified signed desktop releases"
  ```

### Task 8: Roll out by cohort and remove legacy paths

**Files:**
- Create: `docs/runbooks/commerce-runtime-rollout.md`
- Create: `../grok-landing/services/entitlement-api/src/cli/rollout.ts`
- Create: `../grok-landing/tests/rollout-cli.test.ts`
- Modify: `packages/engine-grok/src/index.ts`
- Delete: `packages/engine-grok/src/fake-engine.ts`
- Delete: `packages/engine-grok/src/fake-engine.test.ts`
- Modify: `packages/gateway/src/services/release-manifest.ts`

- [ ] **Step 1: Write failing rollout-control tests**

  Verify allowlist, 1%, 5%, 25%, 50%, and 100% cohort selection is deterministic by salt; platform pause overrides global percentage; artifact revocation overrides every cohort; unauthorized operator and missing reason are rejected.

- [ ] **Step 2: Implement rollout commands and go/no-go ledger**

  Commands are `rollout set`, `rollout pause`, `rollout resume`, `artifact revoke`, and `release inspect-cohort`. Every mutation requires operator identity, reason, release ID, expected current sequence, and audit output. Stable manifest publication keeps two-person approval.

- [ ] **Step 3: Execute cohorts**

  At each cohort, review purchase completion, webhook/email backlog, activation/seat-limit codes, lease health, grant failures, runtime install success, update adoption, crash-free starts, rollback, and support volume. Record a signed decision before advancing. Platform-specific regressions pause only the affected target when safe.

- [ ] **Step 4: Remove legacy paths after measured adoption**

  Revoke old permanent URLs; delete local disk release fallback; delete GD1/H1 production parsing and client-side activation signing; remove full license rows from SQLite; delete production `FakeEngine`; stop global Grok selection; remove portable Windows from the paid flow. Keep explicit development fixtures behind build-time test-only imports that cannot enter production bundles.

- [ ] **Step 5: Run final secret and legacy scans**

  ```bash
  rg 'DOWNLOAD_URL_(MAC|WIN)|0\.0\.0-fallback|FakeEngine|GROKDESK_LICENSE_SECRET|fingerprintMachine|signActivationBlob' . --glob '!node_modules/**' --glob '!docs/superpowers/**'
  pnpm typecheck
  pnpm test
  pnpm build
  ```

  Expected: ripgrep finds only approved test/migration compatibility code; all builds/tests pass.

- [ ] **Step 6: Commit final removals**

  ```bash
  git add docs/runbooks/commerce-runtime-rollout.md packages/engine-grok/src/index.ts packages/gateway/src/services/release-manifest.ts
  git rm packages/engine-grok/src/fake-engine.ts packages/engine-grok/src/fake-engine.test.ts
  git commit -m "refactor: remove legacy licensing and fake runtime paths"
  ```

## Final acceptance evidence

Attach one redacted ledger proving purchase, key recovery, correct architecture download, three activations, fourth denial, transfer, rotation, managed runtime installation with no global Grok, real task, paired update, rollback, temporary entitlement outage, lease-expired read-only behavior, refund denial, and protected local data. Completion also requires current backup-restore, key-rotation, email-outage, webhook-replay, and artifact-revocation drill records.
