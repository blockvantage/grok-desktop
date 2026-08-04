# Feedback hardening plan (ship-connected)

Branch: `feat/intelligence-skills-commerce`  
Source: adversarial merge review (build-red, connectors decorative, skills missing in package).

## Goal

Make the branch **compile, wire connectors/skills for real Grok CLI, harden license for honest launch posture, fix i18n regressions, and close backend correctness holes**. Do not merge until typecheck + desktop build + unit tests pass and adversarial-review claims match reality.

## Architecture decisions

### MCP (blocker 2)

Grok CLI loads MCP from:

- `~/.grok/config.toml` → `[mcp_servers.<name>]`
- Project `.grok/config.toml` (cwd / repo walk)

**Desk approach:** On each engine run, write enabled servers into  
`<primaryCwd>/.grok/config.toml` (merge-safe section writer). Expand `${VAR}` **at spawn** from process env + optional secret store. **Do not** put secrets or full command lines in the system preamble. Remove reliance on invented `GROKDESK_MCP_SERVERS` for capability. Keep env for diagnostics only.

### Skills (blocker 3)

Grok discovers skills from `.grok/skills/`, `[skills].paths` in user config, etc.

- `electron-builder.yml`: `extraResources` → pack monorepo `skills/` → `Resources/skills`
- Main process: set `GROKDESK_BUNDLED_SKILLS` from `process.resourcesPath` (packaged) or monorepo path (dev)
- Engine: symlink/copy bundled packs into `<cwd>/.grok/skills/` before spawn **or** write only name+description for non-default packs in preamble; inject **desk-defaults** fully
- `settings.get` returns `bundledSkillsFound` + `effectiveSkillsPaths` as **sibling** fields (not merged into app settings object for round-trip)

### Presets (blocker 4)

- Add `runtime: "npx" | "uvx"`
- Replace dead packages with maintained ones:
  - fetch → `uvx mcp-server-fetch`
  - git → `uvx mcp-server-git`
  - sqlite → `uvx mcp-server-sqlite`
  - sentry → `@sentry/mcp-server` or HTTP endpoint docs
  - github → `@modelcontextprotocol/server-github` **or** `github/github-mcp-server` via npx if published
  - Prefer healthy free recommended: filesystem, sequential-thinking, memory (verify), fetch/git via uvx
- Mark deprecated as `status: "deprecated" | "active"` and hide from recommended; document archived ones
- CI smoke: resolve package names (optional lightweight check)

### License (blocker 5)

Pragmatic launch-safe scaffold (not full Stripe yet):

1. **Ed25519**: private key only on issuer/server; **public key** embedded client-side
2. Remove `issueLicenseKey` + default HMAC secret from client bundle exports used by desktop
3. Signed activation blob (sig over machineId+licenseId+graceUntil) so hand-written JSON fails offline
4. Whitelist `settings.set` keys — never accept `license` via settings.set
5. Machine id: prefer stable mac serial / MachineGuid / etc. with fallback; document Finder vs terminal
6. License HTTP: body size cap + simple token auth when secret set; rate limit optional
7. Docs: “dev keys only until Stripe issuance”

### Build / CI (blocker 1 + gate)

- Fix ternary braces in task-workspace-view
- CI: `typecheck` + desktop build already partially there — add shared/license/engine typecheck and fail on renderer parse errors
- Root script: `pnpm typecheck` must include desktop

### i18n (6–9)

- Fix scheduled pickFolder literal; tasks.subtitle key; command palette keys
- Ship **en + es** as fully translated; other locales keep keys but honesty test: either translate critical status keys or drop claim of 100% human translation
- Sync locale synchronously in provider; add locale deps to greeting/stream memos
- Grep test ban `{/* i18n */}`

### Backend (10–15)

- TaskRunner: map taskId → engine instance at start; cancel/delete use that engine
- settings.set: zod partial AppSettings; clamp maxConcurrent ≥ 1; reject bad skillsPaths
- Secrets: store placeholders; expand at spawn; redact args in preamble
- engineReloaded = engineSettingsChanged only; re-discover binary on reload
- enableRecommended: skip existing customized server ids (doc + behavior)
- Suggestions: dismiss by suggestionKey; inbox.dismiss; fix biweekly cron to true 14-day
- Skills preamble: desk-defaults full; others name+description only
- Manifest: don’t fabricate real-looking version without verification; mark placeholder digests

## Execution order

1. Build fix + CI gate  
2. MCP writer + engine spawn integration + tests  
3. Skills packaging + env + preamble trim  
4. Preset health + runtime field  
5. Settings schema + runner cancel + secrets  
6. License Ed25519 + signed activation  
7. i18n regressions + locale sync  
8. Proactivity dismiss / cron  
9. Docs honesty pass + full verify  

## Out of scope (explicit)

- Live Stripe checkout wiring  
- Full native-quality non-en translations for all 478 keys  
- Electron e2e in CI  
- Nested button rewrite of entire settings-view (partial if time)  
