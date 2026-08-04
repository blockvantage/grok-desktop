# Grok Build → Grok Desk: things to import

**Source:** [xai-org/grok-build](https://github.com/xai-org/grok-build) (cloned at `/tmp/grok-build` for analysis)
**User guide:** `crates/codegen/xai-grok-pager/docs/user-guide/`
**Date:** 2026-07-15

This is a catalog of Grok CLI / agent-runtime capabilities we can surface, re-use, or re-implement in Grok Desk. Desk is a **desktop coworker** (not a TUI): prefer product language over cloning the terminal UI.

**How Desk uses Grok today**

| Layer | Reality |
|--------|---------|
| Task engine | Headless spawn: `grok -p … --output-format streaming-json` |
| Tools | Execute inside CLI (`executesOwnTools = true`) — gateway mostly observes |
| Profile | Isolated `GROK_HOME` by default (hooks/plugins stripped) |
| Policy | Provisional `policy-to-grok-flags` (no real sandbox yet) |
| Partial path | ACP in `provider-grok`; billing/STT already hit HTTP rails |

**Import strategies**

| Code | Meaning |
|------|---------|
| **Surface** | CLI already does it; expose events/UI (ACP or better headless) |
| **Bridge** | Map CLI feature ↔ Desk gateway/UI contracts |
| **Reimplement** | Own it in TS (API agent loop / gateway tools) |
| **Hybrid** | Start as Surface; migrate to Reimplement |

---

## Wave status (2026-07-17)

CLI feature-port wave landed on `main` (see `docs/analysis/2026-07-16-cli-port-wave-qa.md`):

- **Landed:** ACP default when probe supports stdio, session resume, sleep/wake power gate, max effort, honest strict flags, plan-first + plan card, interject/compact/rewind RPCs (x.ai/* degrade), context meter, media tool→artifacts, citation cards, mermaid fences.
- **Deferred (stretch):** weekly recap inbox (Task 15 / C4).

---

## P0 — Trust, control, session continuity

### 1. OS sandbox profiles
- **CLI:** `xai-grok-sandbox`, `--sandbox`, Seatbelt/Landlock, workspace profiles, child network restrictions
- **Docs:** `18-sandbox.md`
- **Import:** Surface + Bridge — pass documented profiles when probe says supported; show effective sandbox in Settings/task chrome
- **Desk gap:** CLI started without sandbox; policy can over-promise

### 2. Real permission rules (not heuristic flags)
- **CLI:** allow / deny / ask rules, permission modes, remembered grants, dangerous-command list, PreToolUse hooks
- **Docs:** `22-permissions-and-safety.md`
- **Import:** Bridge — compile Desk policy → documented CLI/ACP rules; fail closed when unenforceable
- **Desk gap:** `strict` → `--permission-mode plan` is the wrong semantic

### 3. ACP as primary engine path
- **CLI:** `grok agent stdio` / server / WebSocket; session/request_permission
- **Docs:** `15-agent-mode.md`
- **Import:** Surface — make ACP default when probe supports it; gateway-owned permission broker
- **Desk gap:** headless-degraded is default; ACP gated / incomplete

### 4. Session resume / continue / named sessions
- **CLI:** `-s` named session, `-r` resume, `-c` continue, session IDs in JSON
- **Docs:** `14-headless-mode.md`, slash `/resume`
- **Import:** Bridge — persist engine session id per Desk task; crash recovery + cheap follow-ups

### 5. Plan mode
- **CLI:** `enter_plan_mode` / `exit_plan_mode`, plan file, approval lifecycle
- **Docs:** `19-plan-mode.md`, slash `/plan`, `/view-plan`
- **Import:** Surface + UI — “Draft plan first → Approve / Request changes / Run”
- **Product fit:** perfect for Cowork “waiting on you”

### 6. Interjection / nudge (`/btw`)
- **CLI:** `xai-interjection-core`, slash `/btw` — aside without killing the run
- **Import:** Bridge + UI — “Nudge / Also…” on running tasks

### 7. Goal mode
- **CLI:** `/goal`, `update_goal` tool (status / pause / resume / clear)
- **Import:** Bridge — map to Desk task objective + progress header + tray

### 8. Context compact + context meter
- **CLI:** `/compact [preserve]`, `/context`, `xai-grok-compaction`, token estimation
- **Import:** Surface + UI — long-task “Summarize so far” + context usage indicator

### 9. Sleep / wake auth safety
- **CLI:** `xai-system-power` — WillSleep / DidWake; avoid OIDC refresh during suspend
- **Import:** Reimplement in Electron main / SuperGrok token refresh
- **Why:** always-on desktop apps lose rotated tokens on laptop sleep

### 10. Isolated vs inherited profile (explicit UX)
- **CLI:** hooks/plugins/skills in `~/.grok`
- **Desk today:** isolates by default; `GROKDESK_INHERIT_USER_GROK=1` opt-out
- **Import:** Settings toggle with clear risk copy (“use my Grok plugins” vs Desk-owned profile)

---

## P1 — Grok-native magic & coworker UX

### 11. Imagine / image tools
- **CLI:** `image_gen`, `image_edit`, slash `/imagine`
- **Import:** Surface + artifacts gallery; auto-save to primary workspace

### 12. Video tools
- **CLI:** `image_to_video`, `reference_to_video`, slash `/imagine-video`
- **Import:** Surface + video artifacts / lightbox

### 13. Web search + X search (first-class)
- **CLI:** `web_search`, `web_fetch`, xAI-specific tools (e.g. `x_search` shapes in sampler)
- **Import:** Surface citations as cards; toggle models used for search (`web_search` model in config)

### 14. Memory: remember / flush / dream
- **CLI:** `xai-grok-memory` — MEMORY.md, session logs, hybrid search, MMR, temporal decay
- **Docs:** `13-memory.md` — `/remember`, `/flush`, `/dream`, auto-dream
- **Import:** Bridge Desk memory ↔ engine memory **or** adopt flush/dream UX on Desk store
- **Delight:** “What should I remember?” / “Consolidate this week”

### 15. Rewind + checkpoints
- **CLI:** workspace rewind domains: **fs / hunk / git**
- **Import:** Surface + UI — “Undo last turn”, restore conversation + files

### 16. Hunk tracker (accept / reject edits)
- **CLI:** `xai-hunk-tracker` — per-file hunks, accept/reject, events
- **Import:** “Review changes” pane after agent edits

### 17. Subagent lifecycle events (real HUD)
- **CLI:** `general-purpose`, `explore`, `plan`; personas; capability modes; depth limits
- **Docs:** `16-subagents.md`
- **Import:** Surface worker events over ACP — stop inventing agents from `parentTaskId`

### 18. Worktree isolation for subagents
- **CLI:** `isolation: worktree`, `xai-fast-worktree` (CoW / btrfs / pools)
- **Import:** Optional “try this in a safe worktree” for repo-adjacent tasks

### 19. Fork session
- **CLI:** `/fork` — branch conversation/agent state
- **Import:** “Try another approach” from mid-task

### 20. Mermaid diagrams in-thread
- **CLI:** `xai-grok-mermaid` — pure Rust → PNG, sandboxed worker, no Node/browser
- **Import:** Reimplement or shell out; render architecture/plan diagrams in chat

### 21. Effort / reasoning levels
- **CLI:** `--reasoning-effort` / `/effort` — none → max / xhigh
- **Import:** Already partially mapped; expand to full CLI level set + UI

### 22. Model picker & catalog
- **CLI:** built-ins + custom models + `/v1/models` prefetch; Ctrl+M / `/model`
- **Docs:** `11-custom-models.md`
- **Import:** Live list from auth session; not hard-coded only

### 23. Streaming tool / thought fidelity
- **CLI:** rich streaming; Desk already heartbeats when tools don’t stream
- **Import:** Prefer ACP or richer streaming-json types so steps/tools don’t look frozen

### 24. Final summary + deliverable path discipline
- **CLI:** agent naturally writes files; Desk injects prompt rules for workspace paths
- **Import:** Keep + strengthen artifact harvesting from tool events, not only prose

---

## P2 — Ecosystem: skills, plugins, MCP, hooks

### 25. Skills platform (full)
- **CLI:** multi-root discovery (`.grok/`, `.agents/`, `.claude/`, `.cursor/`), ignore rules, qualified names, auto-invocation
- **Docs:** `08-skills.md`
- **Import:** Scan same roots; skill browser; per-task enable

### 26. `/create-skill` equivalent
- **CLI:** interactive skill authoring → SKILL.md on disk
- **Import:** “Teach Grok this workflow” wizard in Desk

### 27. Bundled / default skills
- **CLI:** ships skills to `~/.grok/skills/` (`/help`, `/create-skill`, `/check-work`, …)
- **Import:** Bundle Desk role-pack skills; auto-resolve every run

### 28. Plugin marketplace
- **CLI:** `xai-grok-plugin-marketplace`
- **Official source:** `https://github.com/xai-org/plugin-marketplace.git`
- **Docs:** `09-plugins.md`
- **Import:** One-click install UI with Desk trust gate; role packs = curated plugin sets

### 29. Plugins bundle (skills + hooks + MCP + agents)
- **CLI:** plugin package format, install/update/uninstall CLI
- **Import:** Manage as “extensions” in Settings

### 30. MCP server management UX
- **CLI:** config.toml MCP, `/mcps`, doctor/diagnostics
- **Docs:** `07-mcp-servers.md`
- **Import:** Curated presets + enable/persist + doctor; keep desk-browser / desk-desktop

### 31. MCP tool search / use_tool pattern
- **CLI:** `search_tool`, `use_tool` for dynamic MCP tools
- **Import:** Surface tool catalog in task chrome; better prompting for desk MCP names

### 32. Hooks (opt-in, trusted)
- **CLI:** Pre/Post tool hooks, HTTP hooks, folder trust
- **Docs:** `10-hooks.md`
- **Import:** Power-user only; default off in isolated profile; trust modal

### 33. Folder trust model
- **CLI:** `trusted_folders.toml` gates project hooks + repo-local MCP/LSP
- **Import:** Per-workspace trust for Desk connectors and project skills

### 34. Project rules (AGENTS.md)
- **CLI:** AGENTS.md / rules dirs, depth precedence
- **Docs:** `12-project-rules.md`
- **Import:** Auto-load workspace rules into preamble; show “rules loaded” in task

### 35. Import Claude / Cursor assets
- **CLI:** `/import-claude`, skill/command discovery under `.claude` / `.cursor`
- **Import:** Onboarding: “Import skills from Claude Code / Cursor”

### 36. Role packs as plugins
- **Desk:** Marketing / Researcher / Ops / Chief of Staff
- **Import:** Implement packs as marketplace plugins + memory namespace, not just standing text

---

## P3 — Background work, multi-agent IA, scheduling

### 37. Background commands + kill / wait
- **CLI:** background shell tasks, `get_command_or_subagent_output`, `wait_*`, `kill_command_or_subagent`
- **Docs:** `20-background-tasks.md`
- **Import:** Live “running processes” strip on a task

### 38. Monitor tool (event stream)
- **CLI:** `monitor` — each stdout line → conversation notification; persistent monitors
- **Import:** “Watch this log / PR until …” as a task mode

### 39. `/loop` recurring in-session prompts
- **CLI:** interval + prompt; wraps scheduler
- **Import:** “Every 5m check CI” without leaving the conversation

### 40. In-engine scheduler tools
- **CLI:** `scheduler_create` / `list` / `delete`
- **Import:** Bridge to Desk gateway scheduler **or** dual-source “upcoming work” UI

### 41. Agent Dashboard IA
- **CLI:** multi-session overview, needs-you sort, peek, pin, stop, dispatch
- **Docs:** `23-dashboard.md`
- **Import:** Steal IA for Home / multi-task — not the TUI

### 42. Tasks pane patterns
- **CLI:** Ctrl+B tasks pane; subagent + monitor badges
- **Import:** Compact worker + background strip in task workspace

### 43. Parallel top-level agents
- **CLI:** dashboard dispatch multiple agents
- **Import:** Already product goal; align events + limits with CLI capabilities

---

## P4 — Auth, billing, updates, enterprise

### 44. Device-code / headless auth
- **CLI:** `--device-auth` / device-code flow
- **Docs:** `02-authentication.md`
- **Import:** Pair with mobile remote / headless installs

### 45. API key + SuperGrok dual path
- **CLI:** browser OAuth, API key, SSO/OIDC, external providers
- **Import:** Settings: SuperGrok primary + API key fallback (already in design)

### 46. Token refresh + 401 retry
- **CLI:** auth middleware retries with refreshed Bearer
- **Import:** Own refresh in main process if pure-API path; else rely on CLI carefully

### 47. Billing / usage from cli-chat-proxy
- **CLI / rails:** `GET …/v1/billing?format=credits`
- **Desk:** already has `billing-client.ts` against `cli-chat-proxy.grok.com`
- **Import:** Expand product usage meter, soft/hard warnings, manage link

### 48. Remote settings / announcements
- **CLI:** `xai-grok-announcements`, settings from proxy
- **Import:** In-app banners (tips, outages, what’s new) with CTA

### 49. Auto-update channel
- **CLI:** `xai-grok-update`, minimum version enforce
- **Import:** Desk app updater + optional “require grok CLI ≥ x” gate

### 50. External OpenTelemetry
- **CLI:** double opt-in OTEL metrics/events, content-free by default
- **Docs:** `24-monitoring-usage.md`
- **Import:** Enterprise fleet observability for Desk

### 51. Custom models / BYOK / Ollama
- **CLI:** chat_completions / responses / messages backends
- **Import:** Power-user model endpoints; corporate gateway

### 52. Managed / org config
- **CLI:** managed_config / requirements.toml, MDM-style overrides
- **Import:** Team defaults for policy, models, MCP

### 53. Client identity headers
- **CLI:** `x-grok-client-identifier`, conv/session/agent headers on sampler
- **Import:** If pure-API path — legitimate client identity + product approval

---

## P5 — Pure API agent path (optional long-term)

Reimplement sampling + a Desk-owned tool loop instead of spawning CLI.

### 54. Sampling client
- **CLI:** `xai-grok-sampler` — `/chat/completions`, `/responses`, `/messages`
- **Proxy:** `https://cli-chat-proxy.grok.com/v1` (SuperGrok)
- **Import:** Reimplement as `provider-grok-api` with streaming + tool-call intents

### 55. Gateway-mediated tool runtime
- **CLI tools to port first (MVP):**
  - `read_file`, `write` / `search_replace`, `list_dir`, `grep`
  - shell / `run_terminal` (policy-gated)
  - `web_search`, `web_fetch`
  - `todo_write` / goal update
  - existing desk-browser + desk-desktop MCP
  - image/video gen when wire format known
- **Import:** `executesOwnTools = false`; every call audited

### 56. Prompt assembly
- **CLI:** system reminders, skill listing, AGENTS.md, memory injection, compaction
- **Import:** Reimplement subset in gateway runner

### 57. Doom-loop / retry policy
- **CLI:** sampler doom-loop recovery headers/policies
- **Import:** Stop runaway tool loops in Desk

### 58. Feature-detect everything
- **Desk today:** probe version, sandbox, agent stdio
- **Import:** Extend probe for plan, goal, memory, media tools, ACP methods

---

## Slash / tool inventory (checklist)

### Session & conversation
- [ ] `/new` · `/clear`
- [ ] `/resume`
- [ ] `/compact` · `/context` · `/session-info`
- [ ] `/fork` · `/rewind`
- [ ] `/copy` · `/export` · `/rename` · `/title`
- [ ] `/history`

### Model & mode
- [ ] `/model` · model picker
- [ ] `/effort`
- [ ] `/plan` · `/view-plan`
- [ ] `/always-approve` · `/auto` · permission mode cycle
- [ ] `/goal` (status / pause / resume / clear)

### Memory
- [ ] `/remember` · `/memory` · `/flush` · `/dream`

### Extensions
- [ ] `/skills` · `/create-skill`
- [ ] `/plugins` · `/marketplace`
- [ ] `/hooks` · `/hooks-trust`
- [ ] `/mcps`

### Media
- [ ] `/imagine` · `/imagine-video`

### Scheduling / background
- [ ] `/loop`
- [ ] monitor tool
- [ ] scheduler_create / list / delete
- [ ] kill / wait multi-task

### Misc product
- [ ] `/btw` (interject)
- [ ] `/theme` (map to Desk theme, not TUI)
- [ ] `/feedback`
- [ ] `/release-notes` · `/docs`
- [ ] `/import-claude`
- [ ] `/dashboard` patterns
- [ ] `/vim-mode` — **skip** (TUI-only)
- [ ] `/minimal` / fullscreen TUI — **skip**

### Built-in agent tool kinds (from `ToolKind`)
- [ ] Read / Edit / Delete / Write / Move / ListDir / Search
- [ ] Lsp
- [ ] Execute (shell)
- [ ] Plan / EnterPlan / ExitPlan
- [ ] WebSearch / WebFetch
- [ ] BackgroundTask / WaitTasks / KillTask
- [ ] Skill / MemorySearch / MemoryGet
- [ ] Task (subagent)
- [ ] AskUser
- [ ] ImageGen / VideoGen / ImageToVideo / ReferenceToVideo
- [ ] DeployApp (if product-relevant)
- [ ] SearchTool / UseTool (MCP)
- [ ] Monitor / GoalUpdate

### Built-in agent types
- [ ] `general-purpose`
- [ ] `explore` (read-heavy)
- [ ] `plan` (planning, no edits)
- [ ] custom personas / roles

---

## Crates → Desk mapping (cheat sheet)

| Grok Build crate | What it gives Desk |
|------------------|--------------------|
| `xai-grok-sampler` | HTTP sampling APIs |
| `xai-grok-auth` | OAuth/API key, refresh retry |
| `xai-grok-env` | `cli-chat-proxy.grok.com/v1` endpoints |
| `xai-grok-tools` | Full tool implementations |
| `xai-grok-workspace` | FS/VCS, checkpoints, rewind |
| `xai-hunk-tracker` | Accept/reject edit hunks |
| `xai-grok-sandbox` | OS sandbox profiles |
| `xai-grok-memory` | Cross-session memory + dream |
| `xai-grok-mcp` | MCP host integration |
| `xai-grok-hooks` | Lifecycle hooks |
| `xai-grok-plugin-marketplace` | Plugin install/browse |
| `xai-grok-subagent-resolution` | Agent/persona resolution |
| `xai-fast-worktree` | Safe isolated worktrees |
| `xai-codebase-graph` | Go-to-def/refs (repo tasks) |
| `xai-grok-mermaid` | Diagram → PNG |
| `xai-grok-voice` | Streaming STT (Desk has STT path) |
| `xai-interjection-core` | Mid-run asides |
| `xai-grok-compaction` | Context compression |
| `xai-prompt-queue` | Queued prompts |
| `xai-computer-hub-*` | Computer-use hub (align with Desk desktop-use) |
| `xai-system-power` | Sleep/wake notifications |
| `xai-grok-announcements` | Server banners |
| `xai-grok-update` | Version/update policy |
| `xai-acp-lib` | ACP protocol types |
| `xai-grok-shell` | Agent runtime entrypoints |
| `xai-grok-pager` | TUI only — steal *concepts*, not UI |

---

## Suggested implementation waves

### Wave 1 — Make the current engine honest
1. Sandbox flags when supported
2. Correct policy → permission rules (fail closed)
3. ACP path default-capable
4. Session resume / continue
5. Plan mode UI
6. Interjection / nudge
7. Goal progress binding
8. Sleep-safe token refresh

### Wave 2 — Grok differentiation
9. Imagine + video artifacts
10. Memory flush / dream
11. Rewind + hunk review
12. Real subagent HUD
13. Mermaid in chat
14. Full effort/model catalog

### Wave 3 — Ecosystem
15. Skills multi-root + create-skill
16. Plugin marketplace
17. MCP presets + doctor
18. Project rules visibility
19. Optional hooks + folder trust

### Wave 4 — Always-on coworker power
20. Monitor + loop
21. Dashboard IA for multi-task
22. Announcements
23. OTEL / managed config (enterprise)

### Wave 5 — Own the agent (optional)
24. `provider-grok-api` MVP (stream + mediated fs tools)
25. Expand tool surface under gateway
26. Deprecate headless spawn for most tasks

---

## Explicitly deprioritize (TUI / low Desk value)

- Vim mode / scrollback keybindings
- Terminal truecolor / tmux troubleshooting
- Ratatui themes as product themes (map to Desk design system instead)
- Full reimplementation of pager chrome
- Shipping unrestricted project hooks by default
- Becoming a multi-pane coding IDE (Desk non-goal)

---

## Product language translation

| CLI | Desk |
|-----|------|
| `/plan` | Draft a plan first |
| `/btw` | Nudge while working |
| `/goal` | Task objective + progress |
| `/loop` + monitor | Watch until done |
| Rewind / hunks | Undo / review changes |
| `/dream` | Learn from this week |
| Marketplace | Install a skill pack |
| Sandbox | Safe workspace mode |
| Dashboard | Multi-task Home |
| `/always-approve` | Autopilot |
| Permission ask | Waiting on you |

---

## References

- Local clone: `/tmp/grok-build`
- User guide: `/tmp/grok-build/crates/codegen/xai-grok-pager/docs/user-guide/`
- Desk design: `docs/superpowers/specs/2026-07-10-grok-desk-design.md`
- Engine adapter: `packages/engine-grok/`
- ACP provider: `packages/provider-grok/`
- Policy flags: `packages/shared/src/policy-to-grok-flags.ts`
- Hardening notes: `codex_improve.md`

---

## Status legend (for tracking)

| Status | Meaning |
|--------|---------|
| **todo** | Not started |
| **partial** | Some Desk support exists |
| **done** | Parity / product-ready |

Fill in as work lands. Default for almost everything above: **todo** or **partial**.

| Area | Status |
|------|--------|
| Headless spawn + streaming-json | partial |
| SuperGrok auth bridge | partial |
| Billing usage HTTP | partial |
| STT / dictation | partial |
| Isolated GROK_HOME | partial |
| Skills paths inject | partial |
| MCP config inject | partial |
| desk-browser / desk-desktop | partial |
| ACP mediation | partial |
| Sandbox | todo |
| Plan / goal / interject | todo |
| Memory dream/flush | todo |
| Rewind / hunks | todo |
| Marketplace | todo |
| Pure API agent | todo |
