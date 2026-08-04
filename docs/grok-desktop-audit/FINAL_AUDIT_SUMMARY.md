# Final audit summary

**Status:** In-repo adversarial cycle closed for fixable P0/P1/reproducible P2.  
**Not unqualified production-ready** — external/owner blockers remain (signing, site claims, SuperGrok E2E, live mobile, ACP cutover, packaging fuse residual).  
**Tip commit:** `df0246d` (`main`)  
**Verified at:** 2026-07-24T02:15:30Z · macOS arm64 · Node 20.13.1 · pnpm 9.6.0

---

## 1. Executive summary

Grok Desk is privileged local agent software (Electron + gateway + SuperGrok/Grok). This audit implemented **substantial security, integrity, and honesty hardening** across entitlements packaging, workspace confinement, IPC/trust, remote pairing, update install races, schedules, ACP framing, connectors, and user-facing claims in-app.

Public **landing-site** wording (keychain, deletes always need yes, memory never leaves machine) still **mismatches product reality** and is an owner action (O-005–007). Live SuperGrok E2E, signed/notarized package fuse read-back, and live mobile device paths were **not** exercised in this environment.

**Production-readiness:** **Not unqualified ship.** Materially safer for internal/beta builds that do not over-claim safety or site copy; block full public marketing until O-005–007 site fixes and O-001 signing qualification complete.

---

## 2. Verification environments

| Kind | Result | Level |
| --- | --- | --- |
| `pnpm typecheck` (12 workspace packages) | **pass** (2026-07-24) | AUTOMATED_TESTED |
| Targeted vitest (shared/gateway/provider-grok/desktop/mobile subsets) | **179 tests pass** | AUTOMATED_TESTED |
| Packaging smoke (desktop) | **30 pass** (source contracts for fuses, unlock bake, webSecurity) | AUTOMATED_TESTED |
| SuperGrok live task E2E | **not run** | BLOCKED (provider/session) |
| Signed/notarized package + `npx @electron/fuses read` | **not run** | BLOCKED (O-001 secrets) |
| Live mobile + relay | **not run** | BLOCKED (devices / infra) |
| Public site deploy | **not in repo** | BLOCKED (O-002 / O-005–7) |

Evidence paths (session scratch, not committed): typecheck + targeted-tests logs under implementer evidence dir.

---

## 3. Findings by severity (session inventory)

Approximate counts from `FINDINGS.md` (including fixed items):

| Severity | Approx. entries | Disposition |
| --- | --- | --- |
| **P0** | 1 | Fixed (entitlement unlock bake) |
| **P1** | ~15 | Fixed (path escape, IPC, desktop injection, updates busy race, etc.) |
| **P2** | ~45 | Fixed or partial (fuses F-046 partial → O-009) |
| **P3** | ~7 | Fixed (a11y region, JWT peek, folder order, …) |

Open/partial in-repo: **F-046** Electron fuses partial (RunAsNode on; asar integrity off) → **O-009**.

---

## 4. Major safety / security outcomes

| Area | Outcome | Verification |
| --- | --- | --- |
| Packaged entitlement unlock bake | Fail-closed; bake only with `GROKDESK_BAKE_DEV_UNLOCK=1`; CI refuse_unlock | AUTOMATED_TESTED |
| Privileged IPC sender + Zod bounds | Fail-closed assertSender; large wave of caps | AUTOMATED_TESTED |
| Workspace path / symlink / reveal / attachments | realpath confine; harvest primary-only; manifest bounds | AUTOMATED_TESTED |
| Desktop control (Win/Mac) | SendKeys/open_app injection fixed; grants lifecycle | AUTOMATED_TESTED |
| Browser URL policy | credentials blocked; private-host policy | AUTOMATED_TESTED |
| Remote pair/crypto/relay | QR relay scheme/creds; frame caps; error redaction; peer caps | AUTOMATED_TESTED |
| Update coordinator | Single-flight install; busy no longer corrupts journal to error | AUTOMATED_TESTED |
| Electron fuses | afterPack flips safe fuses; RunAsNode stays on | SOURCE_REVIEWED + packaging smoke (not signed read) |

---

## 5. Task integrity / data loss

| Area | Outcome |
| --- | --- |
| Chat export pagination | Advances by `seq`; stops if seq does not advance (F-064) |
| Attachment / artifact bounds | Manifest + title/path caps |
| Update journal race | Concurrent install cannot double-switch or force journal `error` via busy (F-066) |
| Crash recovery | Source-reviewed; full E2E across process kill **not** claimed |

---

## 6. Product improvements implemented (selected waves)

- Honesty: Autopilot delete disclosure; memory SuperGrok preamble; license vault copy (not Keychain).
- Capacity/DoS: maps, RPC, peers, localStorage hydrate, MCP host timeouts, ACP line/pending caps.
- Remote: pairing QR validation, mobile frame drop, relay peer caps.
- Schedules: quiet-hours TZ + strict clocks + DST tests.
- A11y: stream approval `role=region`; focus targets retained on turn cards.

---

## 7. Browser / desktop-control

- In-app browser: webSecurity pinned; origin approve map caps; private-host blocks.
- Desktop: host token timing-safe; body size limits; grants cleared; Win injection fixed.
- Residual: live multi-monitor / high-DPI desktop E2E not run this session.

---

## 8. Remote / mobile

- Protocol + crypto unit tests green; mobile frame/timeout tests green.
- Residual: **REAL_DEVICE_VERIFIED** pairing/revoke/lost-phone **blocked**.

---

## 9. Licensing / runtime / updates

- Lease JWKS parse bounds; peekJwtKid bounds; desk updater URL credentials blocked.
- Update install single-flight + journal integrity (F-066).
- Residual: signed package end-to-end, notarization, runtime download on real network **blocked** (O-001).

---

## 10. Accessibility / localization / performance

- Approval landmark a11y improved (F-068); keyboard-only full workflow not fully re-run this closeout.
- Locales: securityDesc honesty fixed earlier; native quality not re-audited.
- Performance: capacity caps reduce DoS; no new cold-launch benchmarks claimed.

---

## 11. Definition of Done — honest gate

| DoD gate | Status |
| --- | --- |
| Inventory + living audit files exist | **Met** (may grow) |
| Claims matrix for key public promises | **Met** (site fixes owner) |
| In-repo P0 / P1 / reproducible P2 fixed or blocked | **Met** (F-046 → O-009 partial) |
| Typecheck pass | **Met** |
| Targeted regression tests pass | **Met** (179 tests this closeout) |
| SuperGrok REAL_PROVIDER E2E | **Blocked** |
| PACKAGED_MANUALLY_VERIFIED signed fuses | **Blocked** O-001 |
| Live mobile REAL_DEVICE | **Blocked** |
| Public site claims accurate | **Blocked** O-005–007 |
| ACP default cutover | **Blocked** O-003 (honest degraded headless kept) |
| Headless shell confinement | **Blocked** O-008 |

---

## 12. Owner actions (exact)

See `REQUIRES_OWNER_ATTENTION.md` (O-001 … O-009). Highest commercial risk: **fix grokdesk.app claims O-005–007 before paid acquisition**.

---

## 13. Commits

~90+ audit-related commits on `main` in this goal-loop (security, bounds, honesty, docs). Latest closeout tip `df0246d`; docs update may follow this summary commit.

---

## 14. Residual risks (do not ship as “fully audited”)

1. Headless Grok tool path may not enforce Desk shell/network deny the same way ACP would (O-003/O-008).  
2. RunAsNode fuse remains on by design until utilityProcess migration (O-009).  
3. Android cleartext for LAN relay (O-009).  
4. Marketing site still can overclaim keychain / deletes / memory.  
5. No live SuperGrok credit burn verification in this session.

---

*End of final summary for this audit cycle. Do not treat as a blank check for production launch without owner gates.*
