# Grok Desk Implementation Plan — Thoughtful Review

**Date:** 2026-07-10  
**Reviewed:** `docs/superpowers/plans/2026-07-10-grok-desk-implementation-plan.md`  
**Against:** `docs/superpowers/specs/2026-07-10-grok-desk-design.md`  
**Branch:** `feat/grok-desk`  
**Live Grok CLI probed:** `/Users/maceo/.grok/bin/grok` (Grok Build TUI)

---

## 1. Executive verdict

| Dimension | Rating | Notes |
|-----------|--------|-------|
| Product alignment with design | **Strong** | Stages S0–S13 map cleanly; Cowork + schedule + always-on covered |
| Early-task executability (1–10) | **Strong** | Real TDD, types, policy, SQLite, fake engine, Electron shell |
| Late-task executability (11–25) | **Weak** | Sketches, not implementable specs; violates plan’s own “no placeholders” bar |
| Architecture realism vs Grok Build | **Needs revision** | Plan invents a host-side tool interceptor that real Grok Build may bypass |
| SuperGrok auth path | **Needs revision** | CLI is `grok login` / `logout`, not `grok auth`; rich flags exist (`--oauth`, permission modes, sandbox) |
| Cross-platform readiness | **Medium** | Paths/tray/CI mentioned; native modules + Electron packaging under-specified |
| Parallel build readiness | **Medium** | Sequential numbering hides a clear DAG; must reorganize into waves |
| Safety / host shell | **Good foundation** | Policy pure functions are solid; missing real-engine enforcement story |

**Bottom line:** Shipable as a backbone plan for **Wave 0–2 (scaffold → offline Cowork path)**. Tasks 11–25 must be expanded or re-derived during execution. The single most important design correction: **treat Grok Build as the tool executor**, and map Grok Desk policy → Grok `--permission-mode` / `--allow` / `--deny` / `--sandbox` / workspace `--cwd`, instead of re-implementing every tool call in our runner.

---

## 2. What the plan gets right

### 2.1 Product decomposition
- Hybrid **Electron + gateway + engine adapter** matches the approved design.
- **FakeEngine first** is correct: UI, policy, and task lifecycle can dogfood without live SuperGrok.
- **Shared pure policy + paths** package enables unit tests without Electron.
- **Domain types + zod IPC** early prevents renderer/gateway drift.
- **Pause-all / approval / audit** appear before polish features — right priority for host shell.
- **Role packs as data**, not separate apps — matches design.
- **macOS + Windows** called out as parity, not afterthought in CI matrix.

### 2.2 Engineering hygiene
- pnpm workspaces, strict TS, vitest, electron-builder dual targets.
- SQLite WAL + explicit schema for tasks/events/memory/schedule/inbox/audit.
- Explicit data dirs per OS.
- Kill-switch and tray status model in types.

### 2.3 Buildability of Tasks 1–9
These are agent-ready: file paths, failing tests, implementations, commits. A subagent can execute them with low ambiguity.

---

## 3. Critical gaps and risks

### 3.1 Architecture: tool ownership (P0)

**Problem:** Task 8’s `TaskRunner` evaluates policy and executes `write_file` itself. Real Grok Build (`grok agent`, permission modes, sandbox) **already executes tools** inside the agent process.

If we keep dual execution:
- Double-writes / race conditions  
- Policy that only gates our FakeEngine path, not real damage from Grok Build  
- False sense of security  

**Required correction:**

| Mode | Who runs tools | How Grok Desk policy applies |
|------|----------------|------------------------------|
| FakeEngine (dev/test) | Gateway runner | `evaluateToolRequest` as written |
| GrokBuildEngine (prod) | Grok Build CLI | Map policy → `--cwd` (workspace), `--permission-mode`, `--allow`/`--deny`, `--sandbox`, optional `--always-approve` only for autopilot |
| Future Docker sandbox | Containerized Grok or host | Mount only roots; network policy |

**Runner becomes an orchestrator:** spawn session, stream events, surface approval UI when Grok pauses for permissions, persist events/artifacts — **not** a second shell.

### 3.2 Auth CLI mismatch (P0)

Plan says `grok auth status` / `grok auth login`. Live CLI exposes:

```
grok login
grok logout
grok --oauth          # OAuth on welcome auth
grok models
grok agent            # headless agent (no interactive UI)
grok -p / --single    # single-turn
--output-format plain|json|streaming-json
--permission-mode default|acceptEdits|auto|dontAsk|bypassPermissions|plan
--sandbox <PROFILE>
--reasoning-effort / --effort
--model
--always-approve
--experimental-memory / --no-memory
grok mcp …
```

**Correction for Tasks 13–14:**
- Sign-in: `grok login` (prefer `--oauth` where applicable)
- Sign-out: `grok logout`
- Headless task run: `grok agent` with `--output-format streaming-json` (verify payload shape empirically)
- Model/effort: `--model`, `--reasoning-effort`
- Autopilot: map to `--permission-mode bypassPermissions` or `--always-approve` **only** when user chose Autopilot
- Balanced/Strict: map to `default` / `acceptEdits` / `plan` after dogfooding — document chosen mapping in ADR

### 3.3 Grok Build already has memory & MCP (P1)

CLI has `grok memory`, `--experimental-memory`, `grok mcp`. Plan rebuilds both in gateway.

**Positioning (do not delete product memory):**
- **Grok Build memory** = agent session/cross-session coding memory  
- **Grok Desk memory** = product identity layer (brand kit, projects, NOW, standing instructions, episodic *task* summaries for UI)

Injection path: Desk memory → `--system-prompt-override` append or `--rules`, not a competing store inside Grok’s DB.

MCP: prefer configuring via Grok’s MCP system when using GrokBuildEngine; Desk UI can manage configs that we pass through.

### 3.4 Detail collapse after Task 10 (P0 for later waves)

Tasks 11–25 often say “implement X” without tests, component trees, or IPC extensions. Examples:
- Task 11: three-pane UI without state machine for approvals  
- Task 14: “prefer ACP” — live CLI evidence points to **`streaming-json` + `grok agent`**, not ACP  
- Task 17: `schedule_runs` migration mentioned casually; no schema  
- Task 19: proactivity “optional model call” from design reduced to heuristics only  
- Task 21–22: thin  

**Mitigation while building:** each wave starts with a 15-minute “task expansion” by the controller (or a plan-writer subagent) before implementers run. Do not hand sketch tasks to implementers raw.

### 3.5 Electron + native modules (P0 operational)

`better-sqlite3` and `keytar` require native compile **against Electron’s Node ABI**, not system Node.

Plan never mentions:
- `electron-rebuild` / `@electron/rebuild`  
- packaging `asarUnpack` for `.node` binaries  
- Windows build tools (VS Build Tools)  

Without this, `pnpm dev` works until gateway loads in Electron main, then crashes.

**Correction:** Task 10 must include rebuild script:

```json
"postinstall": "electron-builder install-app-deps"
```

or explicit rebuild after install. Prefer running gateway in a **utility process / child process** on system Node to avoid ABI hell — recommended architecture tweak:

```
Electron main (thin) --IPC--> gateway child (Node, better-sqlite3 native)
```

Still matches design “local gateway daemon”; slightly clearer process boundary.

### 3.6 Event transport: poll-only (P1)

Renderer polls every 500ms–1s. Works for v1 but:
- Battery / CPU waste  
- Approval latency  
- Racey UI  

**Add:** main process `webContents.send('grokdesk:event', …)` when gateway appends events; preload subscribe API. Keep poll as reconnect fallback.

### 3.7 No-code UX hole: path entry (P1)

Task 10 UI asks for absolute path strings. Design requires non-developers.

**Must have by Task 11:** `dialog.showOpenDialog({ properties:['openDirectory'] })` via main IPC for workspace roots.

### 3.8 Concurrency bugs in sketched runner (P1)

```ts
const promise = this.runTask(taskId).finally(...)
this.running.set(taskId, promise)
await promise  // start() waits for full completion
```

`pumpQueue` uses `void this.start()` — OK — but `start` early-returns if at cap without queueing wakeups beyond `finally`. Need explicit queue structure and tests for:
- pause mid-approval  
- reject approval  
- cancel running task (engine cancel)  
- crash recovery orphan sessions  

### 3.9 Policy product decisions (P2)

- **Strict mode requires approval for reads** — correct for paranoid, terrible default UX if user ever picks strict. Keep, but onboarding should warn.
- **Balanced allows writes without approval** — good for Cowork speed; deletes/shell need approval — good.
- **Network tool** is a stub — real Grok web/X tools won’t appear as `tool: "network"`; events will be engine-specific. Normalization layer must map real tool names.

### 3.10 Schema / migrations (P1)

Single `MIGRATION_V1` string, no versioned migrator. `schedule_runs`, embedding tables, settings evolution will break installs.

**Add** in Task 6 (or immediately after): `migrations/` table + ordered SQL files.

### 3.11 Security design leftovers (P1)

Design requires:
- First-run policy wizard  
- Network allowlists  
- Secret isolation from model context  
- Prompt-injection handling for web/X content  

Plan covers wizard late (Task 13), injection tests only Task 24, secrets only keytar wrapper (no “secret by id” tool path). Acceptable phasing if S12 is real; don’t ship Autopilot schedules before wizard + audit UI.

### 3.12 Missing product pieces vs design

| Design item | Plan status |
|-------------|-------------|
| Projects grouping | DB table only; almost no UI tasks |
| Folder allowlist UX | Weak |
| Quiet hours UI | Mentioned in scheduler only |
| Cost/usage display | Absent (may be OK if CLI doesn’t expose) |
| Imagine / video pipeline | Task 22 one-liner |
| Sub-agent tree UI | One-liner |
| Windows signing / notarization | “document only” — OK |
| Computer-use | Correctly out of scope |
| Gateway language TS | OK |
| Push notifications deep link to task | Partial (protocol Task 23 late) |

### 3.13 File tree drift

- `policy-service.ts` listed, never implemented (logic in shared — delete from tree or implement thin wrapper).
- `store.ts` listed, unused.
- Icons/resources never generated — tray may be invisible on macOS (empty `nativeImage`).

### 3.14 Testing strategy gaps

- No Electron Playwright / Spectron plan (design mentioned E2E).
- No Windows path fixtures in CI for `C:\` style.
- Live tests gated by `GROKDESK_LIVE=1` — good — but no recorded golden `streaming-json` fixtures for offline parse tests. **Capture fixtures early in Task 14.**

### 3.15 Process / monorepo issues

- Workspace package imports from Electron may need `electron.vite` `resolve.alias` for `@grokdesk/*`.
- `composite` project references without root solution build script may confuse agents.
- Desktop `typecheck` scripts reference tsconfigs not fully specified in plan.

---

## 4. Spec coverage audit (deeper)

| Spec § | Covered? | Plan tasks | Residual risk |
|--------|----------|------------|---------------|
| SuperGrok auth | Partial | 13–14 | Wrong CLI verbs until fixed |
| Host shell + policy | Partial | 4, 8, 11 | Real engine bypass |
| Cowork UI | Partial | 10–11 | Path picker, polish |
| Parallel tasks | Yes | 8, 15 | Cap tests thin |
| Scheduler | Yes | 17 | Migration + NL thin |
| Memory | Yes | 18 | Overlap with Grok memory |
| Proactivity desktop | Yes | 12, 19 | Rules-only vs model |
| Model/effort | Partial | 11, 22 | Map to real flags |
| Role packs | Yes | 20 | Skills may not exist as files |
| MCP/skills | Partial | 21 | Prefer Grok MCP |
| Mac+Win parity | Partial | 3, 6, 12, 24 | Native rebuild |
| Artifacts | Partial | 8, 16 | Persist incomplete in runner |
| Audit/kill | Yes | 7–8, 12 | Audit UI missing |
| Optional sandbox | Yes | 25 | Also map to `--sandbox` first |

---

## 5. Recommended architecture amendments (adopt now)

1. **Gateway as child process** (Node) supervised by Electron main — cleaner native modules, crash isolation.  
2. **EngineAdapter contract stays**; FakeEngine keeps in-process tools; GrokBuildEngine streams only.  
3. **Policy mapping module** `packages/shared/src/policy-to-grok-flags.ts` with unit tests.  
4. **Event bus** gateway → main → renderer (push + poll fallback).  
5. **Folder picker IPC** before calling UI “no-code complete”.  
6. **Versioned migrations** from day one.  
7. **Auth surface:** `login`/`logout`/`models`/`agent` as discovered.  
8. **Defer ACP** unless we discover it; prioritize `streaming-json`.  

---

## 6. Parallel execution model

### 6.1 Conflict rule

Default subagent-driven-dev says **don’t parallelize implementers on the same worktree**. We **do** parallelize by:

1. **Wave barriers** (serial merge points), and  
2. **Non-overlapping path ownership**, and/or  
3. **Git worktrees** per wave stream when two streams must touch the repo simultaneously.

### 6.2 Dependency DAG

```
T1 scaffold
   │
   ▼
T2 types ──► T3 paths ──► T4 policy ──► T5 ipc ──► (shared complete)
   │                         │
   │                         ├──► T6a policy-to-grok-flags (NEW, pure)
   │                         └──► T6 db/migrations
   │                                │
   │                     ┌──────────┴──────────┐
   │                     ▼                     ▼
   │              T7 tasks/audit         T8a engine types+fake
   │                     │                     │
   │                     └──────────┬──────────┘
   │                                ▼
   │                         T8b runner + T9 gateway facade
   │                                │
   │                     ┌──────────┴──────────┐
   │                     ▼                     ▼
   │              T10 desktop shell      T13a discover CLI (pure)
   │                     │
   │         ┌───────────┼───────────┐
   │         ▼           ▼           ▼
   │      T11 UI      T12 tray    T16 artifacts API
   │         │           │
   │         └─────┬─────┘
   │               ▼
   │         T13 auth + T14 GrokBuildEngine
   │               │
   │    ┌──────┬───┴───┬────────┬─────────┐
   │    ▼      ▼       ▼        ▼         ▼
   │   T15   T17     T18      T20       T21
   │  parallel sched memory  packs     mcp ui
   │           │       │
   │           └───┬───┘
   │               ▼
   │             T19 proactivity
   │               │
   │         ┌─────┴─────┐
   │         ▼           ▼
   │       T22 depth   T23 protocol/export
   │         │
   │         ▼
   │       T24 CI/hardening
   │         │
   │         ▼
   │       T25 optional docker (last)
```

### 6.3 Waves for parallel subagents

| Wave | Parallel tracks (max 3) | Merge gate |
|------|-------------------------|------------|
| **W0** | T1 scaffold only | `pnpm install` green |
| **W1** | Single agent: T2→T5 shared (+ NEW policy-to-flags) | shared tests green |
| **W2** | Track A: T6–T7 gateway data/tasks · Track B: T8a engine-grok types+fake | both packages build |
| **W3** | T8b runner + T9 facade (one agent — shared runner) | gateway tests green |
| **W4** | Track A: T10 Electron shell · Track B: fixtures/docs for streaming-json capture | app launches |
| **W5** | Track A: T11 Cowork UI · Track B: T12 tray/notifications · Track C: folder picker + push events | manual smoke |
| **W6** | Track A: T13 auth · Track B: T14 engine (after auth interfaces stable — often serial A then B) | live login smoke |
| **W7** | T15 ∥ T16 ∥ T17-recurrence+scheduler ∥ T18 memory ∥ T20 packs (path-partitioned) | integration test |
| **W8** | T19 proactivity · T21 skills/MCP UI · T22 depth | dogfood day |
| **W9** | T23 · T24 | release candidate |
| **W10** | T25 optional | backlog OK |

**Practical max parallelism:** 3 implementers with disjoint paths. Controller merges, runs full `pnpm test`, then opens next wave.

### 6.4 Path ownership (to avoid conflicts)

| Track | Owns |
|-------|------|
| shared | `packages/shared/**` only |
| engine | `packages/engine-grok/**` only |
| gateway | `packages/gateway/**` only |
| desktop-main | `apps/desktop/src/main/**`, preload |
| desktop-ui | `apps/desktop/src/renderer/**` |
| ci | `.github/**`, root README scripts |

When a task needs two tracks (e.g. IPC method + UI), **controller adds IPC to shared/gateway first**, then UI agent consumes.

### 6.5 Review policy under parallel

Per track after merge to feature branch:
1. Spec compliance review (against design + this review’s amendments)  
2. Code quality review  
3. Full workspace test  

Do **not** run two reviewers that edit code; only implementers edit.

---

## 7. Priority order for “whole product” value

If we ever have to sequence value (not cut scope permanently):

1. **Offline Cowork vertical slice** (T1–T11 + folder picker + approvals) — demoable  
2. **Real Grok engine + login** (T13–T14) — SuperGrok value  
3. **Tray + pause + notifications** (T12) — desktop product feel  
4. **Scheduler** (T17) — “managed agents”  
5. **Memory + proactivity** (T18–T19) — always-on  
6. **Role packs + MCP UI** (T20–T21) — marketing agent story  
7. **Hardening dual-OS** (T24) — shippable  
8. **Depth + sandbox** (T22, T25) — differentiators / safety  

---

## 8. Concrete plan patches to apply before/while building

1. Rename auth steps to `grok login` / `logout`.  
2. Prefer `grok agent --output-format streaming-json` for Task 14.  
3. Add `policy-to-grok-flags.ts` + tests.  
4. Add migration runner in Task 6.  
5. Document gateway-as-child-process as preferred; in-process FakeEngine OK for tests.  
6. Expand Task 11 with folder picker + approval state machine before UI implementer.  
7. Capture real `streaming-json` fixture file under `packages/engine-grok/testdata/`.  
8. Add `electron-builder install-app-deps` / rebuild notes to Task 10.  
9. Remove or implement `policy-service.ts` tree entry.  
10. Map Autopilot carefully — never default `--always-approve`.  

---

## 9. Quality bar for implementer subagents

Each implementer must return:

```
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT
SUMMARY: …
FILES CHANGED: …
TESTS: commands + pass/fail
COMMIT: sha + message
CONCERNS: …
```

Controller rejects DONE if:
- No tests when plan specified TDD  
- Touched files outside path ownership without approval  
- Used FakeEngine policy path claims for GrokBuildEngine safety  

---

## 10. Decision log (locked by this review)

| Decision | Choice |
|----------|--------|
| Parallelism | Wave-based, ≤3 tracks, path ownership |
| Real engine protocol | `grok agent` + streaming-json first |
| Auth | `grok login` / `logout` |
| Tool execution (prod) | Grok Build, not Desk runner |
| Tool execution (test) | FakeEngine + Desk policy |
| Memory | Desk product memory + optional Grok memory flags |
| Process model | Prefer gateway child process (implement by Task 10 if feasible; else debt ticket) |
| Branch | `feat/grok-desk` |

---

## 11. Immediate next actions

1. Commit this review.  
2. Start **Wave 0**: Task 1 monorepo scaffold (one implementer).  
3. **Wave 1**: Tasks 2–5 + policy-to-grok-flags (one implementer, full shared package).  
4. **Wave 2**: parallel gateway T6–7 ∥ engine T8a.  
5. Continue waves without pausing for permission unless BLOCKED.

---

## 12. Summary judgment

The plan is a **good construction spine** with an **excellent first third** and a **sketchy last two thirds**. The product vision is coherent. The biggest technical hazard is pretending Grok Desk can interpose on every host tool when Grok Build is the real agent runtime — fix that mapping early and SuperGrok integration becomes much simpler (and safer).

Parallel subagents are viable **from Wave 2 onward** with strict path ownership; Wave 0–1 stay serial by nature of monorepo bootstrap.
