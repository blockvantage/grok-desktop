# Claims matrix (initial)

Sources to expand: grokdesk.app, onboarding, settings, license copy, README, installer, mobile.

| Claim ID | Claim (summary) | Source | Locale | User | License | SuperGrok | OS | Runtime | Permissions | Implementation | Ext dep | Available? | Test | Verification | Quality | Limitations | Copy accuracy | Fix | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLAIM-001 | Packaged app cannot use dev entitlement bypass | Makefile comment (pre-fix) | en | all | paid | n/a | all | packaged | n/a | bake path existed | — | **was false** | artifact | SOURCE+artifact | misleading | bake path | **was inaccurate** | fixed comments + bake decoupling | F-2026-07-23-001 |
| CLAIM-002 | SuperGrok-powered desktop coworker | README | en | all | ? | yes | mac/win | managed or CLI | workspace | engine-grok + gateway | xAI | partial | unit | SOURCE_REVIEWED | unknown e2e | managed runtime may be missing | TBD public site | inventory ongoing | — |
| CLAIM-003 | Personal entitlement seat limit 3 | entitlements/ipc SEAT_LIMIT | en | paid | personal | — | all | — | — | ENTITLEMENT_SEAT_LIMIT=3 | entitlement API | code | unit | SOURCE_REVIEWED | TBD vs site | must match portal | verify site | — | — |
| CLAIM-004 | Secrets in the OS keychain | grokdesk.app local-first blurb | en | all | paid | n/a | mac/win | n/a | n/a | **AES file vault** `safe-storage-vault.ts` | — | **false** | packaging smoke | SOURCE_REVIEWED+web | misleading | vault is local AES, not Keychain | **false on site + was false in license-tab** | fixed in-app copy; site needs owner | F-2026-07-23-006 |
| CLAIM-005 | 20-plus connectors GitHub Slack DBs | grokdesk.app capabilities | en | all | paid | SuperGrok | all | MCP | auth per connector | CONNECTOR_PRESETS (~18) | npx/uvx | partial | source | SOURCE_REVIEWED | gallery exists; one-click ≠ pre-auth | not all auth-ready OOTB | honest “gallery” wording better | O-002 landing | — |
| CLAIM-006 | Remote coming soon | grokdesk.app | en | mobile | paid | — | iOS/Android | relay | pair | apps/mobile + remote services | relay | code present | remote tests | SOURCE_REVIEWED | product may be pre-launch | site says soon; code advanced | owner GTM | O-002 |
| CLAIM-007 | Deletes always need explicit yes | FAQ / approval modes | en | all | paid | — | all | policy | modes | strict/balanced/autopilot | engine | mode-dependent | policy tests | SOURCE_REVIEWED | Autopilot may auto-allow more | “always” overstated for autopilot | soft FAQ fix on site | owner | — |
| CLAIM-008 | One personal license both platforms | pricing | en | paid | personal | SuperGrok | mac/win | — | — | seat limit 3 devices | entitlement | code | SOURCE_REVIEWED | seats ≠ platforms | 3 devices may span machines | verify portal copy | owner | — |
| CLAIM-009 | Memory stays home / not someone’s server | site | en | all | paid | SuperGrok | all | local store | — | local SQLite + SuperGrok preamble | xAI | storage local; **content leaves on run** | unit | SOURCE_REVIEWED+web | partial | see F-011 | fixed in-app; site O-007 | F-011 |
| CLAIM-010 | Secrets in OS keychain | site local-first | en | all | — | — | mac/win | AES vault | — | safe-storage-vault | — | **false** | packaging | SOURCE+web | false | AES file vault | fixed license-tab; site O-005 | F-006 |
| CLAIM-011 | Remote coming soon | site | en | mobile | paid | — | iOS/Android | relay | pair | apps/mobile full stack | relay | code advanced | remote tests | SOURCE_REVIEWED | GTM lag | site vs code | O-002 | — |
| CLAIM-012 | Tasks/memory/files stay on this machine | settings.securityDesc (pre-fix) | en+ | all | paid | SuperGrok | all | local | — | memory → SuperGrok preamble | xAI | **was partial** | packaging smoke | SOURCE_REVIEWED | overclaimed | memory sent on run | fixed in-app locales | F-041 |

---

*Site copy (CLAIM-004/6/7/9/10/11) requires grok-landing owner edits — see REQUIRES_OWNER_ATTENTION.*

| CLAIM-013 | Safety approvals / strict mode | site + settings | en | all | paid | SuperGrok | all | headless or ACP | modes | policy + degraded chip | engine | mode-dependent | unit | SOURCE_REVIEWED | headless path may not enforce shell deny same as ACP | see O-003/O-008 | do not claim absolute OS sandbox | owner GTM | O-003 |
| CLAIM-014 | Connectors “20+” one-click | site | en | all | paid | SuperGrok | all | npx/uvx | per-connector | CONNECTOR_PRESETS | network | gallery | source | SOURCE_REVIEWED | not all pre-authenticated | honest “gallery” | soft site wording | O-002 | — |
| CLAIM-015 | Updates signed / verified | release docs | en | all | paid | — | mac/win | managed | — | manifest verify + desk-updater | CDN | code | unit | AUTOMATED_TESTED (unsigned path) | signed pack not run here | O-001 | owner sign | O-001 |
