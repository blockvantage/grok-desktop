# Grok Desk audit findings

Status values: `open` | `fixed` | `blocked` | `deferred` | `invalid` | `duplicated` | `superseded`

Verification levels: `SOURCE_REVIEWED` | `AUTOMATED_TESTED` | `DEV_MANUALLY_VERIFIED` | `PACKAGED_MANUALLY_VERIFIED` | `REAL_PROVIDER_VERIFIED` | `REAL_DEVICE_VERIFIED` | `INFERRED` | `BLOCKED`

---

## F-2026-07-23-001 — Packaged entitlement unlock can be baked from runtime DEV_UNLOCK

| Field | Value |
| --- | --- |
| Severity | **P0** |
| Confidence | High |
| Status | **fixed** |
| Affected user | Paid / licensed users; any recipient of a binary built while shell had `GROKDESK_DEV_UNLOCK=1` |
| Affected workflow | Product-key activation, lease admission, managed-runtime readiness, paid Grok work gating |
| Safety impact | Unlicensed Grok work and disabled fail-closed entitlement/runtime gates in a “packaged” binary |
| Privacy impact | Indirect (unauthorized agent work on user machine) |
| Productivity impact | Low for unlock user; commercial integrity failure |
| Commercial impact | **Critical** — product key / lease wall bypassable without purchase |
| Platform | All (bake is compile-time) |
| Environment | Any package build with polluted env; observed in local `apps/desktop/out/main/index.js` before fix |

### Preconditions

Developer or CI shell has `GROKDESK_DEV_UNLOCK=1` (e.g. after using `make local` patterns, or exported in profile) and runs a normal desktop package/build **without** intending a review unlock dist.

### Reproduction steps

1. On commit `3bae127` (pre-fix tree), open `apps/desktop/out/main/index.js`.
2. Search for `function isBakedDevUnlock`.
3. Observe inlined body: `const v = true; return v === true || …`.
4. That constant is `__GROKDESK_DEV_UNLOCK__` from `electron.vite.config.ts`, previously set when **either** `GROKDESK_DEV_UNLOCK=1` **or** `GROKDESK_BAKE_DEV_UNLOCK=1` at compile time.
5. At runtime in packaged Electron, `devUnlock = isBakedDevUnlock() || (!isPackaged && env…)` → **true** even when ambient env is unset.

### Expected behavior

- Runtime `GROKDESK_DEV_UNLOCK=1` unlocks **only** unpackaged dev (`make local`).
- Packaged production binaries never honor runtime unlock.
- Compile-time bake, if retained for internal review installers, requires an **explicit** separate flag and is impossible to trigger accidentally from the runtime unlock env.
- Release CI refuses unlock envs and fails if the main bundle inlines unlock true.

### Actual behavior (before fix)

- `electron.vite.config.ts` baked unlock when `GROKDESK_DEV_UNLOCK === "1"` **or** bake flag.
- Local `out/main/index.js` had unlock **true** while current shell env did **not** set unlock (stale accidental bake retained).
- Makefile claimed packaged builds could never enable the bypass — **false** for bake path.

### Evidence

- Pre-fix: `node` match on `out/main/index.js` → `isBakedDevUnlock` `const v = true` (two copies).
- Config: `bakeDevUnlock = process.env.GROKDESK_DEV_UNLOCK === "1" \|\| process.env.GROKDESK_BAKE_DEV_UNLOCK === "1"`.
- Runtime: `apps/desktop/src/main/index.ts` uses `isBakedDevUnlock() \|\| (!app.isPackaged && …)`.
- Post-fix rebuild: both copies `const v = false`.
- Automated: packaging smoke tests for config coupling, release workflow gates, built main false.

### Verification level

- Pre: `SOURCE_REVIEWED` + artifact inspection (`DEV_MANUALLY_VERIFIED` on local out/).
- Post: `AUTOMATED_TESTED` + rebuild artifact inspection.

### Root cause

Single env var served dual purposes (runtime unpackaged unlock vs compile-time package bake). Developer shells commonly set the runtime var; a subsequent package build silently produced unlock-baked main code.

### Similar occurrences searched

- `gateway-process.ts` same bake helper — fixed comments; bake source is vite define only.
- `engine-grok` discover honors `GROKDESK_DEV_UNLOCK` for binary discovery only (not lease).
- Release workflow previously lacked refuse/artifact checks — added.

### Options considered

1. Remove bake path entirely (review installs use unpackaged only).
2. Bake only with explicit `GROKDESK_BAKE_DEV_UNLOCK=1` + CI refuse + artifact grep (**selected**).
3. Keep dual env but document carefully (rejected — proven footgun).

### Selected solution

1. Bake only on `GROKDESK_BAKE_DEV_UNLOCK=1`.
2. Release workflow: `refuse_unlock`, explicit empty env on build, post-build grep for `const v = true` / require `false`.
3. Packaging smoke structural + artifact tests.
4. Correct Makefile / comments.

### Files changed

- `apps/desktop/electron.vite.config.ts`
- `apps/desktop/src/packaging.smoke.test.ts`
- `apps/desktop/src/main/index.ts`, `gateway-process.ts`
- `apps/desktop/src/main/entitlements/bootstrap.ts`, `entitlement-manager.ts`
- `.github/workflows/release-desktop.yml`
- `Makefile`

### Tests added or changed

- packaging smoke: bake-from-DEV_UNLOCK forbidden; release refuse_unlock; built main false.
- (Related P1 IPC tests below.)

### Manual verification

- Rebuilt desktop with unlock envs unset; confirmed `const v = false` in both isBakedDevUnlock functions.

### Packaged verification

- `BLOCKED` for signed notarized production package (no signing identity in this session).
- Structural + local out/ main bundle verified.

### Commit reference

- `4b52b4d` — fix(security): prevent accidental entitlement unlock bake in packages

### Remaining risks

- Intentional review builds with `GROKDESK_BAKE_DEV_UNLOCK=1` still produce unlocked packages — must never be published as production.
- Stale `out/` or `release/` trees on developer machines may retain old bake until rebuild (smoke test fails if out/ is true).

---

## F-2026-07-23-002 — Entitlement/update IPC optional assertSender (fail-open if omitted)

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Affected user | Security-conscious / all users if composition omits gate |
| Affected workflow | Activate/deactivate, update installRestart, entitlement status |
| Safety impact | Compromised non-main webContents could invoke privileged handlers if gate omitted |
| Privacy impact | Device deactivation / activation path abuse |
| Productivity impact | Low |
| Commercial impact | Medium (activate/deactivate without window ownership) |
| Platform | Electron desktop |
| Environment | Mis-wired main composition; production index.ts did pass gate |

### Preconditions

`registerEntitlementIpc` / `registerUpdateIpc` called without `assertSender`.

### Reproduction steps

1. Call `registerEntitlementIpc(ipcMain, handlers)` with no third arg.
2. Invoke status/activate handler.
3. Before fix: handler runs. After fix: throws `assertSender not configured`.

### Expected behavior

Fail-closed: no privileged IPC without explicit sender gate.

### Actual behavior

Optional `assertSender?.()` — silent fail-open.

### Evidence

- Source: `entitlements/ipc.ts`, `updates/update-ipc.ts` pre-fix.
- Production wiring in `index.ts` did pass gate (reduces exploitability) but composition was footgun-prone.
- Tests: fail-closed unit tests added.

### Verification level

`SOURCE_REVIEWED` + `AUTOMATED_TESTED`

### Root cause

Optional callback for test convenience without fail-closed default.

### Selected solution

Require function; throw if missing. Tests pass no-op assertSender.

### Files changed

- `apps/desktop/src/main/entitlements/ipc.ts` (+ test)
- `apps/desktop/src/main/updates/update-ipc.ts` (+ test)

### Remaining risks

- Handlers that still use optional patterns elsewhere (dictation has required-in-production comment — reviewed separately).

### Commit reference

- `4b52b4d` (same security commit as F-001; IPC fail-closed included)

---

## F-2026-07-23-003 — Privileged IPC accepted senders with empty URL when id matched

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Affected user | Security-conscious |
| Affected workflow | All privileged IPC |
| Safety impact | Defense-in-depth: non-main frames with empty URL could skip origin check if id allowed |
| Root cause | `if (url) { check }` fall-through to ok |
| Selected solution | Empty URL only allowed for exact main webContents reference |
| Files | `ipc-sender.ts`, `electron-security.test.ts` |
| Tests | missing-url fail-closed unit test |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-004 — Desktop host grant not destroyed when browser pane retained

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Affected user | Users who grant desktop control and also use agent browser |
| Affected workflow | Task complete/cancel after browser_open; idle period before next turn |
| Safety impact | Host `DesktopPolicyStore` could remain `granted: true` while engine idle if browser pane was kept, allowing desk-desktop MCP input until next reconfigure/destroy |
| Privacy impact | Unwanted screen/input control window |
| Productivity impact | Low |
| Commercial impact | Safety claim integrity |
| Platform | macOS/Windows desktop |
| Preconditions | Task uses confirmed browser open (keepBrowserSession) and had desktop grant |

### Reproduction

1. Run task with browser_open success (confirmed host open).
2. Finally block: `!keepBrowserSession && !confirmedDirectOpen` false → skipped **both** browserDestroy and desktopDestroy.
3. Host desktop grant remains configured after terminal status.

### Expected

Browser pane may remain for user review; **desktop control host grant must clear** when no active sibling runs. Chat-root grant preference may remain in gateway store for next run re-apply.

### Actual (before)

desktopDestroy bundled with browser destroy conditions.

### Selected solution

Split finally: browser keep rules unchanged; `desktopDestroy` whenever no active siblings.

### Files

- `packages/gateway/src/services/runner.ts`
- `packages/gateway/src/services/runner.test.ts`

### Tests

- `destroys desktop host grant after run even when browser pane is retained`

### Verification

AUTOMATED_TESTED (gateway vitest)

### Remaining risks

- Mid-tool exclusive control still relies on adapter finally; cancel of stuck input path needs adapter-level abort review.
- Grant preference re-applied on next start without re-prompt — product choice; document in STATE_MODEL.

---

## F-2026-07-23-005 — Monorepo root version lagged desktop package (0.1.5 vs 0.1.6)

| Field | Value |
| --- | --- |
| Severity | **P3** |
| Confidence | High |
| Status | **fixed** |
| Affected user | Release engineer / support |
| Root cause | Root `package.json` not bumped with desktop |
| Selected solution | Align root to `0.1.6` |
| Files | `package.json` |
| Verification | SOURCE_REVIEWED |

---

## F-2026-07-23-017 — Session media promote allowed path-segment filenames

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `uniqueMediaName("../../evil.png")` returned as-is; join under images/ escapes |
| Fix | sanitizeMediaFileName + dest path assert |
| Commit | `6b6d048` |
| Verification | AUTOMATED_TESTED |

---


## F-2026-07-23-032 — Relative trustedFolders / skillsPaths accepted

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Fix | Absolute path refine on settings schema |
| Commits | `591eddc`, `bd9c78e` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-031 — Managed workspace delete check was case-sensitive

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium–High |
| Status | **fixed** |
| Platform | Windows primarily |
| Evidence | `isManagedWorkspaceRoot` used `startsWith` after `path.resolve` |
| Fix | Nested check via shared `isPathInsideRoot` (drive-letter case aware) |
| Commit | `51b3f81` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-030 — Relative workspace roots bound to gateway cwd

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `tasks.create` / schedule used `path.resolve` without requiring absolute input |
| Fix | Reject non-absolute roots on task and schedule create |
| Commits | `d480a89`, `60979d5` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-029 — workspace.listFiles did not confine roots

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `listWorkspaceFilesImpl(root, max)` with no allowedRoots; read/preview already confined |
| Impact | Privileged IPC client could inventory arbitrary readable dirs |
| Fix | Pass `allowedWorkspaceRoots()`; `confineExistingWorkspacePath`; empty roots fail closed |
| Files | `workspace-list.ts`, `index.ts`, tests |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-028 — Mobile offline mutation queue had no depth cap

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `enqueueOffline` always appended; SecureStore size limits on device |
| Fix | `OFFLINE_QUEUE_MAX_ITEMS = 50` with oldest-first eviction |
| Commit | `3913de3` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-027 — Blind remote relay had unbounded WebSocket frames

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `WebSocketServer` without maxPayload; hello machineId/token unbounded |
| Fix | maxPayload 512 KiB; field length caps on hello/channel |
| Commit | `ce78156` |
| Verification | SOURCE_REVIEWED + store tests (blob size already covered) |

---

## F-2026-07-23-026 — Gateway CLI accepted unbounded JSON-lines

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `createGatewayLineHandler` parsed any line length from parent IPC |
| Fix | `GATEWAY_CLI_MAX_LINE_BYTES` (2 MiB) pre-parse reject |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-025 — AssetTokenStore unbounded growth

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | mint() only; clear only on full store reset |
| Fix | FIFO cap at 512 entries |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-024 — Loopback host token compare was not timing-safe

| Field | Value |
| --- | --- |
| Severity | **P3** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `auth !== token` string compare on browser/desktop host headers |
| Fix | `hostTokenMatches` via `crypto.timingSafeEqual` |
| Commit | `fa0f5c0` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-023 — remote.enable accepted non-websocket relay URLs

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `enable(relayUrl)` stored any trimmed string; WebSocket client later mishandles file/http schemes |
| Fix | `assertValidRelayUrl` — ws/wss only, no credentials, host required |
| Commit | `e302281` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-022 — Loopback host servers had unbounded request bodies

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | browser-host-server / desktop-host-server concatenated all `data` chunks with no max |
| Fix | Shared `readLimitedJsonBody` (1 MiB default); 413 on overflow |
| Files | `host-server-body.ts`, both host servers |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-021 — schedule.create accepted invalid cron (silent no-fire)

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `SchedulerService.create` stored any string; tick catch-continued on parse errors |
| Fix | Validate via `nextRunAt` at create time; throw clear error |
| Files | `scheduler.ts`, `scheduler.test.ts` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-020 — Windows desktop_open_app used cmd /c start

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | Medium–High |
| Status | **fixed** |
| Platform | Windows |
| Evidence | `openApp` passed path/name through `cmd /c start` (metacharacter interpretation) |
| Fix | PowerShell `Start-Process -LiteralPath` / `-FilePath` with single-quote escape |
| Commit | `72da561` |
| Verification | AUTOMATED_TESTED (escape helper); open path SOURCE_REVIEWED |

---

## F-2026-07-23-019 — Windows desktop_type injected SendKeys chords

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Platform | Windows |
| Affected user | Anyone granting desktop control (agent or telepresence) on Windows |
| Safety impact | Typed text with `+^%~(){}[]` became modifier/grouping chords — e.g. passwords with `+`, or `%{F4}` as Alt+F4 |
| Evidence | `WinDesktopAdapter.typeText` only doubled `'` for PowerShell; did not brace SendKeys specials (unlike `winSendKey` single-char path) |
| Root cause | Incomplete port of SendKeys escaping from single-key helper to bulk type path |
| Fix | `escapeSendKeysText` + PowerShell single-quote escape; refuse unknown multi-char keys; F-key range limited to F1–F12 |
| Files | `win-adapter.ts`, `win-sendkeys.test.ts` |
| Commit | `9405214` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-018 — Unbounded IPC free-form fields (goals, memory, paths)

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | CreateTaskInputSchema goal had min only; interject text unbounded; memory content unbounded; entity ids and remote control frames also unbounded |
| Fix | Zod max lengths on goals, memory, paths, taskIds, remote fields, request ids, schedule/inbox/connector ids, hostApproval free-form, remote ControlPlain metadata, desktop tool coords/paths |
| Commits | `e8441f8` … `09adec9` (+ desktop schema follow-up) |
| Verification | AUTOMATED_TESTED (ipc.test.ts, remote-protocol.test.ts, desktop-tool-schemas.test.ts) |

## F-2026-07-23-016 — Attachment filename `..` could escape attachments dir

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `sanitizeAttachmentFileName("..")` → `".."`; `path.join(dest, "..")` leaves dest |
| Fix | Reject pure-dot names; stage asserts candidate under destDir |
| Commit | `99df39d` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-015 — Windows path confinement was case-sensitive

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Platform | Windows |
| Evidence | `isPathInsideRoot` string compare; Windows FS is case-insensitive |
| Fix | Lowercase drive-letter paths for compare; POSIX unchanged |
| Commit | `85059a5` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-014 — Reveal-in-Finder followed workspace symlink escapes

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Related | F-013 |
| Fix | realpath re-check in `revealInFileManager` |
| Commit | `736fd0b` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-013 — Workspace file preview/read did not re-check after symlink realpath

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `prepareWorkspaceAssetMeta` / `readWorkspaceFilePreview` only lexical confine; symlink under root → outside file |
| Fix | `confineExistingWorkspacePath` realpaths file + roots, re-asserts |
| Tests | symlink escape unit tests |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-012 — Tracked apps/desktop/index.js with unlock bake true

| Field | Value |
| --- | --- |
| Severity | **P1** (repo hygiene / accidental use) |
| Confidence | High |
| Status | **fixed** |
| Evidence | Git-tracked ~1MB CJS dump; `isBakedDevUnlock` const v=true; **not** electron-builder `files` (uses out/) but package confusion risk |
| Fix | `git rm --cached`, gitignore, packaging smoke for stray root index.js |
| Commit | (this) |

---

## F-2026-07-23-011 — “Memory stays home” marketing vs SuperGrok prompt injection

| Field | Value |
| --- | --- |
| Severity | **P2** commercial/privacy honesty |
| Confidence | High |
| Status | **fixed** in-app (`b9044cf`); site still wrong (O-007) |
| Evidence | Site: “Memory that stays home…”; code injects memory into SuperGrok preamble |
| Fix | Memory view subtitle discloses send-to-SuperGrok; i18n test |
| Owner | O-007 for site |

---

## F-2026-07-23-010 — Dictation left mic/STT open on composer unmount

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `use-dictation.ts` effect cleanup only unsubscribed |
| Fix | Stop tracks + `dictation.stop` on unmount |
| Commit | `17dd23f` |
| Verification | AUTOMATED_TESTED (source guard) |

---

## F-2026-07-23-009 — Pairing deep-link (pairSecret) shown in cleartext textarea

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Affected user | Mobile remote pairers; shoulder-surf / screen-share |
| Evidence | `remote-tab.tsx` `value={qr}` on visible textarea |
| Fix | Mask by default; show/hide toggle; copy still works |
| Commit | `b4fccc4` |
| Verification | AUTOMATED_TESTED (source guard) |

---

## F-2026-07-23-008 — Privileged IPC trusted any file:// origin

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `isTrustedSenderUrl` returned true for all `file:` |
| Fix | When main window URL known, require same path or same directory |
| Files | `ipc-sender.ts`, `electron-security.test.ts` |
| Commit | `8a1c220` |
| Verification | AUTOMATED_TESTED |

---

## F-2026-07-23-007 — Autopilot allows deletes without approval; marketing said always ask

| Field | Value |
| --- | --- |
| Severity | **P1** (commercial honesty) / product safety education |
| Confidence | High |
| Status | **fixed** (in-app onboarding); site FAQ still wrong (owner) |
| Evidence | `policy.ts` `Autopilot allows delete`; site FAQ “Deletes … always wait for your explicit yes” |
| Fix | Onboarding `policyAutopilotDesc` all locales disclose unprompted deletes; policy + i18n tests |
| Files | `locales/*.json`, `policy.test.ts`, `i18n.test.ts` |
| Remaining | grokdesk.app FAQ / “sharp edges always wait” — **O-006** |

---

## F-2026-07-23-006 — Product claims secrets live in OS keychain; vault is AES file

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | High |
| Status | **fixed** (in-app); site still wrong (owner) |
| Affected user | Security-conscious / privacy / commercial buyers |
| Affected workflow | License settings trust; public marketing local-first claim |
| Safety impact | Low (not an exploit) |
| Privacy impact | **High trust damage** — users believe OS keychain isolation |
| Commercial impact | Misleading security marketing |
| Platform | All |
| Evidence | `safe-storage-vault.ts` header: no Keychain; packaging smoke; license-tab claimed Keychain; grokdesk.app “Secrets in the OS keychain” |
| Root cause | Vault deliberately moved off Keychain (signature ACL prompts); copy not updated |
| Selected solution | Honest in-app license tab copy + smoke test forbids Keychain claim in license-tab |
| Files | `license-tab.tsx`, `packaging.smoke.test.ts` |
| Remaining | Public site + any portal FAQ still claim keychain — **O-005** |

---

## F-2026-07-23-033 — Private browser host check missed CGNAT / IPv4-mapped

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `isPrivateHostname` lacked 100.64/10 and Node-normalized `::ffff:7f00:1` |
| Fix | Expand private detection for CGNAT + IPv4-mapped hex/dotted |
| Commit | `134bea2` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-034 — Quiet hours ignored configured timezone

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `isInQuietHours` used `now.getHours()` despite optional `timezone` field |
| Fix | `Intl.DateTimeFormat` minutes-of-day in IANA zone |
| Commit | `f050829` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-035 — Inbox retention did not cap unread growth

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `prune` only deleted old read rows; failed-task proactivity can re-notify daily |
| Fix | Hard cap 500 rows, drop oldest first |
| Commit | `c4eee13` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-036 — Uncapped SQL list endpoints (tasks/memory/events/etc.)

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | Multiple `SELECT * … ORDER BY` without LIMIT on IPC-facing lists |
| Fix | Default + hard max LIMIT on tasks, memory, artifacts, events, inbox, schedules, turns |
| Commits | `6db29b3` … `675eb0b` |
| Verification | AUTOMATED_TESTED (existing service tests) |

## F-2026-07-23-037 — Mutation receipts never expired

| Field | Value |
| --- | --- |
| Severity | **P3** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `mutation_receipts` insert-only; no retention |
| Fix | `prune(14)` on gateway start |
| Commit | `19c2089` |
| Verification | SOURCE_REVIEWED |

## F-2026-07-23-038 — Mobile iOS ATS allowed arbitrary loads

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `NSAllowsArbitraryLoads: true` alongside local networking |
| Fix | Remove arbitrary loads; keep `NSAllowsLocalNetworking` only |
| Commit | `1080461` |
| Note | Android `usesCleartextTraffic` remains for LAN ws:// (documented residual) |
| Verification | SOURCE_REVIEWED |

## F-2026-07-23-039 — Offline queue allowed multi-50k memory payloads

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `createOfflineQueueItem` accepted any params; SecureStore size limits |
| Fix | `OFFLINE_QUEUE_MAX_PARAMS_BYTES` 8 KiB at enqueue |
| Commit | `383a6d0` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-040 — Clients assumed unbounded events.list pages

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | After F-036 server LIMIT, mobile/desktop single-shot afterSeq:0 could truncate history |
| Fix | Page loops in mobile App, use-chat-events, takeaways path |
| Commits | `77ee48f`, `939912f`, `2ec8612` |
| Verification | SOURCE_REVIEWED |

## F-2026-07-23-041 — Settings securityDesc overclaimed memory locality

| Field | Value |
| --- | --- |
| Severity | **P1** commercial honesty |
| Confidence | High |
| Status | **fixed** |
| Evidence | `securityDesc` said memory stays on machine; `memory.subtitle` already disclosed SuperGrok prompt injection |
| Fix | All locales updated to match memory disclosure |
| Commit | (this) |
| Verification | AUTOMATED_TESTED (i18n catalog) |

## F-2026-07-23-042 — Gateway IPC requests had no timeout

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `GatewayProcess.request` pending Map never timed out |
| Fix | Default 300s timeout; clear pending and reject |
| Commit | `11da26f` |
| Verification | SOURCE_REVIEWED |

## F-2026-07-23-043 — MCP host tokens not redacted in diagnostic logs

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `redactSecrets` lacked GROKDESK_*_TOKEN patterns |
| Fix | Local pattern + unit test |
| Commit | `a3848f5` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-044 — Remote pair/relay protocol strings unbounded

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | High |
| Status | **fixed** |
| Evidence | `PairOfferPlainSchema` / `PairAcceptPlainSchema` / `RelayClientMsgSchema` used `z.string().min(1)` without max on ids, keys, tokens, blobs |
| Fix | Bound pair ids (128), keys/tokens (256), channels (256), relay blob (700k); unit tests |
| Commit | (this wave) |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-045 — Remote RPC errors returned raw to phone

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `RemoteApplicationService.handle` forwarded `e.message` unredacted; session logs echoed app errors |
| Fix | `redactSecretString` + 500-char cap on phone errors and remote session logs |
| Commit | (this wave) |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-046 — Electron security fuses not flipped at pack time

| Field | Value |
| --- | --- |
| Severity | **P2** packaging |
| Confidence | High |
| Status | **partial** |
| Evidence | No afterPack fuse flip; electron-builder 25.1.8 has no native `electronFuses` key |
| Fix | `scripts/after-pack-fuses.mjs` + `afterPack` wiring: cookie encryption on, NODE_OPTIONS/inspect off, onlyLoadAppFromAsar on; **RunAsNode stays true** (gateway/MCP Electron-as-Node) |
| Residual | Asar integrity fuse deferred (needs integrity metadata); RunAsNode must stay on until utilityProcess migration; Android cleartext (O-009) |
| Verification | AUTOMATED_TESTED (packaging smoke source); pack-time fuse read requires signed/local package (owner) |

## F-2026-07-23-047 — Mobile session JSON unvalidated on load

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `loadSession` did `JSON.parse` without field/length checks |
| Fix | `parseStoredSession` bounds + corrupt-row clear; save re-validates |
| Commit | `375e390` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-048 — Desktop grant map unbounded + not cleared on chat delete

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `DesktopGrantStore` Map grew without cap; chat delete left root grants |
| Fix | FIFO cap 512; `clearDesktopGrant` on chat delete |
| Commit | `8f8c503` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-049 — Asset protocol could follow post-mint symlink

| Field | Value |
| --- | --- |
| Severity | **P1** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `resolveAssetResponse` used `stat` on minted path without re-checking realpath |
| Fix | realpath at mint + serve; 404 when resolved path differs |
| Commit | `d88dbb3` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-050 — Retained attachment paths skipped realpath confine

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `stageTaskAttachments` lexical `isPathInsideRoot` on stagedPath without realpath |
| Fix | realpath retained + destDir before retain reuse |
| Commit | `4380587` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-051 — Host write_file lacked re-confine + size cap

| Field | Value |
| --- | --- |
| Severity | **P2** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | TestEngine path wrote `event.path` after policy check without re-assert roots; content unbounded |
| Fix | `assertPathInsideWorkspaceRoots` + `HOST_WRITE_FILE_MAX_CHARS` 2M |
| Commit | `91ce73b` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-052 — Deliverable harvest scanned secondary project roots

| Field | Value |
| --- | --- |
| Severity | **P2** product correctness / privacy |
| Confidence | High |
| Status | **fixed** |
| Evidence | `harvestWorkspaceDeliverables` listed files from all `workspaceRoots`; recent mtime in secondary projects became artifacts |
| Fix | Harvest primary root only (index 0) |
| Commit | `7fae1cf` |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-053 — ACP JSON-RPC lines and pending RPC map unbounded

| Field | Value |
| --- | --- |
| Severity | **P2** reliability / local DoS |
| Confidence | High |
| Status | **fixed** |
| Evidence | `decodeJsonRpcLine` / stdio buffer accepted arbitrary line size; `AcpJsonRpcClient.pending` grew without cap |
| Fix | `ACP_MAX_LINE_BYTES` 2 MiB; buffer overflow skip-to-newline; `ACP_MAX_PENDING_RPC` 64 |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-054 — Desktop/browser MCP hostExec fetch hung forever

| Field | Value |
| --- | --- |
| Severity | **P2** reliability |
| Confidence | High |
| Status | **fixed** |
| Evidence | `desktop-mcp-server.mjs` / `browser-mcp-server.mjs` `fetch` to loopback host had no timeout; desktop path also lacked try/catch |
| Fix | `AbortSignal.timeout(60_000)` + structured host errors on both MCP bridges |
| Verification | AUTOMATED_TESTED (packaging smoke source) |

## F-2026-07-23-055 — Attachment manifest merge unbounded / untyped

| Field | Value |
| --- | --- |
| Severity | **P2** reliability / prompt pollution |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | Prior `manifest.json` JSON.parse as any array with no size/entry cap |
| Fix | `MAX_MANIFEST_BYTES` 256 KiB; shape filter; `MAX_MANIFEST_ENTRIES` 64 (newest retained) |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-056 — peekJwtKid accepted unbounded compact JWS

| Field | Value |
| --- | --- |
| Severity | **P3** defense-in-depth |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | Header base64url + JSON.parse without token/header length bounds |
| Fix | `PEEK_JWT_MAX_CHARS` 16_384; header segment/JSON/kid length caps |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-057 — Gateway main stdout lines + stderr ring unbounded

| Field | Value |
| --- | --- |
| Severity | **P2** reliability |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | Main process `JSON.parse` every gateway stdout line without size check; `stderrBuf += text` grew for process lifetime |
| Fix | Drop lines >2 MiB; `appendStderrRing` 8 KiB |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-058 — Sidebar folder order localStorage unbounded

| Field | Value |
| --- | --- |
| Severity | **P3** |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `loadOrder`/`saveOrder` accepted any-length string arrays |
| Fix | `folder-order.ts` 64 entries / 512 char keys / 32 KiB raw |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-059 — Lease public JWKS parse unbounded

| Field | Value |
| --- | --- |
| Severity | **P2** defense-in-depth |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | Env/bake JWKS JSON.parse without size/key caps; kid/x unbounded |
| Fix | 64 KiB raw, 32 keys, kid≤128, x≤256 |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-060 — Media lightbox fetch hung / unbounded materialize

| Field | Value |
| --- | --- |
| Severity | **P3** reliability |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `blobFromSrc` used bare `fetch` + `blob()` with no timeout or size cap |
| Fix | 30s AbortSignal.timeout; 100 MiB content-length/blob cap |
| Verification | AUTOMATED_TESTED (packaging smoke) |

## F-2026-07-23-061 — Mobile relay frames unbounded before JSON.parse

| Field | Value |
| --- | --- |
| Severity | **P2** reliability / local DoS |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `onData`/`onceJson` parsed arbitrary WS text frames |
| Fix | `MAX_RELAY_FRAME_CHARS` 400k (above relay blob max + JSON wrapper) |
| Verification | AUTOMATED_TESTED (existing remote-client suite still green) |

## F-2026-07-23-062 — Pairing QR relay lacked scheme/credential validation

| Field | Value |
| --- | --- |
| Severity | **P2** security / privacy |
| Confidence | High |
| Status | **fixed** |
| Evidence | `decodePairingQr` accepted any string relay; phone `createWs(relay)` could open credential-bearing or non-ws URLs |
| Fix | `assertPairingRelayUrl` on encode+decode: ws/wss only, no userinfo, hostname required |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-063 — Artifact event title/path unbounded

| Field | Value |
| --- | --- |
| Severity | **P2** reliability |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | Engine `artifact_created` payload title/path written to SQLite without length caps |
| Fix | Title max 512 (slice); path max 4096 else null |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-064 — Chat export pagination ignored missing seq

| Field | Value |
| --- | --- |
| Severity | **P2** correctness |
| Confidence | High |
| Status | **fixed** |
| Evidence | `exportChatMarkdown` advanced `after` only when `e.seq` present; type omitted seq; missing seq re-fetched same window up to 50 pages |
| Fix | Type `ChatExportEventRow.seq`; stop when pageMaxSeq does not advance; multi-page test |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-065 — Settings load cast MCP rows without schema bounds

| Field | Value |
| --- | --- |
| Severity | **P2** reliability / defense-in-depth |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `getAll()` cast `mcpServers` from SQLite without `mcpServerRowSchema`; corrupt rows could hold huge command/args |
| Fix | `sanitizeStoredMcpServers` on load; skillsPaths length/count caps |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-066 — Update install race + busy fail corrupted journal

| Field | Value |
| --- | --- |
| Severity | **P1** update integrity |
| Confidence | High |
| Status | **fixed** |
| Evidence | `tryInstallWhenIdle` claimed single-flight via busy but did not acquire `busy`; concurrent scheduler + approve could double switch/install. Separately, `fail("busy")` defaulted phase to `error` and transitioned the durable journal mid-flight, aborting legitimate stage/install. |
| Fix | Public `tryInstallWhenIdle` acquires busy; nested paths use `tryInstallWhenIdleBody`; `busyResult()` returns busy without journal transition |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-067 — Quiet hours accepted invalid clocks; weak DST coverage

| Field | Value |
| --- | --- |
| Severity | **P2** schedule correctness |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | `isInQuietHours` accepted hour>23/min>59 via bare Number split; DST paths only had LA summer tests |
| Fix | `parseQuietHoursClock` strict HH:MM 0–23/0–59; tests for NY spring/fall + spring-gap cron |
| Verification | AUTOMATED_TESTED |

## F-2026-07-23-068 — Stream approval card lacked landmark a11y

| Field | Value |
| --- | --- |
| Severity | **P3** a11y |
| Confidence | Medium |
| Status | **fixed** |
| Evidence | task-stream `approval` block had no role/aria-label (actionable turn cards already had region) |
| Fix | `role="region"` + `aria-label` + decorative icon aria-hidden; structure test |
| Verification | AUTOMATED_TESTED |
