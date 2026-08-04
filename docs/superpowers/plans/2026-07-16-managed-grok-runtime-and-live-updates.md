# Managed Grok Runtime and Synchronized Live Updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically install a verified Desk-managed Grok runtime and deliver synchronized, compatible live updates for Grok Desk and Grok on qualified macOS and Windows architectures.

**Architecture:** A separately signed compatibility manifest resolves one exact Desk/Grok pair for the running process target. Electron main downloads and verifies side-by-side Grok runtimes under user data, atomically selects a current/previous pair, and coordinates exact-version Desk updates through a narrow electron-updater wrapper. Durable journals recover crashes; gateway admission pauses installation until work is idle; post-restart health commits or restores the runtime/read-only repair state.

**Tech Stack:** TypeScript, Electron 33, SemVer 2, Ed25519, electron-updater, electron-builder, Node streams/crypto/fs, macOS codesign/spctl/notarytool, Windows Authenticode/NSIS, Vitest, Playwright, GitHub Actions.

**Design:** `docs/superpowers/specs/2026-07-16-commerce-entitlements-runtime-updates-design.md`

---

## Parallel ownership

After target/manifest DTO freeze, these streams can run concurrently:

- Manifest contracts/resolver: `packages/shared/src/{runtime-target,compatibility-*}` and vectors.
- Runtime storage/download/verification: `apps/desktop/src/main/runtime/**`.
- Updater coordinator: `apps/desktop/src/main/updates/**` after resolver/status freeze.
- Renderer UX: runtime/update components after `UpdateStatus` freeze.
- Release pipeline: workflow/builder/scripts after artifact naming freeze.

The engine cutover stream must also own `packages/engine-grok/**`, engine composition, `FakeEngine` removal, and global Grok discovery because those collide with entitlement work. Integration hotspots have one owner: desktop main/index/IPC/preload, shared IPC/index, `apps/desktop/package.json`, lockfile, locale files, and builder config.

## Resolved platform and rollback policy

- Artifact selection uses `process.platform` + `process.arch`, not host CPU. An x64 Desk under Rosetta/emulation receives x64 Grok.
- Qualified publication targets: `darwin-arm64`, `darwin-x64`, `win32-x64`.
- `win32-arm64` stays absent until a native Desk/Grok pair passes the full real-hardware suite.
- Current and previous verified Grok runtimes are side-by-side and automatically switchable.
- The Electron app itself is installed by platform installer semantics. After a bad Desk update, restore a compatible previous Grok when possible; otherwise enter licensed read-only repair and offer a separately signed, manifest-authorized prior Desk installer as a rollback update. Automatic binary-level Desk rollback would require a separate native bootstrap/watchdog and is outside this approved architecture.

### Task 1: Freeze target, manifest, and compatible-pair contracts

**Files:**
- Create: `packages/shared/src/runtime-target.ts`
- Create: `packages/shared/src/runtime-target.test.ts`
- Create: `packages/shared/src/compatibility-manifest.ts`
- Create: `packages/shared/src/compatibility-manifest.test.ts`
- Create: `packages/shared/src/compatibility-resolver.ts`
- Create: `packages/shared/src/compatibility-resolver.test.ts`
- Create: `packages/shared/src/update-status.ts`
- Create: `docs/contracts/release-manifest-v1.schema.json`
- Create: `docs/contracts/release-manifest-v1-vectors.json`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/package.json`

- [ ] **Step 1: Write failing target and semantic-resolution tests**

  ```ts
  expect(toRuntimeTarget("darwin", "arm64")).toBe("darwin-arm64");
  expect(toRuntimeTarget("darwin", "x64")).toBe("darwin-x64");
  expect(toRuntimeTarget("win32", "x64")).toBe("win32-x64");
  expect(toRuntimeTarget("linux", "x64")).toBe("unsupported");
  expect(resolvePair(manifest, installedStable)).toMatchObject({ deskVersion: "1.2.0", grokVersion: "0.9.4" });
  expect(resolvePair(manifestWithOnlyBeta, installedStable)).toBeNull();
  ```

  Cover prerelease precedence, channel opt-in, rollout cohort, deadline override, revoked version/artifact, explicit downgrade edge, missing target, and no independently latest pair.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/shared test -- src/runtime-target.test.ts src/compatibility-manifest.test.ts src/compatibility-resolver.test.ts`

- [ ] **Step 3: Define the signed envelope**

  ```ts
  export type SignedCompatibilityEnvelope = {
    schemaVersion: 1;
    payloadBase64Url: string;
    signatures: Array<{ algorithm: "Ed25519"; keyId: string; signatureBase64Url: string }>;
  };
  ```

  `payloadBase64Url` contains exact RFC 8785 UTF-8 manifest bytes. Each signature signs `GROKDESK-RELEASE-MANIFEST-V1\n<payloadBase64Url>`. Payload contains monotonic sequence; issued/expiry; stable/beta; Desk/Grok releases per target; exact compatibility pairs; capabilities; artifact ID/grant endpoint/size/SHA-256/provenance/signing policy; rollout basis points/salt; security deadline; revocations; authorized downgrade edges; release notes/support.

- [ ] **Step 4: Implement target and pair resolution**

  Add `semver` and types as direct dependencies. Select only pairs containing the installed/target versions allowed by channel and exact target. Cohort is a SHA-256 of opaque device cohort ID plus signed salt. Security deadline and revocation override percentage. Returning from beta to stable requires a signed compatible stable pair and an authorized downgrade edge when version precedence decreases.

- [ ] **Step 5: Verify vectors and commit**

  Run: `pnpm --filter @grokdesk/shared test -- src/runtime-target.test.ts src/compatibility-manifest.test.ts src/compatibility-resolver.test.ts`

  ```bash
  git add packages/shared/src/runtime-target.ts packages/shared/src/runtime-target.test.ts packages/shared/src/compatibility-manifest.ts packages/shared/src/compatibility-manifest.test.ts packages/shared/src/compatibility-resolver.ts packages/shared/src/compatibility-resolver.test.ts packages/shared/src/update-status.ts packages/shared/src/index.ts packages/shared/package.json docs/contracts/release-manifest-v1.schema.json docs/contracts/release-manifest-v1-vectors.json pnpm-lock.yaml
  git commit -m "feat: define compatible Desk and Grok releases"
  ```

### Task 2: Verify, fetch, and cache signed manifests safely

**Files:**
- Create: `apps/desktop/src/main/updates/manifest-verifier.ts`
- Create: `apps/desktop/src/main/updates/manifest-verifier.test.ts`
- Create: `apps/desktop/src/main/updates/manifest-client.ts`
- Create: `apps/desktop/src/main/updates/manifest-client.test.ts`
- Create: `apps/desktop/src/main/updates/manifest-cache.ts`
- Create: `apps/desktop/src/main/updates/manifest-cache.test.ts`
- Modify: `apps/desktop/electron.vite.config.ts`

- [ ] **Step 1: Write failing signature/rollback/cache tests**

  Test valid overlapping key rotation, unknown-only signatures, tampering, expiry, highest sequence, same sequence/different hash, sequence rollback, absent target, revoked pair, HTTP ETag/304, offline valid cache, corrupt cache, oversized response, and packaged local-file rejection.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/manifest-verifier.test.ts src/main/updates/manifest-client.test.ts src/main/updates/manifest-cache.test.ts`

- [ ] **Step 3: Compile a separate release key ring**

  Use `GROKDESK_RELEASE_PUBLIC_KEYS` at build time, separate from product/lease keys. Accept a signature only from a trusted key valid for that sequence/time. The network public-key endpoint may supply rotation metadata but cannot replace the built-in root without a trusted cross-signature.

- [ ] **Step 4: Persist anti-rollback state atomically**

  Cache `{ envelope, payloadSha256, highestSequence, etag, checkedAt }` under user data with unique temp/fsync/rename. Reject a lower sequence and same sequence with a new hash. Development fixture URLs are accepted only when `!app.isPackaged` and an explicit test flag is set.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/manifest-*.test.ts`

  ```bash
  git add apps/desktop/src/main/updates/manifest-* apps/desktop/electron.vite.config.ts
  git commit -m "feat: verify signed release manifests"
  ```

### Task 3: Create side-by-side runtime storage and crash recovery

**Files:**
- Create: `apps/desktop/src/main/runtime/runtime-types.ts`
- Create: `apps/desktop/src/main/runtime/runtime-paths.ts`
- Create: `apps/desktop/src/main/runtime/runtime-paths.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-store.ts`
- Create: `apps/desktop/src/main/runtime/runtime-store.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-recovery.ts`
- Create: `apps/desktop/src/main/runtime/runtime-recovery.test.ts`

- [ ] **Step 1: Write failing path, traversal, pointer, and GC tests**

  ```ts
  expect(runtimeBinary(root, "0.9.4", "darwin-arm64")).toBe(
    join(root, "runtimes/grok/0.9.4/darwin-arm64/grok"),
  );
  expect(() => runtimeBinary(root, "../escape", "darwin-arm64")).toThrowError("invalid_runtime_version");
  ```

  Inject crash before/after pointer temp write/fsync/rename/backup cleanup. Assert recovery selects only a complete verified installation and GC retains current, previous, and journal-referenced versions.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime/runtime-paths.test.ts src/main/runtime/runtime-store.test.ts src/main/runtime/runtime-recovery.test.ts`

- [ ] **Step 3: Implement exact layout**

  ```text
  <userData>/runtimes/grok/<version>/<target>/grok[.exe]
  <userData>/runtimes/grok/<version>/<target>/installation.json
  <userData>/runtimes/grok/current.json
  <userData>/runtimes/grok/staging/
  <userData>/runtimes/grok/quarantine/
  ```

  `installation.json` contains artifact ID, version/target, digest, provenance, manifest sequence/key ID, install time, platform-signing result, and probe results. Validate every resolved path remains below the runtime root, reject symlink traversal, and use user-only permissions.

- [ ] **Step 4: Implement atomic selection**

  `current.json` stores current and previous installation references/digests. Switch via temp/fsync/rename, then re-read and rehash. Never select staging or quarantine. Startup removes abandoned staging only when it is not in the update journal.

- [ ] **Step 5: Verify and commit**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime`

  ```bash
  git add apps/desktop/src/main/runtime/runtime-types.ts apps/desktop/src/main/runtime/runtime-paths.ts apps/desktop/src/main/runtime/runtime-paths.test.ts apps/desktop/src/main/runtime/runtime-store.ts apps/desktop/src/main/runtime/runtime-store.test.ts apps/desktop/src/main/runtime/runtime-recovery.ts apps/desktop/src/main/runtime/runtime-recovery.test.ts
  git commit -m "feat: add side-by-side Grok runtime store"
  ```

### Task 4: Download runtime artifacts with bounded resume

**Files:**
- Create: `apps/desktop/src/main/runtime/artifact-downloader.ts`
- Create: `apps/desktop/src/main/runtime/artifact-downloader.test.ts`

- [ ] **Step 1: Write failing streaming and resume tests**

  Cover exact length, overrun, underrun, digest mismatch, redirect allowlist, timeout, cancellation, disk full, server without ranges, correct 206/Content-Range, changed ETag/artifact/digest, interrupted resume, and cleanup/quarantine.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime/artifact-downloader.test.ts`

- [ ] **Step 3: Implement safe streaming**

  Create `.part` and metadata with exclusive user-only permissions. Stream without buffering, abort at `expectedSize + 1`, update SHA-256, fsync. Resume only if artifact ID, SHA, expected length, ETag, and source host still match; require valid 206 and exact Content-Range. Otherwise delete partial and restart at byte 0.

  Follow at most three HTTPS redirects to the signed allowlist. Never send entitlement bearer/cookie across an origin change; download grants resolve to an opaque storage URL first.

- [ ] **Step 4: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime/artifact-downloader.test.ts
  git add apps/desktop/src/main/runtime/artifact-downloader.ts apps/desktop/src/main/runtime/artifact-downloader.test.ts
  git commit -m "feat: download Grok runtime safely"
  ```

### Task 5: Verify platform signatures, capabilities, and install transaction

**Files:**
- Create: `apps/desktop/src/main/runtime/platform-signature.ts`
- Create: `apps/desktop/src/main/runtime/platform-signature.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-verifier.ts`
- Create: `apps/desktop/src/main/runtime/runtime-verifier.test.ts`
- Create: `apps/desktop/src/main/runtime/runtime-manager.ts`
- Create: `apps/desktop/src/main/runtime/runtime-manager.test.ts`

- [ ] **Step 1: Write failing verification/install tests**

  Cover SHA/size, macOS wrong Team ID/designated requirement, Windows invalid status/thumbprint/subject, unsigned artifact when required, executable bit, probe timeout/output cap, version mismatch, missing `agent --help`, failed capability, switch failure, gateway rebuild failure, and previous rollback.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime/platform-signature.test.ts src/main/runtime/runtime-verifier.test.ts src/main/runtime/runtime-manager.test.ts`

- [ ] **Step 3: Implement native signature checks without shell interpolation**

  macOS spawns argument arrays for `codesign --verify --strict`, extracts Team ID/designated requirement, and runs `spctl -a -t exec`. Windows invokes PowerShell `Get-AuthenticodeSignature` with an escaped literal path through stdin/script file, requires `Status=Valid`, and matches manifest thumbprint/subject. Cap output/time; log safe result only.

- [ ] **Step 4: Implement non-billable probes**

  Run explicit binary with `--version`, `--help`, and `agent --help`; cap each at 10 seconds and 256 KiB; require exact declared version and manifest capabilities, including managed mode/no self-update. Set `0755` on macOS only after digest/signature pass.

- [ ] **Step 5: Implement the install transaction**

  Resolve pair → target/disk/writable checks → grant/download → length/digest → platform signature → probes → atomic version-directory rename → pointer switch → gateway rebuild with explicit binary → auth/capability health. Pre-switch failures preserve current. Post-switch failure restores previous pointer and rebuilds it. Startup rehashes the selected binary.

- [ ] **Step 6: Verify and commit**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/runtime`

  ```bash
  git add apps/desktop/src/main/runtime
  git commit -m "feat: install verified managed Grok runtime"
  ```

### Task 6: Remove global Grok and simulated production composition

**Files:**
- Create: `packages/engine-testkit/package.json`
- Create: `packages/engine-testkit/src/test-engine.ts`
- Create: `packages/engine-testkit/src/index.ts`
- Create: `packages/engine-grok/testdata/test-grok-cli.mjs`
- Modify: `packages/engine-grok/src/discover.ts`
- Modify: `packages/engine-grok/src/discover.test.ts`
- Modify: `packages/engine-grok/src/session.ts`
- Modify: `packages/engine-grok/src/index.ts`
- Modify: `packages/engine-grok/src/auth-bridge.ts`
- Modify: `packages/gateway/src/engine-composition.ts`
- Modify: `packages/gateway/src/provider-composition.ts`
- Modify: `packages/gateway/src/services/auth-grok.ts`
- Modify: `packages/gateway/src/services/engine-rebuild.ts`
- Modify: `packages/gateway/src/services/ensure-desk-planes-engine.ts`
- Modify: `apps/desktop/src/main/gateway-process.ts`
- Modify: `apps/desktop/src/main/super-grok-http.ts`
- Modify: `apps/desktop/src/main/dictation-service.ts`
- Delete: `packages/engine-grok/src/fake-engine.ts`
- Delete: `packages/engine-grok/src/fake-engine.test.ts`

- [ ] **Step 1: Write failing production-boundary tests**

  Assert packaged engine creation requires an explicit absolute managed binary, ignores PATH/common locations/`GROK_BUILD_PATH`, and returns truthful `managed_runtime_unavailable` without simulated content. Assert test engine is injectable only from `@grokdesk/engine-testkit`.

- [ ] **Step 2: Move global discovery to diagnostics only**

  Rename behavior to `findGlobalGrokBinary` and never use it for production engine/auth/dictation selection. Development override is accepted only when unpackaged and explicit. Preserve the existing Grok auth home, but never copy/update global binary, edit PATH, touch `~/.grok/bin`, or run `grok update`.

- [ ] **Step 3: Build engine from explicit binary**

  `GrokBuildEngine` receives an absolute verified path. Gateway environment prepends only its directory. After runtime install, rebuild engine immediately. If unavailable, expose a non-running unavailable state; no fake success/events/artifacts.

- [ ] **Step 4: Move all tests to testkit/CLI fixture**

  Replace every `FakeEngine` import found by `rg -l '\bFakeEngine\b'` with direct testkit injection. Process/E2E uses `test-grok-cli.mjs`, not a production setting. Remove `forceFakeEngine` from shared settings and migrate stored values to false/absence.

- [ ] **Step 5: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/engine-testkit test
  pnpm --filter @grokdesk/engine-grok test
  pnpm --filter @grokdesk/gateway test -- src/services/engine-rebuild.test.ts src/p0/engine-composition-boundary.test.ts
  rg -n 'FakeEngine|forceFakeEngine' packages apps --glob '!**/dist/**'
  ```

  Expected: tests pass and ripgrep finds no production symbol.

  ```bash
  git add packages/engine-testkit packages/engine-grok packages/gateway apps/desktop/src/main/gateway-process.ts apps/desktop/src/main/super-grok-http.ts apps/desktop/src/main/dictation-service.ts packages/shared/src/settings-schema.ts
  git rm packages/engine-grok/src/fake-engine.ts packages/engine-grok/src/fake-engine.test.ts
  git commit -m "refactor: require managed Grok runtime"
  ```

### Task 7: Journal one synchronized Desk/Grok update transaction

**Files:**
- Create: `apps/desktop/src/main/updates/update-journal.ts`
- Create: `apps/desktop/src/main/updates/update-journal.test.ts`
- Create: `apps/desktop/src/main/updates/update-coordinator.ts`
- Create: `apps/desktop/src/main/updates/update-coordinator.test.ts`
- Create: `apps/desktop/src/main/updates/update-health.ts`

- [ ] **Step 1: Write a failing recovery test for every state**

  ```text
  idle → checking → available → downloading → verifying → staged
  → waiting_for_idle → installing → restarting
  → post_update_verification → committed
  ```

  Inject restart at each transition and assert idempotent recovery, no double download/install, and no loss of active pair. Journal includes installed/target pair, previous runtime, manifest sequence/hash, staged paths/digests, customer action, attempts, and timestamps—no grants or entitlement secrets.

- [ ] **Step 2: Verify failure**

  Run: `pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/update-journal.test.ts src/main/updates/update-coordinator.test.ts`

- [ ] **Step 3: Implement exact pair staging**

  Resolve once; stage and verify Grok without switching; obtain an exact-version Desk feed/grant; stage Desk; re-resolve against the same manifest sequence; set `staged`. Grok-only is allowed only with installed Desk compatibility. Desk-only is allowed only when installed Grok remains compatible.

- [ ] **Step 4: Implement post-restart commit**

  Before gateway startup, select/probe target Grok, then verify actual Desk version, runtime version/digest/capabilities, gateway readiness, auth-status responsiveness, and main health. Commit only then. Runtime failure restores previous compatible runtime. Irrecoverable mismatch enters licensed read-only repair with signed prior-Desk rollback option.

- [ ] **Step 5: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/update-journal.test.ts src/main/updates/update-coordinator.test.ts
  git add apps/desktop/src/main/updates/update-journal.ts apps/desktop/src/main/updates/update-journal.test.ts apps/desktop/src/main/updates/update-coordinator.ts apps/desktop/src/main/updates/update-coordinator.test.ts apps/desktop/src/main/updates/update-health.ts
  git commit -m "feat: coordinate paired Desk and Grok updates"
  ```

### Task 8: Wrap electron-updater and block installation until idle

**Files:**
- Create: `apps/desktop/src/main/updates/desk-updater.ts`
- Create: `apps/desktop/src/main/updates/desk-updater.test.ts`
- Create: `apps/desktop/src/main/updates/update-scheduler.ts`
- Create: `apps/desktop/src/main/updates/update-scheduler.test.ts`
- Create: `packages/gateway/src/services/operation-readiness-guard.ts`
- Create: `packages/gateway/src/services/operation-readiness-guard.test.ts`
- Modify: `apps/desktop/package.json`

- [ ] **Step 1: Write failing exact-version and idle tests**

  Assert updater cannot choose generic latest, cannot install a version/digest outside resolved pair, uses protected short-lived feed/grant, and verifies SHA-256 plus updater SHA-512/Authenticode. Treat `running`, `waiting_approval`, and `waiting_user` as active. Test wait, explicit cancel, remote submission race, scheduler/proactivity pause, and install single-flight.

- [ ] **Step 2: Add the narrow updater wrapper**

  Add `electron-updater` directly. Configure an exact-version feed returned for the resolved Desk release; disable automatic install-on-quit until the coordinator authorizes it. Verify downloaded artifact against signed compatibility manifest before install. The wrapper exports only `downloadExact`, `installOnRestart`, `cancelDownload`, and safe progress events.

- [ ] **Step 3: Add shared admission blocking**

  Combine update readiness with the entitlement guard so all interactive/follow-up/retry/remote/scheduled/provider entry points use one `assertGrokAdmission`. After user approves restart, block new tasks, pause scheduler/proactivity, and wait for idle or execute explicit cancellation choice. Renderer cannot set readiness policy.

- [ ] **Step 4: Schedule checks**

  Check after entitlement/runtime bootstrap at startup, every six hours with ±10% jitter, manually, and immediately on active revocation. Honor ETag/cache; one check/download/install transaction at a time.

- [ ] **Step 5: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/desk-updater.test.ts src/main/updates/update-scheduler.test.ts
  pnpm --filter @grokdesk/gateway test -- src/services/operation-readiness-guard.test.ts
  git add apps/desktop/src/main/updates/desk-updater.ts apps/desktop/src/main/updates/desk-updater.test.ts apps/desktop/src/main/updates/update-scheduler.ts apps/desktop/src/main/updates/update-scheduler.test.ts apps/desktop/package.json packages/gateway/src/services/operation-readiness-guard.ts packages/gateway/src/services/operation-readiness-guard.test.ts pnpm-lock.yaml
  git commit -m "feat: install exact Desk updates when idle"
  ```

### Task 9: Enforce security deadlines and signed revocations

**Files:**
- Create: `apps/desktop/src/main/updates/security-deadline.ts`
- Create: `apps/desktop/src/main/updates/security-deadline.test.ts`
- Modify: `apps/desktop/src/main/updates/update-coordinator.ts`
- Modify: `packages/gateway/src/services/operation-readiness-guard.ts`

- [ ] **Step 1: Write failing trusted-time/deadline tests**

  Use maximum observed wall time, signed manifest issued time, entitlement API server time, and monotonic elapsed time. Test clock rollback, before-deadline warning/stage, after-deadline block, newly revoked active runtime, previous non-revoked compatible runtime, and no recovery candidate.

- [ ] **Step 2: Implement a durable trusted-time floor**

  Persist only time evidence/source. Never move the floor backward. Document that fully trusted offline time is impossible without OS/hardware support; this protects ordinary clock rollback.

- [ ] **Step 3: Apply security policy**

  Before deadline, warn/download/stage. After deadline, block new Grok operations while preserving local read/export/settings/diagnostics/license/runtime recovery. A revocation immediately excludes the artifact; switch to a verified compatible previous runtime or enter read-only repair. Policy reaches gateway through a main-only internal method that renderer IPC rejects.

- [ ] **Step 4: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/main/updates/security-deadline.test.ts src/main/updates/update-coordinator.test.ts
  pnpm --filter @grokdesk/gateway test -- src/services/operation-readiness-guard.test.ts
  git add apps/desktop/src/main/updates/security-deadline.ts apps/desktop/src/main/updates/security-deadline.test.ts apps/desktop/src/main/updates/update-coordinator.ts packages/gateway/src/services/operation-readiness-guard.ts
  git commit -m "feat: enforce signed security update policy"
  ```

### Task 10: Connect main/preload IPC and runtime/update UX

**Files:**
- Create: `apps/desktop/src/main/updates/update-ipc.ts`
- Create: `apps/desktop/src/main/runtime-update-bootstrap.ts`
- Create: `apps/desktop/src/renderer/components/views/settings/runtime-updates-tab.tsx`
- Create: `apps/desktop/src/renderer/components/views/settings/runtime-updates-tab.test.tsx`
- Create: `apps/desktop/src/renderer/components/runtime-install-step.tsx`
- Create: `apps/desktop/src/renderer/components/update-restart-dialog.tsx`
- Create: `apps/desktop/src/renderer/components/security-update-banner.tsx`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/main/ipc-bridge.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Modify: `apps/desktop/src/renderer/components/onboarding-wizard.tsx`
- Modify: `apps/desktop/src/renderer/components/views/settings-view.tsx`
- Modify: `apps/desktop/src/renderer/components/views/settings/license-tab.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/*.json`

- [ ] **Step 1: Write failing safe-status/action tests**

  Status shows Desk version/target, managed Grok version/target, compatibility, channel/update policy, last check, progress/staged pair, previous runtime, security deadline, and global Grok diagnostic path/version. Actions are Check, Update and restart, Repair, Retry, compatible runtime rollback, Copy diagnostics, Open logs, and stable/beta selection.

- [ ] **Step 2: Expose main-owned actions only**

  Renderer may request check/stage/install/repair/rollback/channel and subscribe to safe status. It cannot set artifact URL/hash/path, compatibility, manifest, signing result, runtime pointer, journal state, idle state, or security deadline.

- [ ] **Step 3: Implement durable readiness ordering**

  Bootstrap recovers journal, verifies entitlement, verifies/installs managed runtime, probes it, then starts gateway and proceeds to SuperGrok/workspace/permissions. Progress survives restarts. No state skips into global/fake Grok.

- [ ] **Step 4: Implement settings and restart dialog**

  Split License from Runtime & Updates. Repair only re-verifies/re-downloads runtime and preserves conversations/artifacts/settings/device identity/product key/SuperGrok auth. Update dialog offers wait for active work or explicit cancellation; never silently cancels.

- [ ] **Step 5: Verify and commit**

  ```bash
  pnpm --filter @grokdesk/desktop exec vitest run src/renderer/components/views/settings/runtime-updates-tab.test.tsx src/main/updates
  pnpm --filter @grokdesk/shared test -- src/ipc.test.ts
  git add apps/desktop/src/main apps/desktop/src/preload/index.ts apps/desktop/src/renderer packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts
  git commit -m "feat: connect runtime and live update UX"
  ```

### Task 11: Productionize signed release packaging and ingestion

**Files:**
- Create: `.github/workflows/release-desktop.yml`
- Create: `.github/workflows/qualify-desktop-release.yml`
- Create: `apps/desktop/scripts/notarize.cjs`
- Create: `scripts/release/collect-desktop-artifacts.mjs`
- Create: `scripts/release/verify-desktop-artifacts.mjs`
- Create: `scripts/qualification/macos.sh`
- Create: `scripts/qualification/windows.ps1`
- Create: `docs/runbooks/desktop-release.md`
- Create: `docs/runbooks/runtime-update-incident.md`
- Create: `docs/qualification/desktop-platform-matrix.md`
- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/src/packaging.smoke.test.ts`
- Delete: `.github/workflows/release-desktop.example.yml`

- [ ] **Step 1: Write failing packaging-contract tests**

  Assert targets are DMG+ZIP for macOS ARM64/x64 and NSIS for Windows x64; portable/Linux/Windows ARM64 are not published. Assert updater provider, publisher name, hardened runtime, notarize hook, exact artifact names, and inclusion of native vault/runtime resources.

- [ ] **Step 2: Implement the release matrix**

  Each target runs install, typecheck, unit tests, native ABI rebuild, build, package smoke, package, and artifact verification. Pin release-critical actions to commit SHAs and use protected environments.

- [ ] **Step 3: Enforce signing gates**

  macOS: Developer ID, hardened runtime, notarization, staple, `codesign --verify --deep --strict`, `spctl --assess`, `xcrun stapler validate` for DMG and updater ZIP/app. Windows: sign app and NSIS, configure publisher, require `Get-AuthenticodeSignature=Valid`, timestamp, and standard-user install.

- [ ] **Step 4: Produce release candidate metadata**

  Generate SHA-256, updater SHA-512, CycloneDX SBOM, provenance/attestation, exact-version feed inventory, signing identities, scan results, target/version/size. Workflow uploads candidate metadata to entitlement release import. It never receives manifest private key; KMS/two-person publication happens in the entitlement service.

- [ ] **Step 5: Verify and commit**

  ```bash
  pnpm typecheck
  pnpm test
  pnpm --filter @grokdesk/desktop build
  pnpm --filter @grokdesk/desktop exec vitest run src/packaging.smoke.test.ts
  git add .github/workflows/release-desktop.yml .github/workflows/qualify-desktop-release.yml apps/desktop/electron-builder.yml apps/desktop/scripts/notarize.cjs apps/desktop/src/packaging.smoke.test.ts scripts/release scripts/qualification docs/runbooks docs/qualification
  git rm .github/workflows/release-desktop.example.yml
  git commit -m "ci: publish qualified Desk and Grok releases"
  ```

### Task 12: Remove local update metadata and qualify platforms

**Files:**
- Delete: `packages/gateway/src/services/release-manifest.ts`
- Delete: `packages/gateway/src/services/release-manifest.test.ts`
- Delete: `docs/releases/latest.json`
- Delete: `apps/desktop/src/renderer/lib/update-check.ts`
- Delete: `apps/desktop/src/renderer/lib/update-check.test.ts`
- Modify: `packages/gateway/src/services/license-meta-dispatch.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/gateway/src/license.integration.test.ts`

- [ ] **Step 1: Write failing packaged-local-manifest rejection test**

  Place a validly shaped local file with a higher version beside a packaged build and assert it is ignored. Test semantic prerelease comparison and architecture selection through the new resolver.

- [ ] **Step 2: Remove disk/UI fallback**

  Delete disk manifest loader, local `updates.manifest` RPC, string-inequality helper, static update URL opener, and bundled local release file. Keep development signed fixtures only through explicit unpackaged main-process injection.

- [ ] **Step 3: Run automated full gate**

  ```bash
  pnpm --filter @grokdesk/shared test -- src/runtime-target.test.ts src/compatibility-manifest.test.ts src/compatibility-resolver.test.ts
  pnpm --filter @grokdesk/engine-grok test
  pnpm --filter @grokdesk/gateway test -- src/services/operation-readiness-guard.test.ts src/services/engine-rebuild.test.ts
  pnpm --filter @grokdesk/desktop test -- src/main/runtime src/main/updates
  pnpm -r typecheck
  pnpm -r test
  pnpm --filter @grokdesk/desktop build
  pnpm --filter @grokdesk/desktop e2e
  ```

- [ ] **Step 4: Execute real-machine qualification**

  macOS Apple silicon and Intel: clean no-global-Grok install, signed/notarized/stapled verification, activation/runtime, previous-stable paired update, interrupted download, kill at every journal boundary, probe rollback, Keychain persistence, repair preservation, uninstall choice.

  Windows x64 standard user: signed NSIS, Credential Manager, no-global-Grok runtime, proxy/redirect, antivirus quarantine/file lock, long path, non-ASCII username, interruption/restart/rollback, repair, uninstall choice.

  Windows ARM64 remains unpublished until native Desk/runtime and this entire matrix pass on real hardware.

- [ ] **Step 5: Commit removal**

  ```bash
  git add packages/gateway/src/services/license-meta-dispatch.ts packages/shared/src/ipc.ts packages/gateway/src/license.integration.test.ts
  git rm packages/gateway/src/services/release-manifest.ts packages/gateway/src/services/release-manifest.test.ts docs/releases/latest.json apps/desktop/src/renderer/lib/update-check.ts apps/desktop/src/renderer/lib/update-check.test.ts
  git commit -m "refactor: remove legacy update metadata paths"
  ```

## Lane acceptance

The runtime/update lane is complete when a clean qualified machine with no global Grok installs a signed/digest-verified managed runtime, the gateway uses its explicit path immediately, the signed resolver chooses one compatible Desk/Grok pair with real semantic precedence, interrupted transactions recover, active work prevents switching, runtime failure restores the prior verified version, security deadlines/revocations fail closed for new work, stable/beta behavior is explicit, and signed packages pass macOS ARM64/Intel plus Windows x64 real-machine qualification.
