# Test matrix

| Test ID | Domain | Feature | User | Preconditions | Profile | Workspace | Steps | Expected | Actual | OS | Arch | Build | Provider | Auto/Manual | Status | Verification | Evidence | Finding |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-SEC-001 | packaging | DEV_UNLOCK not baked from runtime env | release eng | source tree | N/A | repo | Read electron.vite.config bake expression | Bake only BAKE_DEV_UNLOCK | Pass | macOS | arm64 | source | N/A | auto | pass | AUTOMATED_TESTED | packaging.smoke.test.ts | F-2026-07-23-001 |
| TM-SEC-002 | packaging | Built main unlock false | release eng | out/main after clean build | N/A | repo | Regex isBakedDevUnlock const v | false | Pass after rebuild | macOS | arm64 | local out | N/A | auto | pass | AUTOMATED_TESTED | packaging.smoke + node inspect | F-2026-07-23-001 |
| TM-SEC-003 | packaging | Release workflow refuse unlock | release eng | workflow file | N/A | repo | Assert refuse_unlock + no `: 1` | present | Pass | macOS | arm64 | source | N/A | auto | pass | AUTOMATED_TESTED | packaging.smoke | F-2026-07-23-001 |
| TM-SEC-004 | entitlement | gatewayEnv packaged ignores runtime unlock | security | GROKDESK_PACKAGED=1 | N/A | N/A | gatewayEnv(false) with DEV_UNLOCK=1 | fail-closed 1 | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | gateway-process.test.ts | F-2026-07-23-001 |
| TM-SEC-005 | ipc | entitlement missing assertSender | security | register without gate | N/A | N/A | invoke status | throw | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | entitlements/ipc.test.ts | F-2026-07-23-002 |
| TM-SEC-006 | ipc | update missing assertSender | security | register without gate | N/A | N/A | installRestart | throw | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | update-ipc.test.ts | F-2026-07-23-002 |
| TM-SEC-007 | ipc | untrusted sender origin | security | evil webContents id | N/A | N/A | validatePrivilegedIpcSender | reject | Pass (existing) | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | electron-security.test.ts | — |
| TM-SEC-008 | ipc | empty URL non-main | security | spoof id+empty url | N/A | N/A | validatePrivilegedIpcSender | reject missing url | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | electron-security.test.ts | F-2026-07-23-003 |
| TM-DESK-001 | desktop | destroy host grant keep browser | daily user | confirmed browser open + grant | N/A | temp ws | start task open browser done | browserDestroy 0; desktopDestroy 1 | Pass | macOS | arm64 | unit | fake engine | auto | pass | AUTOMATED_TESTED | runner.test.ts | F-2026-07-23-004 |

---

| TM-PATH-001 | workspace | symlink escape read | security | symlink in root | temp | unit | confineExistingWorkspacePath | deny | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | workspace-path-confine.test.ts | F-013 |
| TM-PATH-002 | reveal | symlink escape reveal | security | symlink in root | temp | unit | revealInFileManager | deny | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | reveal.test.ts | F-014 |
| TM-PATH-003 | paths | Windows case | security | C:/ vs c:/ | N/A | unit | isPathInsideRoot | allow | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | paths.test.ts | F-015 |
| TM-PATH-004 | attachments | filename .. | security | name=.. | N/A | unit | sanitizeAttachmentFileName | file | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | attachments.test.ts | F-016 |
| TM-PATH-005 | media | promote ../../name | security | relName path | N/A | unit | uniqueMediaName | basename | Pass | macOS | arm64 | unit | N/A | auto | pass | AUTOMATED_TESTED | session-media.test.ts | F-017 |


| Test ID | Domain | Feature | Status | Verification |
| --- | --- | --- | --- | --- |
| T-UPD-066 | updates | concurrent tryInstallWhenIdle vs busy stage | pass | AUTOMATED_TESTED |
| T-SCHED-067 | schedule | quiet hours invalid clock + DST NY + spring-gap cron | pass | AUTOMATED_TESTED |
| T-A11Y-068 | a11y | stream approval role=region | pass | AUTOMATED_TESTED |
