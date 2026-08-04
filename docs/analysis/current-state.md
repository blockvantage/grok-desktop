# Grok Desk — current state analysis (2026-07-11)

Branch baseline: `main` @ worktree `feat/intelligence-skills-commerce`.

## Product shape

Grok Desk is an Electron desktop app (`apps/desktop`) over a local gateway (`packages/gateway`) that runs Grok Build sessions (`packages/engine-grok`) with shared types/policy (`packages/shared`).

| Layer | Role today |
| --- | --- |
| Desktop UI | Chat-style tasks, settings (MCP + skills paths), memory, schedules, inbox |
| Gateway | SQLite persistence, task runner, scheduler, proactivity, settings, IPC |
| Engine | Spawns Grok Build CLI; passes `GROKDESK_SKILLS_PATHS` + MCP JSON env; also injects skill text into prompt preamble |
| Shared | Types, IPC zod schemas, role packs, policy → CLI flags |

## Skills

- Settings store `skillsPaths: string[]` (user-chosen directories only).
- Defaults are **empty** (`mcpServers: []`, `skillsPaths: []`).
- Engine scans each path for `*/SKILL.md` and inlines content into the run preamble; also sets env for CLI wrappers.
- Role packs name skill *ids* (marketing, research…) but **no SKILL.md packs ship with the app**.

## Connections / MCP

- Users manually add MCP rows in Settings (id, command, args, enabled).
- No curated presets, no one-click enable, no first-run connectors.
- Enabled servers go to `GROKDESK_MCP_SERVERS` + prompt list.

## Intelligence / automations

- **Scheduler**: cron rules → create tasks; quiet hours respected.
- **Proactivity**: hourly tick only pings inbox for `waiting_approval` / `failed` (deduped 24h).
- **Memory**: profile/standing/preference stored + embeddings; used in runner preamble, **not** for suggesting automations.
- **Role packs**: standing instructions written to memory on task create.

## Commerce / distribution

- No license keys, no activation, no update/download manifest.
- Version is monorepo `0.1.0`; website `grokdesk.app` is external.

## Gaps this goal closes (slices)

1. Bundle default SKILL.md packs + auto-resolve into every run.
2. Curated connector presets + enable/persist.
3. Memory-aware proactivity suggestions (smart automations).
4. License activate/verify + release download manifest.
