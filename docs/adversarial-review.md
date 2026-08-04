# Adversarial review — intelligence / skills / commerce / i18n

**Branch:** `feat/intelligence-skills-commerce`  
**Worktree:** `~/blockvantage/worktrees/grok-desktop-intelligence`  
**vs:** `main` @ `98757ee`  
**Hardening pass:** 2026-07-11 (feedback ship-blockers)

Also see `docs/plans/2026-07-11-feedback-hardening.md`.

## Themes

| Theme | Finding | Severity | Outcome |
| --- | --- | --- | --- |
| Desktop build | `{t("workspace.approve")}` invalid object literal in ternary | **blocker → fixed** | Dropped braces; CI now runs typecheck + desktop build |
| MCP wiring | Only set invented `GROKDESK_MCP_SERVERS` + prompt list | **blocker → fixed** | Writes `<cwd>/.grok/config.toml` `[mcp_servers.*]` Grok CLI actually loads; installs skills under `.grok/skills/` |
| Packaged skills | No extraResources; env never set | **blocker → fixed** | `electron-builder` extraResources + `GROKDESK_BUNDLED_SKILLS` from main; `bundledSkillsFound` on settings.get |
| Preset packages | fetch/git/sqlite/sentry broken; deprecated npm archives | **blocker → fixed** | `runtime: npx\|uvx`; uvx for fetch/git/sqlite; `@sentry/mcp-server`; status active/deprecated; auto-enable only healthy free **npx** |
| License scaffold | HMAC secret + issue in client; unsigned offline JSON | **high → hardened** | Ed25519 GD2 path; signed `activationSig`; settings.set whitelist (no license inject); HTTP body cap + rate limit + issue auth. **Still not Stripe-backed multi-seat — do not sell as DRM alone** |
| i18n literal / wrong keys | `{/* i18n */}` on scheduled; tasks.subtitle wrong; palette keys | **high → fixed** | Correct keys; status strings improved for secondary locales |
| Locale stale UI | module `t` one render late; greeting memos | **med → fixed** | Sync `setActiveLocale` during provider render; locale deps |
| Cancel after hot-reload | TaskRunner used current engine only | **high → fixed** | Per-task engine map at run start |
| settings.set loose schema | concurrency 0, forged license, bad skillsPaths | **high → fixed** | zod partial + clamp + reject unknown keys |
| Secrets in settings/prompt | Expanded at enable; args echoed | **high → fixed** | Placeholders stored; expand at spawn; redacted preamble; MCP names only |
| engineReloaded honesty | Always true on enable | **med → fixed** | Returns whether engine was actually swapped |
| Suggestions re-nag | 24h dedupe only | **med → fixed** | Suggestion dedupe until dismiss; `inbox.dismiss`; biweekly cron → `1,15` |
| Release manifest | Fake `0.1.0` + zero digests | **med → fixed** | Explicit `0.0.0-placeholder` / dev channel; no cross-OS download fallback |
| Skills preamble bloat | Full body of all packs every task | **med → fixed** | desk-defaults full; others name+description |
| i18n “100% coverage” | Structural keys only; secondary locales ~EN | **open honesty** | Key parity remains; human translation not 100% for fr/de/pt/ja/zh long copy — claim is **key coverage**, not native quality |

## Material improvements this pass

- Real MCP project config writer + skills install into workspace
- Packaged skills path + builder extraResources
- Healthy connector catalog with runtime/status fields
- License Ed25519 + signed activation + settings isolation
- Build/typecheck CI gate
- Runner cancel correctness + settings schema
- i18n regression fixes + locale sync

## Still deferred / honest limits

- Live Stripe issuance, seat tracking server, deactivate product flow
- Full native-quality translation of all 478 strings in 5 secondary locales
- In-app credential vault UI (Dock-launched apps still need env or future safeStorage form)
- Nested button a11y cleanup of settings gallery
- Electron e2e for packaged MCP spawn
- Schedule-from-suggestion one-click CTA

## Verification (local)

- `pnpm --filter @grokdesk/{shared,license,engine-grok,gateway} build` green
- shared 59, license 7, engine-grok 28, gateway 51 tests green
- desktop typecheck green
- desktop build (electron-vite) — see CI / local log

## Evidence

Worktree commits after hardening; plan in `docs/plans/2026-07-11-feedback-hardening.md`.
