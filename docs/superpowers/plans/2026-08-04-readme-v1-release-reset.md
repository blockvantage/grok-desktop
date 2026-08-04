# README Refresh and v1.0.0 Release Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish an authentic, current Grok Desk README and a verified v1.0.0 release, then replace public `main` history with one root commit and remove obsolete remote refs/releases.

**Architecture:** A deterministic Electron capture harness owns sample-profile creation, synthetic demo state, and screenshot output. README/version changes are verified before packaging. Destructive GitHub operations occur only after all three platform artifacts are available and remote refs are re-audited.

**Tech Stack:** Electron, Playwright, TypeScript, pnpm, ImageMagick, electron-builder, Git, GitHub CLI/Actions.

---

## Task 0: Stabilize approvals and polish loading/onboarding

**Files:**

- Modify: `apps/desktop/src/renderer/styles/globals.css`
- Modify: approval/needs-you surfaces under `apps/desktop/src/renderer/components/`
- Modify: `apps/desktop/src/renderer/components/conversation-loading.tsx`
- Create: `apps/desktop/src/renderer/components/boot-screen.tsx`
- Create: `apps/desktop/src/renderer/lib/boot-progress.ts`
- Modify: `apps/desktop/src/renderer/components/onboarding-wizard.tsx`
- Modify: localized renderer catalogs and focused tests

- [x] Reproduce the blinking source and prove approval surfaces use an infinite amber animation.
- [x] Add failing tests for one-shot approval motion, transcript-shaped loading, determinate startup milestones, and free onboarding navigation.
- [x] Replace perpetual approval emphasis with a one-shot entrance and reduced-motion fallback.
- [x] Replace the logo/orbit loader with a calm layout-matched skeleton.
- [x] Bind startup progress to real boot stages and paint 100% before shell handoff.
- [x] Allow direct onboarding step selection and Left/Right keyboard navigation without weakening the final completion gate.
- [x] Run focused unit/type/build gates and visually inspect the real Electron states.

---

## Task 1: Add the isolated README capture harness

**Files:**

- Modify: `.gitignore`
- Create: `apps/desktop/e2e/readme-capture.spec.ts`
- Create: `apps/desktop/e2e/fixtures/readme-demo.ts`
- Create: `apps/desktop/scripts/capture-readme.mjs`
- Modify: `apps/desktop/package.json`
- Create: `apps/desktop/src/main/readme-demo-seed.ts` only if gateway/UI state cannot be established through existing public/test-only IPC
- Test: `apps/desktop/src/main/e2e-test-controls.test.ts`

- [x] Add `samples/readme-demo/` to `.gitignore` and create the directory with fresh `user-data`, `gateway-data`, `workspace`, `raw`, and `logs` children.
- [x] Write a failing fixture test that requires fixed locale/theme/window size, fake provider, isolated data paths, and rejects real profile environment variables.
- [x] Implement `createReadmeDemoProfile()` in `readme-demo.ts` to recreate only the explicit ignored demo directory and return absolute paths plus deterministic environment.
- [x] Write the Playwright capture spec to launch built Electron, fail on unexpected console errors, seed only synthetic content, wait for stable states, and capture six 1440×960 PNG frames.
- [x] If public UI actions cannot deterministically reach a state, extend the existing `GROKDESK_E2E=1` sender-gated controls; assert the handler is absent without the gate.
- [x] Add `capture:readme` to `apps/desktop/package.json` and a wrapper script that builds first, runs the spec, and prints captured paths.
- [x] Run `pnpm --filter @grokdesk/desktop test -- src/main/e2e-test-controls.test.ts` and the capture command. Expected: six non-empty raw PNG files and no real-profile paths in logs.
- [x] Commit the harness.

## Task 2: Curate current product images

**Files:**

- Create: `docs/media/readme-v1/home.png`
- Create: `docs/media/readme-v1/active-queue.png`
- Create: `docs/media/readme-v1/approval.png`
- Create: `docs/media/readme-v1/completed-work.png`
- Create: `docs/media/readme-v1/artifacts.png`
- Create: `docs/media/readme-v1/settings-trust.png`
- Create: `docs/media/readme-v1/hero.jpg`
- Modify: `docs/media/README.md`

- [x] Inspect all raw captures for stale copy, errors, missing assets, private paths, clipping, and inconsistent state.
- [x] Use ImageMagick to strip metadata and optimize PNGs without resizing below 1440×960.
- [x] Produce a 1600×900 authentic hero crop from the strongest current capture; do not synthesize or alter UI content.
- [x] Run `magick identify` and assert exact dimensions and sRGB color space.
- [x] Update the media inventory and remove only README media proven obsolete after the new README references are complete.
- [x] Commit curated media.

## Task 3: Rewrite README around the current product

**Files:**

- Modify: `README.md`
- Test: `apps/desktop/src/renderer/lib/release-qa-gate.test.ts`

- [x] Rewrite the hero, product promise, visual tour, delivery/trust guarantees, capabilities, three-step flow, downloads, requirements, builder section, and support footer.
- [x] Reference every new image with meaningful alt text and reasonable widths; do not use the old stylized product banner.
- [x] Keep claims specific and supported by shipped behavior. State that unsigned installers can trigger Gatekeeper/SmartScreen if the v1.0.0 release is unsigned.
- [x] Update direct download links to stable `releases/latest/download/` asset names.
- [x] Add or extend a structural README test that verifies every local image exists and every stable installer name matches `scripts/stage-free-release-assets.mjs`.
- [x] Run the structural test and a Markdown link/path scan.
- [x] Commit README changes.

## Task 4: Set all workspace packages and release examples to 1.0.0

**Files:**

- Modify: `package.json`
- Modify: every first-party package manifest returned by `rg --files -g package.json`
- Modify: `.github/workflows/release-free-github.yml`
- Modify: `.github/ISSUE_TEMPLATE/bug_report.yml`
- Modify: release-facing documentation where `0.1.9` is the current example
- Modify: `pnpm-lock.yaml` if pnpm records importer versions

- [x] Run a manifest test that enumerates all 13 first-party manifests and fails unless `.version === "1.0.0"`.
- [x] Update only first-party manifest versions; do not replace dependency versions that happen to equal `0.1.0`.
- [x] Replace current-release examples `v0.1.9` with `v1.0.0` while preserving historical migration fixtures and third-party/API protocol versions.
- [x] Run `pnpm install --lockfile-only` and verify the lockfile has no unrelated dependency churn.
- [x] Run the manifest test and `pnpm typecheck`.
- [x] Commit version changes.

## Task 5: Run the complete pre-release gate

**Files:**

- Modify only files required to fix verified failures.

- [x] Run `pnpm typecheck`.
- [x] Run `pnpm test`.
- [x] Run `pnpm --filter @grokdesk/desktop release-qa`.
- [x] Run `pnpm --filter @grokdesk/desktop build`.
- [x] Run `pnpm --filter @grokdesk/desktop bundle-budget`.
- [x] Run `pnpm --filter @grokdesk/desktop e2e:chat`.
- [x] Run screenshot-capture tests again after the final build.
- [x] For any failure, use `superpowers:systematic-debugging`, reproduce the smallest failing case, fix the root cause, rerun the focused gate, then rerun this complete gate.
- [x] Confirm `git diff --check`, credential canaries, and no tracked files under `samples/readme-demo/`.

## Task 6: Build and verify three release installers

**Files:**

- Use: `apps/desktop/electron-builder.yml`
- Use: `scripts/stage-free-release-assets.mjs`
- Output ignored: `apps/desktop/release/`
- Output ignored/local: `samples/readme-demo/release-assets/`

- [x] Detect signing variables without printing their values. Use signed paths when available, otherwise the approved unlocked paths.
- [x] Build macOS ARM64 DMG and x64 DMG with the correct native Electron ABI.
- [x] Verify each DMG architecture/package contents, no keytar, required skills/MCP resources, version 1.0.0, and successful mount/app discovery.
- [x] Attempt the existing Windows x64 unlocked NSIS build. If host tooling cannot produce a valid artifact, dispatch `.github/workflows/release-free-github.yml` for `v1.0.0` in dry-run mode after a temporary non-release branch push, fix workflow failures, and download the Windows artifact.
- [x] Verify the Windows installer through its workflow's PE, resource, silent-install, Defender, and signing checks.
- [x] Stage stable names with `stage-free-release-assets.mjs` and generate one `SHA256SUMS.txt` sorted by filename.
- [x] Confirm all four files are non-empty and hashes reproduce exactly.

## Task 7: Rewrite public history safely

**Files:** repository Git refs only.

- [ ] Record the verified tree SHA, current `origin/main` SHA, complete remote branch list, remote tag list, and release list.
- [ ] For every non-main remote branch, inspect `origin/main..branch`; merge required unique changes and rerun Tasks 5–6 before deletion. At design time no non-main remote branches exist.
- [ ] Create a recoverable local backup ref outside `refs/heads` and record its SHA locally; do not push it.
- [ ] Create a new orphan/root commit with the exact verified tree and message `Grok Desk 1.0.0`.
- [ ] Verify the new commit has zero parents and its tree SHA equals the verified tree SHA.
- [ ] Move local `main` to the root commit and rerun typecheck plus package smoke.
- [ ] Force-push with `git push --force-with-lease=main:<audited-sha> origin main`.
- [ ] Verify remote `main` matches the new root and delete each audited non-main remote branch with an explicit refspec.

## Task 8: Replace releases and publish v1.0.0

**Files:** GitHub release/tag state and local verified artifacts.

- [ ] Delete GitHub release `v0.1.9` and its remote tag; verify neither remains.
- [ ] Create annotated tag `v1.0.0` at the new root commit and push it.
- [ ] Create GitHub release `v1.0.0` named `Grok Desk v1.0.0` with concise release notes, installer/signing status, and system requirements.
- [ ] Upload `GrokDesk-mac-arm64.dmg`, `GrokDesk-mac-x64.dmg`, `GrokDesk-win-x64.exe`, and `SHA256SUMS.txt` without clobbering unverified assets.
- [ ] Verify release is latest, all assets return HTTP 200, sizes match local files, and SHA-256 hashes match.
- [ ] Verify GitHub shows one `main` root commit, no extra remote branches, only the intended v1.0.0 release/tag, and README images render.
- [ ] Report the final commit/tag/release URLs, artifact hashes/signing status, deleted refs, and exact verification results.
