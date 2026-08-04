# Free Desk build — release readiness report

**Date:** 2026-07-31  
**Scope:** Final free-app release audit after Phase 6 (product licensing unhooked)  
**Goal:** Ship gate only — no new features; P0/P1 free-build blockers only  
**Recommendation:** **Ship**

---

## Executive summary

Grok Desk is free: product-key activation, Desk license readiness, and product-license fail-closed admission are removed from the live product path. SuperGrok (xAI) account sign-in remains for model access. All required automated gates pass. Residual `rg` hits for license/entitlement wording are classified **Keep** (OSS/legal, Apple entitlements, run-attempt leases, update crypto, SuperGrok billing, retired docs, free-app comments).

**P1 Fix applied this audit:** active packaging docs (`docs/packaging-macos.md`, `docs/packaging-windows.md`) still instructed baking `GROKDESK_LICENSE_PUBLIC_KEY` for product-license verification and (macOS) importing SHA-256 catalogs to an entitlement release service. Those sections are rewritten for free Desk; packaging.smoke now guards free packaging docs.

| Gate | Result |
|------|--------|
| Residual `rg` audit + classification | **PASS** (0 Fix-class live gates) |
| Free product path (desktop readiness/settings/i18n/packaging) | **PASS** (10 files, 118 tests) |
| Gateway free admission / dispatch / composition | **PASS** (5 files, 31 tests) |
| SuperGrok + simplified-flow units | **PASS** (9 files, 105 tests) |
| `pnpm --filter @grokdesk/desktop build` | **PASS** |
| `pnpm --filter @grokdesk/desktop release-qa` | **PASS** (5 files, 69 tests) |
| `GROKDESK_NODE_PATH="$(which node)" pnpm --filter @grokdesk/desktop visual-qa` | **PASS** (`ok: true`, zero console/asset/overflow failures) |
| Packaging / free distribution docs | **PASS** (after P1 packaging-doc fix; free channel + retired product keys documented) |
| AGENTS.md credential rules | **PASS** (unchanged; no keychain/keytar/`safeStorage` product-key path) |

---

## Pass/fail matrix

### Automated gates

| Gate | Pass/Fail | Notes / evidence |
|------|-----------|------------------|
| Residual reference audit | **PASS** | Full output captured; classification Keep vs Fix; packaging-doc Fix items fixed; live UI/gateway Fix = none remaining |
| Desktop free-path suites | **PASS** | packaging.smoke (32, includes free packaging-docs guard), readiness-*, account-signed-in, home-landing, i18n, ui-structure, main-i18n, create-task-ui |
| Gateway free admission | **PASS** | entitlement-admission (fail-closed always false; null guard admits), composition free Desk tests, first-submit warm, tasks-core-dispatch, mutation-single-flight — 31 tests |
| SuperGrok / account | **PASS** | account-signed-in (10); command palette billing is SuperGrok/xAI admin action, not Desk license |
| Simplified flow units | **PASS** | composer-intents, work-graph, artifacts, memory, motion, queue, create-task-optimistic — 105 tests |
| Desktop build | **PASS** | electron-vite main/preload/renderer; exit 0 |
| release-qa | **PASS** | release-qa-gate, motion, lazy-preview, view-transition, ui-structure — 69 tests |
| visual-qa | **PASS** | Playwright 1/1; `visual-qa.json` `ok: true`; `consoleErrors: []`, `failedAssets: []`, `overflow: []` |
| Packaging / release workflows | **PASS** | electron-builder Apple entitlements only; free release refuses baked unlock |
| Free distribution docs | **PASS** | packaging-macos/windows free channel + Product licensing (retired); license-release-keys/outage/legacy RETIRED; packaging.smoke guards docs |
| Credential / product-key vault | **PASS** | Production remains `createSafeStorageCredentialVault` where retained; packaging smoke forbids keytar/Keychain/`safeStorage` |

### Free-app product path (audit §1)

| Check | Pass/Fail | Evidence |
|-------|-----------|----------|
| Fresh profile: no product key/license required | **PASS** | Main skips product-license bootstrap; `GROKDESK_PRODUCT_KEY_ENFORCEMENT = false`; readiness has no license dimension |
| Stale license data: no activation/read-only prompts | **PASS** | Main: “Stale entitlement state files under userData are ignored”; license UI deleted; ui-structure asserts no activation gate |
| No Home/Settings/Palette/sidebar Desk license ask | **PASS** | license-tab/activation-screen/read-only-banner/use-entitlement absent; settings has no license tab; readiness Runtime · Sign-in · Workspace only |
| Task creation not blocked by missing Desk license | **PASS** | create-task-ui tests; free admission null-guard admits; no license code path in create-task helpers |
| Gateway free admission | **PASS** | `isEntitlementFailClosed` always false; composition never installs product-license deny-all |

### SuperGrok path (audit §2)

| Check | Pass/Fail | Evidence |
|-------|-----------|----------|
| SuperGrok sign-in visible/functional | **PASS** | readiness `sign_in` dimension; account-signed-in helpers; visual-qa home shows account footer when signed in |
| Usage/account display sensible | **PASS** | account-signed-in + i18n usage strings (spending/monthly limit → billing) |
| xAI billing not mislabeled as Desk licensing | **PASS** | palette `billing` / `usage` admin actions; en “Billing, upgrades… on grok.com — never through a Desk cloud account”; free menuSubtitle “no keys, no paywall” |
| Missing SuperGrok blocks only Grok-required actions | **PASS** | Shell boots without product license; readiness multi-blocker is runtime + sign_in + workspace; free admission for non-guarded paths |

### Simplified flow (audit §4)

| Flow | Pass/Fail | Evidence |
|------|-----------|----------|
| Home ask / continue / needs-you (no admin noise) | **PASS** | home-landing-policy + readiness + visual-qa `01-home-desktop.png` / min window |
| Intent chips Brief/Research/Image/Organize/Schedule/Summarize | **PASS** | composer-intents (18); visual-qa intent selected/cleared |
| Work graph Plan/Research/Edit/Review/Deliver | **PASS** | work-graph (12) + rail structure |
| Artifacts available / unavailable | **PASS** | artifact-availability + visual-qa artifacts surface |
| Memory approve / edit / dismiss | **PASS** | memory-suggestions (9) |
| Follow-up / interjection idempotency | **PASS** | use-workspace-queue + gateway mutation-single-flight + tasks-core-dispatch clientMutationId |
| Motion / reduced-motion | **PASS** | motion-system + release-qa |

### Packaging / release (audit §5)

| Check | Pass/Fail | Evidence |
|-------|-----------|----------|
| No stale product-key packaging requirements | **PASS** | release-free-github empties unlock envs; refuses baked entitlement unlock; packaging docs no longer require LICENSE_PUBLIC_KEY bake |
| OSS/legal license metadata retained | **PASS** | package licenses / notices not stripped for free build |
| Free distribution docs accurate | **PASS** | packaging-macos + packaging-windows document free channel + product licensing retired; license-release-keys RETIRED |
| No product-key secrets packaged/required | **PASS** | packaging.smoke free Desk + free packaging-docs assertions; main free-desk log; preload has no productKey IPC |

---

## Manual / structural flow notes

### Free app startup

- Main process logs `free Desk: product-license enforcement disabled`, sets `GROKDESK_ENTITLEMENT_FAIL_CLOSED=0`, and does not bootstrap product-license activation or lease refresh.
- Stale entitlement/license material under `userData` is ignored (no crash, no activation UI).
- Readiness stack is **Runtime · Sign-in · Workspace** only (`packages/shared` `ReadinessDimension`; no `license` row/CTA).

### SuperGrok vs Desk licensing

- Sign-in and usage are SuperGrok/xAI account surfaces.
- Command palette **billing** / **usage** sit in admin tier (`command-palette-policy`); they are not Desk product-key flows.
- Dictation “entitlementReadOnly” i18n means voice unavailable under current app/runtime state — **not** Desk license read-only.

### Residual product-key code in tree

- `apps/desktop/src/main/entitlements/*`, `@grokdesk/license`, `@grokdesk/entitlement-client` remain for crypto/redact/tests/update adapters.
- **Not** registered as a live free-build product gate (preload has no activation IPC; renderer has no license imports; gateway fail-closed always off).
- Classified **Keep** (infrastructure + safety), not Fix.

---

## Automated validation results

Run from repo root on 2026-07-31:

```bash
# Residual audit
rg -n "license|licence|entitlement|product key|productKey|read-only|readonly|billing|upgrade|paywall|lease|trial" \
  apps packages docs .github
# PASS classification — ~11.5k hits; Fix-class live gates: 0

pnpm --filter @grokdesk/desktop exec vitest run \
  src/packaging.smoke.test.ts \
  src/renderer/lib/readiness-ui.test.ts \
  src/renderer/lib/readiness-layout.test.ts \
  src/renderer/components/readiness-checklist.test.tsx \
  src/renderer/lib/account-signed-in.test.ts \
  src/renderer/lib/home-landing-policy.test.ts \
  src/renderer/i18n/i18n.test.ts \
  src/renderer/ui-structure.test.ts \
  src/main/main-i18n.test.ts \
  src/renderer/lib/create-task-ui.test.ts
# PASS — packaging.smoke includes free packaging-docs guard (32 tests in that file)

# Post P1 packaging-doc fix:
pnpm --filter @grokdesk/desktop exec vitest run \
  src/packaging.smoke.test.ts src/renderer/ui-structure.test.ts
# PASS — 2 files, 71 tests

pnpm --filter @grokdesk/gateway exec vitest run \
  src/services/entitlement-admission.test.ts \
  src/services/entitlement-composition.test.ts \
  src/services/first-submit-entitlement-warm.test.ts \
  src/services/tasks-core-dispatch.test.ts \
  src/services/mutation-single-flight.test.ts
# PASS — 5 files, 31 tests

pnpm --filter @grokdesk/desktop exec vitest run \
  src/renderer/lib/account-signed-in.test.ts \
  src/renderer/lib/composer-intents.test.ts \
  src/renderer/lib/work-graph.test.ts \
  src/renderer/lib/artifact-availability.test.ts \
  src/renderer/lib/memory-suggestions.test.ts \
  src/renderer/lib/motion-system.test.ts \
  src/renderer/lib/command-palette-policy.test.ts \
  src/renderer/hooks/use-workspace-queue.test.tsx \
  src/renderer/lib/create-task-optimistic.test.ts
# PASS — 9 files, 105 tests

pnpm --filter @grokdesk/desktop build
# PASS — exit 0

pnpm --filter @grokdesk/desktop release-qa
# PASS — 5 files, 69 tests

export GROKDESK_NODE_PATH="$(which node)"
pnpm --filter @grokdesk/desktop visual-qa
# PASS — 1 Playwright test; visual-qa.json ok:true
# consoleErrors:[], failedAssets:[], overflow:[]
```

Provider/shared packages were **not** re-run in this audit (not touched by free-build fixes). Prior simplified-experience readiness already covered provider ACP interject + shared IPC when those packages changed in Phase 4.

Visual-qa artifacts (local only; do not commit):

- `apps/desktop/test-results/visual-qa/visual-qa.json`
- Screenshots `01-home-desktop.png` … `09-intent-cleared.png`

Implementer scratch (ephemeral): residual-rg.txt, residual-rg-final.txt, residual-classification.md, packaging-audit.md, free-path-tests.log, gateway-free-suites.log, desktop-free-suites.log, supergrok-path-tests.log, simplified-flow-tests.log, build.log, release-qa.log, visual-qa.log.

---

## Residual license/entitlement reference classification

**Command:**  
`rg -n "license|licence|entitlement|product key|productKey|read-only|readonly|billing|upgrade|paywall|lease|trial" apps packages docs .github`

**Approximate volume:** ~11.5k lines (includes TypeScript `readonly`, historical docs, crypto packages).

| Class | What | Disposition |
|-------|------|-------------|
| **Keep** — OSS / legal | `package.json` license fields, LICENSE files, OSS notices | Keep |
| **Keep** — Apple entitlements | `electron-builder.yml` `entitlements` / `entitlementsInherit` plists | Keep |
| **Keep** — Run-attempt leases | Task/message submission leases, heartbeats, queue recovery | Keep |
| **Keep** — Update / crypto | Release-manifest keys, `@grokdesk/license` verify modules, secret redaction of `productKey` | Keep |
| **Keep** — Residual entitlement modules | main `entitlements/*` not bootstrapped as Desk gate; entitlement-client OpenAPI | Keep |
| **Keep** — SuperGrok billing | Palette usage/billing; i18n spending limits / grok.com account | Keep |
| **Keep** — Free-app comments / flags | “product-license enforcement disabled”, `GROKDESK_PRODUCT_KEY_ENFORCEMENT = false` | Keep |
| **Keep** — Retired docs | `docs/license-release-keys.md`, entitlement-outage, legacy-migration, superpowers historical plans | Keep |
| **Keep** — CI crypto / refuse-unlock | license package tests in CI; free release refuses `GROKDESK_BAKE_DEV_UNLOCK` | Keep |
| **Fix** — Live Desk product gate | Activation UI, readiness license row, fail-closed admit | **None remaining** (UI/gateway already free) |
| **Fix** — Active free packaging docs | packaging-macos/windows product-key bake + entitlement-service checklist | **Fixed this audit** |
| **Noise** | TS `readonly` keyword; historical audit FINDINGS commercial language | Not Fix |

### Fix-class scan result (post-fix)

**Fixed (P1) this audit:**

| Doc | Was | Now |
|-----|-----|-----|
| `docs/packaging-macos.md` | Required `GROKDESK_LICENSE_PUBLIC_KEY` so main can “verify licenses”; checklist imported SHA-256 to “entitlement release service”; only listed `release-desktop.yml` | Free channel `release-free-github.yml`; **Product licensing (retired)**; optional `GROKDESK_RELEASE_PUBLIC_KEYS` for update/runtime only |
| `docs/packaging-windows.md` | “Bake `GROKDESK_LICENSE_PUBLIC_KEY` at electron-vite build time for release” | Same free/retired stance; free checklist without product-key secrets |

**Guard:** `apps/desktop/src/packaging.smoke.test.ts` → `free packaging docs do not require product-license key bake` (reads real docs).

**Still clean (no Fix):**

- Deleted and still absent: `license-activation-screen`, `license-read-only-banner`, `settings/license-tab`, `use-entitlement`, renderer `entitlement.ts`.
- Preload: no `productKey` / product-license activation IPC.
- No active docs instructing users to paste/activate a Desk product key.
- Gateway: `isEntitlementFailClosed` always returns `false`.

---

## P0 / P1 blockers

### P0

**None.**

### P1 (found and fixed this audit)

| ID | Item | Status |
|----|------|--------|
| F-DOC-1 | `docs/packaging-macos.md` required product-license public key bake + entitlement release service checklist | **Fixed** |
| F-DOC-2 | `docs/packaging-windows.md` required `GROKDESK_LICENSE_PUBLIC_KEY` bake for release | **Fixed** |
| F-DOC-3 | packaging.smoke lacked assertion on free packaging docs | **Fixed** (new test) |

**Open P1:** none remaining after the packaging-doc fix.

Residual modules that still *contain* product-key APIs are not live gates; removing them is optional cleanup, not a release blocker.

---

## Non-blocking risks

1. **Entitlement/license packages remain in the monorepo** (`@grokdesk/license`, main entitlements sources). A future change could re-wire them as a Desk gate if someone ignores free-app flags — mitigated by packaging.smoke, admission tests, and ui-structure free-Desk assertions.
2. **visual-qa requires `GROKDESK_NODE_PATH`** for gateway/native ABI; CI must set it.
3. **Commerce-runtime-integration workflow** still exercises historical crypto vectors; it is not a free UI gate but can confuse operators if misread as “Desk still sells keys.”
4. **Dirty worktree** may include unrelated Phase 1–6 work; this audit only adds the readiness report (no unrelated reverts).
5. **Live work-graph visual soft-skip** when profile has no running task remains (units cover stages); same as simplified-experience report.
6. **Owner/infra** (signing secrets, clean-machine SuperGrok E2E, legal entity placeholders) remain outside this free-build code audit.

---

## Credential audit (AGENTS.md)

- **Unchanged:** Never use OS Keychain, Windows Credential Manager, keytar, or Electron `safeStorage` for product keys / device identity.
- Production path remains `createSafeStorageCredentialVault` (AES file under `userData` + local `.key`) where vault code is retained.
- Unit tests may use `createMemoryCredentialVault` only.
- Product licensing is retired; vault rule still applies to any residual secret material.

---

## Worktree hygiene

- **This audit deliverable:** `docs/free-build-release-readiness-2026-07-31.md`
- **P1 fixes applied (scoped):**
  - `docs/packaging-macos.md` — free channel + product licensing retired
  - `docs/packaging-windows.md` — free channel + product licensing retired
  - `apps/desktop/src/packaging.smoke.test.ts` — free packaging-docs guard
- Unrelated dirty worktree left intact; no destructive git operations
- Do not commit `apps/desktop/test-results/**` or session scratch logs

---

## Recommendation

### **Ship**

Rationale:

1. Free product path is intact end-to-end (startup, UI, task create, gateway admission).
2. SuperGrok remains correctly scoped as account/model auth, not Desk licensing.
3. Residual license/entitlement references are intentional Keep classes; Fix-class packaging-doc blockers **fixed and guarded**.
4. Required automated gates all **pass**, including build, release-qa, visual-qa, desktop free suites, gateway free admission, and packaging.smoke (32).
5. Packaging/free-release workflows refuse product-license unlock bake; free distribution docs document free channel + retired product keys.
6. AGENTS credential rules untouched.

**Hold only if** release owners require external items outside this audit (notarization secrets, clean-machine SuperGrok E2E matrix, legal copy finalization). Those are not free-build code blockers.

---

## Non-goals confirmed

- No new product features or Phase 7+ UX work
- No re-enablement of Desk product licensing
- No removal of Keep-class residuals (OSS, Apple entitlements, leases, update crypto, SuperGrok billing, retired docs)
- No credential vault architecture change
- Unrelated dirty worktree left alone
