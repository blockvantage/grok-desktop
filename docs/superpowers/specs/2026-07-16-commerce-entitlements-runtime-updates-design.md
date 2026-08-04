# Grok Desk Commerce, Entitlements, Managed Grok Runtime, and Updates Design

> **RETIRED for Desk product licensing (2026-07-31):** The free desktop app no longer requires product keys, device leases, or entitlement fail-closed admission. GD3 activation and Desk license enforcement sections are historical. Release-manifest / managed-runtime / SuperGrok auth guidance may still apply.

**Date:** 2026-07-16

**Status:** Historical design (Desk product licensing retired; free app)

**Repositories:** `grok-desktop`, `../grok-landing`

**Platforms:** macOS ARM64, macOS Intel, Windows x64; Windows ARM64 only after native qualification

**Commercial model:** One-time paid personal license, three active devices, self-service transfers, no trial, lifetime stable updates

---

## 1. Purpose

Build one connected production system for:

- Stripe purchase and fulfillment;
- durable customer entitlements;
- retrievable and rotatable product keys;
- three-device activation and self-service device management;
- passwordless customer recovery;
- protected architecture-specific downloads;
- automatic installation of a Desk-managed Grok runtime;
- compatible lifetime updates for Grok Desk and Grok;
- signed offline operation and truthful read-only failure behavior;
- support, security, audit, migration, and rollback.

This design replaces the current disconnected foundations: permanent download URLs, locally generated activation state, cosmetic license status, disk-only update manifests, global Grok discovery, and the silent `FakeEngine` fallback.

## 2. Product decisions

The following decisions are final:

1. Grok Desk is paid before download. There is no free trial.
2. `FakeEngine` is not a customer-facing mode and is removed from production composition.
3. One personal entitlement permits three simultaneously active devices in any supported Mac/Windows combination.
4. Device seats are transferable through passwordless self-service.
5. A one-time purchase includes lifetime stable Grok Desk and managed Grok runtime updates.
6. Beta updates are opt-in.
7. SuperGrok is required separately for model usage and remains owned by xAI/Grok account billing.
8. The customer portal uses email magic links rather than passwords.
9. An activated device receives a server-signed 30-day offline lease, refreshed daily when possible.
10. Expired or revoked licensing never hides or deletes local work. Desk becomes read-only for new Grok-backed operations.
11. Grok is installed and versioned as a Desk-managed runtime. Desk does not mutate the user's terminal Grok installation.
12. Desk and Grok updates are coordinated through a signed compatibility manifest and side-by-side runtime versions.

## 3. Existing gaps this design closes

The implementation must explicitly remove every audited gap:

- License status currently does not gate product behavior.
- Client-side activation can create HMAC activation signatures with a baked-in development secret.
- The current `online` verification path performs no server request and extends grace locally.
- License state and the full key are persisted in gateway settings SQLite.
- Device identity is derived from hostname, username, platform, and architecture.
- Missing Grok only produces an instruction to install manually.
- Missing Grok silently selects `FakeEngine` at gateway startup.
- Installing Grok while Desk is open does not rebuild the selected engine on auth refresh.
- Current Desk update metadata is loaded only from local disk.
- The shipped release manifest is a placeholder.
- Update availability uses string inequality instead of semantic precedence.
- An architecture-aware download helper exists but is not used by the update UI.
- Desk opens a web page but does not download, verify, stage, install, or roll back updates.
- Release packaging currently qualifies only macOS ARM64 and Windows x64 in the example workflow.
- License entry is plain text, does not submit on Enter, and exposes raw internal errors.
- The purchase page and email currently distribute permanent Mac and Windows URLs.
- Stripe metadata is the only fulfillment persistence.
- Keys are not issued or recoverable from the landing flow.

## 4. System architecture

### 4.1 Service map

```text
Stripe ──signed webhook──> Landing web
                              │ internal service-authenticated command
                              ▼
Customer portal ───────> Entitlement API ───────> PostgreSQL
                              │
Desktop activation ───────────┤
Lease refresh ────────────────┤
Release lookup ───────────────┤
Download grant ───────────────┘
                              │
                              ▼
                       Private artifact storage/CDN

Desktop main process
  ├── OS credential store: product key and device private key
  ├── Entitlement client: activate, refresh, and status
  ├── Runtime manager: install, verify, select, repair, and roll back Grok
  └── Update coordinator: resolve and stage compatible Desk/Grok pairs

Desktop gateway
  └── Independently verifies signed lease before every real Grok-backed operation

Blind remote relay
  └── Continues routing opaque encrypted frames only
```

### 4.2 Repository ownership

`grok-landing` owns:

- marketing and pricing;
- Stripe Checkout and webhook receipt;
- purchase success fulfillment;
- passwordless customer portal;
- new `services/entitlement-api` service;
- PostgreSQL schema, migrations, backup configuration, and operator tooling;
- entitlement, activation, lease, portal, release, and download APIs;
- email outbox and Resend delivery;
- release/artifact catalog and protected download authorization;
- Caddy and Docker Compose routing for the new service;
- public legal/privacy/support updates.

`grok-desktop` owns:

- secure local product-key and device-key storage;
- activation and readiness UX;
- server-signed lease verification;
- gateway-level license enforcement;
- removal of production fake-engine fallback;
- managed Grok runtime download, verification, and selection;
- synchronized Desk/Grok update coordination;
- read-only expired-license behavior;
- update/runtime diagnostics and repair.

The remote relay remains:

- blind;
- stateless;
- in-memory;
- without database credentials;
- without Stripe, customer-email, license, signing-key, portal, or artifact access.

### 4.3 Why entitlement is a separate service

The entitlement service is separate from both Next.js and the relay. This costs one service and PostgreSQL but provides:

- isolated signing authorities;
- narrow public and internal APIs;
- durable transactions for seats and webhook idempotency;
- independent scaling and incident response;
- database-backed audit and recovery;
- no erosion of the relay's blind design;
- no private signing material in the marketing web process.

### 4.4 Signing authorities

Use four separately scoped authorities:

1. Product-key signer.
2. Device-lease signer.
3. Release-manifest signer.
4. Magic-link and portal-session secrets.

Production holds them in a managed secret store or KMS. The landing container, relay, PostgreSQL, desktop build system, desktop binary, and renderer receive no private signing material. Public verification keys are published with key IDs and rotation windows.

## 5. Entitlement data model

PostgreSQL is authoritative. The minimum model is:

### 5.1 `customers`

- `id`
- normalized email
- display email
- Stripe customer ID
- locale
- created/updated timestamps
- deletion/anonymization timestamps

Email uniqueness and Stripe-customer uniqueness must handle customers purchasing with aliases or multiple Stripe customer records without merging unrelated people automatically.

### 5.2 `orders`

- Stripe Checkout session ID
- Stripe payment intent ID
- Stripe customer ID
- customer ID
- amount/currency
- payment status
- locale
- purchased/refunded/chargeback timestamps
- original Stripe metadata snapshot

### 5.3 `stripe_events`

- Stripe event ID as the idempotency key
- event type
- received timestamp
- processed timestamp
- processing status
- safe failure code and retry count

Do not store raw card data. Retain webhook payloads only when justified by the retention policy and encrypt any retained body.

### 5.4 `entitlements`

- entitlement ID
- customer ID
- product ID
- status
- key version
- seat limit, fixed at three for this product
- update policy, fixed at lifetime stable
- purchase/order linkage
- purchased, suspended, refunded, revoked, and reinstated timestamps
- status reason and operator reference

States include `active`, `suspended`, `chargeback_pending`, `refunded`, `revoked`, and `manual_review`.

### 5.5 `activations`

- activation ID
- entitlement ID
- stable random device ID
- device public-key thumbprint
- encrypted or normalized public key material as required for signature verification
- customer-visible device name
- platform, process architecture, OS version, and Desk version
- created, last-seen, deactivated, and revoked timestamps
- status and safe status reason

Only active rows count toward the three-seat limit.

### 5.6 `lease_events`

- lease ID/JTI or safe hash
- activation and entitlement IDs
- signing key ID
- issued, refresh-after, and expiry timestamps
- issuance result
- revoked/denied reason

The complete bearer lease need not be stored if it can be reconstructed or audited safely from claims.

### 5.7 `magic_links` and `portal_sessions`

Store token hashes, never bearer tokens. Track customer, purpose, creation, expiry, consumption, IP/rate-limit metadata, session inactivity, absolute expiry, and revocation.

### 5.8 `releases`, `artifacts`, and `compatibility_pairs`

Record Desk versions, Grok versions, channels, platforms, architectures, artifact provenance, URLs, hashes, sizes, signing identities, scan results, compatibility, rollout configuration, deadlines, revocations, and release approval.

### 5.9 `download_grants`

Bind a single-use, short-lived grant to entitlement, release, artifact, platform, architecture, nonce, expiry, and consumption timestamp.

### 5.10 `email_outbox`

Store logical message type, recipient reference, locale, template data, attempt count, next attempt, provider result, and sent timestamp. Do not store full product keys in provider metadata.

### 5.11 `audit_events`

Append-only records for every entitlement, activation, key, portal, release, artifact, refund, and operator mutation. Include actor, reason, target, correlation ID, safe before/after summary, source, and timestamp.

## 6. Purchase and fulfillment

### 6.1 Checkout

Stripe Checkout remains `mode: payment`. Checkout metadata includes product, locale, and fulfillment schema version. The success URL contains the Stripe session placeholder only long enough for server-side exchange.

### 6.2 Webhook transaction

On a verified `checkout.session.completed` event with `payment_status=paid`:

1. Insert or load the Stripe event by event ID.
2. Upsert the customer conservatively.
3. Insert or load the order by Checkout session/payment intent.
4. Insert or load one entitlement for the order.
5. Set three seats and lifetime stable updates.
6. Generate product-key claims at key version one.
7. Create a short-lived post-checkout fulfillment session.
8. Insert purchase email into the outbox.
9. Commit.
10. Return webhook success.

Resend availability must not determine Stripe webhook success. A worker drains the outbox with exponential backoff and idempotent logical message IDs.

### 6.3 Success page

The success page verifies payment server-side, exchanges the Stripe session for a short-lived fulfillment session, and then shows:

- masked product key with explicit Reveal and Copy;
- architecture-specific download selector;
- three-device allowance;
- lifetime stable updates;
- separate SuperGrok requirement;
- confirmation that recovery email was queued/sent;
- passwordless account and support links.

The product key never appears in a URL, referrer, analytics event, or client log.

### 6.4 Purchase email

Email contains a secure magic link to view the key, not the full key in link parameters. It includes the download selector, three-device and lifetime-update terms, SuperGrok separation, portal/support links, and Stripe order reference.

## 7. Product-key format and recovery

### 7.1 GD3 format

```text
GD3.<base64url(canonical claims)>.<base64url(ed25519 signature)>
```

Claims contain:

- schema version;
- entitlement ID;
- product ID;
- key version;
- issued timestamp;
- seat policy;
- lifetime-update policy.

Claims do not contain email, machine data, or device names.

### 7.2 Recovery without plaintext storage

Ed25519 signatures are deterministic for identical canonical input. The service reconstructs the same key from authoritative entitlement claims and the signing authority. It does not need a plaintext key column.

### 7.3 Rotation

Rotating an exposed key increments `keyVersion` and issues the new canonical key. Old key versions cannot create new activations. Existing recognized activations remain active and refresh through device-key proof unless the customer also deactivates them or the entitlement is revoked.

### 7.4 Legacy policy

- GD1/H1 is never accepted in production.
- Client-generated activation signatures are removed.
- Legitimate historical GD2 purchases may be exchanged only through an explicit server-side allowlist/backfill.
- Development or unverifiable keys direct the customer to recovery/support and never silently activate.

## 8. Device identity, activation, and leases

### 8.1 Local identity

On first launch, the main process generates:

- random device UUID;
- Ed25519 device keypair;
- default device display name;
- platform, process architecture, OS version, and Desk version metadata.

The private device key and product key live in macOS Keychain or Windows Credential Manager. They never enter renderer state, SQLite, logs, diagnostics, update journals, or gateway settings.

### 8.2 Activation challenge

1. Client requests a short-lived server challenge.
2. Client signs the challenge plus canonical device metadata.
3. Client submits GD3 key, device public key, signature, challenge ID, and metadata.
4. Server validates challenge expiry/consumption and device signature.
5. Server validates GD3 signature and current entitlement key version.
6. Server locks the entitlement row in a transaction.
7. Server checks active status and active seat count.
8. If fewer than three seats are active, create activation and lease.
9. Commit challenge consumption, activation, lease event, and audit event.

Concurrent requests must never create a fourth active seat.

### 8.3 Seat-limit behavior

When all seats are occupied, activation returns a stable error code plus redacted device summaries suitable for UI. No device is silently evicted. The user opens the portal, deactivates a device, and retries.

### 8.4 Signed lease

Lease claims include:

- schema, issuer, and audience;
- entitlement and activation IDs;
- device-public-key thumbprint;
- product and capability claims;
- seat and lifetime-update policies;
- issue, refresh-after, and expiry timestamps;
- key IDs and lease JTI.

The server signs the lease. The desktop can verify but cannot extend it.

### 8.5 Refresh

Desk refreshes at startup when needed and every 24 hours with jitter. Refresh requires a new server nonce signed by the registered device private key. The product key is not required for normal refresh.

### 8.6 Offline and expiry policy

- Lease validity: 30 days.
- Temporary service/network failures preserve full licensed behavior until expiry.
- After expiry, new Grok-backed operations are blocked.
- Local viewing, export, diagnostics, repair, update, deletion, and account recovery remain available.
- Successful refresh restores full behavior immediately.
- Refunds, chargebacks, revocation, suspension, or device deactivation deny refresh and take full effect no later than lease expiry.

## 9. Passwordless customer portal

### 9.1 Authentication

1. User enters checkout email at `/account`.
2. Server always returns a generic response.
3. Single-use magic link expires after 15 minutes.
4. Exchange creates `HttpOnly`, `Secure`, `SameSite=Strict` session cookie.
5. Session expires after 30 minutes inactivity and eight hours absolute.
6. Mutation requests require CSRF protection.

### 9.2 Portal capabilities

- List purchases and entitlement state.
- Reveal, copy, or resend reconstructed product key.
- Rotate a compromised key.
- Show three device slots.
- Display safe device name, platform, architecture, Desk version, activation, and last-seen time.
- Rename and deactivate devices.
- Download current stable installers for qualified architectures.
- Show lifetime-update policy and supported versions.
- Show order reference, refund/revocation state, and support link.

### 9.3 Enumeration and abuse controls

Responses, timing, and rate-limit behavior must not reveal whether an email exists. Rate limits apply by IP, normalized email hash, customer, entitlement, and device. Tokens are stored hashed and invalidated on consumption.

## 10. Refund, chargeback, and suspension behavior

Stripe events drive authoritative transitions. A refunded, revoked, or charged-back entitlement cannot:

- activate a device;
- refresh a lease;
- obtain a download grant;
- obtain an update authorization.

Existing leases remain cryptographically valid only until expiry unless the desktop receives an earlier successful online denial. Local work stays accessible.

Every transition is idempotent, audited, and reversible only through an authorized reinstatement path.

## 11. Protected downloads

Permanent public installer URLs are removed.

The success page, email, and portal request a one-use download grant. The service validates entitlement and artifact eligibility, then returns or redirects to a private object-store/CDN URL expiring within minutes.

The grant is bound to:

- entitlement;
- artifact and release;
- platform and architecture;
- nonce;
- expiry;
- one-use state.

Download logs contain safe entitlement/artifact identifiers, never keys or magic tokens. Storage denies unauthenticated listing and direct public downloads.

## 12. Desktop readiness and activation UX

### 12.1 First-run state machine

```text
activate Desk license
→ install managed Grok runtime
→ verify runtime capabilities
→ authenticate SuperGrok
→ workspace and permission onboarding
→ ready for real work
```

No state can be skipped into a fake engine. Progress is durable across restarts.

### 12.2 Key entry

The activation screen provides:

- masked input with Reveal;
- clipboard paste;
- stripping of surrounding prose, spaces, and line breaks around a recognizable GD3 token;
- Enter submission;
- immediate local shape validation;
- “Where is my key?” portal link;
- “Buy Grok Desk” link for shared installers;
- three-device and privacy copy.

The renderer sends the key once to a narrow main-process handler and clears React state immediately after submission. The main process owns network activation and secure storage.

### 12.3 Error taxonomy

Stable server codes map to localized copy for invalid format, invalid signature, rotated key, refunded/revoked entitlement, seat limit, service unavailable, clock skew, unsupported client, unsupported architecture, and credential-store failure. Raw reasons and stack traces are never displayed.

### 12.4 Account separation

Settings clearly distinguishes:

- Grok Desk license: active state, three devices, lifetime updates, portal access.
- Managed Grok runtime: version, architecture, compatibility, repair/update.
- SuperGrok account: connection, usage, and official billing management.

## 13. Enforcement boundary

The gateway validates a signed lease before every real Grok-backed operation:

- interactive task creation;
- follow-up;
- scheduled run;
- remote/mobile task creation;
- retry/revision;
- provider inference;
- Grok-backed dictation or auxiliary model operations.

All call paths share one entitlement guard. Renderer, tray, scheduler, and remote clients cannot bypass it.

Permitted in read-only mode:

- view conversations and artifacts;
- export data;
- read settings and diagnostics;
- repair/update runtime;
- recover/refresh license;
- manage links and support;
- delete local data.

License state is explicit rather than inferred from booleans:

```text
unactivated
activating
active
refresh_due
offline_grace
seat_limit
suspended
refunded
revoked
lease_expired
service_unavailable
device_deactivated
read_only
```

## 14. Managed Grok runtime

### 14.1 Ownership

Desk uses a runtime under Electron `app.getPath("userData")`, for example:

- macOS: `~/Library/Application Support/GrokDesk/runtimes/grok/<version>/<arch>/grok`
- Windows: `%LOCALAPPDATA%\GrokDesk\runtimes\grok\<version>\<arch>\grok.exe`

Each runtime directory includes binary, digest, provenance, manifest key ID, installation time, and probe results. Atomic `current.json` selects the active version. Keep the previous verified runtime.

Desk does not run `grok update`, alter `~/.grok/bin`, or change PATH. A global Grok installation is diagnostic information only. Development builds may retain explicit override hooks that cannot activate in production accidentally.

### 14.2 Architecture mapping

Canonical targets:

- `darwin-arm64`
- `darwin-x64`
- `win32-x64`
- `win32-arm64` only after complete native qualification

Runtime selection uses the running Desk process architecture so the binary is executable in the same environment. Browser detection may recommend an installer but the paid download page always exposes explicit architecture choices.

### 14.3 Runtime artifact ingestion

The release-import job records exact version, official source, target, size, SHA-256, retrieval time, capability probes, platform signing identity when present, malware scan, compatibility test, approver, and audit ID.

Only approved artifacts enter a signed compatibility manifest. The artifact may remain at the official source or be mirrored; digest and provenance remain mandatory.

### 14.4 Installation transaction

1. Resolve recommended compatible runtime.
2. Validate platform/architecture, disk space, and writable directory.
3. Obtain grant when using private mirror.
4. Stream to a unique temporary file with bounded size.
5. Resume through byte ranges when supported.
6. Verify length and SHA-256.
7. Verify macOS signing or Windows Authenticode when present and required by manifest policy.
8. Mark executable on macOS.
9. Run non-billable `--version`, `--help`, and `agent --help` probes.
10. Match reported version/capabilities to manifest.
11. Atomically place version directory and update `current.json`.
12. Rebuild gateway engine against the explicit binary.
13. Continue to SuperGrok authentication.

Failures never replace the current runtime. Startup cleans abandoned staging files safely.

## 15. Signed compatibility and release manifest

The manifest includes:

- schema and monotonically increasing sequence;
- stable and beta channels;
- Desk releases by platform/architecture;
- Grok runtime releases by platform/architecture;
- tested compatibility pairs and capability requirements;
- minimum, maximum, and recommended versions;
- artifact URL, size, digest, signing identity, and provenance;
- release notes and support URL;
- rollout percentage and cohort salt;
- mandatory security deadline;
- revoked version/artifact list;
- expiry and signing-key ID.

Desk rejects invalid/unknown signatures, expiry, sequence rollback, absent architecture, unauthorized downgrade, revoked artifacts, invalid digests, and pairs outside declared compatibility.

Version precedence is semantic, including prereleases.

## 16. Coordinated Desk and Grok updates

### 16.1 State machine

```text
idle
→ checking
→ available
→ downloading
→ verifying
→ staged
→ waiting_for_idle
→ installing
→ restarting
→ post_update_verification
→ committed
```

Pre-install failures preserve the active pair. Runtime verification failure restores the previous runtime. An irrecoverable mismatch enters licensed read-only repair mode.

### 16.2 Update behavior

- Check at startup, every six hours with jitter, and manually.
- Resolve one compatible Desk/Grok pair.
- Download and verify in background while tasks continue.
- Never switch runtime while a task or scheduled execution is active.
- Prompt “Update and restart” when staged.
- Stop new task acceptance after approval.
- Drain or cancel active work according to explicit customer choice.
- Journal transitions and artifact paths durably.
- Install signed/notarized macOS or Authenticode-signed NSIS update.
- On restart, select/probe paired Grok before gateway start.
- Commit only after main, gateway, auth, and capability health checks.

Use `electron-updater` or a narrowly wrapped equivalent that supports protected short-lived download URLs and existing electron-builder artifacts.

### 16.3 Partial updates

A Grok-only hotfix is permitted only when explicitly compatible with installed Desk. A Desk-only update is permitted only when compatible with installed Grok or after staging its required runtime.

### 16.4 Mandatory security updates

Security releases may publish a deadline. Before it, warn and stage. After it, block new tasks until update while preserving local read/export. Signed emergency revocation can block a compromised artifact.

### 16.5 Lifetime updates and channels

Every active entitlement receives lifetime stable updates. Beta is explicit opt-in and never silently changes a customer from stable. Returning to stable resolves a compatible non-beta pair without unsafe downgrade.

## 17. Runtime and update diagnostics

Settings exposes:

- Desk version/architecture;
- managed Grok version/architecture;
- compatibility result;
- channel and entitlement update policy;
- last manifest check;
- progress/staging state;
- previous runtime;
- Check, Repair, Retry, Copy diagnostics, Open logs, and compatible runtime rollback actions.

Repair re-verifies and re-downloads runtime only. It never deletes work, license, device identity, or SuperGrok auth.

## 18. Failure behavior

| Failure | Required behavior |
|---|---|
| No network before activation | Wait and retry; no fake mode |
| Entitlement service unavailable after activation | Existing lease continues until expiry |
| Email delivery failure | Success page works; outbox retries |
| Three seats occupied | Portal/device action; no silent eviction |
| Interrupted runtime/update download | Resume/retry; active pair untouched |
| Digest/signature mismatch | Quarantine/delete artifact, security event, never execute |
| Disk full | Required-space guidance and retry |
| Windows antivirus/file lock | Preserve active pair and offer repair |
| Runtime probe failure | Restore previous compatible runtime |
| Crash during staging | Resume or clean using journal |
| Desk update with runtime failure | Restore runtime if compatible; otherwise read-only repair |
| Refund/chargeback | Deny refresh/download; lease expires normally |
| Magic link expired/reused | Generic new-link flow |
| Unsupported architecture | No cross-architecture guess; qualified options/support |

## 19. Operator tooling

Ship an authenticated internal CLI before a public admin dashboard. It supports:

- lookup by entitlement, Stripe IDs, normalized email, and activation;
- inspection of webhook, email, lease, activation, download, and audit history;
- resend fulfillment/magic link;
- authorized device rename/deactivation;
- suspend, reinstate, refund reconciliation, and revoke;
- product-key rotation;
- artifact/runtime revocation and rollout pause;
- cohort inspection;
- redacted support bundle export.

Mutations require operator identity, reason, timestamp, and before/after audit. Signing-key operations and stable release publication require stronger authorization and should support two-person approval.

## 20. Security and privacy controls

- TLS for every public/internal hop.
- Service authentication from landing to entitlement API.
- Strict schemas and bounded bodies.
- Rate limits by safe IP/email/customer/entitlement/device dimensions.
- Generic recovery responses.
- Hashed bearer tokens in PostgreSQL.
- CSRF protection for portal mutations.
- Replay-resistant activation and refresh nonces.
- Device-key proof for refresh.
- Product keys and secrets redacted everywhere.
- Separate signing keys with rotation and overlapping verification windows.
- Manifest sequences prevent rollback.
- Private artifact storage.
- Database and signing credentials unavailable to relay/clients.
- Explicit data retention, anonymization, and deletion policies.

Legal/privacy copy must disclose Stripe, Resend, device metadata, licensing checks, update checks, artifact downloads, support/audit retention, and the separate SuperGrok relationship.

## 21. Observability and recovery

Measure checkout-to-entitlement completion, webhook backlog, email retries, activation outcomes, seat-limit events, lease refresh health, magic-link delivery/exchange, download failures, update adoption, runtime installation, and rollback.

Alert on webhook backlog, signing failures, database health, email backlog, elevated invalid signatures, rollback spikes, expiring manifests, revoked artifact requests, and failed backups.

PostgreSQL uses encrypted backups and point-in-time recovery. Regular restore drills and runbooks cover:

- signing-key rotation;
- artifact revocation;
- entitlement-service outage;
- database restore;
- email outage;
- bad release rollback;
- Stripe webhook replay/backfill;
- customer key compromise.

## 22. Cross-repository contracts

Entitlement API owns OpenAPI 3.1 for all HTTP contracts. Generate server validation and a typed desktop client. CI fails on drift.

Canonical crypto specifications and byte-level vectors cover:

- GD3 keys;
- activation challenge signatures;
- device leases;
- release manifests;
- valid, invalid, expired, tampered, rotated, and replayed fixtures.

Both repositories run the same vectors.

## 23. Test strategy

### 23.1 Entitlement tests

- GD3 issue/reconstruct/verify/rotate.
- No email/device data in claims.
- Exactly three of four concurrent activations commit.
- Atomic deactivation/replacement.
- Challenge expiry/replay/wrong device.
- Lease issue/refresh/expiry/rotation.
- Refund/chargeback/suspension transitions.
- Duplicate/out-of-order Stripe events.
- Outbox retry and logical idempotency.
- Magic-link/session/CSRF/rate limits.
- Download grant expiry/single-use/binding.
- Manifest signature/expiry/sequence/cohort/revocation.
- Audit completeness.

### 23.2 Desktop tests

- Paste normalization and renderer clearing.
- Keychain/Credential Manager success/failure/corruption.
- Device-key stable reuse.
- Lease verification, binding, and read-only transition.
- Guard every interactive/scheduled/remote/provider entry point.
- No production FakeEngine fallback.
- Architecture selection and no PATH dependency.
- Interrupted downloads and size/digest/signature failure.
- Atomic runtime install/current pointer recovery.
- Probe mismatch and rollback.
- Semantic versions and prereleases.
- Manifest rollback/expiry/revocation.
- Paired resolution and update-journal recovery.
- Repair preserves all user/auth/license data.
- Gateway rebuilds immediately after runtime install.

### 23.3 Adversarial tests

- Forged H1/GD1 activation.
- Replayed challenge.
- Modified device claims.
- Lease copied to another device.
- Manifest downgrade/substitution.
- Artifact changed after verification.
- Reused/expired download grant.
- Email enumeration and portal CSRF.
- Four-way seat race.
- Refunded entitlement activation/refresh.
- Remote task with expired lease.
- Revoked runtime selection.

### 23.4 Secret-canary tests

Search renderer IPC, SQLite, local logs, diagnostics, journals, temp files, PostgreSQL logs, email metadata, and audit exports for product keys, device private keys, magic tokens, portal sessions, and signing material.

### 23.5 Platform qualification

macOS ARM64 and Intel require clean install with no global Grok, codesign/notarization/stapling, activation, runtime install, update from previous stable, interruption recovery, rollback, Keychain persistence, and uninstall data choice.

Windows x64 requires clean standard-user NSIS install, Authenticode, activation/runtime, Credential Manager persistence, antivirus/file-lock scenarios, update/restart/rollback, long paths, non-ASCII usernames, and proxy environments.

Windows ARM64 is unpublished until the full native pair passes the same suite on real hardware. Portable Windows builds are removed from the primary paid flow initially.

### 23.6 Commerce E2E

Test checkout through refund: entitlement creation, success session, email, magic recovery, architecture downloads, three activations, fourth rejection, self-service replacement, key rotation, old-key rejection, recognized-device refresh, refund, and denied future refresh/download.

## 24. Migration

### 24.1 Landing

- Enumerate historical paid Stripe sessions.
- Backfill customer, order, entitlement, and GD3 claims idempotently.
- Preserve purchase time and locale.
- Send controlled recovery/account email.
- Replace permanent URLs in new communication.
- Keep old URLs only for a defined measured transition, then revoke.

### 24.2 Desktop

- Detect legacy SQLite license material.
- Exchange allowlisted legitimate GD2 purchases for GD3.
- Generate device identity and obtain server lease.
- Move key/device secret to OS credential store.
- Purge legacy license data from SQLite.
- Reject production H1/GD1 and unverifiable development keys.
- Preserve conversations, artifacts, settings, and SuperGrok auth.

## 25. Deployment and rollout

1. Provision PostgreSQL, backups, secrets/KMS, and artifact storage.
2. Deploy entitlement API dark.
3. Mirror Stripe webhooks and verify idempotent entitlement creation.
4. Backfill historical purchases.
5. Deploy portal and protected downloads.
6. Send recovery access to existing purchasers.
7. Publish signed compatibility manifests.
8. Ship activation/runtime/update-capable Desk behind an operator rollout flag.
9. Dogfood on Mac ARM64, Mac Intel, and Windows x64.
10. Enable new purchases.
11. Migrate installed customers.
12. Remove permanent URLs, legacy activation, fake fallback, and disk manifests after adoption.
13. Enable stable update checks globally.

Rollout cohorts support allowlist, 1%, 5%, 25%, 50%, and 100%, with platform-specific pauses and immediate artifact revocation. The relay deploys independently.

## 26. Release gates

A stable pair cannot publish until:

- package tests and type checks pass;
- API contract compatibility passes;
- cross-repository crypto vectors pass;
- platform installation/update suites pass;
- artifacts are signed, scanned, hashed, and uploaded;
- manifest signing and rollback tests pass;
- database migration/rollback is tested;
- support and incident runbooks are current;
- legal/privacy copy is accurate;
- monitoring and alerts are active.

## 27. Acceptance criteria

A paid customer can:

- purchase once;
- retrieve or rotate the key through an email magic link;
- download the correct qualified installer;
- activate three devices;
- transfer seats without support;
- automatically install a compatible Grok runtime without global Grok;
- authenticate SuperGrok and run only real work;
- receive compatible lifetime stable Desk and Grok updates;
- survive temporary entitlement-service outages;
- recover from interrupted or failed runtime/update transactions;
- retain read/export access after expiry/revocation;
- never encounter simulated output represented as real Grok work.

The program is not complete until all audited gaps in section 3 are removed or explicitly migrated behind an expiring compatibility path.
