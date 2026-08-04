# Grok Desk audit log (append-only)

## 2026-07-23T22:49:15Z — audit start / P0 entitlement unlock bake

| Field | Value |
| --- | --- |
| Branch / commit | `main` @ `3bae127` |
| OS / arch | macOS Darwin arm64 |
| Node / pnpm | v20.13.1 / 9.6.0 |
| App profile | N/A (source + local `apps/desktop/out` artifact) |
| Workspace | `/Users/maceo/blockvantage/grok/grok-desktop` (repo; no user workspace mutations) |

### Investigation performed

1. Repository map: monorepo (`apps/desktop`, `apps/mobile`, `packages/*`, `services/remote-relay`, `skills/`, CI).
2. Entitlement unlock path: `Makefile` `local` target, `electron.vite.config.ts` bake, `apps/desktop/src/main/index.ts`, `gateway-process.ts`, entitlement manager.
3. Inspected built `apps/desktop/out/main/index.js` for inlined `isBakedDevUnlock`.
4. IPC sender gating: `ipc-sender.ts`, `privileged-ipc.ts`, entitlement/update registration.
5. Release workflow: `.github/workflows/release-desktop.yml` package matrix env.

### Commands / tests

- `node` inspect of `out/main/index.js` → `const v = true` inside both `isBakedDevUnlock` copies (**P0 evidence**).
- After fix + rebuild: `const v = false` (both copies).
- `pnpm --filter @grokdesk/desktop exec vitest run src/packaging.smoke.test.ts src/main/entitlements/ipc.test.ts src/main/updates/update-ipc.test.ts` → pass (41 tests).
- `env -u GROKDESK_DEV_UNLOCK -u GROKDESK_BAKE_DEV_UNLOCK pnpm --filter @grokdesk/desktop build` → pass.

### Findings created

- **F-2026-07-23-001** (P0): Compile-time unlock bake coupled to runtime `GROKDESK_DEV_UNLOCK` → accidental entitlement bypass in packaged main bundle.
- **F-2026-07-23-002** (P1): Entitlement/update IPC allowed missing `assertSender` (optional) → fail-closed required gate.

### Changes made

- Bake only when `GROKDESK_BAKE_DEV_UNLOCK=1`.
- Release workflow refuse_unlock + post-build artifact grep for `const v = true`.
- Packaging smoke guards for config + workflow + built main.
- Entitlement/update IPC fail-closed without assertSender.
- Makefile / comments accuracy.

### Next investigation target

- Workspace path confinement + browser openHtml path safety end-to-end.
- Strict mode side-effect guarantees.
- Cancel / stop process tree.
- Remote pairing cryptography and duplicate submission.
- Public claims vs implementation (`grokdesk.app`).
- Agent lifecycle / crash recovery residual.
- Accessibility and i18n gaps.

---

## 2026-07-23T23:00:00Z — IPC empty-URL harden + desktopDestroy split

| Field | Value |
| --- | --- |
| Branch / commit base | `4b52b4d` |
| OS / arch | macOS Darwin arm64 |

### Investigation

- `validatePrivilegedIpcSender` skipped origin when `getURL()` empty.
- `TaskRunner` finally destroyed desktop only when browser also destroyed; confirmed browser open left host desktop granted after done.

### Changes

- Fail-closed empty URL for non-main senders (F-003).
- Always `desktopDestroy` when no active siblings (F-004).
- Root version `0.1.6` (F-005).
- New runner test for desktop destroy vs browser retain.

### Tests

- desktop electron-security + privileged-ipc: pass
- gateway `runner.test.ts` (2 selected): pass (after better-sqlite3 host rebuild)

### Next

- Cancel process-tree SIGKILL matrix residual
- Public site claims browse
- Remote crypto review
- Onboarding e2e if display available

---

## 2026-07-23T23:07:00Z — claims, dictation gate, homepage

| Field | Value |
| --- | --- |
| Commits | `91dcf9e`, `9e5e2dc`, `ab9b2d1` (+ homepage pending) |
| OS | macOS arm64 |

### Work

- Browsed https://grokdesk.app — keychain + deletes-always claims false vs code.
- Fixed license-tab vault honesty; Autopilot delete disclosure (7 locales).
- Dictation assertSender fail-closed.
- Remote idempotency SOURCE_REVIEWED (mutation receipts + tests exist).
- openHtml outside path already denied via host policy + runner tests.

### Owner blockers

- O-005 site keychain, O-006 site deletes FAQ.

---

## 2026-07-23T23:40:45Z — path confinement & filename escape wave

| Fixes | Symlink realpath re-check (read/preview/reveal); Windows case; attachment `..`; media promote; skill pack names |
| --- | --- |
| Commits | `09eb55c` … `a88a090` / `6b6d048` / `99df39d` / `85059a5` / `736fd0b` |
| Tests | workspace-path-confine, workspace-asset, workspace-read-file, reveal, attachments, session-media, mcp-config-write |
| Residual | O-008 headless agent tool path confine depends on CLI sandbox |

---

## 2026-07-23T23:23:00Z — index.js unlock residue, memory privacy, i18n security

| Commits | `0229639`, `b9044cf`, `1b876eb`, `58fc44e` |
| --- | --- |
| Fixes | Untrack unlock-true index.js; memory SuperGrok disclosure; protection + remote/license i18n |
| Still open | Full E2E, Windows, signed package, site O-005/6/7, a11y deep pass, ACP cutover |

---

## 2026-07-23T23:13:00Z — remote mask, dictation unmount, vault docs

| Commits | `b4fccc4`, `8ef6124`, `17dd23f` |
| --- | --- |
| Fixes | Pairing link masked; vault comment; mic release on unmount |
| Tests | remote-tab component, use-dictation, i18n catalog |
| Still open | Full e2e onboarding, Windows package, signed release, live SuperGrok, site copy (owner), ACP cutover |

---

## 2026-07-23T21:06:00Z — IPC residual bounds, Windows desktop injection, schedule/host harden

| Commits | `09adec9` … `1ba4f5b` … host body (this wave) |
| --- | --- |
| OS | macOS arm64 |

### Fixes

- Remaining unbounded IPC entity ids, hostApproval free-form, remote ControlPlain metadata (F-018 completion).
- **F-019** Windows `typeText` SendKeys chord injection (`+^%~(){}[]`).
- **F-020** Windows `openApp` via `cmd /c start` → Start-Process LiteralPath.
- Desktop tool Zod coord/path/key bounds.
- **F-021** schedule.create validates cron/tz at create.
- Markdown: no free-form inputs; recovery banner `role=status`.
- **F-022** loopback host servers 1 MiB body cap.

### Tests

- shared ipc + remote-protocol + desktop-tool-schemas
- desktop win-sendkeys, host-server-body, scheduler
- renderer markdown-security

### Still open / blocked

- SuperGrok live E2E; signed/notarized package; Windows package matrix
- Site claims O-005/6/7; ACP cutover O-003; headless path residual O-008
- Deep a11y pass; live remote/mobile pairing E2E on device

## 2026-07-23T21:12:00Z — desktop injection + host/remote/asset/CLI harden

| Commits | `9405214` … `fd9f619` |
| --- | --- |
| Highlights | Windows SendKeys + openApp; macOS AppleScript escape; host body/token; remote relay scheme; schedule cron; markdown inputs; asset token FIFO; CLI line max |
| Findings | F-019–F-026 fixed with AUTOMATED_TESTED |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, deep a11y, live mobile remote |

## 2026-07-23T21:19:00Z — i18n a11y, relay frames, offline queue

| Commits | `52a0d7f` … `3913de3` |
| --- | --- |
| Fixes | Plan/sources/attachments i18n; relay maxPayload + hello bounds; offline queue max 50 |
| Findings | F-027, F-028 |
| Residual | SuperGrok E2E, signed package, site claims, ACP, headless O-008, live mobile device |

## 2026-07-23T21:25:00Z — workspace list confine + absolute roots

| Commits | `6218fa7`, `d480a89`, `60979d5` |
| --- | --- |
| Fixes | F-029 listFiles allowedRoots; F-030 absolute roots for tasks + schedules |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, live mobile |

## 2026-07-23T21:29:00Z — path case consistency + listFiles + absolute roots

| Commits | `6218fa7` … `793984a` |
| --- | --- |
| Fixes | F-029 listFiles roots; F-030 absolute task/schedule roots; F-031 managed-root case; isPathInsideRoot rollout for attachments, skills, runtime, session-media |
| Residual | SuperGrok E2E, signed package, site claims, ACP, headless O-008, live mobile device E2E |

## 2026-07-23T21:33:00Z — settings paths, remote rekey, dictation partial

| Commits | `75b66c4` … `90de5fc` |
| --- | --- |
| Fixes | Dictation partial cap; absolute trustedFolders/skillsPaths; remote rekey 32-byte pub; path case helpers earlier |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, live mobile |

## 2026-07-23T21:41:00Z — quiet hours, inbox cap, list bounds, a11y, browser private nets

| Commits | `d5a9df2` … `ae06d6a` |
| --- | --- |
| Fixes | F-034 quiet-hours TZ; F-035 inbox hard cap; tasks/memory/artifacts list LIMIT; F-033 private hosts; notice-slot a11y |
| Residual | SuperGrok E2E, signed package, site claims, ACP, headless O-008, live mobile device |

## 2026-07-23T21:44:00Z — SQL list caps + retention prunes

| Commits | `6db29b3` … `2da67ad` |
| --- | --- |
| Fixes | F-036 list LIMITs (tasks/memory/events/artifacts/inbox/schedules/turns/devices); F-037 mutation receipts 14d; schedule occurrences 90d |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, live mobile |

## 2026-07-23T21:50:00Z — mobile ATS/i18n, offline params, pairing challenge cap, retention

| Commits | `1080461` … `2574b80` / `ab7ecee` / `bafc178` / `383a6d0` |
| --- | --- |
| Fixes | F-038 mobile ATS; mobile i18n leftovers; F-039 offline params 8k; pairing challenges max 5; retention prunes |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, O-009 fuses/Android cleartext, live mobile device |

## 2026-07-23T21:55:00Z — events.list client/server completeness + corrupt payloads

| Commits | `77ee48f` … `ec23818` |
| --- | --- |
| Fixes | F-040 client pagination (mobile/desktop/export); corrupt payload_json isolation |
| Residual | SuperGrok E2E, signed package, site claims, ACP, headless O-008, O-009 fuses, live mobile device |

## 2026-07-23T21:59:00Z — commercial honesty + event payload harden

| Commits | `135a73b` … `0046cee` |
| --- | --- |
| Fixes | F-041 securityDesc/privacy/evergreen memory honesty; packaging smoke guard; coalesced message 500k cap |
| Residual | SuperGrok E2E, signed package, site O-005–7, ACP O-003, headless O-008, O-009 fuses, live mobile device |

## 2026-07-23T22:10:00Z — remote protocol bounds + error redaction + Electron fuses

| Commits | `ac4bf2e` … (this wave) |
| --- | --- |
| Fixes | F-044 pair/relay schema max bounds; F-045 remote error secret redaction; F-046 afterPack fuses (cookie/NODE_OPTIONS/inspect/onlyLoadAppFromAsar); pairSecret/deskToken/deviceToken in secret-redact |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 asar integrity + Android cleartext + RunAsNode architecture, live mobile device |

## 2026-07-23T22:14:00Z — a11y plan focus + mobile session validate

| Commits | `300bd9c` … (this) |
| --- | --- |
| Fixes | Plan approve autofocus + region labels; mobile StoredSession parse bounds |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 asar/Android cleartext, live mobile device |

## 2026-07-23T22:16:00Z — update status bounds + desktop grant cap

| Commits | `9db5da6` … `8f8c503` |
| --- | --- |
| Fixes | F-047 mobile session validate; UpdateStatus string maxes; F-048 desktop grant FIFO + chat-delete clear |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 asar/Android/RunAsNode, live mobile device |

## 2026-07-23T22:18:00Z — asset symlink TOCTOU + list limits

| Commits | `0b12e2a` … (this) |
| --- | --- |
| Fixes | F-049 asset protocol post-mint symlink; run-attempt list LIMIT; pair challenge SQL filter |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:22:00Z — attachment realpath + mobile prefs bounds

| Commits | `4380587` … `d8cbe26` |
| --- | --- |
| Fixes | F-050 retained attachment realpath; stage under real destDir; mobile prefs display/seen caps |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:24:00Z — corrupt SQLite JSON isolation wave

| Commits | `42165fc` … (this) |
| --- | --- |
| Fixes | Operation receipts, tasks policy/skills/mcp, schedule workspaceRoots, mutation results isolate corrupt JSON |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:28:00Z — localStorage hydrate bounds + manifest schema bounds

| Commits | `e3791e5` … `67cb5d1` |
| --- | --- |
| Fixes | Compatibility manifest field maxes; durable queue/drafts/session/pins/recipes/layout/unread localStorage caps |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:32:00Z — offline queue / pairing QR / host write_file

| Commits | `eb43961` … `f752d5b` |
| --- | --- |
| Fixes | Offline queue parse caps; pairing QR field/size bounds; F-051 host write_file re-confine + content max |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:35:00Z — map/peer capacity caps

| Commits | `72aa929` … `2be4dd9` |
| --- | --- |
| Fixes | Relay max peers + channel length; browser/desktop policy maps 512; remote session 32; reveal roots 64; schedule lastFired prune |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:38:00Z — more capacity + version honesty

| Commits | `e7ad6b6` … `adadd18` |
| --- | --- |
| Fixes | GROKDESK_VERSION 0.1.6; desktop lastCapture 512; ACP sessions 64; browser views 32 |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:40:00Z — crypto compares + partition sanitize + mutation flights

| Commits | `a20a4a5` … `98df514` |
| --- | --- |
| Fixes | Browser partition sanitize; timing-safe device/desk tokens; mobile compose goal caps; mutation single-flight cap 256 |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:42:00Z — connection and RPC concurrency caps

| Commits | `c8d10d8` … `7df3485` |
| --- | --- |
| Fixes | Loopback host maxConnections 32; relay HTTP 4096; gateway pending 128; host-bridge reverse calls 64 |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T22:50:00Z — URL credentials + vault ids + harvest + webSecurity

| Commits | `7fae1cf` … `f827b89` |
| --- | --- |
| Fixes | F-052 primary-only harvest; webSecurity pin; vault id path-safe; download/manifest/browser URL credentials blocked; journal forbidden keys; temp attachment prune; pending approvals 64 |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:00:00Z — ACP framing + MCP host timeout + manifest bounds

| Commits | (this wave) |
| --- | --- |
| Fixes | F-053 ACP line/pending caps; F-054 MCP hostExec 60s timeout; F-055 attachment manifest bounds; F-056 peekJwtKid bounds |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:05:00Z — gateway framing + folder order + lease JWKS

| Commits | (this wave) |
| --- | --- |
| Fixes | F-057 gateway stdout/stderr bounds; F-058 folder order; F-059 lease JWKS parse |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:08:00Z — media lightbox + mobile relay frame bounds

| Commits | (this wave) |
| --- | --- |
| Fixes | F-060 media fetch timeout/size; F-061 mobile WS frame cap |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:10:00Z — pairing relay, artifacts, chat export pagination

| Commits | (this wave) |
| --- | --- |
| Fixes | F-062 pairing QR relay validation; F-063 artifact title/path bounds; F-064 chat export seq pagination |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:12:00Z — settings MCP load sanitize

| Commits | (this wave) |
| --- | --- |
| Fixes | F-065 sanitize mcpServers on settings load via wire schema |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-23T23:15:00Z — update install race, quiet hours DST, approval a11y

| Commits | (this wave) |
| --- | --- |
| Fixes | F-066 update busy single-flight + busy must not error journal; F-067 quiet hours clock validation + DST tests; F-068 stream approval landmark |
| Residual | SuperGrok E2E, signed package fuse validation, site O-005–7, ACP O-003, headless O-008, O-009 residuals, live mobile |

## 2026-07-24T02:16:00Z — closeout verification + final summary

| Field | Value |
| --- | --- |
| Branch / tip | `main` @ `df0246d` (+ docs commit following) |
| OS | macOS arm64 |
| Commands | `pnpm typecheck` (all packages Done); targeted vitest shared/gateway/provider-grok/desktop/mobile |
| Results | typecheck exit 0; **179** targeted tests pass (26+39+7+101+6) |
| Docs | FINAL_AUDIT_SUMMARY rewritten; REQUIRES_OWNER_ATTENTION O-005–011 paste-ready site copy + live E2E/device |
| In-repo residual | F-046 partial / O-009 fuses+Android; all other open P0/P1/P2 either fixed or owner-blocked |
| Residual | SuperGrok E2E, signed fuse read, site O-005–7, ACP O-003, headless O-008, live mobile O-011 |
| Do not claim | Unqualified production launch or full DoD live-provider coverage |
