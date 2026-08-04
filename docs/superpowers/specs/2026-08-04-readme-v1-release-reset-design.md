# README Refresh and v1.0.0 Release Reset Design

## Purpose

Prepare Grok Desk for a clean public v1.0.0 presentation and release. Replace the stale README imagery with authentic, deterministic captures from the current Electron product; rewrite the README around the product's real value and trust model; build the advertised macOS and Windows installers; and reset the public repository history and releases exactly as authorized.

## Decisions

- Capture the real Electron application with a fresh isolated sample profile and workspace under ignored `samples/readme-demo/`.
- Use the deterministic fake provider and test-only controls. Never use a real SuperGrok account, real user profile, credentials, or private workspace files.
- Show six current product states: Home, active conversation with queued follow-up, approval/needs-attention, completed work, Artifacts, and Settings/trust controls.
- Track only curated, optimized README images. Keep the sample profile and generated intermediates ignored and local.
- Rewrite the README for clarity and credibility. Do not invent metrics, testimonials, availability, or security claims.
- Set every workspace package version to `1.0.0`.
- Build macOS ARM64, macOS x64, and Windows x64. Prefer configured signing; if credentials are unavailable, publish the existing explicitly unlocked/unsigned build variants and disclose that status in the release notes.
- Audit remote branches immediately before the rewrite. At design time, `origin` has only `main`, so there is nothing else to merge or delete.
- Replace `main` with one root commit containing the verified complete tree, then push with `--force-with-lease`.
- Delete the existing GitHub `v0.1.9` release and tag. Do not publish the local-only `entitlements-contract-v1` tag.
- Create a new `v1.0.0` tag and GitHub release with three stable installer assets plus a SHA-256 checksum file.
- Preserve the credential-vault decision in `docs/decisions/2026-07-24-no-keychain.md`: no OS Keychain, Windows Credential Manager, `keytar`, Electron `safeStorage`, or bootstrap memory vault.

## v1 Experience Addendum: Calm, Truthful Motion

- Approval and needs-you surfaces enter once with a short opacity/translate transition, then remain visually stable. No perpetual amber blinking, glow pulsing, or remount-driven emphasis.
- Conversation history loading uses a transcript-shaped skeleton and one restrained transform-only scan line instead of simultaneous logo, glow, and orbit loops.
- App startup exposes determinate progress tied to real boot milestones: start, workspace load, session restore, and ready. The bar reaches 100% before the shell handoff; it is not a decorative placeholder.
- Onboarding keeps every choice editable until launch. People may click any valid scene or use Left/Right arrows, while Enter continues and the final launch gate still enforces required safety defaults.
- All new motion is limited to opacity and transforms where practical, and becomes static under `prefers-reduced-motion`.

## README Information Architecture

1. Centered brand mark, product name, outcome-led positioning, and download links.
2. Authentic full-width product hero.
3. Short explanation of the problem Grok Desk solves.
4. Visual product tour using current UI states.
5. Delivery/trust section covering durable local queueing, exactly-once mutations, per-conversation serialization, approvals, and local workspaces without overstating guarantees.
6. Capability overview: parallel work, browser, artifacts, memory, schedules, connectors, and recovery.
7. Three-step workflow from goal to files.
8. Download matrix and honest unsigned-installer caveat when applicable.
9. System requirements and builder quick start.
10. Architecture paths, verification commands, support, and trademark note.

## Screenshot System

The capture harness launches built Electron with:

- a new user-data directory;
- a new gateway data directory;
- a new sample workspace;
- `GROKDESK_E2E=1`;
- the fake provider;
- browser login disabled;
- a fixed viewport and deterministic locale/theme.

The capture flow seeds only synthetic content. It waits for stable UI states, fails on unexpected console errors, captures PNG source frames, and uses ImageMagick for deterministic cropping/optimization. Final files live under `docs/media/readme-v1/`. The hero is a real app capture, not generated or composited product UI.

## Versioning and Packaging

All first-party `package.json` files move to `1.0.0`; dependency versions remain unchanged. Lockfile importer metadata is regenerated with pnpm where required.

Build outputs:

- `GrokDesk-mac-arm64.dmg`
- `GrokDesk-mac-x64.dmg`
- `GrokDesk-win-x64.exe`
- `SHA256SUMS.txt`

Builds must pass native-module architecture checks and package smoke checks. A macOS host may cross-package Windows only if the existing toolchain succeeds; otherwise use the repository's GitHub Actions Windows job, diagnose workflow failures, and download the completed artifact before publishing the release.

## Verification

Before history rewrite:

- `pnpm install --lockfile-only` if version metadata changes the lockfile;
- `pnpm typecheck`;
- `pnpm test`;
- desktop release QA;
- desktop build and bundle budget;
- deterministic chat E2E;
- screenshot-capture assertions;
- macOS ARM64/x64 package builds and inspection;
- Windows x64 package build and inspection or successful Windows CI artifact;
- `git diff --check` and credential/keytar canaries.

After history rewrite:

- verify the new root commit has no parent and its tree matches the verified pre-rewrite tree;
- rerun a focused smoke/typecheck gate on the root commit;
- force-push with `--force-with-lease` against the audited remote SHA;
- verify the remote `main` SHA;
- delete `v0.1.9` release/tag;
- create `v1.0.0` tag/release and upload verified assets;
- verify asset names, sizes, hashes, release links, and README rendering.

## Failure Handling

- Product capture failure: inspect main/gateway logs and fix the real launch or fixture root cause; do not substitute mock screenshots.
- Build failure: isolate whether it is code, native ABI, signing, cross-platform tooling, or external credentials. Fix code/tooling issues; use the approved unsigned path only for absent signing credentials.
- Windows cross-build failure caused by host limitations: run the repository Windows workflow and use its verified artifact.
- Remote branch divergence: stop destructive operations long enough to merge any unique required changes, rerun verification, then re-audit.
- Force-push lease mismatch: fetch, inspect the new remote commits, integrate anything required, regenerate the root commit, and retry with a fresh lease. Never use a blind force push.

## Destructive Boundary

The user explicitly authorized deleting all non-main remote branches after review, replacing `main` history with one commit, force-pushing it, deleting previous releases, and creating v1.0.0. The implementation must still resolve exact refs before deletion and report every deleted remote ref and release. At design time there are no non-main remote branches; the only release/tag targeted for deletion is `v0.1.9`.
