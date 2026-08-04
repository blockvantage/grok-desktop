# Requires owner attention

Only genuine blockers / product decisions. Last updated: 2026-07-24.  
In-repo code for these items is already fail-closed or honest where possible; **owner action is outside this monorepo or requires secrets/devices.**

---

## O-001 — Production signing, notarization, and protected release secrets

| Field | Value |
| --- | --- |
| Decision required | Confirm release environment secrets are populated; never set `GROKDESK_BAKE_DEV_UNLOCK` |
| Why blocked | No CSC/Apple/Authenticode credentials in this audit session |
| User impact | Cannot ship verified signed builds from this environment |
| Security impact | Cannot complete PACKAGED_MANUALLY_VERIFIED for unlock bake / fuse read on notarized binary |
| Commercial impact | Blocks official distribution qualification |
| Options | (a) Owner runs release dry_run=false after gate (b) Provide staging signing |
| Recommended | Run release workflow dry_run with post-build unlock grep (in workflow); then `npx @electron/fuses read` on the signed binary |
| Consequence of delay | Risk of shipping from ad-hoc local packages |
| Owner action | Verify GitHub `release-desktop` environment; confirm unlock envs unset; run package job; archive fuse-read output |

---

## O-002 — Sibling commerce / entitlement / landing systems

| Field | Value |
| --- | --- |
| Decision required | Whether audit expands into `grok-landing` / entitlement API deployment |
| Why blocked | Sibling repos/services may be absent; production endpoints external |
| User impact | Claims/checkout accuracy may drift from desktop |
| Security impact | Lease issuer trust depends on external JWKS |
| Commercial impact | Purchase funnel truthfulness |
| Options | (a) Desktop-only claims inventory (done) (b) Full cross-repo with LANDING_ROOT |
| Recommended | Point LANDING_ROOT for live `contracts:check`; re-deploy site after O-005–007 |
| Owner action | Provide landing root path or accept dry-run contracts only |

---

## O-003 — Product-default AgentProvider / ACP cutover

| Field | Value |
| --- | --- |
| Decision required | When to flip product default from headless engine-grok to ACP/AgentProvider |
| Why blocked | Product/architecture residual; needs live CLI proof and mediation readiness |
| User impact | Tool policy fail-closed behavior differs by path |
| Security impact | Headless path cannot always enforce shell/network deny the same way ACP mediation can |
| Commercial impact | Safety marketing claims depend on path |
| Options | Keep headless + honest degraded chip (current); or cutover with gate |
| Recommended | Do not flip without live SuperGrok CLI proof; keep `preferProviderEngine` opt-in |
| Owner action | Schedule cutover decision; fund live SuperGrok CLI verification |

---

## O-004 — Intentional review unlock packages

| Field | Value |
| --- | --- |
| Decision required | Whether review/internal unlock packages remain a supported artifact class |
| Why blocked | Product/process — bake path still exists via `GROKDESK_BAKE_DEV_UNLOCK=1` |
| User impact | Confused if unlock build is redistributed |
| Security / commercial | Unlocked package must never be sold as production |
| Options | (a) Keep bake with process controls (b) Delete bake entirely |
| Recommended | Keep bake for internal QA only; watermark UI “dev unlock”; never publish |
| Owner action | Document distribution policy; ban unlocked artifacts from release channels |

---

## O-005 — Public site claims secrets live in OS keychain

| Field | Value |
| --- | --- |
| Decision required | Update grokdesk.app (and any portal FAQ) vault/storage copy |
| Why blocked | Sibling landing repo not in this workspace |
| User impact | Privacy-conscious buyers misled about secret storage |
| Security impact | Trust / disclosure accuracy (not an exploit) |
| Commercial impact | Local-first security claim is false as worded |
| Available options | (a) Change site to encrypted app-data vault (b) Revert product to Keychain (rejected — signature ACL prompts) |
| Recommended | (a) Match `safe-storage-vault.ts` |
| Consequence of delay | Continued false advertising risk |
| Owner action | Edit landing local-first / secrets copy; re-deploy site |

### Recommended site copy (paste-ready)

> **Where secrets live.** Product keys and device credentials are stored in an encrypted vault inside Grok Desk’s application data on your disk (not in the macOS Keychain or Windows Credential Manager by default). SuperGrok still processes the prompts and relevant context when you run a task—same as using Grok in a browser.

In-app license tab already corrected (F-006).

---

## O-006 — Public site claims deletes always need explicit yes

| Field | Value |
| --- | --- |
| Decision required | Soften FAQ / marketing: Autopilot can delete without prompt |
| Why blocked | Landing site outside this repo |
| User impact | Users may enable Autopilot believing deletes always ask |
| Security impact | Safety expectation mismatch |
| Recommended | Mode-aware FAQ wording |
| Owner action | Edit grokdesk.app FAQ + “sharp edges always wait” product claims |

### Recommended site copy (paste-ready)

> **Deletes and approvals.** In **Strict** and **Balanced**, destructive file operations wait for your approval. **Autopilot** can delete and overwrite inside your allowed workspace folders without asking—use it only when you trust the folder and the task.

In-app Autopilot disclosure already present (F-007).

---

## O-007 — Public site “memory stays home / not on someone’s server”

| Field | Value |
| --- | --- |
| Decision required | Clarify local storage vs SuperGrok processing |
| Why blocked | Landing site |
| Recommended | Local store + send-on-run honesty |
| Owner action | Edit grokdesk.app memory marketing |

### Recommended site copy (paste-ready)

> **Memory.** Grok Desk keeps memory records on your disk. When you run a task, relevant memory is included in the prompt sent to SuperGrok (like chat history)—it is not uploaded as a continuous cloud sync.

In-app securityDesc honesty already fixed (F-041).

---

## O-008 — Headless engine path confinement vs symlink / OS sandbox

| Field | Value |
| --- | --- |
| Decision required | When to require ACP/sandbox so agent shell tools cannot escape workspace via symlinks |
| Why blocked | Headless Grok executes own tools; Desk policy is fail-closed when shell denied; with shell allowed, CLI sandbox may be best-effort |
| User impact | Power-user Autopilot + shell could write outside if CLI sandbox weak |
| Recommended | Keep product-default sandbox honesty chip; accelerate ACP cutover (O-003) |
| Owner action | Decide default mediation path for paid release |

---

## O-009 — Electron fuses residual + Android cleartext

| Field | Value |
| --- | --- |
| Severity | P2 packaging / mobile |
| Progress | **F-046 partial:** afterPack flips cookie encryption, disables NODE_OPTIONS/`--inspect`, enables onlyLoadAppFromAsar; **RunAsNode left on** (gateway + desk MCP need Electron-as-Node) |
| Why still blocked | (1) Asar integrity fuse needs hash metadata not emitted by electron-builder 25 without newer integration. (2) RunAsNode cannot be disabled without migrating gateway/MCP to `utilityProcess` or a Node binary. (3) Android `usesCleartextTraffic: true` remains — private LAN IPs cannot be listed in networkSecurityConfig domain rules; needs TLS-on-LAN product decision or debug-only cleartext |
| Suggested action | Validate fuses on a local/signed pack with `npx @electron/fuses read`; plan utilityProcess for gateway; Android: prefer wss LAN or debug-gated cleartext |
| Related | F-038 iOS ATS; F-046 afterPack fuses |

---

## O-010 — SuperGrok live E2E residual (session closeout)

| Field | Value |
| --- | --- |
| Decision required | Fund live SuperGrok credit/session for REAL_PROVIDER_VERIFIED task suite |
| Why blocked | No production SuperGrok session/credits in audit environment |
| User impact | Cannot certify end-to-end agent quality, cancel, or SuperGrok admission under live provider |
| Recommended | Owner runs SuperGrok / browser-capability e2e with real account credentials in CI secret store (Desk product-key paid-readiness E2E is retired; free app) |
| Owner action | Provide non-production SuperGrok test account or accept SOURCE/AUTOMATED only for agent quality |

---

## O-011 — Live mobile + relay production residual

| Field | Value |
| --- | --- |
| Decision required | Qualify live pair / revoke / offline queue on real iOS/Android against production or staging relay |
| Why blocked | No physical device loop in this session |
| Recommended | Use internal TestFlight / internal track + staging relay; capture REAL_DEVICE_VERIFIED matrix |
| Owner action | Schedule device QA; keep remote “coming soon” on site until GTM (CLAIM-006/011) |
