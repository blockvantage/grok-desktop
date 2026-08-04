# Grok Desk — Product Design Spec

**Date:** 2026-07-10  
**Status:** Draft for review  
**Working name:** Grok Desk  
**Platforms:** macOS and Windows (first-class parity from day one)

## 1. Summary

Grok Desk is a SuperGrok-powered **desktop coworker**: a knowledge-work agent (Claude Cowork class) that runs on the user’s machine, uses the full Grok capability surface, supports **parallel and scheduled tasks**, and includes an **always-on** layer with local memory and proactive desktop nudges.

It is **not** primarily a coding IDE. Code execution and shell are tools the coworker may use when needed; the UX is goal → progress → artifacts, with no terminal required of the user.

### One-liner

> SuperGrok subscription in, Cowork-class agency out — parallel tasks, schedules, memory, and desktop proactivity on Mac and Windows.

## 2. Goals and non-goals

### Goals

| Goal | Detail |
|------|--------|
| SuperGrok auth | Sign in with SuperGrok / X Premium+ subscription (OAuth / session), not API-key-first |
| Knowledge-work Cowork | Folder-scoped multi-step work: research, writing, marketing, ops, file organization |
| Full Grok surface | Models, effort/reasoning, web + X search, code execution, Imagine, vision, MCP, skills, multi-agent/Heavy where available |
| Parallel tasks | Multiple concurrent Cowork sessions with a clear task switcher |
| Scheduled work | Cron and natural-language recurrence; quiet hours; missed-run policy |
| Always-on coworker | Local memory/identity + proactive loop + in-app inbox |
| Desktop-only reach | Menu bar (macOS) / system tray (Windows), OS notifications, in-app inbox — no Slack/Telegram/email v1 |
| Host execution | Agent runs tools on the host with strong policy guardrails (not VM-required for v1) |
| Cross-platform | **macOS and Windows are equal product targets**; same features, shared codebase |
| No-code UX | Users never need to open a terminal or write code |

### Non-goals

- Multi-channel messaging bridges (Slack, Telegram, iMessage, email digests) in the initial product surface
- Cloud-hosted agent control plane (local-first gateway)
- Primary product as a multi-pane coding IDE (Claude Code Desktop clone)
- Guaranteeing a full VM sandbox on day one (optional harder sandbox is a later stage)
- Replacing grok.com chat for casual Q&A

## 3. Product principles

1. **Coworker, not chatbot** — Tasks, deliverables, and “waiting on you” states are first-class.
2. **Subscription-native** — SuperGrok login is the happy path; API key is a power-user fallback only.
3. **Power with brakes** — Host shell is allowed; allowlists, approvals, audit, and kill-switch are mandatory.
4. **One brain, many runs** — Memory, policy, and schedule live in a local gateway shared by all tasks.
5. **Platform parity** — Feature that ships on Mac ships on Windows in the same release train.
6. **Grok-differentiated** — Lead with X search, Imagine, Heavy/multi-agent, and less-filtered Grok personality where appropriate — not a generic Electron chat wrapper.

## 4. User surfaces

### 4.1 Main window (Electron)

| Surface | Purpose |
|---------|---------|
| **Home** | Briefing, inbox highlights, suggested next actions |
| **Tasks** | Primary Cowork workspace (list + active task) |
| **Schedule** | Upcoming and past scheduled runs; create/edit rules |
| **Memory** | View/edit profile, projects, brand kit, preferences, episodic summaries |
| **Skills & Connectors** | Skills packs, MCP servers, Grok server-side tools toggles |
| **Settings** | Auth, defaults (model/effort/approval), workspace roots, quiet hours, advanced |

### 4.2 Task workspace (three-pane, Cowork-class)

- **Left:** Task list (active / scheduled / done), filters, “New task”
- **Center:** Goal thread, live step/tool stream, clarifications
- **Right:** Progress, allowlisted folders, connectors, working files, artifacts
- **Bottom chrome:** Model selector, effort control, approval mode indicator, stop/pause

### 4.3 Desktop chrome (cross-platform)

| Capability | macOS | Windows |
|------------|-------|---------|
| Background presence | Menu bar extra | System tray icon |
| Status | Idle / working (N) / needs you / paused / reauth | Same |
| Quick capture | Menu / popover | Tray menu / flyout |
| Pause all | One click kill-switch | Same |
| Notifications | User Notifications | Windows Toast notifications |
| Deep link | `grokdesk://…` | Same custom protocol |

### 4.4 Role packs (same UI, different defaults)

One-click packs that configure skills, connectors, and memory namespace — not separate apps:

- Marketing Agent  
- Researcher  
- Ops / file organizer  
- Personal Chief of Staff  

## 5. Architecture

### 5.1 High-level

```
┌─────────────────────────────────────────────────────────────┐
│                 ELECTRON SHELL (macOS + Windows)             │
│     Home · Tasks · Schedule · Memory · Settings · Inbox      │
│     Tray/menu bar · notifications · deep links               │
└────────────────────────────┬────────────────────────────────┘
                             │ typed IPC / local RPC
┌────────────────────────────▼────────────────────────────────┐
│              LOCAL GATEWAY DAEMON (same process tree)        │
│  Sessions · Scheduler · Memory · Proactivity · Policy · Audit│
│  SQLite + embeddings · secret vault (OS credential store)    │
└───────┬──────────────────────┬──────────────────┬───────────┘
        │                      │                  │
        ▼                      ▼                  ▼
┌───────────────┐    ┌─────────────────┐   ┌────────────────┐
│ Engines       │    │ Tool bus        │   │ OS integration │
│ Grok Build    │    │ MCP · skills    │   │ notify · tray  │
│ (primary)     │    │ host fs/shell   │   │ paths · keytar │
│ future API    │    │ Grok tools      │   │                │
└───────────────┘    └─────────────────┘   └────────────────┘
```

### 5.2 Component responsibilities

| Component | Responsibility |
|-----------|----------------|
| **Electron main** | Window lifecycle, tray, notifications, protocol handler, spawn/supervise gateway |
| **Electron renderer** | All product UI (React or equivalent) |
| **Gateway** | Durable state, policy, orchestration, proactivity, engine sessions |
| **Shared package** | Types, IPC contracts, policy evaluation pure functions |
| **Engine adapter** | Talks to Grok Build (ACP and/or headless); normalizes events |

### 5.3 Repository layout (monorepo)

```
apps/desktop/          # Electron main + preload + renderer
packages/gateway/      # Local control plane
packages/shared/       # Types, IPC schemas, policy pure logic
packages/engine-grok/  # Grok Build adapter
docs/                  # Specs and plans
```

**Language default:** TypeScript throughout (shared types, faster iteration). Native modules only where needed (keytar, optional filesystem watchers).

### 5.4 Why this architecture

- SuperGrok subscription path is already embodied by **Grok Build**; reimplementing the full agent loop + OAuth is higher risk and slower.
- Always-on memory, schedule, and multi-task policy need a **gateway** that outlives a single renderer window.
- Engine adapter boundary allows future API-key or multi-model engines without rewriting UI.
- Single TS monorepo supports **Mac and Windows** packaging via Electron Builder with shared gateway logic.

## 6. Auth

### 6.1 Primary: SuperGrok OAuth / session

- User signs in through the same class of flow Grok Build uses (browser/device OAuth → local session).
- Gateway stores tokens/session material in the **OS credential store**:
  - macOS: Keychain  
  - Windows: Credential Manager  
  via a cross-platform secret API (e.g. keytar or OS-native wrappers).
- UI shows signed-in account, plan hints if available, re-auth, sign-out.
- Gateway surfaces a clear `needs_reauth` state to tray + Home.

### 6.2 Secondary: API key (optional)

- Settings allow an xAI API key for fallback/headless experiments.
- Never the default onboarding path.
- Stored only in OS credential store.

### 6.3 Session lifecycle

1. First launch → onboarding (auth → policy wizard → optional role pack)  
2. Token refresh handled by gateway in background  
3. Auth failure → pause new scheduled/proactive runs; notify user  

## 7. Tasks (Cowork core)

### 7.1 Task model

| Field | Description |
|-------|-------------|
| `id` | Stable UUID |
| `goal` | Natural language definition of done |
| `mode` | `interactive` \| `scheduled` \| `proactive` |
| `status` | `queued` \| `running` \| `waiting_approval` \| `waiting_user` \| `blocked` \| `done` \| `failed` \| `cancelled` |
| `attachments` | Folder/file paths, URLs, prior artifact refs |
| `policySnapshot` | Frozen allowlist, approval mode, network rules at start |
| `model` | Selected Grok model id |
| `effort` | Fast \| Normal \| Heavy (or numeric/API equivalent) |
| `skills` / `mcp` | Enabled set |
| `rolePack` | Optional pack id |
| `projectId` | Optional grouping |
| `parentTaskId` | For sub-agent children |
| `createdAt` / `updatedAt` / `completedAt` | Timestamps |
| `scheduleRuleId` | If spawned by scheduler |

### 7.2 Events and streaming

Append-only `TaskEvent` stream:

- `message` (user / assistant)  
- `step` (plan step start/end)  
- `tool_request` / `tool_result`  
- `approval_required` / `approval_resolved`  
- `artifact_created`  
- `status_change`  
- `error`  

Renderer subscribes via IPC; reconnect replays from last sequence id.

### 7.3 Parallelism

- Configurable max concurrent running tasks (default 3–5).  
- Queue excess as `queued`.  
- Each task = one engine session under gateway policy.  
- Global **Pause all** freezes runners and scheduler triggers.

### 7.4 Artifacts

| Type | Examples |
|------|----------|
| File | Written into allowlisted workspace |
| Report | Markdown/HTML/PDF generated deliverable |
| Media | Imagine image/video outputs |
| Card | Structured summary with open/reveal actions |

Cross-task artifact browser; pin to projects; “Reveal in Finder” / “Show in Explorer”.

## 8. Execution engine

### 8.1 Primary engine: Grok Build

- Discover or bundle Grok Build CLI on both platforms.
- Prefer structured protocol (ACP if available; else headless JSONL/stdio).
- Adapter responsibilities:
  - Start/stop session per task  
  - Inject system preamble (memory slices, policy, project rules)  
  - Stream normalized events  
  - Map model/effort settings into engine flags  
  - Surface tool calls for policy interception where the protocol allows  

### 8.2 Sub-agents / Heavy

- When SuperGrok/Heavy multi-agent is available through the engine, expose as effort/mode and UI “parallel specialists.”  
- Fallback: gateway spawns child tasks with specialist role prompts (research, writer, critic, file-ops) and merges results.

### 8.3 Engine failure modes

- Missing CLI → install guidance UI (platform-specific install steps)  
- Crash mid-task → mark `failed` or `blocked` with resume option  
- Version skew → compatibility check at launch  

## 9. Tools and Grok capabilities

The product must make these **visible and usable** from Cowork (not buried):

| Capability | Product exposure |
|------------|------------------|
| Web search | Research + citations in artifacts |
| X search | Live market/competitor/social signal |
| Code execution | Spreadsheets, transforms, automation *for* the user |
| Filesystem | Read/write under allowlisted roots |
| Host shell | Approval-gated by policy mode |
| MCP | User-configured servers; per-task enable |
| Skills | SKILL.md packs + role packs |
| Imagine | Image/video deliverables as artifacts |
| Vision | Screenshots, PDFs, brand boards as inputs |
| Model selection | From models available to the session |
| Effort | Fast / Normal / Heavy (map to engine/API) |
| Collections / knowledge | If session supports file/collections tools |

### 9.1 Host tools (cross-platform)

Abstract filesystem and shell behind platform adapters:

- Paths: normalize to absolute; never assume POSIX-only in UI copy  
- Shell: `zsh`/`bash` on macOS; PowerShell (preferred) or `cmd` on Windows — engine/tool layer picks safe defaults  
- “Reveal”: `open -R` vs `explorer /select,`  

## 10. Policy engine (host shell safety)

Host execution without a VM requires **policy as a product feature**.

### 10.1 Workspace roots

- Global default roots (user-configured).  
- Per-task additional roots.  
- Deny access outside roots unless user elevates with explicit approval.

### 10.2 Approval modes

| Mode | Behavior |
|------|----------|
| **Strict** | Confirm every write, shell, and external side-effect |
| **Balanced (default)** | Confirm shell, deletes, path escapes, network posts / sends |
| **Autopilot** | No interactive confirms for that task; still fully audited — must be explicit per task or schedule |

### 10.3 Other controls

- **Network policy:** allow Grok server tools; optional blocklists  
- **Kill switch:** Pause all from tray/menu bar  
- **Audit log:** append-only local log of tool calls, approvals, denials  
- **Secrets:** OS credential store; prefer “use secret by id” over injecting raw secrets into prompts  

### 10.4 First-run policy wizard

Mandatory onboarding:

1. Choose default approval mode  
2. Pick default workspace folders  
3. Confirm understanding of host-access risks  
4. Optional: enable Autopilot only for scheduled tasks (off by default)

### 10.5 Future: hard sandbox backend

Same UI; optional Docker/VM engine for high-risk tasks. Not required for initial “whole product” definition but architected as a second engine adapter.

## 11. Scheduler

### 11.1 Rules

| Field | Description |
|-------|-------------|
| `id` | UUID |
| `name` | Human label |
| `goalTemplate` | Goal text (may include memory placeholders) |
| `cron` / recurrence | Cron expression or structured recurrence |
| `timezone` | User timezone (critical for Mac/Windows portability) |
| `policyProfileId` | Approval/roots defaults for spawned tasks |
| `model` / `effort` | Defaults |
| `enabled` | Boolean |
| `quietHoursRespect` | Boolean |

### 11.2 Behavior

- Natural language → recurrence compiler (e.g. “every Monday 9am”).  
- On fire: create Task with `mode=scheduled` and frozen policy snapshot.  
- Missed runs: user preference `run_on_wake` vs `skip`.  
- Quiet hours: suppress start + proactive notifications.  

### 11.3 Triggers (full product)

1. Time (cron)  
2. Manual “Run now”  
3. Optional file-watch on a folder (phase within scheduler stage)  
4. Optional local webhook later (not required for parity MVP of scheduler)

## 12. Memory and identity

### 12.1 Stores

| Store | Contents |
|-------|----------|
| Profile | Working style, tone, constraints |
| Projects | Initiatives, status, goals |
| Brand kit | Voice, claims, offers, asset paths |
| Preferences | Model, effort, approval, roots |
| Episodic | Task summaries (not full transcripts by default) |
| Working (NOW) | Current focus scratchpad |
| Standing instructions | User-approved long-lived rules |

### 12.2 Implementation

- SQLite for structured rows.  
- Local embeddings index for retrieval (privacy-first default).  
- Optional remote embeddings later if user opts in.  

### 12.3 Injection

Per task, gateway retrieves a **bounded** relevant slice (token budget) + always-include standing instructions. No dumping entire memory into every run.

### 12.4 User control

Full UI to list, edit, delete, export/import memory. “Forget this project” removes project namespace.

## 13. Proactivity (always-on, desktop-only)

### 13.1 Loop

Background job in gateway (default: hourly when machine awake and not in quiet hours):

1. Load NOW, unfinished tasks, upcoming schedules, recent failures  
2. Optional cheap model call: “Is a nudge warranted?”  
3. Create `InboxItem`s; optionally fire OS notification  

### 13.2 Inbox item types

- Approval waiting  
- Task needs clarification  
- Unfinished deliverable  
- Schedule completed — review artifact  
- Suggested next action  
- Reauth required  
- Engine/CLI unhealthy  

### 13.3 Tray / menu bar behavior

- Reflect aggregate status  
- Quick capture → task or memory note  
- Pause all / Resume  
- Open inbox / Open last needs-you task  

## 14. Cross-platform requirements (Mac + Windows)

### 14.1 Parity rules

- Same feature set on both OS for every release that ships a feature.  
- Platform-specific **implementation** is allowed; platform-specific **capability gaps** are not (except OS-imposed limits).  
- CI: build and smoke-test on macOS and Windows.

### 14.2 Platform matrix

| Concern | macOS | Windows |
|---------|-------|---------|
| Packaging | `.dmg` / `.zip` (signed + notarized when ready) | `.exe` installer / portable (signed when ready) |
| Auto-update | Electron updater | Electron updater |
| Secrets | Keychain | Credential Manager |
| Notifications | User Notifications | Toast |
| Background UI | Menu bar | System tray |
| Default data dir | `~/Library/Application Support/GrokDesk/` | `%APPDATA%\GrokDesk\` |
| Logs | `~/Library/Logs/GrokDesk/` | `%LOCALAPPDATA%\GrokDesk\logs\` |
| Shell default | zsh/bash | PowerShell |
| Path UX | POSIX display OK | Show Windows paths correctly; never break on spaces/`\` |
| Grok Build | Install/discover Windows + Mac binaries | Same |
| File watch / reveal | FSEvents / Finder | ReadDirectoryChanges / Explorer |
| Autostart (optional) | Login item | Startup folder / registry Run key |

### 14.3 Testing obligations

- Unit tests OS-agnostic in `packages/*`  
- Integration tests with path fixtures for both separators  
- E2E smoke: auth mock, create task, approval gate, artifact path open — on both OS in CI (or at least nightly on both)  

## 15. Key user flows

### 15.1 Interactive Cowork

1. New task → goal + folders + model/effort  
2. Gateway builds context (memory + skills + policy)  
3. Engine runs; tools pass policy  
4. Approvals → notification + waiting state  
5. Artifacts written; episodic summary stored  

### 15.2 Scheduled marketing pack

1. User creates “Monday 9am competitor scan” with Marketing pack + X/web  
2. Cron fires → task runs under chosen approval mode  
3. On done → toast + inbox “Review competitor pack”  
4. Artifacts in project folder  

### 15.3 Proactive nudge

1. Loop sees campaign brief task stuck `waiting_user` for 24h  
2. Inbox + notification  
3. One click focuses task and restores context  

### 15.4 First-run (both OS)

1. Sign in SuperGrok  
2. Policy wizard  
3. Optional role pack  
4. Sample task template (“Organize Downloads” with explicit root)  

## 16. Data model (persistence)

Core tables / collections:

- `sessions` (auth metadata pointers, not raw secrets)  
- `tasks`, `task_events`, `artifacts`  
- `schedule_rules`, `schedule_runs`  
- `memory_items` (+ embedding index)  
- `inbox_items`  
- `policy_profiles`  
- `connectors`, `skill_installs`  
- `audit_entries`  
- `projects`  

**Backup:** export/import zip of data dir (excluding secrets; re-auth after import).

## 17. Security model

| Threat | Mitigation |
|--------|------------|
| Prompt injection via web/X/files | Untrusted content isolation/summarization; high-impact actions always policy-gated |
| Host shell blast radius | Roots, approvals, audit, pause-all, concurrency caps |
| Credential theft | OS stores only; no secrets in SQLite plaintext or logs |
| Memory poisoning | User-editable memory; provenance fields |
| Runaway agents | Step budgets where available; hard kill; max concurrency |
| Cross-user machine | Single OS-user data isolation; standard file permissions |

Onboarding copy must state clearly: **host mode can modify anything the OS user can, subject to policy you configure.**

## 18. Observability and supportability

- Structured logs (redact secrets)  
- Per-task debug export (events + policy snapshot)  
- “Copy diagnostics” for issues (OS version, engine version, app version)  
- Crash recovery: restart gateway; reattach or mark orphaned engine processes  

## 19. Build stages (full product construction order)

Time is not constrained; order reflects dependencies. **Every stage is delivered for macOS and Windows.**

| Stage | Deliverable |
|-------|-------------|
| **S0 Foundations** | Monorepo, Electron shell both OS, gateway process, IPC, SQLite, config, logging, tray stubs |
| **S1 Auth** | SuperGrok session via Grok Build bridge; OS secret storage; reauth UX both OS |
| **S2 Single task path** | Create task → engine stream → basic artifact write |
| **S3 Policy** | Allowlists, approval UI, audit log, Pause all |
| **S4 Full Cowork UI** | Three-pane UX, model/effort, skills/MCP management |
| **S5 Parallelism** | Multi-task manager, caps, switcher |
| **S6 Artifacts & projects** | Browser, project grouping, Reveal in Finder/Explorer |
| **S7 Scheduler** | Cron + NL recurrence, quiet hours, timezone-correct on both OS |
| **S8 Memory** | Stores, retrieval injection, Memory UI |
| **S9 Proactivity** | Loop, inbox, notifications, tray quick capture |
| **S10 Role packs** | Marketing / Research / Ops / Chief of Staff |
| **S11 Grok depth** | Imagine pipeline UX, X/web result surfacing, Heavy/sub-agent UX |
| **S12 Hardening** | Injection tests, export/import, crash recovery, signing pipeline, CI both OS |
| **S13 Optional hard sandbox** | Docker/VM engine adapter for high-risk tasks |

### Definition of done (whole product)

On **both macOS and Windows**, a SuperGrok user can:

1. Sign in without an API key  
2. Run parallel Cowork tasks with full Grok tools and model/effort controls  
3. Schedule recurring work  
4. Rely on local memory and desktop proactive inbox/notifications  
5. Operate under clear host policy with audit and kill-switch  
6. Use Marketing (and other) role packs for real knowledge-work deliverables  

## 20. Testing strategy

| Layer | Scope |
|-------|-------|
| Unit | Policy, recurrence parsing, memory retrieval ranking, path normalization |
| Integration | Gateway + fake engine fixture; task lifecycle; scheduler fire |
| E2E | Electron smoke both OS: task, approval, artifact path |
| Security | Prompt-injection fixtures vs policy |
| Dogfood | Weekly marketing + file-ops scenarios on Mac and Windows |

## 21. Open engineering decisions (defaults locked for plan)

| Decision | Default |
|----------|---------|
| Gateway language | TypeScript (same monorepo as Electron) |
| UI framework | React + TypeScript in Electron renderer |
| Engine | Grok Build primary adapter |
| Embeddings | Local-first |
| Packaging | electron-builder, dual-target CI |
| State DB | SQLite |

These can change only with an ADR if evidence demands it.

## 22. Naming

- **Product:** Grok Desk (working; final marketing name TBD)  
- **Protocol:** `grokdesk://`  
- **Data dir:** `GrokDesk`  
- **Binary/CLI companion:** none required for users; Grok Build is dependency  

## 23. Out of scope for this spec (track separately)

- Mobile companion  
- Team multiplayer / shared org memory  
- HIPAA/enterprise compliance packaging  
- Multi-channel messaging  
- Full computer-use (mouse/keyboard GUI control) as primary driver  

## 24. Success metrics (qualitative)

- Daily driver replaces ad-hoc Claude Cowork / terminal Grok Build for knowledge work  
- User trusts scheduled + autopilot for at least one recurring workflow  
- Proactive inbox produces actionable nudges weekly without spam  
- No catastrophic unapproved destructive actions in dogfood (policy holds)  

## 25. Changelog

| Date | Change |
|------|--------|
| 2026-07-10 | Initial full design from brainstorm; macOS + Windows first-class parity required |

---

## Appendix A — Competitive positioning (context)

| Product | Relation |
|---------|----------|
| Claude Cowork | UX and job-to-be-done north star; Grok models + X/Imagine differentiation |
| Grok Build | Primary execution engine and SuperGrok auth path |
| OpenHands / Open Interpreter / CodePilot | Architecture references for multi-agent desktop control planes |
| Vellum / OpenClaw | Memory + proactivity references; we stay desktop-only for reach |

## Appendix B — Risk register

| Risk | Mitigation |
|------|------------|
| SuperGrok OAuth not officially exposed to third-party apps | Prefer official Grok Build session bridge; document TOS; avoid brittle web scrape auth |
| Grok Build protocol instability | Adapter isolation; version pins; contract tests |
| Host shell incidents | Policy defaults strict-to-balanced; audit; no global autopilot default |
| Windows path/shell edge cases | Early Windows CI; path fuzzer tests |
| Scope creep into IDE | Keep Tasks UX deliverable-centric; no editor-first navigation |
