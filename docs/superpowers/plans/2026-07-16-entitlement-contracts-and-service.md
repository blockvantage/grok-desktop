# Entitlement Contracts and Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoritative entitlement API and PostgreSQL system for purchases, GD3 keys, three-device activations, signed leases, recovery, protected downloads, release publication, audit, and operator support.

**Architecture:** A standalone Fastify service uses bounded TypeBox/OpenAPI schemas and explicit PostgreSQL transactions. Product-key, lease, portal, and release authorities are isolated; the always-on API has no release-manifest private key, and a one-shot two-person-approved publisher signs manifests. The checked-in OpenAPI and byte-level crypto vectors are the cross-repository source of truth.

**Tech Stack:** Node.js 20, TypeScript, Fastify, TypeBox, PostgreSQL 16, `pg`, `jose`, RFC 8785 canonical JSON, authenticated landing email-delivery adapter, S3-compatible private storage, Pino, prom-client, Vitest, Testcontainers, OpenAPI 3.1.

**Design:** `../grok-desktop/docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Ownership and file map

Create `services/entitlement-api` in `grok-landing`. It owns its own `package-lock.json`, following `services/remote-relay`; the landing root remains pnpm-managed. The service lane must not edit landing pages, Next route handlers, `src/lib/resend.ts`, or the relay.

Core files:

```text
services/entitlement-api/package.json
services/entitlement-api/package-lock.json
services/entitlement-api/tsconfig.json
services/entitlement-api/vitest.config.ts
services/entitlement-api/Dockerfile
services/entitlement-api/src/index.ts
services/entitlement-api/src/app.ts
services/entitlement-api/src/worker.ts
services/entitlement-api/src/release-publisher.ts
services/entitlement-api/src/config.ts
services/entitlement-api/src/errors.ts
services/entitlement-api/src/db/{pool,migrate,transaction}.ts
services/entitlement-api/src/http/{request-context,internal-auth,operator-auth,security-headers}.ts
services/entitlement-api/src/crypto/{canonical,key-ring,product-key,device-proof,device-lease,release-manifest,token-hash,redaction}.ts
services/entitlement-api/src/commerce/{stripe-events,fulfillment,transitions,backfill}.ts
services/entitlement-api/src/activations/{challenges,service}.ts
services/entitlement-api/src/leases/service.ts
services/entitlement-api/src/portal/{recovery,sessions,service}.ts
services/entitlement-api/src/email/{outbox,worker,templates}.ts
services/entitlement-api/src/releases/{catalog,compatibility,rollout,publication}.ts
services/entitlement-api/src/downloads/{grants,object-store}.ts
services/entitlement-api/src/audit/service.ts
services/entitlement-api/src/rate-limits/service.ts
services/entitlement-api/src/retention/worker.ts
services/entitlement-api/src/routes/{public,internal,operator}/**
services/entitlement-api/src/operator-cli/**
services/entitlement-api/openapi/entitlement-api.v1.json
services/entitlement-api/contracts/crypto/v1/*.json
services/entitlement-api/migrations/0001_bootstrap.sql … 0007_retention_and_immutability.sql
services/entitlement-api/test/{unit,integration,contract,adversarial,e2e,helpers}/**
```

The integration lane exclusively edits root Compose/Caddy. One backend integration owner exclusively edits `src/app.ts`, `src/config.ts`, `package.json`, `package-lock.json`, and migration ordering; domain workers export Fastify plugins and avoid those hotspots.

## Frozen API surface

Public desktop endpoints:

- `GET /.well-known/grokdesk-keys.json`
- `POST /v1/activations/challenges`
- `POST /v1/activations`
- `POST /v1/activations/deactivation-challenges`
- `DELETE /v1/activations/current`
- `POST /v1/leases/challenges`
- `POST /v1/leases/refresh`
- `GET /v1/releases/manifest?channel=&target=`
- `POST /v1/releases/resolve`
- `POST /v1/download-grants`
- `GET /v1/downloads/redeem?grant=`
- `GET /healthz` and `GET /readyz`

Internal landing endpoints, all protected by rotating service HMAC:

- `POST /internal/v1/stripe/events`
- `POST /internal/v1/fulfillment/exchange`
- `POST /internal/v1/fulfillment/key/reveal`
- `POST /internal/v1/portal/recovery`
- `POST /internal/v1/portal/magic/exchange`
- `GET /internal/v1/portal/account`
- `POST /internal/v1/portal/key/reveal`
- `POST /internal/v1/portal/key/resend`
- `POST /internal/v1/portal/key/rotate`
- `PATCH /internal/v1/portal/activations/:id`
- `DELETE /internal/v1/portal/activations/:id`
- `POST /internal/v1/portal/download-grants`
- `POST /internal/v1/portal/logout`

Operator endpoints use a private listener/network, OIDC authentication, role checks, reason strings, and audit. They are never routed by public Caddy. OpenAPI operation IDs and stable errors from Task 3 are authoritative for both landing and desktop generated clients.

### Task 1: Scaffold a fail-closed service and migration runner

**Files:**
- Create: `services/entitlement-api/package.json`
- Create: `services/entitlement-api/tsconfig.json`
- Create: `services/entitlement-api/vitest.config.ts`
- Create: `services/entitlement-api/Dockerfile`
- Create: `services/entitlement-api/src/config.ts`
- Create: `services/entitlement-api/src/db/pool.ts`
- Create: `services/entitlement-api/src/db/migrate.ts`
- Create: `services/entitlement-api/test/integration/migrations.test.ts`

- [ ] **Step 1: Write failing empty-database, checksum, and lock tests**

  ```ts
  it("applies each migration once and rejects changed history", async () => {
    await migrate(pool, migrations);
    await migrate(pool, migrations);
    expect(await appliedVersions(pool)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(migrate(pool, mutateChecksum(migrations, 2))).rejects.toMatchObject({
      code: "migration_checksum_mismatch",
    });
  });
  ```

  Run two migrators concurrently and assert PostgreSQL advisory locking serializes them.

- [ ] **Step 2: Verify failure**

  Run: `cd services/entitlement-api && npm test -- test/integration/migrations.test.ts`

  Expected: FAIL because the package and migration runner are absent.

- [ ] **Step 3: Add scripts and pinned dependencies**

  Define `dev`, `start`, `worker`, `release:publish`, `build`, `typecheck`, `lint`, `test`, `test:unit`, `test:integration`, `test:contract`, `test:adversarial`, `test:e2e`, `db:migrate`, `db:status`, `contract:generate`, `contract:check`, `vectors:check`, and `operator`. Install Fastify, TypeBox, `pg`, `jose`, `canonicalize`, AWS S3/presigner, `prom-client`, Pino, Commander, SemVer, TypeScript, Vitest, Testcontainers PostgreSQL, fast-check, and openapi-typescript; commit the generated lockfile.

- [ ] **Step 4: Implement strict configuration**

  ```ts
  export const ConfigSchema = Type.Object({
    NODE_ENV: Type.Union([Type.Literal("development"), Type.Literal("test"), Type.Literal("production")]),
    DATABASE_URL: Type.String({ minLength: 1 }),
    PUBLIC_ISSUER_URL: Type.String({ format: "uri" }),
    PRODUCT_SIGNER_FILE: Type.Optional(Type.String()),
    LEASE_SIGNER_FILE: Type.Optional(Type.String()),
    INTERNAL_AUTH_KEYS_FILE: Type.String({ minLength: 1 }),
  }, { additionalProperties: true });
  ```

  In production, reject missing managed signer configuration, local private-key material without the audited emergency flag, default secrets, HTTP issuer URLs, and database URLs without TLS policy.

- [ ] **Step 5: Implement checksum migrations and verify**

  Store version, name, SHA-256, and applied timestamp in `schema_migrations`; acquire a fixed advisory lock; execute each new SQL file in its own transaction; refuse a digest mismatch.

  Run: `npm run typecheck && npm run test:integration -- migrations.test.ts && npm run build`

  Expected: PASS.

- [ ] **Step 6: Commit**

  ```bash
  git add services/entitlement-api
  git commit -m "feat: scaffold entitlement service"
  ```

### Task 2: Create the authoritative PostgreSQL schema

**Files:**
- Create: `services/entitlement-api/migrations/0001_bootstrap.sql`
- Create: `services/entitlement-api/migrations/0002_commerce.sql`
- Create: `services/entitlement-api/migrations/0003_activations_and_leases.sql`
- Create: `services/entitlement-api/migrations/0004_portal_and_email.sql`
- Create: `services/entitlement-api/migrations/0005_releases_and_downloads.sql`
- Create: `services/entitlement-api/migrations/0006_audit_rate_limits_and_approvals.sql`
- Create: `services/entitlement-api/migrations/0007_retention_and_immutability.sql`
- Create: `services/entitlement-api/test/integration/schema-invariants.test.ts`

- [ ] **Step 1: Write failing database invariant tests**

  Assert: one order per Checkout session; one entitlement per order; seat limit equals 3; update policy equals `lifetime_stable`; active seat slots are unique 1–3; active device thumbprints are unique per entitlement; release-manifest sequences are unique; audit rows cannot update/delete; token columns reject raw bearer prefixes through `CHECK` constraints.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- schema-invariants.test.ts`

- [ ] **Step 3: Implement commerce and entitlement tables**

  Use `gen_random_uuid()`, `timestamptz`, `bigint` money, lowercase ISO currency, and text states with `CHECK`. Create `signing_keys`, `customers`, `orders`, `stripe_events`, `entitlements`, `fulfillment_sessions`, `legacy_key_allowlist`, and `backfill_runs`. Do not make normalized email globally unique and never merge customers solely by email.

  Entitlement state constraint is exactly:

  ```sql
  CHECK (state IN ('active','suspended','chargeback_pending','refunded','revoked','manual_review')),
  CHECK (seat_limit = 3),
  CHECK (update_policy = 'lifetime_stable')
  ```

- [ ] **Step 4: Implement activation, recovery, release, and control tables**

  Add `activation_challenges`, `activations`, `lease_events`, `magic_links`, `magic_link_customers`, `portal_sessions`, `email_outbox`, `releases`, `artifacts`, `compatibility_pairs`, `release_manifests`, `download_grants`, `audit_events`, `rate_limit_buckets`, and `operator_approvals`. Store token/JTI hashes, never complete bearers.

  Add partial unique active indexes on `(entitlement_id, seat_slot)` and `(entitlement_id, device_public_key_thumbprint)`. Add an append-only trigger for audit. Add anonymization/pruning functions while preserving accounting references.

- [ ] **Step 5: Verify migrations from empty and rollback database**

  Run: `npm run db:migrate && npm run test:integration -- migrations.test.ts schema-invariants.test.ts`

  Expected: PASS on an empty Testcontainers database and a database restored from the previous schema snapshot.

- [ ] **Step 6: Commit**

  ```bash
  git add services/entitlement-api/migrations services/entitlement-api/test/integration
  git commit -m "feat: add entitlement database schema"
  ```

### Task 3: Freeze OpenAPI, errors, internal authentication, and crypto vectors

**Files:**
- Create: `services/entitlement-api/src/errors.ts`
- Create: `services/entitlement-api/src/http/internal-auth.ts`
- Create: `services/entitlement-api/src/http/request-context.ts`
- Create: `services/entitlement-api/openapi/entitlement-api.v1.json`
- Create: `services/entitlement-api/contracts/crypto/v1/product-keys.json`
- Create: `services/entitlement-api/contracts/crypto/v1/activation-challenges.json`
- Create: `services/entitlement-api/contracts/crypto/v1/device-leases.json`
- Create: `services/entitlement-api/contracts/crypto/v1/release-manifests.json`
- Create: `services/entitlement-api/test/contract/openapi.test.ts`
- Create: `services/entitlement-api/test/contract/crypto-vectors.test.ts`

- [ ] **Step 1: Write failing stability tests**

  ```ts
  expect(stableErrorCodes).toEqual([
    "invalid_key_format", "invalid_key_signature", "key_rotated",
    "entitlement_suspended", "entitlement_refunded", "entitlement_revoked",
    "seat_limit", "challenge_expired", "challenge_replayed", "device_signature_invalid",
    "clock_skew", "unsupported_client", "unsupported_architecture",
    "device_deactivated", "lease_expired", "lease_device_mismatch",
    "grant_expired", "grant_used", "grant_binding_mismatch", "service_unavailable",
  ]);
  ```

  Assert generated OpenAPI is byte-identical after two runs and every response uses `{ code, message, requestId }` without raw details.

- [ ] **Step 2: Implement rotating internal HMAC authentication**

  Sign exact UTF-8 bytes:

  ```text
  GROKDESK-INTERNAL-V1
  <key-id>
  <unix-seconds>
  <HTTP-method>
  <path-and-query>
  <lowercase-SHA256-body>
  ```

  Require a five-minute window, timing-safe comparison, known active key ID, replay nonce for mutations, and bounded body before hashing. Stripe event re-delivery remains safe by event ID.

- [ ] **Step 3: Define exact GD3, device-proof, lease, and manifest vector inputs**

  GD3 is `GD3.<base64url(RFC8785 claims)>.<base64url(Ed25519 signature)>`; the signature input is ASCII `GD3.<claims>`. Claims are `{ schema:1, entitlementId, productId:"grok-desk", keyVersion, issuedAt, seatLimit:3, updatePolicy:"lifetime_stable", kid }`.

  Activation input is `GROKDESK-ACTIVATE-V1\n<base64url(RFC8785 payload)>`; refresh is `GROKDESK-LEASE-REFRESH-V1\n<base64url(RFC8785 payload)>`; manifest is `GROKDESK-RELEASE-MANIFEST-V1\n<base64url(RFC8785 payload)>`. Leases are compact JWS with `alg=EdDSA`, `typ=grokdesk-lease+jwt`, and `kid`.

  Include valid, tampered, expired, rotated, unknown-key, wrong-device, replayed-challenge, and sequence-rollback cases with fixed clocks and test-only keys.

- [ ] **Step 4: Generate and verify the contract**

  Run:

  ```bash
  npm run contract:generate
  npm run contract:generate
  git diff --exit-code openapi/entitlement-api.v1.json
  npm run test:contract
  npm run vectors:check
  ```

  Expected: deterministic output and all vectors pass.

- [ ] **Step 5: Commit Contract Gate C1**

  ```bash
  git add services/entitlement-api/src/errors.ts services/entitlement-api/src/http services/entitlement-api/openapi services/entitlement-api/contracts services/entitlement-api/test/contract
  git commit -m "feat: freeze entitlement contracts and vectors"
  ```

### Task 4: Implement key issuance, reconstruction, rotation, and key rings

**Files:**
- Create: `services/entitlement-api/src/crypto/canonical.ts`
- Create: `services/entitlement-api/src/crypto/key-ring.ts`
- Create: `services/entitlement-api/src/crypto/product-key.ts`
- Create: `services/entitlement-api/src/crypto/redaction.ts`
- Create: `services/entitlement-api/test/unit/crypto/product-key.test.ts`
- Create: `services/entitlement-api/test/unit/crypto/redaction.test.ts`

- [ ] **Step 1: Write failing deterministic key tests**

  Issue twice from identical persisted claims and assert byte equality. Assert claims contain no email/device fields. Rotate from version 1 to 2 and assert the old key reports `key_rotated` for activation while reconstruction of version 2 remains deterministic.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:unit -- product-key.test.ts redaction.test.ts`

- [ ] **Step 3: Implement signer abstraction and public JWK registry**

  Define:

  ```ts
  export interface Signer {
    readonly kid: string;
    readonly purpose: "product" | "lease" | "release";
    sign(bytes: Uint8Array): Promise<Uint8Array>;
    publicJwk(): Promise<JsonWebKey>;
  }
  ```

  Local/test signers read base64 PKCS#8 DER from mounted files. Production must use the managed signer implementation; local private keys require an explicit audited emergency mode. Retain public verification keys through every issued key/lease/manifest validity window.

- [ ] **Step 4: Implement reconstruction without plaintext storage**

  Persist `entitlementId`, `productId`, `keyVersion`, `issuedAt`, `seatLimit`, `updatePolicy`, and signing `kid`; reconstruct canonical claims and deterministic Ed25519 signature on reveal/resend. The database has no product-key column.

- [ ] **Step 5: Verify and commit**

  Run: `npm run test:unit -- product-key.test.ts redaction.test.ts && npm run test:contract`

  ```bash
  git add services/entitlement-api/src/crypto services/entitlement-api/test/unit/crypto
  git commit -m "feat: issue recoverable GD3 product keys"
  ```

### Task 5: Make Stripe events and email fulfillment transactional

**Files:**
- Create: `services/entitlement-api/src/commerce/stripe-events.ts`
- Create: `services/entitlement-api/src/commerce/fulfillment.ts`
- Create: `services/entitlement-api/src/commerce/transitions.ts`
- Create: `services/entitlement-api/src/email/outbox.ts`
- Create: `services/entitlement-api/src/email/worker.ts`
- Create: `services/entitlement-api/src/routes/internal/commerce.ts`
- Create: `services/entitlement-api/test/integration/stripe-fulfillment.test.ts`

- [ ] **Step 1: Write failing idempotency/state tests**

  Cover duplicate paid events, email provider failure, refund before checkout, full/partial refund, dispute opened/lost/won, and retry. Assert paid transaction creates customer/order/entitlement/fulfillment session/outbox/audit exactly once.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- stripe-fulfillment.test.ts`

- [ ] **Step 3: Implement the paid transaction**

  Insert/load Stripe event by event ID; conservatively upsert customer; insert/load order; insert one active three-seat lifetime-stable entitlement; persist product-key claims; create a ten-minute fulfillment session; enqueue purchase email; append audit; commit. Landing email delivery is outside this transaction.

  Map transitions exactly: open dispute → `chargeback_pending`; lost → `revoked`; won/withdrawn → audited reinstatement; full refund → `refunded`; partial/ambiguous → `manual_review`. Out-of-order events remain retryable until order linkage exists.

- [ ] **Step 4: Implement worker retries through the landing delivery adapter**

  Claim outbox rows with `FOR UPDATE SKIP LOCKED`; derive the one-use fragment token only for the authenticated call to the landing route `/api/internal/email-outbox`; use outbox UUID as logical idempotency key; exponential delays of 1, 5, 15, 60, 360 minutes capped at 24 hours; persist safe provider code/message ID. PostgreSQL template data and provider metadata contain no full key or bearer token. The worker authenticates to landing with a separately scoped rotating token, and the landing route is not public through Caddy.

- [ ] **Step 5: Verify and commit**

  Run: `npm run test:integration -- stripe-fulfillment.test.ts && npm run test:unit -- transitions.test.ts`

  ```bash
  git add services/entitlement-api/src/commerce services/entitlement-api/src/email services/entitlement-api/src/routes/internal/commerce.ts services/entitlement-api/test/integration/stripe-fulfillment.test.ts
  git commit -m "feat: add durable commerce fulfillment"
  ```

### Task 6: Implement challenge-response activation and exactly three seats

**Files:**
- Create: `services/entitlement-api/src/crypto/device-proof.ts`
- Create: `services/entitlement-api/src/activations/challenges.ts`
- Create: `services/entitlement-api/src/activations/service.ts`
- Create: `services/entitlement-api/src/routes/public/activations.ts`
- Create: `services/entitlement-api/test/integration/activation-concurrency.test.ts`
- Create: `services/entitlement-api/test/adversarial/entitlement-security.test.ts`

- [ ] **Step 1: Write failing proof/replay/race tests**

  Test expired five-minute challenge, replay, changed metadata, wrong public key, forged GD1/H1, rotated key, refunded entitlement, duplicate device, and four simultaneous distinct devices. Assert exactly three active rows and one `seat_limit` response with safe device summaries.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- activation-concurrency.test.ts && npm run test:adversarial`

- [ ] **Step 3: Verify RFC 7638 device identity and challenge proof**

  Accept canonical Ed25519 public JWK, compute RFC 7638 thumbprint, validate the exact signed activation bytes, bind nonce/challenge/device UUID/public key/name/platform/process architecture/OS/Desk version, and consume challenge atomically.

- [ ] **Step 4: Allocate a seat transactionally**

  `SELECT ... FOR UPDATE` the entitlement, validate state/GD3/current key version, find lowest free slot 1–3, insert activation, consume challenge, issue lease event, append audit, and commit. The partial unique seat indexes are the second defense. Never evict an existing device.

- [ ] **Step 5: Verify and commit**

  Run the four-way test 25 times:

  ```bash
  for i in $(seq 1 25); do npm run test:integration -- activation-concurrency.test.ts || exit 1; done
  npm run test:adversarial
  ```

  Expected: every run commits exactly three activations.

  ```bash
  git add services/entitlement-api/src/crypto/device-proof.ts services/entitlement-api/src/activations services/entitlement-api/src/routes/public/activations.ts services/entitlement-api/test/integration/activation-concurrency.test.ts services/entitlement-api/test/adversarial
  git commit -m "feat: enforce three-device activation"
  ```

### Task 7: Issue and refresh device-bound 30-day leases

**Files:**
- Create: `services/entitlement-api/src/crypto/device-lease.ts`
- Create: `services/entitlement-api/src/leases/service.ts`
- Create: `services/entitlement-api/src/routes/public/leases.ts`
- Create: `services/entitlement-api/test/integration/lease-refresh.test.ts`

- [ ] **Step 1: Write failing lease tests**

  Assert `refreshAfter=iat+24h`, `exp=iat+30d`, audience/issuer/product/activation/device binding, random JTI, stored keyed JTI hash only, challenge proof, replay rejection, copied lease rejection, deactivated/refunded denial, and recognized-device refresh after customer-key rotation.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- lease-refresh.test.ts`

- [ ] **Step 3: Implement compact EdDSA JWS**

  Protected header is `{ alg:"EdDSA", typ:"grokdesk-lease+jwt", kid }`. Claims include issuer, audience, entitlement/activation IDs, device thumbprint, product/capabilities, seat/update policy, `iat`, `refreshAfter`, `exp`, and JTI. Store only `HMAC(serverJtiKey, jti)`.

- [ ] **Step 4: Implement refresh transaction**

  Validate and consume refresh challenge, device signature, registered public key, prior lease JTI/activation binding, entitlement/activation state, supported client, and clock tolerance. Update last-seen metadata, append lease/audit events, and return server time with the new lease.

- [ ] **Step 5: Verify and commit**

  Run: `npm run test:integration -- lease-refresh.test.ts && npm run test:contract`

  ```bash
  git add services/entitlement-api/src/crypto/device-lease.ts services/entitlement-api/src/leases services/entitlement-api/src/routes/public/leases.ts services/entitlement-api/test/integration/lease-refresh.test.ts
  git commit -m "feat: issue device-bound offline leases"
  ```

### Task 8: Implement passwordless recovery and portal operations

**Files:**
- Create: `services/entitlement-api/src/portal/recovery.ts`
- Create: `services/entitlement-api/src/portal/sessions.ts`
- Create: `services/entitlement-api/src/portal/service.ts`
- Create: `services/entitlement-api/src/routes/internal/portal.ts`
- Create: `services/entitlement-api/test/integration/portal-recovery.test.ts`

- [ ] **Step 1: Write failing enumeration/session/CSRF tests**

  Known, unknown, and rate-limited email requests must have indistinguishable 202 status/body/timing envelope. Test 15-minute single-use magic link, reuse, 30-minute inactivity, eight-hour absolute expiry, logout, CSRF mismatch/replay, key reveal/resend/rotation, rename/deactivate, and no implicit device eviction.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- portal-recovery.test.ts`

- [ ] **Step 3: Implement hashed tokens and scoped sessions**

  Generate 32 random bytes, store `HMAC(tokenHashKey, token)` only, scope recovery to exact matching customer rows without merging by email, consume in one transaction, and create an opaque session. Coalesce last-seen writes to once per five minutes. Require synchronized CSRF hash on every mutation.

- [ ] **Step 4: Implement portal capabilities**

  Return purchases/status, masked key, on-demand reconstructed key, three safe device slots, qualified artifacts, lifetime policy, order reference, refund/revocation state, and support link. Rotating increments key version; old keys cannot activate, while existing device-key refresh remains valid. Deactivation locks entitlement and frees the selected slot atomically.

- [ ] **Step 5: Verify and commit**

  Run: `npm run test:integration -- portal-recovery.test.ts && npm run test:unit -- sessions.test.ts rate-limits.test.ts`

  ```bash
  git add services/entitlement-api/src/portal services/entitlement-api/src/routes/internal/portal.ts services/entitlement-api/test/integration/portal-recovery.test.ts
  git commit -m "feat: add passwordless entitlement recovery"
  ```

### Task 9: Add release catalog, signed manifests, and one-use downloads

**Files:**
- Create: `services/entitlement-api/src/releases/catalog.ts`
- Create: `services/entitlement-api/src/releases/compatibility.ts`
- Create: `services/entitlement-api/src/releases/rollout.ts`
- Create: `services/entitlement-api/src/releases/publication.ts`
- Create: `services/entitlement-api/src/crypto/release-manifest.ts`
- Create: `services/entitlement-api/src/downloads/grants.ts`
- Create: `services/entitlement-api/src/downloads/object-store.ts`
- Create: `services/entitlement-api/src/routes/public/releases.ts`
- Create: `services/entitlement-api/src/routes/public/downloads.ts`
- Create: `services/entitlement-api/src/release-publisher.ts`
- Create: `services/entitlement-api/test/integration/release-publication.test.ts`
- Create: `services/entitlement-api/test/integration/download-grants.test.ts`

- [ ] **Step 1: Write failing publication/grant tests**

  Cover semantic/prerelease resolution, compatible pair only, target absence, deterministic cohort, security deadline override, concurrent sequence publication, invalid approval, revocation, grant target/artifact binding, expiry, first redemption 303, and second redemption `grant_used`.

- [ ] **Step 2: Verify failure**

  Run: `npm run test:integration -- release-publication.test.ts download-grants.test.ts`

- [ ] **Step 3: Implement artifact eligibility**

  Require exact version, target, private object key/source provenance, size, SHA-256, platform signing identity, scan result, probe result, compatibility evidence, approver, and audit ID. Resolve one exact Desk/Grok pair; never return independently latest components.

  Publish the signed envelope from `GET /v1/releases/manifest?channel=&target=`. Resolve and authorize an exact entitlement-eligible pair through `POST /v1/releases/resolve`; that response may reference only artifacts present in the accepted manifest sequence.

- [ ] **Step 4: Isolate manifest publication**

  The API stores candidates/approvals but has no release private key. The one-shot publisher receives the managed/KMS release signer, locks the sequence singleton, verifies two distinct unexpired approvals, signs canonical bytes, inserts sequence/signature/expiry atomically, then exits. Product and lease signers cannot publish a manifest.

- [ ] **Step 5: Implement private download redemption**

  Validate active entitlement and artifact eligibility, create a minutes-long single-use token hash, atomically consume it, and return 303 to a minutes-long private S3/CDN presigned URL. Disable anonymous listing/direct access. Logs contain safe entitlement/artifact references, never the grant or URL query.

- [ ] **Step 6: Verify and commit**

  Run: `npm run test:integration -- release-publication.test.ts download-grants.test.ts && npm run test:contract`

  ```bash
  git add services/entitlement-api/src/releases services/entitlement-api/src/downloads services/entitlement-api/src/crypto/release-manifest.ts services/entitlement-api/src/routes/public services/entitlement-api/src/release-publisher.ts services/entitlement-api/test/integration
  git commit -m "feat: publish compatible releases and grants"
  ```

### Task 10: Ship audited operator CLI and immutable support history

**Files:**
- Create: `services/entitlement-api/src/audit/service.ts`
- Create: `services/entitlement-api/src/http/operator-auth.ts`
- Create: `services/entitlement-api/src/routes/operator/index.ts`
- Create: `services/entitlement-api/src/operator-cli/index.ts`
- Create: `services/entitlement-api/src/operator-cli/client.ts`
- Create: `services/entitlement-api/src/operator-cli/commands/*.ts`
- Create: `services/entitlement-api/test/integration/operator-audit.test.ts`

- [ ] **Step 1: Write failing authorization/audit tests**

  Reject invalid issuer/audience/role, missing reason, self-approval, expired approval, action-digest mismatch, and raw secret in support export. Assert each mutation creates exactly one append-only audit event with actor, reason, target, correlation, redacted before/after, source, and time.

- [ ] **Step 2: Implement private operator surface**

  Validate OIDC JWT against configured issuer/JWKS/audience and roles. Support lookup by entitlement, Stripe IDs, exact normalized email, activation; inspect webhook/email/lease/activation/download/audit; resend; rename/deactivate; suspend/reinstate/reconcile/revoke; rotate key; artifact revoke; rollout pause; cohort inspect; and redacted support bundle.

- [ ] **Step 3: Enforce two-person operations**

  Stable publication, stable artifact revocation, and signing-key rotation require request, approval by another subject, and execution against an exact action digest before expiry.

- [ ] **Step 4: Verify and commit**

  Run: `npm run test:integration -- operator-audit.test.ts && npm run test:adversarial`

  ```bash
  git add services/entitlement-api/src/audit services/entitlement-api/src/http/operator-auth.ts services/entitlement-api/src/routes/operator services/entitlement-api/src/operator-cli services/entitlement-api/test/integration/operator-audit.test.ts
  git commit -m "feat: add audited entitlement operations"
  ```

### Task 11: Add rate limits, retention, observability, and service wiring

**Files:**
- Create: `services/entitlement-api/src/rate-limits/service.ts`
- Create: `services/entitlement-api/src/retention/worker.ts`
- Create: `services/entitlement-api/src/observability/logging.ts`
- Create: `services/entitlement-api/src/observability/metrics.ts`
- Create: `services/entitlement-api/src/app.ts`
- Create: `services/entitlement-api/src/index.ts`
- Create: `services/entitlement-api/src/worker.ts`
- Create: `services/entitlement-api/test/adversarial/secret-canary.test.ts`
- Create: `services/entitlement-api/test/e2e/commerce-lifecycle.test.ts`

- [ ] **Step 1: Write failing rate, canary, and lifecycle tests**

  Rate dimensions are HMAC(IP), normalized email, customer, entitlement, and device. Canary fixtures include GD3, private JWK, magic token, portal session, grant, authorization/cookie headers, email, and Stripe body; assert none appears in logs, audit, support bundles, database logs, or provider metadata.

- [ ] **Step 2: Implement bounded-cardinality telemetry**

  Emit request latency/result, Stripe backlog/age, checkout-to-entitlement, email backlog/result, activation/seat limit, lease, magic exchange, grant, manifest expiry/signing, revoked artifact, database pool, and operator outcomes. Labels may be route template, stable code, product, channel, target, and version only.

- [ ] **Step 3: Implement retention worker**

  Prune expired challenges/rate buckets after seven days and expired token/grant metadata after 90 days; retain security access metadata for one year; retain order/audit as required by approved policy. Anonymization removes display email/device names but preserves accounting and immutable audit references. Constants are configuration with production startup requiring an approved policy version.

- [ ] **Step 4: Wire routes with explicit exposure**

  Register health/ready/public keys, activation, lease, releases, and downloads as public plugins; commerce/fulfillment/portal behind internal HMAC; operator behind OIDC and separate listener/network; metrics behind service authentication. Apply Helmet, body limits, trusted-proxy allowlist, request IDs, redaction, and error mapper globally.

- [ ] **Step 5: Run the complete service gate**

  ```bash
  npm run typecheck
  npm run lint
  npm run test:unit
  npm run test:integration
  npm run test:contract
  npm run test:adversarial
  npm run test:e2e
  npm run build
  npm run contract:generate
  git diff --exit-code openapi/entitlement-api.v1.json
  npm run vectors:check
  ```

  Expected: every command exits 0; the E2E covers purchase through refund and denied later activation/refresh/grant.

- [ ] **Step 6: Commit**

  ```bash
  git add services/entitlement-api
  git commit -m "feat: complete production entitlement service"
  ```

## Lane acceptance

The service is ready for staging when empty/upgrade migrations pass, duplicate and out-of-order Stripe events converge, four-way activation always yields three seats, device-bound leases and rotation rules pass shared vectors, recovery does not enumerate email, grant redemption is single-use, release publication is isolated and two-person approved, every mutation audits once, and secret canaries remain absent. Production additionally requires managed PostgreSQL/PITR, KMS/secret-store authorities, OIDC, private storage, TLS, monitoring, approved retention, and a successful restore drill.
