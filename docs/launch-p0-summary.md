# Launch P0 summary

Date: 2026-07-30
Scope: in-repo launch blockers (claim honesty, free-OSS license UI, runtime first-run gate, workflow)

## Done

- **Skeptic follow-up:** Rewrote `how.intro` in all 7 locales to be mode-aware (Strict/Balanced wait; Autopilot can act without asking). Broadened `claim-honesty.test.ts` with UNIVERSAL_ALWAYS_WAIT + per-locale how.intro checks.

- **Landing claim honesty (7 locales):** Removed false “secrets in OS keychain,” “sharp edges always wait,” and local-only memory overclaims from feature index, pillars, FAQ, privacy, and terms. Privacy now states encrypted app-data vault (not macOS Keychain / Windows Credential Manager). Terms/FAQ/feature copy are **mode-aware**: Strict/Balanced wait for deletes; Autopilot can delete without prompting. Memory copy discloses SuperGrok send-on-run.
- **Durable tests:** `grok-landing/tests/claim-honesty.test.ts` (3 tests) + existing `oss-consistency` (11) — **14 passed**.
- **Desktop free app (Phase 6):** product-license UI/gates removed entirely (no license tab, activation screen, readiness License row, or Desk entitlement fail-closed). SuperGrok sign-in/usage remain.
- **Installer copyright:** `electron-builder.yml` `Copyright © xAI` → `Copyright © 2026 Grok Desk`.
- **Runtime first-run gate:**
  - `shouldBlockCreate` returns `runtime_missing` when `runtimeReady === false`.
  - `App.createTask` hard-blocks Run, toasts `readiness.runtime.missing`, opens Settings → Advanced.
  - `RuntimeInstallStep` wired into **Home** (`data-testid="home-runtime-install"`) when runtime readiness is blocked, and into **onboarding ready scene** when `engineStatus === "missing"`.
  - Install CTA triggers `updateStatus.check()` and navigates to Runtime & updates.
- **Workflow:** `.grok/workflows/launch-p0-fix.rhai` (+ copy under `grok-desktop/.grok/workflows/`) — inventory → verify → summary phases.
- **Unit tests:** desktop `create-task-ui` + `readiness-ui` — **6 passed**.

## Remaining owner-only

- **O-001** Signing/notarization secrets for free GitHub channel (Gatekeeper/SmartScreen).
- **O-010** Live SuperGrok E2E on clean machines with real credentials.
- **Legal entity / jurisdiction / hosting** placeholders in `company.ts` — require real registered values (not invented).
- **Production redeploy** of grokdesk.app so live marketing matches in-repo dictionaries.
- **Free managed-runtime download backend** may still fail without entitlement/manifest URLs baked for free builds — UI now gates honestly; binary fetch is owner/infra.

## Residual risk

- Live site can still serve old false claims until redeploy.
- Managed Grok install button may not obtain a binary if free-channel update/entitlement path is misconfigured.
- Headless engine sandbox residual (O-008) and ACP cutover (O-003) unchanged.
- Product licensing retired; free Desk has no license tab or paid gates.
- Non-EN marketing was rewritten for honesty; full native linguistic polish of long legal paragraphs remains uneven (privacy/terms often shared EN blocks).
- No crash telemetry; first users still depend on support email ops.

## Verification evidence (this session)

| Check | Result |
|-------|--------|
| Landing claim rg | 0 hits (`claim-grep.txt`) |
| Desktop commercial/xAI rg on apps/desktop | 0 hits (`desktop-claim-grep.txt`) |
| Runtime wiring | RuntimeInstallStep in home-view + onboarding-wizard; createTask blocks `runtime_missing` |
| Landing tests | claim-honesty + oss-consistency: 14 passed |
| Desktop tests | create-task-ui + readiness-ui: 6 passed |

## Polish pass (post-P0)

- Platform-aware free downloads (`detectPreferredDownloadId` + reordered primary CTA + Recommended badge).
- Mac Gatekeeper + Windows SmartScreen install notes; system requirements line.
- FAQ: SuperGrok where-to-get, installer blocked, what else is needed; platforms mention macOS 12+ / Win 10/11 / no Linux.
- Connectors copy softened to preset gallery + tokens.
- Overnight narrative labeled illustrative scenario.
- Support form defaults to **install** (not billing).
- Desktop: Autopilot first-select confirm (onboarding dialog + settings confirm); createTask failure toast offers Open logs.
