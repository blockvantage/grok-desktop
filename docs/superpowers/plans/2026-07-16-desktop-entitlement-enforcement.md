# Desktop Entitlement, Key Management, and Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **RETIRED (2026-07-31):** Grok Desk product licensing is removed; the app is free. This plan is historical only. Do not re-implement Desk product-key gates. SuperGrok account auth remains separate.

**Goal (historical):** Replace local cosmetic licensing with secure GD3 activation, OS-vault key/device identity, server-signed offline leases, and gateway-level read-only enforcement across every real Grok operation.

**Architecture:** Renderer key handling is a narrow one-shot main-process IPC. Electron main owns the product key, random Ed25519 device identity, activation/refresh network calls, and atomic entitlement state. The gateway receives neither private key nor product key; it establishes device identity through a startup proof, reads a signed lease state file, and synchronously guards every Grok-backed admission and execution boundary.

**Tech Stack:** TypeScript, Electron 33, `@github/keytar`, Node Ed25519, generated OpenAPI client, atomic JSON state, React 18, Vitest, Playwright, SQLite migration tooling.

**Design:** `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Ownership and parallel lanes

After Contract Gate C1, run these file-disjoint streams in parallel:

- Crypto/client: `packages/license/**`, new `packages/entitlement-client/**`.
- Main entitlement: `apps/desktop/src/main/entitlements/**`.
- Gateway guard: new `packages/gateway/src/services/entitlement-*` plus focused call sites.
- Renderer: entitlement hook/components/tests after safe status DTO freeze.
- Engine testkit/Fake removal belongs to the runtime/update plan because it overlaps engine composition.

One integration owner edits `package.json`, `pnpm-lock.yaml`, `packages/shared/src/ipc.ts`, `packages/shared/src/index.ts`, `packages/gateway/src/index.ts`, `packages/gateway/src/host-bridge.ts`, desktop main/preload startup, `App.tsx`, electron-builder, and Vite config.

## Stable desktop contract

Safe renderer states are exactly:

```text
unactivated, activating, active, refresh_due, offline_grace, seat_limit,
suspended, refunded, revoked, lease_expired, service_unavailable,
device_deactivated, read_only, credential_store_failure, migration_required
```

Capability categories are:

- `grok_operation`: blocked unless entitlement is active/grace-valid and update policy permits it.
- `local_read`: always allowed.
- `local_manage`: local rename, memory/connector/settings/schedule editing is allowed; a schedule cannot execute while blocked.
- `recovery`: license refresh, portal, runtime update/repair, diagnostics, export, deletion, and cancellation are always allowed.

This implements “read-only for new Grok-backed operations” without unnecessarily locking local organization or recovery.

### Task 1: Generate a typed entitlement HTTP client

**Files:**
- Create: `packages/entitlement-client/package.json`
- Create: `packages/entitlement-client/tsconfig.json`
- Create: `packages/entitlement-client/scripts/generate.mjs`
- Create: `packages/entitlement-client/src/generated/api.ts`
- Create: `packages/entitlement-client/src/client.ts`
- Create: `packages/entitlement-client/src/errors.ts`
- Create: `packages/entitlement-client/src/index.ts`
- Create: `packages/entitlement-client/src/client.test.ts`
- Create: `packages/entitlement-client/testdata/http-fixtures.json`

- [ ] **Step 1: Write failing timeout/error/redaction tests**

  ```ts
  await expect(client.createActivationChallenge(deviceRequest)).rejects.toMatchObject({
    code: "service_unavailable",
    retryable: true,
  });
  expect(JSON.stringify(client.diagnostics())).not.toContain("GD3.");
  ```

  Cover invalid JSON, oversized response, 429 retry-after, 4xx authoritative denial, 5xx retryability, TLS/network timeout, and request ID propagation.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/entitlement-client test`

  Expected: FAIL because the package does not exist.

- [ ] **Step 3: Generate from authoritative OpenAPI**

  Generate operation types for `createActivationChallenge`, `activateDevice`, `createLeaseRefreshChallenge`, `refreshDeviceLease`, `createDeactivationChallenge`, `deactivateCurrentDevice`, `exchangeLegacyGd2`, `getVerificationKeys`, `resolveRelease`, and `createDownloadGrant`. The generator embeds the source OpenAPI SHA-256 and fails if operation IDs disappear.

- [ ] **Step 4: Implement the transport wrapper**

  ```ts
  export type EntitlementClientOptions = {
    baseUrl: URL;
    fetch?: typeof globalThis.fetch;
    timeoutMs?: number;
    userAgent: string;
  };

  export class EntitlementApiError extends Error {
    constructor(
      readonly code: StableEntitlementError,
      readonly retryable: boolean,
      readonly requestId?: string,
    ) { super(code); }
  }
  ```

  Accept JSON only, cap bodies at 64 KiB, use an 8-second activation/refresh timeout, reject redirects except the documented grant redemption flow, and never include request/response bodies in errors or diagnostics.

- [ ] **Step 5: Verify deterministic generation and commit**

  ```bash
  pnpm --filter @grokdesk/entitlement-client run generate
  pnpm --filter @grokdesk/entitlement-client run generate
  git diff --exit-code -- packages/entitlement-client/src/generated/api.ts
  pnpm --filter @grokdesk/entitlement-client test
  git add packages/entitlement-client package.json pnpm-lock.yaml
  git commit -m "feat: add generated entitlement client"
  ```

### Task 2: Replace legacy license code with pure verification primitives

**Files:**
- Delete: `packages/license/src/activation.ts`
- Delete: `packages/license/src/service.ts`
- Delete: `packages/license/src/server.ts`
- Delete: `packages/license/src/keys.ts`
- Delete: `packages/license/src/license.test.ts`
- Create: `packages/license/src/base64url.ts`
- Create: `packages/license/src/canonical.ts`
- Create: `packages/license/src/product-key.ts`
- Create: `packages/license/src/device-proof.ts`
- Create: `packages/license/src/key-ring.ts`
- Create: `packages/license/src/lease.ts`
- Create: `packages/license/src/status.ts`
- Create: `packages/license/src/errors.ts`
- Create: `packages/license/src/product-key.test.ts`
- Create: `packages/license/src/device-proof.test.ts`
- Create: `packages/license/src/lease.test.ts`
- Create: `packages/license/src/status.test.ts`
- Create: `packages/license/testdata/commerce-crypto-vectors.json`
- Delete: `scripts/license-keygen.mjs`

- [ ] **Step 1: Write failing shared-vector and extraction tests**

  ```ts
  expect(extractGd3("Here is your key:\n GD3.abc.def \nThanks")).toBe("GD3.abc.def");
  expect(() => extractGd3("GD3.a.b and GD3.c.d")).toThrowError("multiple_keys");
  expect(verifyLease(copiedDeviceVector)).toEqual({ ok: false, code: "lease_device_mismatch" });
  ```

  Reject GD1, GD2, H1, malformed/oversized base64url, unknown schema/key ID, wrong product/audience/issuer/capability, clock skew, expiry, and copied device.

- [ ] **Step 2: Verify current failures**

  Run: `pnpm --filter @grokdesk/license test`

- [ ] **Step 3: Implement bounded extraction and public verification only**

  Accept at most 8 KiB input and exactly one `GD3.<claims>.<signature>` token. Parse claims only after base64url length checks. The package exposes no private-key load, key issuance, HMAC, machine fingerprint, local activation signing, or local grace extension.

  ```ts
  export type LeaseDecision =
    | { ok: true; claims: DeviceLeaseClaims; state: "active" | "refresh_due" | "offline_grace" }
    | { ok: false; code: StableEntitlementError; state: EntitlementState };
  ```

- [ ] **Step 4: Derive explicit state and capability decisions**

  `deriveEntitlementState` uses verified claims, safe authoritative denial, refresh error class, and clock. A network error preserves the last cryptographically valid lease until its original expiry; no code changes `exp` locally.

- [ ] **Step 5: Run cross-repository vectors and commit**

  ```bash
  pnpm --filter @grokdesk/license test
  pnpm --filter @grokdesk/shared test -- src/entitlements
  git add packages/license docs/license-release-keys.md
  git rm scripts/license-keygen.mjs
  git commit -m "refactor: replace local activation with lease verification"
  ```

### Task 3: Store product and device secrets in native OS credential stores

**Files:**
- Delete: `apps/desktop/src/main/credential-vault.ts`
- Delete: `apps/desktop/src/main/p0/credential-vault.test.ts`
- Create: `apps/desktop/src/main/entitlements/os-credential-vault.ts`
- Create: `apps/desktop/src/main/entitlements/os-credential-vault.test.ts`
- Create: `apps/desktop/src/main/entitlements/device-identity.ts`
- Create: `apps/desktop/src/main/entitlements/device-identity.test.ts`
- Create: `apps/desktop/src/main/entitlements/types.ts`
- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/scripts/rebuild-native-for-electron.mjs`
- Modify: `apps/desktop/scripts/rebuild-native-for-node.mjs`
- Modify: `apps/desktop/src/packaging.smoke.test.ts`

- [ ] **Step 1: Write failing vault and identity tests**

  Test set/get/delete, persistence across wrapper instances, access denial, corrupt JSON, native module failure, and no plaintext fallback. Test first-run UUIDv4 plus Ed25519 identity, stable reuse, metadata reconstruction, and refusal to regenerate when a lease exists but the private key is missing.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements/os-credential-vault.test.ts src/main/entitlements/device-identity.test.ts`

- [ ] **Step 3: Implement the strict native vault**

  Use `@github/keytar` with service `ai.x.grokdesk` and accounts `product-key/v1` and `device-identity/v1`. Package/rebuild its native module for Electron 33 on macOS ARM64/x64 and Windows x64. If native storage cannot load or returns an OS denial, return `credential_store_failure`; never fall back to memory, `safeStorage` files, plaintext, CLI arguments, or SQLite.

  ```ts
  export interface OsCredentialVault {
    get(account: "product-key/v1" | "device-identity/v1"): Promise<string | null>;
    set(account: "product-key/v1" | "device-identity/v1", value: string): Promise<void>;
    delete(account: "product-key/v1" | "device-identity/v1"): Promise<boolean>;
  }
  ```

- [ ] **Step 4: Implement random device identity**

  Store `{ schema:1, deviceId, publicJwk, privatePkcs8Base64, createdAt, displayName }` in the device entry. UUID/key are random and never derived from hostname, username, OS, or architecture. Customer-visible OS name may seed `displayName` only.

- [ ] **Step 5: Verify package inclusion and commit**

  Run:

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements
  pnpm --filter @grokdesk/desktop run rebuild:electron
  pnpm --filter @grokdesk/desktop exec vitest run src/packaging.smoke.test.ts
  ```

  Expected: PASS and native module is unpacked/loaded in packaged smoke.

  ```bash
  git add apps/desktop/package.json apps/desktop/scripts apps/desktop/src/main/entitlements apps/desktop/src/packaging.smoke.test.ts pnpm-lock.yaml
  git rm apps/desktop/src/main/credential-vault.ts apps/desktop/src/main/p0/credential-vault.test.ts
  git commit -m "feat: add native entitlement credential vault"
  ```

### Task 4: Persist only signed lease state atomically

**Files:**
- Create: `apps/desktop/src/main/entitlements/state-store.ts`
- Create: `apps/desktop/src/main/entitlements/state-store.test.ts`

- [ ] **Step 1: Write failing crash/permission/canary tests**

  Inject failures before write, after fsync, and before rename. Assert the previous valid file remains readable; mode is `0600` on POSIX; parent is user-only; state contains lease plus safe denial metadata but no GD3 or private key.

- [ ] **Step 2: Implement the state envelope**

  ```ts
  export type EntitlementStateFile = {
    schema: 1;
    deviceId: string;
    devicePublicKeyThumbprint: string;
    lease: string | null;
    authoritativeState: "none" | "suspended" | "refunded" | "revoked" | "device_deactivated";
    updatedAt: string;
    requestId: string | null;
  };
  ```

  Write unique temp → fsync file → rename → fsync directory. Reject symlinks, world/group-readable files, unknown schema, and oversized files. Keep the previous valid lease when transient refresh fails.

- [ ] **Step 3: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements/state-store.test.ts
  git add apps/desktop/src/main/entitlements/state-store.ts apps/desktop/src/main/entitlements/state-store.test.ts
  git commit -m "feat: persist signed entitlement state atomically"
  ```

### Task 5: Implement main-process activation and refresh management

**Files:**
- Create: `apps/desktop/src/main/entitlements/activation-flow.ts`
- Create: `apps/desktop/src/main/entitlements/activation-flow.test.ts`
- Create: `apps/desktop/src/main/entitlements/refresh-loop.ts`
- Create: `apps/desktop/src/main/entitlements/refresh-loop.test.ts`
- Create: `apps/desktop/src/main/entitlements/error-map.ts`
- Create: `apps/desktop/src/main/entitlements/error-map.test.ts`
- Create: `apps/desktop/src/main/entitlements/entitlement-manager.ts`
- Create: `apps/desktop/src/main/entitlements/entitlement-manager.test.ts`

- [ ] **Step 1: Write failing flow tests**

  Cover challenge proof, response loss/retry idempotency, double-click single-flight, seat limit with validated key retention, successful vault write, startup refresh, 24-hour jitter, transient failure preserving lease, authoritative denial applied immediately, and no local expiry extension.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements/activation-flow.test.ts src/main/entitlements/refresh-loop.test.ts src/main/entitlements/entitlement-manager.test.ts`

- [ ] **Step 3: Implement exact activation proof**

  Request a challenge, construct contract-defined canonical payload with challenge/nonce/device UUID/public JWK/thumbprint/name/platform/process architecture/OS/Desk version, sign with device private key, submit GD3 and proof, verify returned lease locally, then store key and state. Do not store an invalid key. A `seat_limit` response proves a valid current key, so securely store it for retry.

- [ ] **Step 4: Implement refresh policy**

  Initialize before gateway startup. Refresh at startup when `now >= refreshAfter`, then schedule at `refreshAfter` with ±10% jitter and single-flight. On timeout/network/5xx/429, preserve a still-valid lease and expose `service_unavailable`/`offline_grace`; on signed/authoritative suspension/refund/revocation/deactivation, write denial immediately. Never mutate `exp`.

- [ ] **Step 5: Map only stable safe errors**

  Map every service code to a safe renderer key and recovery action. Raw response bodies, crypto causes, stack traces, key, nonce, proof, and lease never leave main logs.

- [ ] **Step 6: Verify and commit**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements`

  ```bash
  git add apps/desktop/src/main/entitlements
  git commit -m "feat: activate and refresh desktop entitlement"
  ```

### Task 6: Expose narrow main-only entitlement IPC

**Files:**
- Create: `apps/desktop/src/main/entitlements/ipc.ts`
- Create: `apps/desktop/src/main/entitlements/ipc.test.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Modify: `apps/desktop/src/main/ipc-bridge.ts`
- Modify: `apps/desktop/src/main/security-url.ts`

- [ ] **Step 1: Write failing IPC boundary tests**

  Assert renderer can call only `status`, typed activation, clipboard activation, bounded file activation, retry, refresh, current-device deactivation, clear local key, reset identity, open portal, and open purchase. Assert it cannot set lease/state/device public key, answer gateway proof, pass a file path without dialog approval, or call generic gateway license RPC.

- [ ] **Step 2: Define safe DTOs**

  ```ts
  export type EntitlementStatusDto = {
    state: EntitlementState;
    expiresAt: string | null;
    refreshAfter: string | null;
    deviceName: string;
    activeDevices: number | null;
    seatLimit: 3;
    devices: Array<{ name: string; platform: string; architecture: string; lastSeenAt: string }>;
    recoveryAction: "none" | "retry" | "portal" | "purchase" | "credential_help";
  };
  ```

  No DTO contains product key, lease, claim set, device public/private key, challenge, signature, token, raw server body, or internal path.

- [ ] **Step 3: Keep clipboard/file key extraction in main**

  Clipboard activation reads clipboard in main. Import uses a main-owned file dialog, accepts `.txt`, `.md`, `.json`, caps UTF-8 at 8 KiB, rejects zero/multiple tokens, and deletes no user file. Neither path returns extracted contents to renderer.

- [ ] **Step 4: Verify and commit**

  Run: `pnpm --filter @grokdesk/shared test -- src/ipc.test.ts && pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements/ipc.test.ts src/main/security-url.test.ts`

  ```bash
  git add packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts apps/desktop/src/main/entitlements/ipc.ts apps/desktop/src/main/entitlements/ipc.test.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/lib/api.ts apps/desktop/src/main/ipc-bridge.ts apps/desktop/src/main/security-url.ts
  git commit -m "feat: expose safe entitlement IPC"
  ```

### Task 7: Prove device identity to the gateway without sharing secrets

**Files:**
- Modify: `packages/gateway/src/host-bridge.ts`
- Modify: `packages/gateway/src/host-bridge.test.ts`
- Modify: `apps/desktop/src/main/gateway-process.ts`
- Modify: `apps/desktop/src/main/gateway-process.test.ts`
- Create: `packages/gateway/src/services/entitlement-device-proof.ts`
- Create: `packages/gateway/src/services/entitlement-device-proof.test.ts`

- [ ] **Step 1: Write failing startup proof tests**

  Gateway creates a random nonce; main signs `GROKDESK-GATEWAY-DEVICE-V1\n<nonce>\n<gatewayPid>\n<deviceId>`; gateway verifies against the lease-bound public key. Test replay, wrong PID/device, invalid signature, timeout, and renderer attempt.

- [ ] **Step 2: Implement main-only HostBridge method**

  Pass `GROKDESK_ENTITLEMENT_STATE_PATH` as a path only. The gateway reads the public key from the verified lease claims/state; it requests one startup proof through HostBridge. Main reads private key from native vault only for signing and clears buffers after use. Generic renderer IPC cannot invoke this method.

- [ ] **Step 3: Verify and commit**

  Run: `pnpm --filter @grokdesk/gateway test -- src/host-bridge.test.ts src/services/entitlement-device-proof.test.ts && pnpm --filter @grokdesk/desktop exec vitest run src/main/gateway-process.test.ts`

  ```bash
  git add packages/gateway/src/host-bridge.ts packages/gateway/src/host-bridge.test.ts packages/gateway/src/services/entitlement-device-proof.ts packages/gateway/src/services/entitlement-device-proof.test.ts apps/desktop/src/main/gateway-process.ts apps/desktop/src/main/gateway-process.test.ts
  git commit -m "feat: bind gateway to device entitlement"
  ```

### Task 8: Guard every Grok-backed gateway entry point

**Files:**
- Create: `packages/gateway/src/services/entitlement-guard.ts`
- Create: `packages/gateway/src/services/entitlement-guard.test.ts`
- Create: `packages/gateway/src/services/entitlement-engine.ts`
- Create: `packages/gateway/src/services/entitlement-engine.test.ts`
- Create: `packages/gateway/src/services/entitlement-error.ts`
- Create: `packages/gateway/src/services/entitlement-entrypoints.test.ts`
- Modify: `packages/gateway/src/services/task-submission.ts`
- Modify: `packages/gateway/src/services/scheduler.ts`
- Modify: `packages/gateway/src/services/runner.ts`
- Modify: `packages/gateway/src/services/title-generation.ts`
- Modify: `packages/gateway/src/services/remote-application.ts`
- Modify: `apps/desktop/src/main/dictation-service.ts`

- [ ] **Step 1: Write the entry-point matrix first**

  ```ts
  const protectedEntrypoints = [
    "interactive", "follow_up", "revision", "retry", "remote", "scheduled",
    "queued_execution", "provider_inference", "title_generation", "dictation",
  ] as const;
  for (const entrypoint of protectedEntrypoints) {
    it(`blocks ${entrypoint} when the lease is expired`, () => assertBlocked(entrypoint));
  }
  ```

  Also assert conversation/artifact/task view, export, settings, diagnostics/logs, runtime repair/update, entitlement recovery/portal, local manage, cancellation, and deletion remain allowed.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/gateway test -- src/services/entitlement-entrypoints.test.ts`

- [ ] **Step 3: Implement synchronous guard decisions**

  The guard rereads the atomic state when mtime changes, verifies bundled lease-signing key ring, issuer/audience/product/device/capability/time, applies authoritative denial, and exposes:

  ```ts
  assertCapability(capability: "grok_operation" | "local_read" | "local_manage" | "recovery", action: string): void;
  ```

  Failure is `entitlement_read_only` with safe state/action only. It never includes lease or claims. A bundled trusted key ring may be updated by signed app releases; an arbitrary network key never becomes trusted without chain validation.

- [ ] **Step 4: Enforce at admission and last inference boundary**

  Guard `TaskSubmissionService.submit`, scheduler before occurrence creation, runner after queue delay and before side effects, `EntitlementGuardedEngine.run`, title generation, and dictation before capture and before upload. Remote creation routes through the same submission service. Expired queued work becomes a recoverable blocked state and does not spin in `pumpQueue`.

- [ ] **Step 5: Verify all entry points and commit**

  Run:

  ```bash
  pnpm --filter @grokdesk/gateway test -- src/services/entitlement-guard.test.ts src/services/entitlement-engine.test.ts src/services/entitlement-entrypoints.test.ts src/services/scheduler.test.ts src/services/runner.test.ts
  pnpm --filter @grokdesk/desktop exec vitest run src/main/dictation-service.test.ts
  ```

  ```bash
  git add packages/gateway/src/services apps/desktop/src/main/dictation-service.ts apps/desktop/src/main/dictation-service.test.ts
  git commit -m "feat: enforce entitlement at Grok boundaries"
  ```

### Task 9: Remove full keys and legacy license RPC from SQLite/gateway

**Files:**
- Delete: `packages/gateway/src/services/license-ops.ts`
- Delete: `packages/gateway/src/services/license-ops.test.ts`
- Delete: `packages/gateway/src/license.integration.test.ts`
- Rename: `packages/gateway/src/services/license-meta-dispatch.ts` to `packages/gateway/src/services/meta-dispatch.ts`
- Modify: `packages/gateway/src/services/settings.ts`
- Modify: `packages/gateway/src/services/settings.test.ts`
- Modify: `packages/gateway/src/services/settings-response.ts`
- Modify: `packages/gateway/src/services/gateway-domain-deps.ts`
- Modify: `packages/shared/src/settings-schema.ts`
- Modify: `packages/shared/src/settings-schema.test.ts`
- Modify: `packages/shared/src/remote-allowlist.ts`

- [ ] **Step 1: Write failing schema and RPC absence tests**

  Assert `AppSettings` has no `license`, settings responses contain no activation/key, and RPC methods `license.status`, `license.activate`, and `license.verify` are absent from local/remote allowlists and dispatch.

- [ ] **Step 2: Remove gateway-owned activation/storage**

  Remove `SettingsService.setLicense`, current license ops, local `online` verify, full activation persistence, machine fingerprint, and comments claiming secrets are settings. Rename the remaining metadata dispatcher so it does not imply gateway license ownership.

- [ ] **Step 3: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/shared test -- src/settings-schema.test.ts src/remote-allowlist.test.ts
  pnpm --filter @grokdesk/gateway test -- src/services/settings.test.ts src/services/settings-response.test.ts
  git add packages/gateway packages/shared
  git commit -m "refactor: remove gateway license secret storage"
  ```

### Task 10: Migrate legitimate GD2 and securely purge old material

**Files:**
- Create: `packages/gateway/src/legacy-license-migration.ts`
- Create: `packages/gateway/src/legacy-license-migration.test.ts`
- Create: `apps/desktop/src/main/entitlements/legacy-migration.ts`
- Create: `apps/desktop/src/main/entitlements/legacy-migration.test.ts`
- Create: `docs/runbooks/legacy-license-migration.md`

- [ ] **Step 1: Write failing crash-idempotency and canary tests**

  Cover no legacy data, allowlisted GD2 exchange, unrecognized GD2, GD1/H1/dev rejection, vault denial, lost response, crash after vault write, crash after lease state write, SQLite/WAL purge, and preservation of conversations/tasks/artifacts/preferences/remote/SuperGrok auth.

- [ ] **Step 2: Implement journaled extraction**

  States are `detected`, `vault_written`, `exchange_started`, `lease_received`, `legacy_purged`, and `complete`. Main invokes a narrow gateway migration subpath before normal gateway startup, receives legacy material once, moves it to native vault, then calls only the server allowlist exchange. It never transforms GD2 locally.

- [ ] **Step 3: Purge securely after verified replacement**

  After rereading the vault and verifying the new lease, transactionally remove the legacy field, enable SQLite `secure_delete`, checkpoint/truncate WAL, and vacuum while idle. H1/GD1/development material is purged and yields recovery/support; it never activates.

- [ ] **Step 4: Verify and commit**

  Run:

  ```bash
  pnpm --filter @grokdesk/gateway test -- src/legacy-license-migration.test.ts src/p0/secret-settings.test.ts
  pnpm --filter @grokdesk/desktop exec vitest run src/main/entitlements/legacy-migration.test.ts
  ```

  Expected: database/WAL canary scan finds no GD1/GD2/GD3 or activation signature after success.

  ```bash
  git add packages/gateway/src/legacy-license-migration.ts packages/gateway/src/legacy-license-migration.test.ts apps/desktop/src/main/entitlements/legacy-migration.ts apps/desktop/src/main/entitlements/legacy-migration.test.ts docs/runbooks/legacy-license-migration.md
  git commit -m "feat: migrate and purge legacy licenses"
  ```

### Task 11: Build activation, seat-limit, and read-only UX

**Files:**
- Create: `apps/desktop/src/renderer/lib/entitlement.ts`
- Create: `apps/desktop/src/renderer/lib/entitlement.test.ts`
- Create: `apps/desktop/src/renderer/hooks/use-entitlement.ts`
- Create: `apps/desktop/src/renderer/hooks/use-entitlement.test.tsx`
- Create: `apps/desktop/src/renderer/components/license-activation-screen.tsx`
- Create: `apps/desktop/src/renderer/components/license-activation-screen.test.tsx`
- Create: `apps/desktop/src/renderer/components/license-read-only-banner.tsx`
- Create: `apps/desktop/src/renderer/components/license-read-only-banner.test.tsx`
- Create: `apps/desktop/src/renderer/components/license-seat-limit.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/onboarding-wizard.tsx`
- Modify: `apps/desktop/src/renderer/components/views/settings/license-tab.tsx`
- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/components/views/scheduled-view.tsx`
- Modify: `apps/desktop/src/renderer/components/inbox-panel.tsx`
- Modify: `apps/desktop/src/renderer/components/dictation-button.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/*.json`

- [ ] **Step 1: Write failing renderer-clearing and state tests**

  ```ts
  fireEvent.change(keyInput, { target: { value: "GD3.abc.def" } });
  fireEvent.keyDown(keyInput, { key: "Enter" });
  expect(keyInput).toHaveValue("");
  expect(activateTyped).toHaveBeenCalledWith("GD3.abc.def");
  activation.resolve(seatLimitStatus);
  expect(await screen.findByText("All 3 device slots are in use")).toBeVisible();
  ```

  Assert clearing occurs before the promise resolves, including rejection.

- [ ] **Step 2: Implement the activation screen**

  Use password input, explicit Reveal, `autoComplete="off"`, `spellCheck={false}`, Enter submit, main-owned Paste and Import buttons, immediate local GD3 shape check, “Where is my key?”, portal, purchase, three-device/lifetime/privacy copy, and localized stable errors only.

- [ ] **Step 3: Implement seat-limit and read-only behavior**

  Show API-provided safe summaries, portal and Retry; never auto-evict. When blocked, retain shell/conversations/artifacts/export/settings/diagnostics/repair/recovery/delete, show persistent recovery banner, and proactively disable Grok composer/follow-up/run-now/dictation while allowing schedule editing with a “will not run until active” message. Gateway remains authoritative.

- [ ] **Step 4: Enforce readiness ordering**

  First run is license activation → managed runtime → SuperGrok auth → workspace/permissions → ready. Remove all demo/fake copy and skip paths.

- [ ] **Step 5: Verify seven locales and commit**

  Run:

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/renderer/lib/entitlement.test.ts src/renderer/hooks/use-entitlement.test.tsx src/renderer/components/license-activation-screen.test.tsx src/renderer/components/license-read-only-banner.test.tsx
  pnpm --filter @grokdesk/desktop exec vitest run src/renderer/i18n/i18n.test.ts
  ```

  ```bash
  git add apps/desktop/src/renderer
  git commit -m "feat: add secure desktop activation UX"
  ```

### Task 12: Add commerce secret redaction and desktop E2E

**Files:**
- Modify: `apps/desktop/src/main/redact.ts`
- Modify: `apps/desktop/src/main/redact.test.ts`
- Modify: `packages/shared/src/secret-redact.ts`
- Create: `packages/shared/src/p0/commerce-secret-canary.test.ts`
- Create: `packages/gateway/src/services/entitlement-redaction.test.ts`
- Create: `apps/desktop/src/main/entitlements/secret-canary.test.ts`
- Create: `apps/desktop/e2e/activation.spec.ts`
- Create: `apps/desktop/e2e/read-only.spec.ts`

- [ ] **Step 1: Write failing canary tests**

  Feed GD1/GD2/GD3, signed lease, private JWK/PKCS#8, activation/refresh signature, challenge nonce, and portal/magic/grant token through IPC errors, gateway stdio frames, logs, diagnostics, SQLite/WAL, state/journal/temp files, and remote errors. Assert renderer/remote receive safe code only.

- [ ] **Step 2: Extend centralized redaction**

  Log only event name, stable result code, platform/architecture, retry class, and generated correlation ID. Fetch request/response bodies are never logged. Gateway internal causes remain local and redacted; stdio frames carry a separate safe code.

- [ ] **Step 3: Implement activation/read-only E2E**

  Test pasted/imported key, Enter submit, three-device seat limit fixture, portal link, offline restart, refresh due, lease expiry, service failure, revocation, local data view/export, blocked interactive/remote/scheduled/dictation, and recovery. Assert no key appears in DOM snapshots, console, SQLite, logs, or diagnostics.

- [ ] **Step 4: Run final lane gate**

  ```bash
  pnpm --filter @grokdesk/entitlement-client test
  pnpm --filter @grokdesk/license test
  pnpm --filter @grokdesk/gateway test
  pnpm --filter @grokdesk/desktop test
  pnpm -r typecheck
  pnpm -r build
  pnpm --filter @grokdesk/desktop e2e -- e2e/activation.spec.ts e2e/read-only.spec.ts
  rg -n 'GD1\.|H1\.|signActivationBlob|DEFAULT_LICENSE_SECRET|fingerprintMachine' apps packages scripts --glob '!**/dist/**' --glob '!**/testdata/**'
  ```

  Expected: all tests/builds pass; ripgrep finds no production legacy activation path.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/desktop/src/main/redact.ts apps/desktop/src/main/redact.test.ts apps/desktop/src/main/entitlements/secret-canary.test.ts apps/desktop/e2e packages/shared/src/secret-redact.ts packages/shared/src/p0/commerce-secret-canary.test.ts packages/gateway/src/services/entitlement-redaction.test.ts
  git commit -m "test: prove entitlement enforcement and secrecy"
  ```

## Lane acceptance

The desktop entitlement lane is complete when the renderer never retains a key, native Keychain/Credential Manager persistence passes clean packaged tests, random device identity survives restarts, main performs real challenge/refresh calls, the gateway independently verifies a device-bound lease at every Grok boundary, expired/revoked users retain local read/export/recovery, SQLite/logs contain no key material, and GD1/H1/local-signing paths are absent from production.
