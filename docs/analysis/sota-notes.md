# SOTA notes (practical product patterns)

## 1. Default skills on every conversation

**SOTA (Claude Code, Cursor, OpenClaw-style agents):** ship a progressive-disclosure skill tree under a known root; load `SKILL.md` metadata always, full body when relevant. Prefer **bundled defaults + user overlays**, never empty skills on first run.

**Takeaway for Desk:** monorepo `skills/` packs always merged into `skillsPaths` before engine start; user paths append, not replace.

## 2. Connections / MCP presets

**SOTA (Claude Desktop / CoWork, Cursor):** connector **gallery** with categories (local, web, productivity), **Recommended** first-run set, search/filters, capability descriptions, and clear “needs API key” badges. One-click enable; OAuth/token connectors stay opt-in. MCP is the wire; UX is the catalog.

**Takeaway for Desk:** expanded `CONNECTOR_PRESETS` (filesystem, fetch, memory, sequential-thinking, git, GitHub, Slack, Brave Search, Puppeteer, Postgres, …) + filter helpers + Settings gallery (search, category chips, recommended, detail pane) + `enableRecommended` for free essentials.

## 3. Smart automations / proactivity

**SOTA:** Apple Intelligence / Notion AI / Rewind-style systems combine **standing context + unfinished work + templates** into suggestions, not just failure alerts. Deterministic rule engines first; LLM ranking optional.

**Takeaway for Desk:** extend proactivity tick to emit `suggestion` inbox items from standing/profile memory and draft schedule rule templates — no live Grok required for the suggestion generation path.

## 4. One-time payment + license key (Electron)

**SOTA (Gumroad, Lemon Squeezy, Paddle, Keygen):** checkout issues a license key; app activates against a small API; store signed activation locally with **offline grace**; honest DRM (deter casual sharing, not unbreakable).

**Takeaway for Desk:** in-repo `@grokdesk/license` with HMAC-signed keys, activate/verify, offline grace; swap verify URL later for hosted API.

## 5. Automatic downloads / updates

**SOTA:** static `latest.json` (or app-update.yml) with version + platform URLs + checksums; app or website points at the manifest; electron-updater optional later.

**Takeaway for Desk:** ship `docs/releases/latest.json` + pure `parseReleaseManifest` consumer; no live CDN required for the slice.
