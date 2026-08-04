# Grok Desk audit inventory (append-only)

Last extended: 2026-07-23T22:54:28Z  
Baseline commit at audit start: `3bae127`

Legend — Review status: `discovered` | `mapped` | `reviewed` | `tested` | `fixed-related`  
Risk: `critical` | `high` | `medium` | `low` | `info`

---

## Desktop shell / screens

| ID | Category | Name | Location | User | Purpose | Permissions | Ext deps | Data | Criticality | Risk | Review | Test | Verification | Findings | Evidence | Last reviewed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| SHELL-001 | screen | Main window / App shell | `apps/desktop/src/renderer/App.tsx` | all | Primary chrome, routing | none | gateway IPC | UI state | high | medium | discovered | partial | SOURCE_REVIEWED | — | list_dir + App imports | 2026-07-23 |
| SHELL-002 | screen | Home | `renderer/components/views/home-view.tsx` | all | New task / first value | workspace | gateway | task create | high | medium | discovered | e2e smoke | SOURCE_REVIEWED | — | packaging smoke DictationButton | 2026-07-23 |
| SHELL-003 | screen | Task workspace | `task-workspace-view.tsx` | all | Conversation + tools | task policy | engine | events | high | high | discovered | partial | SOURCE_REVIEWED | — | file present | 2026-07-23 |
| SHELL-004 | screen | Settings | `settings-view.tsx` + tabs | all | Preferences, account, license, remote, runtime | elev. for some | entitlement/update | settings DB | high | high | discovered | partial | SOURCE_REVIEWED | — | tabs dir | 2026-07-23 |
| SHELL-005 | screen | Artifacts | `artifacts-view.tsx` | all | Deliverable gallery | read workspace | — | artifact index | medium | medium | discovered | — | SOURCE_REVIEWED | — | frontend-10 exit | 2026-07-23 |
| SHELL-006 | screen | Memory | `memory-view` (chunk) | all | Profile/standing memory | memory R/W | embeddings | SQLite | medium | high | discovered | — | SOURCE_REVIEWED | — | build chunks | 2026-07-23 |
| SHELL-007 | screen | Scheduled | `scheduled-view` | all | Cron automations | schedule | scheduler | rules | medium | high | discovered | — | SOURCE_REVIEWED | — | gateway scheduler | 2026-07-23 |
| SHELL-008 | screen | Onboarding wizard | `onboarding-wizard` | first-run | Workspace/mode/account | folder trust | SuperGrok | prefs | high | high | discovered | e2e onboarding | SOURCE_REVIEWED | — | e2e specs | 2026-07-23 |
| SHELL-009 | tray | System tray | `main/tray.ts` | all | Show/hide, status | — | — | — | medium | low | discovered | tray.test | SOURCE_REVIEWED | — | tray.ts | 2026-07-23 |
| SHELL-010 | banner | Remote control banner | `remote-control-banner.tsx` | remote | Active remote session UX | remote pair | relay | session | high | critical | discovered | remote tests | SOURCE_REVIEWED | — | component | 2026-07-23 |
| SHELL-011 | banner | Desktop control HUD | `desktop-control-hud.tsx` | power | Desktop automation visibility | desktop grant | OS APIs | grants | high | critical | discovered | — | SOURCE_REVIEWED | — | component | 2026-07-23 |
| SHELL-012 | panel | Inbox | `inbox-panel.tsx` | all | Approvals/failures | — | proactivity | inbox | medium | medium | discovered | — | SOURCE_REVIEWED | — | component | 2026-07-23 |

## Settings tabs (partial)

| ID | Category | Name | Location | Criticality | Risk | Review | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| SET-001 | settings | Account | `settings/account-tab.tsx` | high | high | discovered | SOURCE_REVIEWED |
| SET-002 | settings | License / entitlement | `settings/license-tab.tsx` | high | critical | mapped | SOURCE_REVIEWED |
| SET-003 | settings | Remote | `settings/remote-tab.tsx` | high | critical | discovered | SOURCE_REVIEWED |
| SET-004 | settings | Runtime / updates | `settings/runtime-updates-tab.tsx` | high | critical | discovered | SOURCE_REVIEWED |
| SET-005 | settings | Preferences / MCP / skills | settings-view sections | medium | high | discovered | SOURCE_REVIEWED |

## IPC / preload

| ID | Category | Name | Location | Purpose | Risk | Review | Test | Verification | Findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| IPC-001 | preload | `window.grokdesk` bridge | `preload/index.ts` | Renderer API surface | high | mapped | sandbox-safety | AUTOMATED_TESTED | — |
| IPC-002 | ipc | `grokdesk:request` | `ipc-bridge.ts` | Gateway RPC | high | mapped | shared parseIpc | SOURCE_REVIEWED | — |
| IPC-003 | ipc | Privileged handle helper | `privileged-ipc.ts` | Sender gate wrapper | critical | reviewed | privileged-ipc.test | AUTOMATED_TESTED | — |
| IPC-004 | ipc | Sender validation | `ipc-sender.ts` | Origin/window ownership | critical | reviewed | electron-security.test | AUTOMATED_TESTED | — |
| IPC-005 | ipc | Entitlement handlers | `entitlements/ipc.ts` | Activate/status/deactivate | critical | fixed | ipc.test | AUTOMATED_TESTED | F-2026-07-23-002 |
| IPC-006 | ipc | Update handlers | `updates/update-ipc.ts` | Check/install/cancel | critical | fixed | update-ipc.test | AUTOMATED_TESTED | F-2026-07-23-002 |
| IPC-007 | ipc | Dictation | `dictation-service.ts` | STT | high | discovered | dictation tests | SOURCE_REVIEWED | — |
| IPC-008 | ipc | Browser host | browser-service IPC | In-app browser | critical | discovered | browser tests | SOURCE_REVIEWED | — |
| IPC-009 | ipc | Desktop control | desktop IPC | Screen/input | critical | discovered | desktop tests | SOURCE_REVIEWED | — |
| IPC-010 | ipc | Reveal path | `reveal.ts` | Finder reveal confined | high | mapped | reveal.test | AUTOMATED_TESTED | — |

## Entitlement / license / packaging

| ID | Category | Name | Location | Purpose | Risk | Review | Test | Verification | Findings |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ENT-001 | entitlement | Dev unlock runtime | Makefile `local`, index.ts | Dev bypass unpackaged | high | reviewed | gateway-process.test | AUTOMATED_TESTED | F-2026-07-23-001 |
| ENT-002 | entitlement | Compile-time bake | electron.vite.config.ts | Review install unlock | **critical** | **fixed** | packaging.smoke | AUTOMATED_TESTED | F-2026-07-23-001 |
| ENT-003 | entitlement | Manager synthetic active | entitlement-manager.ts | Dev unlock status | high | reviewed | manager.test | AUTOMATED_TESTED | F-2026-07-23-001 |
| ENT-004 | entitlement | Gateway fail-closed | gatewayEnv | Child admission | critical | reviewed | gateway-process.test | AUTOMATED_TESTED | F-2026-07-23-001 |
| ENT-005 | credential | Safe storage vault | safe-storage-vault.ts | AES file vault | critical | mapped | packaging smoke | AUTOMATED_TESTED | — |
| PKG-001 | packaging | Release workflow | release-desktop.yml | Signed publish | critical | fixed | packaging.smoke | SOURCE_REVIEWED | F-2026-07-23-001 |
| PKG-002 | packaging | electron-builder | electron-builder.yml | dmg/nsis | high | mapped | packaging.smoke | AUTOMATED_TESTED | — |
| UPDATE-001 | update | Manifest client | updates/manifest-client.ts | Signed manifests | critical | discovered | manifest tests | SOURCE_REVIEWED | — |

## Gateway / agent / policy

| ID | Category | Name | Location | Purpose | Risk | Review | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TASK-001 | task | Task runner | gateway services runner | Execute runs | critical | discovered | SOURCE_REVIEWED |
| RUN-001 | run | Run attempts | run-attempt services | Lifecycle | critical | discovered | SOURCE_REVIEWED |
| APPROVAL-001 | approval | ACP permission bridge | acp-permission-bridge | Tool approval | critical | discovered | SOURCE_REVIEWED |
| TOOL-001 | tool | Tool receipts | tool-operation-receipts | Audit trail | high | discovered | SOURCE_REVIEWED |
| FILE-001 | file | Workspace confine | workspace-path-confine.ts | Path jail | critical | mapped | AUTOMATED_TESTED |
| POLICY-001 | policy | Fail-closed shell/network | policy-provider-gate.ts | Strict mode | critical | discovered | SOURCE_REVIEWED |
| RUNTIME-001 | runtime | Managed Grok binary | main/runtime/* | Install/verify CLI | critical | discovered | SOURCE_REVIEWED |
| MCP-001 | mcp | Desk browser MCP | resources/browser-mcp-server.mjs | In-app browser tools | critical | discovered | SOURCE_REVIEWED |
| DESKTOP-001 | desktop | Desk desktop MCP | resources/desktop-mcp-server.mjs | OS control tools | critical | discovered | SOURCE_REVIEWED |
| SCHED-001 | schedule | Scheduler | services/scheduler.ts | Unattended tasks | high | discovered | SOURCE_REVIEWED |
| REMOTE-001 | remote | Remote services | gateway services/remote | Mobile control | critical | discovered | SOURCE_REVIEWED |
| RELAY-001 | relay | Remote relay | services/remote-relay | Signaling | critical | discovered | SOURCE_REVIEWED |
| MOBILE-001 | mobile | Companion app | apps/mobile | Pair + task | high | discovered | SOURCE_REVIEWED |
| DB-001 | database | SQLite gateway DB | packages/gateway/src/db.ts | Persistence | critical | discovered | SOURCE_REVIEWED |
| SKILL-001 | skill | Bundled skills | skills/* | Role skill packs | medium | discovered | SOURCE_REVIEWED |

## Security boundaries (index)

| ID | Category | Name | Notes | Risk | Review |
| --- | --- | --- | --- | --- | --- |
| SEC-001 | boundary | Renderer sandbox | sandbox+contextIsolation+no nodeIntegration | critical | mapped |
| SEC-002 | boundary | Preload channel leaf | ipc-channels sandbox-safe import | high | mapped |
| SEC-003 | boundary | External URL open | security-url.ts http(s) only | high | mapped |
| SEC-004 | boundary | Navigation lockdown | decideRendererNavigation | high | mapped |
| SEC-005 | boundary | file:// IPC origin | ipc-sender.ts same-dir | high | fixed | F-008 |
| SEC-006 | boundary | Dictation unmount | use-dictation cleanup | medium | fixed | F-010 |
| REMOTE-002 | remote | Pairing QR + mask | remote-tab.tsx | critical | fixed | F-009 |
| REMOTE-003 | remote | Mutation idempotency | MutationReceiptService | critical | mapped | SOURCE_REVIEWED |
| DICT-001 | dictation | STT IPC + entitlement | dictation-service.ts | high | fixed | F-002-class |
| CLAIM-004 | claim | OS keychain secrets | site + license-tab | high | fixed in-app | F-006 |
| CLAIM-007 | claim | Deletes always ask | site FAQ + policy | high | fixed onboarding | F-007 |
| ENT-002 | entitlement | Bake unlock | electron.vite + CI | critical | fixed | F-001 |
| DESKTOP-002 | desktop | Host destroy after run | runner.ts finally | critical | fixed | F-004 |

---

*Continue appending rows; do not delete historical entries — mark superseded in Findings.*

## Gateway IPC methods (from shared/ipc.ts literals) — bulk discovery 2026-07-23

| ID | Category | Name | Review | Risk | Notes |
| --- | --- | --- | --- | --- | --- |
| IPC-G-001 | ipc | tasks.create | discovered | critical | task admission + workspace |
| IPC-G-002 | ipc | tasks.list / get / cancel / setTitle / delete / approve | discovered | high | |
| IPC-G-003 | ipc | browser.* | discovered | critical | hostApproval, capability, allowExternal, openHtml |
| IPC-G-004 | ipc | tasks.pauseAll / resumeAll | discovered | high | also pauses desktop |
| IPC-G-005 | ipc | task.interject / compact / contextUsage / rewind* | discovered | medium | |
| IPC-G-006 | ipc | power.setState | discovered | high | sleep/wake |
| IPC-G-007 | ipc | desktop.task.* | discovered | critical | grant/resume |
| IPC-G-008 | ipc | events.list | discovered | medium | |
| IPC-G-009 | ipc | auth.* | discovered | critical | SuperGrok session |
| IPC-G-010 | ipc | chats.exportMarkdown | discovered | medium | |
| IPC-G-011 | ipc | schedule.* | discovered | high | unattended |
| IPC-G-012 | ipc | memory.* | discovered | high | privacy F-011 |
| IPC-G-013 | ipc | inbox.* | discovered | medium | |
| IPC-G-014 | ipc | settings.get / set | discovered | high | MCP secrets vaultized |
| IPC-G-015 | ipc | tray.status | discovered | low | |
| IPC-G-016 | ipc | artifacts.list | discovered | medium | |
| IPC-G-017 | ipc | rolePacks.list / models.list | discovered | low | |
| IPC-G-018 | ipc | workspace.* | discovered | critical | path confine |
| IPC-G-019 | ipc | connectors.* | discovered | high | |
| IPC-G-020 | ipc | remote.* | discovered | critical | pairing/telepresence |

## Mobile companion (discovery)

| ID | Category | Name | Location | Risk | Review | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| MOBILE-001 | mobile | App shell | apps/mobile/App.tsx | high | discovered | Pair + remote control UI |
| MOBILE-002 | mobile | Pair screen | screens/PairScreen.tsx | critical | discovered | QR scan; no raw code display |
| MOBILE-003 | mobile | Session store | storage/session.ts | critical | reviewed | SecureStore |
| MOBILE-004 | mobile | Offline queue | storage/offline-queue.ts | high | reviewed | limited methods; TTL 24h |
| MOBILE-005 | mobile | Remote client | api/remote-client.ts | critical | discovered | E2E sealed frames |

## Database tables (gateway SQLite)

| ID | Category | Name | Risk | Review |
| --- | --- | --- | --- | --- |
| DB-001 | database | meta | low | mapped |
| DB-002 | database | tasks | critical | mapped |
| DB-003 | database | task_events | high | mapped |
| DB-004 | database | artifacts | medium | mapped |
| DB-005 | database | schedule_rules / schedule_occurrences | high | mapped |
| DB-006 | database | memory_items | high | mapped |
| DB-007 | database | inbox_items | medium | mapped |
| DB-008 | database | audit_entries | high | mapped |
| DB-009 | database | settings | high | mapped |
| DB-010 | database | projects | medium | mapped |
| DB-011 | database | remote_devices / remote_pair_challenges | critical | mapped |
| DB-012 | database | mutation_receipts | high | mapped |
| DB-013 | database | task_run_attempts / task_run_attempt_usage | high | mapped |
| DB-014 | database | operation_receipts | high | mapped |
| DB-015 | database | conversations / turns | high | mapped |

