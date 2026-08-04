# Simplified experience — release readiness report

**Date:** 2026-07-31  
**Scope:** Integration audit of Phases 1–5 from `docs/simplified-experience-qa-plan-2026-07-31.md`  
**Goal:** Release prep only — no Phase 6+ product work, no new product workflows  
**Recommendation:** **Ship**

---

## Executive summary

Phases 1–5 (truth/reliability, simplified surfaces, embedded workflows, work graph/sync, motion/perf/QA) are implemented in the worktree and pass the automated release gates:

| Gate | Result |
|------|--------|
| `pnpm --filter @grokdesk/desktop build` | **PASS** |
| `pnpm --filter @grokdesk/desktop release-qa` | **PASS** (68 tests) |
| `GROKDESK_NODE_PATH="$(which node)" pnpm --filter @grokdesk/desktop visual-qa` | **PASS** (`visual-qa.json` `ok: true`, zero console errors, zero asset 5xx, zero overflow) |
| Phase 1–5 desktop unit regressions (15 files) | **PASS** (144 tests) |
| Gateway + provider + shared interjection/IPC | **PASS** (15 + 11 + 24 tests) |

All **eight** named audit flows pass with concrete evidence (unit/structure tests, visual-qa screenshots/JSON, and source wiring). No open **P0** blockers found in this audit.

---

## Pass/fail matrix

### Automated gates

| Gate | Pass/Fail | Notes / evidence |
|------|-----------|------------------|
| Desktop build | **PASS** | electron-vite main/preload/renderer; exit 0 |
| release-qa | **PASS** | `release-qa-gate`, motion, lazy-preview, view-transition, ui-structure |
| visual-qa | **PASS** | Playwright 1/1; screenshots under `apps/desktop/test-results/visual-qa/`; contract fields empty for errors |
| Desktop Phase 1–5 suites | **PASS** | account-signed-in, artifacts, intents, memory, work-graph, motion, palette, home landing, schedule nav, queue, projector, readiness, scheduled-view |
| Gateway mutation / dispatch | **PASS** | includes `clientMutationId` on real IPC path + interject single-flight |
| Provider ACP interject | **PASS** | `clientMutationId` on interject params |
| Shared IPC | **PASS** | `task.interject` + create `goalSource` schemas |
| Credential / product-key path | **PASS** | Production remains `createSafeStorageCredentialVault`; no vault files in this phase diff |

### Eight audit flows

| # | Flow | Pass/Fail | Primary evidence |
|---|------|-----------|------------------|
| 1 | Healthy signed-in Home | **PASS** | `account-signed-in` + readiness tests; `01-home-desktop.png` Sign-in ✓ + Connected account; landing policy max 3 actions |
| 2 | Intent task flow | **PASS** | `composer-intents` (18) + slash parity; `08-intent-selected.png` / `09-intent-cleared.png` |
| 3 | Schedule flow | **PASS** | `open_schedule` intent + `seedScheduleFormGoal` (no auto-create); scheduled-view tests |
| 4 | Running task / work graph | **PASS** | `work-graph` (12) + rail; visual soft-skip for live graph when chat terminal (documented) |
| 5 | Artifact flow | **PASS** | availability helpers + `03-artifacts.png` Unavailable UI; `failedAssets: []` |
| 6 | Memory flow | **PASS** | suggestion create/approve/edit/dismiss; no silent approve |
| 7 | Follow-up / interjection sync | **PASS** | queue + IPC + gateway single-flight + provider ACP tests |
| 8 | Motion / reduced motion | **PASS** | `motion-system` + CSS `prefers-reduced-motion`; release-qa |

Detailed flow matrix (with file references): implementer scratch `flow-matrix.md` from this audit session.

---

## Manual / structural flow results

### 1. Healthy signed-in Home

- **Observed (visual-qa profile):** Account footer “Alex Eth · Connected · 17% used”; readiness Sign-in row is green. No false “Sign in” primary blocker.
- **Composer-first desk:** Greeting, primary composer, compact WORKFLOWS chips (3), Recent chats, optional discovery cards.
- **Min window (`960x640` path):** No horizontal overflow recorded; readiness CTA not clipped in `02-home-min-window.png`.
- **Free Desk (Phase 6):** Product-license readiness row and activation gates are **removed**. Readiness is Runtime · Sign-in · Workspace only. SuperGrok sign-in remains a separate blocker when required.

### 2. Intent task flow

- Catalog: Brief, Research, Image, Organize, Schedule, Summarize.
- Selecting Brief sets structured mode (chip + Marketing Agent pack) without stuffing a long prompt into the textarea (`08-intent-selected.png`).
- Clear restores mode (`09-intent-cleared.png`).
- Unit parity: chip expansion equals slash expansion for brief/research/image/organize; expanded goals omit leading slash tokens.
- Create path supports `goalSource` for audit (shared IPC + gateway tasks).

### 3. Schedule flow

- Schedule intent uses `sendAction: "open_schedule"`.
- `seedScheduleFormGoal` / scheduled view seed draft only; user still confirms cadence/name before create (tests assert seed behavior, not auto-create).

### 4. Running task / work graph

- Stages: Plan → Research → Edit → Review → Deliver from real event/tool evidence (`projectWorkGraph`).
- Product states distinguish **waiting_for_approval** / needs-you from **failed**.
- Retry/recovered states are first-class.
- Visual-qa noted no live running graph in the current chat (terminal tasks only) — soft skip with `ok: true`, covered by units + rail structure.

### 5. Artifact flow

- List marks missing files with **Unavailable** badge and non-broken preview panel (“File unavailable”) plus Open folder / Open task / Remove from list (`03-artifacts.png`).
- Existing artifacts remain listable without generic 500 media chrome.
- Gate: zero `grokdesk-asset://` 500s in this run.

### 6. Memory flow

- Usable takeaways → pending suggestion only.
- Approve maps to memory upsert; edit alone stays pending; dismiss removes from queue.
- Sensitive content flagged for review; no auto-commit of durable memory.

### 7. Follow-up / interjection sync

- Follow-ups keep `clientMutationId` through queue delivery.
- Mid-run interjection: renderer passes mutation id → `task.interject` IPC → gateway single-flight/receipts → provider ACP `x.ai/session/interjection` params include `clientMutationId`.
- Replay/dedupe covered by mutation-single-flight and provider tests.

### 8. Motion / reduced motion

- Central tokens/classes in `motion-system.ts` + `globals.css` (`--motion-duration-*`, surface classes for nav, palette, intent chips, work graph, artifact reveal, approval).
- `prefers-reduced-motion: reduce` zeros nonessential animation; pure helpers return duration 0 / no animate class.

---

## Automated gate results (commands)

Run from repo root on 2026-07-31:

```bash
pnpm --filter @grokdesk/desktop build
# PASS — exit 0

pnpm --filter @grokdesk/desktop release-qa
# PASS — 5 files, 68 tests

export GROKDESK_NODE_PATH="$(which node)"
pnpm --filter @grokdesk/desktop visual-qa
# PASS — 1 Playwright test; visual-qa.json ok:true
# consoleErrors:[], failedAssets:[], overflow:[]

pnpm --filter @grokdesk/desktop test -- \
  src/renderer/lib/account-signed-in.test.ts \
  src/renderer/lib/artifact-availability.test.ts \
  src/renderer/lib/composer-intents.test.ts \
  src/renderer/lib/memory-suggestions.test.ts \
  src/renderer/lib/work-graph.test.ts \
  src/renderer/lib/motion-system.test.ts \
  src/renderer/lib/command-palette-policy.test.ts \
  src/renderer/lib/home-landing-policy.test.ts \
  src/renderer/lib/imagine-schedule-nav.test.ts \
  src/renderer/hooks/use-workspace-queue.test.tsx \
  src/renderer/lib/conversation-projector.test.ts \
  src/renderer/lib/readiness-ui.test.ts \
  src/renderer/lib/readiness-layout.test.ts \
  src/renderer/components/readiness-checklist.test.tsx \
  src/renderer/components/views/scheduled-view.test.tsx
# PASS — 15 files, 144 tests

pnpm --filter @grokdesk/gateway test -- \
  src/services/mutation-single-flight.test.ts \
  src/services/tasks-core-dispatch.test.ts
# PASS — 15 tests

pnpm --filter @grokdesk/provider-grok test -- src/acp-session.test.ts
# PASS — 11 tests

pnpm --filter @grokdesk/shared test -- src/ipc.test.ts
# PASS — 24 tests
```

Visual-qa artifacts (local only, **do not commit** unless intentionally refreshing fixtures):

- `apps/desktop/test-results/visual-qa/visual-qa.json`
- `apps/desktop/test-results/visual-qa/01-home-desktop.png`
- `apps/desktop/test-results/visual-qa/02-home-min-window.png`
- `apps/desktop/test-results/visual-qa/03-artifacts.png`
- `apps/desktop/test-results/visual-qa/03-memory.png`
- `apps/desktop/test-results/visual-qa/03-settings.png`
- `apps/desktop/test-results/visual-qa/05-existing-chat.png`
- `apps/desktop/test-results/visual-qa/06-slash-menu.png`
- `apps/desktop/test-results/visual-qa/07-command-palette.png`
- `apps/desktop/test-results/visual-qa/08-intent-selected.png`
- `apps/desktop/test-results/visual-qa/09-intent-cleared.png`

---

## Remaining P0 / P1 blockers

### P0

**None** discovered in this integration audit for the Phase 1–5 simplified-experience scope.

### P1 (non-blocking for ship of this set)

| ID | Item | Severity | Notes |
|----|------|----------|-------|
| R-1 | Live work-graph / approval / retry screenshots soft-skipped when profile has no running task | P1 polish | Units cover states; consider seeding a running task fixture for visual-qa later |
| R-2 | License readiness still prominent on unactivated/temp profiles | P1 UX | Honest for enforcement builds; free path already special-cased in license-tab — keep consistent with free-channel policy |
| R-3 | Main renderer chunk still large (~2.6 MB) | P2 perf | Phase 5 lazy-preview work landed; further code-splitting is follow-on, not a ship blocker for UX truth |

---

## Known non-blocking risks

1. **visual-qa depends on `GROKDESK_NODE_PATH`** so the gateway child uses system Node (ABI match for native modules). Documented on the script/spec; CI must set it.
2. **Unrelated dirty worktree files** (see hygiene) may land in the same branch if commits are not split carefully.
3. **Inbox / chat history density** in the sidebar remains higher than a pure “one composer” ideal for power users with long history — Phase 2 grouping helps but does not hide all history.
4. **Owner-only launch items** from `docs/launch-p0-summary.md` (signing secrets, clean-machine SuperGrok E2E, legal entity placeholders) remain outside this phase audit.
5. **Generated screenshots** under `apps/desktop/test-results/` are machine-local and should stay uncommitted (gitignore).

---

## Worktree hygiene

### Git status (inspected)

- Branch: `main` (tracking `origin/main`)
- Large uncommitted Phase 1–5 surface + packaging-adjacent edits; **no files reverted** as part of this audit

### Changed-files by phase/area

**Phase 1 — Truth / reliability**

- `apps/desktop/src/main/asset-protocol.ts`
- `apps/desktop/src/renderer/lib/account-signed-in.ts` (+test)
- `apps/desktop/src/renderer/lib/artifact-availability.ts` (+test)
- `apps/desktop/src/renderer/lib/readiness-ui.ts` (+test)
- `apps/desktop/src/renderer/lib/readiness-layout.ts` (+test)
- `apps/desktop/src/renderer/components/readiness-checklist.tsx` (+test)
- `apps/desktop/src/renderer/components/views/artifacts-view.tsx`
- `apps/desktop/src/renderer/lib/preview-load-error.ts` (+test)
- `apps/desktop/e2e/visual-qa.spec.ts`
- `apps/desktop/package.json` (`visual-qa`, `release-qa` scripts)

**Phase 2 — Simplified surfaces**

- `home-view.tsx`, `app-sidebar.tsx`, `app-topbar.tsx`, `command-palette.tsx`
- `command-palette-policy.ts`, `home-landing-policy.ts`, `home-recent-tasks.ts`, `sidebar-chat-sections.ts`, `view-search-policy.ts`, `dual-search.ts` (+tests)

**Phase 3 — Embedded workflows**

- `composer-intents.ts`, `memory-suggestions.ts`, `memory-view.tsx`
- `imagine-schedule-nav.ts`, `scheduled-view.tsx` (+tests)
- `create-task-ui.ts`, `create-task-optimistic.ts` (+tests)
- i18n locales (`en` + de/es/fr/ja/pt/zh)

**Phase 4 — Work graph / sync**

- `work-graph.ts`, `work-graph-rail.tsx`, `conversation-projector.ts`, live-work/plan cards
- `use-workspace-queue.ts` (+test)
- `packages/shared/src/ipc.ts`, gateway dispatch/mutation/runner, `provider-grok` acp-session, agent-runtime/engine-grok types

**Phase 5 — Motion / perf / QA**

- `motion-system.ts`, `view-transition.ts`, `globals.css`, `lazy-preview-load.test.ts`, `release-qa-gate.test.ts`, `ui-structure.test.ts`, `api.ts`, `App.tsx` wiring

**Packaging / release infra (adjacent)**

- `.github/workflows/release-free-github.yml`, `electron-builder.yml`, `packaging.smoke.test.ts`, `docs/packaging-windows.md`, `license-tab.tsx`, `onboarding-wizard.tsx`

**Unrelated — do not revert / separate from this PR if possible**

- `videos/assets/audio/night-shift/` (media)
- `docs/launch-p0-summary.md` and `.grok/workflows/launch-p0-fix.rhai` (prior launch orchestration)
- `.grok/workflows/implement-phase2-surfaces.rhai`, `implement-phase5-motion.rhai` (harness)

**Generated — do not commit**

- `apps/desktop/test-results/**` (visual-qa screenshots + JSON)
- Session scratch gate logs (ephemeral)

### Suggested commit split (if/when committing)

1. Truth / reliability (Phase 1 + visual-qa harness scripts)
2. Simplified surfaces (Phase 2)
3. Embedded workflows (Phase 3 + i18n)
4. Work graph / sync (Phase 4 + packages)
5. Motion / perf / QA (Phase 5)
6. Packaging/license/CI only if intentionally included

---

## Credential audit

- Production bootstrap continues to call **`createSafeStorageCredentialVault`** (AES file under Electron `userData` + local `.key`).
- Packaging smoke and vault sources still forbid keytar / OS Keychain / Electron `safeStorage` for product keys.
- This audit **did not** modify vault bootstrap paths; no reintroduction risk in the phase diff.

---

## Recommendation

### **Ship**

Rationale:

1. All required automated gates **pass**, including live Electron visual-qa with a clean product contract (no console errors, no asset 500s, no overflow).
2. All eight audit flows have **independent pass evidence** (not prose-only).
3. No Phase 1–5 **P0** regressions remain for the original simplified-experience blockers (false sign-in, broken artifacts, min-window clip, intent surface, memory review, work graph, interjection idempotency, motion system).
4. Residual items are **P1/P2 polish or owner/infra**, not integration blockers for this release slice.

Hold only if product policy requires a licensed visual-qa fixture before tagging, or if packaging/signing owner items must gate the same release train (those are separate from Phase 1–5 UX work).

---

## Non-goals confirmed

- No Phase 6 product feature work started.
- No new product workflow intents beyond Phases 1–5 catalog.
- Unrelated dirty files left intact.
- No commit/PR forced by this audit (report only unless requested).
