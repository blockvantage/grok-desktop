# Grok Build Parity + Simplicity Design

**Date:** 2026-07-22  
**Status:** Design / planning only — no implementation in this doc  
**Supersedes (priority, not deletion):** `to_add.md` catalog framing; extends beyond `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md` (Sticky + Magic, implemented)  
**Inputs:** `to_add.md`, CLI-port QA (`docs/analysis/2026-07-16-cli-port-wave-qa.md`), `codex_improve.md` (SEC-01 / GROK-02), live Grok Build `0.2.x` (`grok --help`, `~/.grok/docs/user-guide/`), current Desk policy/engine/provider surfaces

---

## 1. Product contract

**Grok Desk’s moat is to get as close as practical to Grok Build capabilities while keeping the default Desk experience simple for non-power users.**

That means:

| We will | We will not |
|---------|-------------|
| Surface and bridge the *capabilities* Grok Build already owns (tools, modes, safety, multi-agent, media, memory, skills) so Desk feels like the same agent, in a coworker shell | Clone 100% of CLI / TUI features into primary chrome |
| Prefer product language (“Draft a plan first”, “Safe workspace”, “Watch until done”) over slash commands and raw flags | Ship a second TUI, vim mode, truecolor diagnostics, or pager chrome |
| Default path: few words, few controls, safe defaults that match what the engine actually enforces | Expose every Grok Build permission mode, sandbox profile, and extension method as top-level settings |
| Advanced path: Settings, overflow menus, and power toggles for people who already know Grok CLI | Make power features the onboarding default or Home noise |
| Fail closed and label honesty gaps when Desk cannot enforce a promise | Market “sandboxed / fully mediated” while sandbox is off and tools execute inside the CLI |

**Contract sentence (use in reviews):**  
*Close to Grok Build capability; Desk language and dual-path simplicity; not a 100% CLI clone; not a second TUI.*

---

## 2. Dual-path simplicity rules

Every **include** capability must pass these rules before UI is designed:

1. **Default path first.** A non-power user gets the value with zero slash-command knowledge and at most one obvious control (toggle, chip, overflow item, or automatic behavior).
2. **Advanced path stays out of the main chrome.** CLI-shaped detail lives in Settings → Advanced, task overflow, or env/probe fallbacks — never a new top-level nav item for rare actions.
3. **No raw flags as primary UI.** Never show `--sandbox workspace` or `--permission-mode acceptEdits` as the default label. Map to Desk nouns; put the flag only in diagnostics / “effective protection” expanders.
4. **Effective protection matches enforcement.** If the engine does not pass sandbox or cannot mediate a tool, the UI must not claim full protection. Prefer “Best-effort / CLI enforces” wording until conformance proves more.
5. **Surface before reimplement.** Prefer ACP/tool events and CLI flags over a Desk-owned reimplementation of the same loop — unless the CLI path is structurally blind (headless-only).
6. **No surface that only works headless-degraded.** Features that need tool_call / plan / permission streams require ACP; headless must degrade gracefully or hide the control.
7. **One scheduler of record for users.** Desk’s gateway scheduler owns “upcoming work.” CLI `/loop` and `scheduler_*` tools bridge into it or appear as ephemeral in-task watches — not a second competing calendar UI.
8. **Cut rule.** If a feature needs a new Home section *and* a new Settings page *and* a new task mode to ship, cut or split it. Prefer zero net-new nav.

### Import strategies (from `to_add.md`)

| Code | Meaning |
|------|---------|
| **Surface** | CLI already does it; expose events/UI (usually ACP) |
| **Bridge** | Map CLI feature ↔ Desk gateway/UI contracts |
| **Reimplement** | Own it in TS (gateway tools / Desk store) |
| **Hybrid** | Start Surface; migrate to Reimplement if needed |

### Engine dependency

| Tag | Meaning |
|-----|---------|
| **ACP-required** | Needs structured session updates / extensions; hide or degrade on headless |
| **Headless-ok** | Works via argv/env or Desk-side services without ACP streams |
| **Either** | Useful on both; richer on ACP |

---

## 3. Baseline (already landed — do not re-open as greenfield)

Verified against post-wave QA and current tree (2026-07-22). These are **baseline**, not new work, unless an honesty gap is called out.

| Capability | Status | Honesty gap (if any) |
|------------|--------|----------------------|
| ACP default when probe supports `agent stdio` | Landed | Per-task headless fallback still required |
| Session resume / continue | Landed | — |
| Sleep/wake power gate + auth safety | Landed | — |
| Plan-first + plan card + approval | Landed | Full live ACP plan loop quality varies by CLI |
| Interject / nudge while working | Landed | Degrades to queue on headless |
| Compact + context meter | Landed | — |
| Rewind / undo turn | Landed | No per-hunk accept/reject yet |
| Media tool → artifacts (image/video) | Landed | Harvest best-effort from tool output paths |
| Citation cards | Landed | — |
| Mermaid fences in-thread | Landed | — |
| Effort mapping incl. max → xhigh | Landed | — |
| Strict ≠ plan mode (read-only denials) | Landed | Still not full allow/deny/ask rule compile |
| Isolated `GROK_HOME` by default | Landed | Inherit only via `GROKDESK_INHERIT_USER_GROK=1` (no Settings UI) |
| Bundled skills + connector presets | Landed | Multi-root discovery + marketplace not done |
| Desk scheduler + Desk memory store | Landed (product-native) | Not the same as CLI experimental memory / dream |
| Billing / SuperGrok rails | Landed | — |

**Critical honesty gaps still open (must not be marked “done”):**

1. **Sandbox is probed but not passed** — `policyToGrokArgs` intentionally omits `--sandbox` until conformance tests prove profile semantics.
2. **`executesOwnTools = true`** — gateway observes CLI effects; not full pre-mediation. ACP permission broker is partial mediation, not absolute audit of every FS/network effect.
3. **Inherit user profile is env-only** — power users who want their Grok plugins have no clear product path.
4. **Weekly memory recap** was stretch and **deferred** (Task 15 / C4).

---

## 4. Critique: over-complication traps

These traps would *look* like parity but hurt the moat or the simple default:

| Trap | Why it fails | Rule |
|------|--------------|------|
| Marketplace / plugins before trust | Users install untrusted hooks while sandbox is off | Wave T before Wave E |
| Subagent HUD inventing agents from `parentTaskId` | Fake workers destroy trust in multi-agent | Only real ACP/subagent events; otherwise “Working…” only |
| Dual schedulers (Desk cron + CLI `/loop` UI) | Two “upcoming” lists; user confusion | Bridge into Desk scheduler or in-task watch strip |
| Inherit-user-Grok without risk copy | Silent third-party hooks outside Desk policy | Explicit Settings toggle + danger copy |
| Best-of-N as default | Cost explosion; silent multi-run | Advanced overflow only; never default |
| Hooks on by default | Security + non-determinism | Default off; power-only |
| Pure-API rewrite before ACP fidelity | Months of rewrite while product lags CLI | Defer Own-the-loop until trust + coworker waves land |
| Every permission mode in Home | `dontAsk` / `bypassPermissions` jargon | Three Desk modes + optional “Accept edits” advanced |
| Full sandbox profile matrix in composer | `devbox` / custom `sandbox.toml` is enterprise noise | Map Desk Safe / Standard / Open → CLI profiles |
| Slash-command-first Desk | Power-user CLI muscle memory; alienates default users | Slash optional shortcuts only; default labels are product language |
| Shipping weekly recap as a chatty always-on spam | Inbox fatigue | Soft opt-in / quiet hours / one weekly item |
| “Review changes” that reimplements a full IDE diff | Scope creep toward multi-pane IDE (Desk non-goal) | Per-turn hunk list with accept/reject; deep git stays external |

---

## 5. Inventory: Include / Defer / Never

### 5.1 INCLUDE — Wave T (Trust honesty)

| ID | User outcome | Default UX label | Advanced escape | Strategy | Engine | Simplicity critique (what NOT to ship) |
|----|--------------|------------------|-----------------|----------|--------|----------------------------------------|
| T1 | Agent FS/network constrained by OS when CLI supports it | **Safe workspace** (on by default when probe + platform allow) | Settings → protection profile: Safe / Standard / Open → maps to `strict` / `workspace` / `off` | Surface + Bridge | Headless-ok (argv) + ACP same | Do not expose `devbox` or custom `sandbox.toml` editor in v1 |
| T2 | Desk approval mode actually constrains tools | Keep **Careful / Balanced / Autopilot**; wire real rules | Advanced: **Accept file edits** (maps `acceptEdits`); optional **Auto-approve safe tools** (`auto`) buried in Settings | Bridge | Either | Do not surface `dontAsk` / `bypassPermissions` as primary labels; no rule-DSL editor for default users |
| T3 | User sees what is actually enforced this run | Compact **Protection** chip (“Sandbox · approvals · network”) | Expand → effective argv / mode / sandbox profile (diagnostics) | Bridge | Either | Do not dump full CLI help into the chip |
| T4 | Power users can use personal Grok plugins deliberately | Isolated profile default (no UI needed) | Settings → **Use my Grok plugins & hooks** (off by default) + risk dialog | Bridge | Headless-ok | Do not auto-inherit `~/.grok` silently; no “merge everything” |
| T5 | Project connectors/skills only run when workspace trusted | First time in a folder: soft **Trust this folder for project tools?** | Settings → trusted folders list | Bridge | Either | Do not reimplement full `trusted_folders.toml` UI parity day one |

**Prerequisite:** T1–T3 before any marketing language that implies hard sandboxing or “always safe autopilot.”

### 5.2 INCLUDE — Wave C (Coworker stickiness)

| ID | User outcome | Default UX label | Advanced escape | Strategy | Engine | Simplicity critique |
|----|--------------|------------------|-----------------|----------|--------|---------------------|
| C1 | Long tasks show objective progress | **Working toward…** progress line under title (from goal/update events) | Task overflow → pause / clear objective | Surface + Bridge | ACP-required (rich); headless degrades to static goal text | Do not ship a separate Goal Mode product or `/goal` as primary |
| C2 | After agent edits, user can accept/reject file changes | **Review changes** strip (files changed this turn) | Per-file accept/reject; “undo turn” already covers full rewind | Surface + Bridge | ACP-required | Do not build a full multi-file IDE diff browser |
| C3 | Branch conversation without losing original | **Try another approach** (fork) | Optional restore-code when resuming forks | Surface + Bridge | Either (`--fork-session` / ACP) | Do not auto-fork every retry; edit-and-rerun stays the daily path |
| C4 | Real multi-agent visibility | Compact **Helpers** row: “Researching… / Planning…” with live status | Expand → agent type (explore/plan/general) only when real events exist | Surface | ACP-required | Never invent workers from `parentTaskId` alone |
| C5 | Optional safe isolation for repo work | **Work in a safe copy** toggle on repo tasks (off by default) | Advanced worktree name/ref | Surface + Bridge | Headless-ok (`--worktree`) / ACP if supported | Do not default every task to a worktree; CoW platform noise stays hidden |
| C6 | Watch external progress without leaving the task | **Watch until…** suggestion when user language matches (CI, log, PR) | Task strip: active watches + stop | Hybrid | ACP-required for monitor tool | Do not add a global “Monitors” nav; no second dashboard product |
| C7 | Recurring in-chat checks | User says “every 30m check deploy” → create **Desk schedule** or in-task loop with confirm | Schedule detail in existing Schedules UI | Bridge | Either | Do not keep a separate CLI scheduler UI; bridge or discard |
| C8 | See long-running shell (dev server) | Thin **Running** strip when background shell tools emit | Kill / open log | Surface | ACP-required | Do not become a process manager app |
| C9 | Weekly “what I learned” without manual memory hygiene | One **Weekly recap** inbox item (opt-in / quiet hours) | Memory settings: frequency, off | Reimplement on Desk store (Hybrid if CLI dream used later) | Headless-ok (scheduler) | Do not enable CLI experimental-memory by default without UX; no daily spam |
| C10 | Mid-run and long-context already sticky | *(baseline)* plan-first, nudge, compact, rewind, citations, mermaid | — | — | — | Do not re-ship as new work |

### 5.3 INCLUDE — Wave E (Ecosystem, curated)

| ID | User outcome | Default UX label | Advanced escape | Strategy | Engine | Simplicity critique |
|----|--------------|------------------|-----------------|----------|--------|---------------------|
| E1 | Project skills from common toolchains just work | Silent multi-root scan (bundled + user paths + `.grok`/`.agents`/`.claude`/`.cursor` when folder trusted) | Settings → skill roots + enable list | Bridge | Headless-ok | Do not require users to know SKILL.md layout |
| E2 | Capture a repeated workflow once | **Teach Desk this workflow** (short wizard → SKILL.md) | Open skills folder | Hybrid | Headless-ok | Do not clone full interactive CLI skill authoring TUI |
| E3 | Curated extensions without hunting GitHub | **Extensions** (Settings): recommended packs only | Full marketplace browse (power) with trust gate | Bridge | Headless-ok | Do not dump entire public marketplace unvetted into Home |
| E4 | Project rules apply automatically | Silent AGENTS.md / rules load; chip **Using project rules** | View loaded rules | Bridge | Either | Do not edit AGENTS.md in a custom IDE inside Desk |
| E5 | Import prior Claude/Cursor investment | Onboarding optional: **Import from Claude Code / Cursor** | Settings re-run | Bridge | Headless-ok | One-shot import, not continuous dual-ecosystem sync UI |
| E6 | Connectors stay healthy | Existing presets + **Check connection** doctor on failure | MCP tool catalog for power users | Surface + Bridge | Either | Do not show every MCP tool id in the main task chrome |

### 5.4 INCLUDE — Wave X (CLI headliners, advanced by default)

| ID | User outcome | Default UX label | Advanced escape | Strategy | Engine | Simplicity critique |
|----|--------------|------------------|-----------------|----------|--------|---------------------|
| X1 | Hard problems can run multiple attempts | Task overflow → **Try N approaches** (2–3 only) | Never on by default; cost warning | Surface | Headless-ok (`--best-of-n`); ACP if available | Do not put Best-of-N on Home composer |
| X2 | Optional self-verify after work | Toggle **Double-check when done** (off by default) on heavy/max tasks | — | Surface | Headless-ok (`--check`) | Do not always append check loops (latency) |
| X3 | Resume restores code state when wanted | Advanced resume option **Restore code from that session** | — | Surface | Headless-ok (`--restore-code`) | Dangerous; confirm dialog required |
| X4 | Accept edits without full autopilot | Maps into T2 advanced **Accept file edits** | — | Bridge | Either | Do not add a fourth primary approval mode on Home |
| X5 | Model list stays honest | Keep existing model picker; live catalog when authed | Offline hard-coded fallback | Surface | Either | Do not rebuild a CLI model modal |

### 5.5 DEFER (valuable later, not in this program’s committed waves)

| Item | Why defer | Revisit when |
|------|-----------|--------------|
| Full pure-API agent path (`provider-grok-api`, gateway-owned tool loop) | Architectural bet; huge cost; ACP path still unfinished fidelity | After T+C land and `executesOwnTools` remains a hard product blocker |
| Full custom sandbox.toml editor | Enterprise / rare | Managed org customers ask |
| Device-code / OIDC enterprise auth polish | Important for fleet, not daily consumer moat | Mobile remote / enterprise packaging wave |
| OTEL / managed org config / MDM | Enterprise | Fleet contracts |
| Custom models / BYOK / Ollama | Power-user niche | Clear demand + support cost |
| Server announcements system | Nice-to-have | Ops need |
| Full persona / agent definition editor | Power CLI feature | After subagent HUD proves useful |
| In-engine experimental memory as default | Parallel memory systems risk double-write | Only if Desk store proves insufficient and CLI memory is stable |
| Computer-use expansion beyond current desk-desktop MCP | Separate product track | Existing computer-use program |
| Dashboard multi-session TUI IA clone | Desk Home already multi-task | Only steal sort/pin patterns if Home fails |

### 5.6 NEVER (Desk non-goals)

| Item | Reason |
|------|--------|
| Vim mode / scrollback keybindings | TUI-only |
| Terminal truecolor / tmux / `/terminal-setup` | Not an Electron concern |
| Ratatui / TUI themes as product themes | Desk has its own design system |
| `/minimal` / `/fullscreen` / alt-screen | TUI render modes |
| Unrestricted project hooks by default | Security |
| Becoming a multi-pane coding IDE | Explicit product non-goal |
| Exposing every slash command 1:1 as Desk slash | Desk slash is coworker recipes (brief, research, …), not CLI shell |
| Shipping dual competing memory UIs without a single source of truth | Confuses default users |
| Marketing full mediation while tools execute only inside CLI | Honesty |

---

## 6. Product language map (CLI → Desk)

| Grok Build | Desk default language |
|------------|----------------------|
| `--sandbox` / profiles | Safe workspace / Protection |
| Permission modes | Careful / Balanced / Autopilot (+ Accept edits advanced) |
| `/plan` | Draft a plan first |
| `/btw` | Nudge (send while working) — already landed |
| `/goal` + `update_goal` | Working toward… |
| `/loop` + `monitor` | Watch until… |
| Rewind / hunks | Undo turn / Review changes |
| `/dream` / flush | Weekly recap / Remember this |
| Marketplace | Extensions (recommended) |
| Subagents | Helpers |
| Worktree | Work in a safe copy |
| `--best-of-n` | Try N approaches |
| `--check` | Double-check when done |
| Inherit `~/.grok` | Use my Grok plugins & hooks |
| AGENTS.md | Project rules |
| `/always-approve` | Autopilot |

---

## 7. Improvements to what we already ship

This section is **not** a Grok Build port list. It is a critique of **Desk as it exists today** (source audit 2026-07-22): polish waves that already landed, structural debt that still hurts daily use, and product surfaces that are half-powerful.

**Principle:** perfect the coworker shell before stacking more CLI capability on fragile foundations. Many items here unblock Wave T/C quality; some should ship *before* or *alongside* T1–T3.

### 7.1 Already strong (do not rebuild)

Treat these as settled unless a regression appears. Evidence: `IMPROVEMENTS.md`, `UI_IMPROVEMENTS.md`, `SLASH_IMPROVEMENTS.md`, `POLISH-PLAN.md`, `EXPERIENCE_IMPROVEMENTS.md`, `docs/plans/ux-review-improvements.md`.

| Area | What is already good |
|------|----------------------|
| Visual system | Tonal surfaces, sand accent, focus rings, reduced motion, premium motion tokens |
| Chat plumbing | Optimistic create, queue with undo/missing-attachment guardrails, push notifications + 30s safety net, plan card, context meter, citations, mermaid, media harvest + posters |
| Slash (Desk recipes) | Send-time expansion, armed chip, effort from recognition — not CLI slash clone |
| i18n | 7 locales, engine reply language, dictation language, tray/main catalog |
| Auth honesty | Never-signed-in ≠ reauth (`auth-bridge` + AccountController phases) |
| Boot | Settings/task list paint without waiting forever on `grok models` (auth probe backgrounded) |
| Secrets | Credential vault + SQLite refs (SEC-02 largely addressed) |
| Electron chrome | Renderer `sandbox: true`, `will-navigate` guard, controlled `openExternal` |
| CSP | Remote `https:` images blocked; assets via `grokdesk-asset:` |
| Worker HUD discipline | `isLikelySubagent` always false; HUD only from truthful worker events (`subagent-hud.ts`) |

### 7.2 Critical product truth (still rough)

| ID | Problem (verified in source) | Improvement | Simplicity rule |
|----|------------------------------|-------------|-----------------|
| **I1** | **One conversation story is still multi-task plumbing.** Follow-ups use `parentTaskId`; workers use lifecycle events; users still see “tasks” where they think “chat.” Lists, delete, export, and remote can disagree about the unit of work. | Make **conversation** the user noun everywhere: one root, turns as history, helpers as ephemeral workers. Tasks remain the engine unit. | No second nav called “Conversations” — rename copy + projectors only |
| **I2** | **Status hierarchy is fragmented.** Account, engine/CLI, gateway dead, entitlement, update, browser, remote, approval, and run state each have their own banner/pill. Default users get competing reds/ambers. | One **status owner** model: severity-ranked notice stack (already started) that owns *all* blocking reasons; suppress lower-priority chrome while a higher one is active | Do not add more permanent banners |
| **I3** | **Protection / policy UI can still over-promise** relative to spawn (sandbox off, `executesOwnTools = true`, shell/network hard-allowed on create in places). | Same as Wave T3 — but treat as **current-app fix**, not optional port: always show *effective* protection for the open run | Chip only; no new Settings page for diagnostics |
| **I4** | **Approval cards still under-specify risk** on some paths (tool name/command sometimes thin; desktop-control vs shell vs browser not equally clear). | Every parked approval shows: **what** · **where** · **why it needs you** · once/always if available | No raw JSON dumps in the card |
| **I5** | **Helpers HUD is correctly empty without worker events** — but ACP worker fidelity is incomplete, so multi-agent work still looks like a single silent agent. | Improve ACP mapping of worker_* / subagent tool events into the existing HUD (ties to C4); keep “hide rather than invent” | Never re-enable parentTaskId-as-agent |

### 7.3 Engine & gateway reliability (existing path)

| ID | Problem | Improvement | Priority |
|----|---------|-------------|----------|
| **I6** | Headless path remains event-poor; ACP is better but still capability-gated / fallback-prone | Prefer ACP; when degraded, UI labels “Limited mode” once (not per-tool spam); improve resume failure → transcript fallback messaging | P0 with T |
| **I7** | Subprocess budgets incomplete: stderr capped (~256 KiB) but **wall-clock / idle / turn / tool budgets** are weak or absent vs GROK-04 intent | Bounded run: max wall time, idle timeout, max turns; surface “stopped: budget” as clear terminal reason | P0 |
| **I8** | Crash recovery / orphaned runs / multi-instance leases exist but user copy is operator-ish | Human terminal reasons: “Stopped after sleep”, “Reconnected”, “Engine upgraded — resumed” | P1 |
| **I9** | Title generation / session meta / usage exist; usage soft-limits under-told in-chat | Soft usage warning in composer when near cap; keep billing detail in Account | P1 |
| **I10** | Proactivity is thin: hourly tick mainly pings waiting/failed + optional memory automation suggestions | Tighten **waiting-on-you** inbox quality (dedupe, deep-link to exact approval); defer aggressive automation spam | P1 |
| **I11** | Preflight / runtime install / entitlement gates can stack into opaque “can’t run” | Single readiness checklist when blocked: License · Runtime · Sign-in · Workspace — one CTA each | P0 for paid path |

### 7.4 Existing surfaces that under-deliver

These features **already ship**; they need depth, not a new product.

| Surface | Today | Improve to | Cut |
|---------|-------|------------|-----|
| **Home** | Strong composer + rail | Smarter empty/recent: last conversation jump, one “needs you” card, quieter stats | No dashboard widgets farm |
| **Workspace** | Full chat, approvals, queue, live work | Faster first paint; freeze chrome during live run; clearer Waiting/Blocked | No IDE panel sprawl |
| **Artifacts** | Harvest + hero digest | Persistent gallery filters (media/docs), open-in-folder reliability, large-file progress | No full Finder clone |
| **Memory** | List/search/CRUD + embeddings | Semantic search UI (embeddings exist backend); “pin / forget”; link memories to tasks that created them | No second knowledge base product |
| **Scheduled** | Cron rules + quiet hours | Plain-language next run; failed-run history; one-tap disable | No calendar suite |
| **Browser pane** | Task-scoped browser | Capability routing that *guarantees* in-app browser when the task needs web UI; clearer permission for desktop vs browser | No multi-tab browser chrome |
| **Desktop control** | HUD + grants | Session-scoped grant memory with visible “Grok can control your Mac until…” | No always-on accessibility by default |
| **Remote** | Pairing + control | Pairing recovery, session expiry honesty, mobile parity of approvals | No remote desktop competitor |
| **Settings / Tools** | Connectors, skills paths, prefs | Connector doctor (ties E6); skills path validation; “reset isolated profile” | No CLI flag editor |
| **Command palette** | Nav + recents + stop | Jump to conversation by title; “needs you” filter | Keep small |
| **Inbox** | Approvals / suggestions | Group by conversation; mark-all for suggestions only | No email client |

### 7.5 Performance & code health (current app)

| ID | Evidence (2026-07-22) | Improvement | Why it matters for simple UX |
|----|----------------------|-------------|------------------------------|
| **I20** | God components: `task-workspace-view.tsx` ~2.9k, `App.tsx` ~2.1k, `runner.ts` ~1.7k, `home-view` / `task-stream` ~1.6k, `gateway/index` ~1.4k | Continue extract-by-bounded-context (queue, approvals, stream, shell boot already partially done). **No behavior change.** | Bugs and “simple” fixes become impossible in 3k-line files |
| **I21** | Main renderer chunk still ~2.2 MB after lazy Settings/Artifacts/etc. | Split Home vs Workspace vs TaskStream; lazy mermaid/diagram only when needed | Cold start / first interaction feel |
| **I22** | Gateway composition still patches / wide `index.ts` surface | Provider registry + dispatch modules with constructor deps; reduce monkey-patch | Safer ACP/trust work |
| **I23** | E2E thin: smoke, onboarding/account, browser capability, paid readiness — not create-run-approve-export | One **golden path** Playwright: onboard → create task → approve mock → see message → export | Stops silent product regressions |
| **I24** | Tests strong unit/integration; few contract tests against live `grok` version matrix | Pin CLI version range in probe; CI job optional “CLI available” | Ports do not break weekly |

### 7.6 Security residual (current ship)

Partially fixed items should not be reopened; residual risk remains.

| ID | Status | Remaining work |
|----|--------|----------------|
| **I30** | SEC-01 open | Policy not authoritative while `executesOwnTools`; create path still generous on shell/network — fix with Wave T + ACP broker honesty |
| **I31** | SEC-02 largely landed | Vault exists; ensure no secret literals remain in settings RPC, logs, diagnostics, project `.grok` writes; canary tests stay green |
| **I32** | SEC-03 improved | Keep sandbox on; validate IPC sender window/origin on every privileged channel; audit `openExternal` allowlist periodically |
| **I33** | SEC-04 improved (CSP) | Keep remote images blocked; any future remote media must be proxy-consented |

### 7.7 UX polish residual (small, high leverage)

Prior rounds marked most CHAT/PROG/LANG **DONE**. Residual only if dogfood still hurts:

| ID | Improvement |
|----|-------------|
| **I40** | Search-within-conversation (filter turns) without leaving workspace |
| **I41** | Export: markdown + attachments zip; share sheet on macOS |
| **I42** | First-run: seed one starter goal after onboarding (activation SOTA) if still missing |
| **I43** | Reduce entitlement / runtime install copy to one human paragraph + one button |
| **I44** | Tray: show “Needs you (N)” not only generic running |
| **I45** | Accessibility: full keyboard path for approve/reject + queue send-now (regression-proof) |

### 7.8 Explicit non-improvements (do not spend here)

- Restyling the design system from scratch (foundation is good).
- Replacing the chat model with a “docs site” or multi-pane IDE.
- Cloning Grok TUI chrome into Electron.
- Mobile feature parity before desktop golden path is boringly reliable.
- New locales (it/ko) before residual English stragglers are zero (LANG-6 recipe only).

### 7.9 Sequencing vs port waves

```text
I11 readiness + I6 degraded-mode labeling   ──►  with Wave T
I1 conversation noun + I2 notice hierarchy  ──►  before heavy Wave C UI
I20–I22 extractions                          ──►  continuous; never block T1
I7 run budgets                              ──►  Wave T companion
I23 golden E2E                              ──►  before Wave E marketplace
I5/C4 worker fidelity                       ──►  Wave C
Surface depth (Memory/Schedule/Artifacts)   ──►  after T honesty, small slices
```

**Critique:** Shipping marketplace (E3) or best-of-N (X1) while I1/I2/I11 still confuse “what is my chat / why can’t I run” is the wrong moat order. **Current-app truth beats new capability.**

---

## 8. Moat definition (how we know we won)

Desk wins when a Grok Build power user says “it can do the same hard things” **and** a non-technical coworker says “I just type what I need.”

Measurable proxies (per wave success signals live in the implementation plan):

- Protection chip matches engine argv in dogfood (zero false “sandbox on” claims).
- Share of multi-turn tasks with real helper visibility when the agent delegates.
- “Review changes” used more than full undo for edit-heavy tasks.
- Watch-until / schedule bridges reduce “I’ll check later in the terminal” escapes.
- Weekly recap accept rate without unsubscribe spikes.
- Extensions install rate from recommended set only (not raw marketplace dump).
- **Current-app:** golden-path E2E green; no “Sign in again” for never-signed-in; god-file line counts trend down each quarter; notice stack shows ≤1 blocking reason at a time.

---

## 9. Risks and intentional overrides

| Risk | Mitigation |
|------|------------|
| “As close as possible” vs “simple” | Dual-path + Include/Defer/Never; advanced stays buried |
| `executesOwnTools` limits absolute audit | Wave T documents partial mediation; pure-API stays Defer |
| CLI 0.2.x evolves faster than Desk | Capability probes; never hard-code one CLI method set as permanent contract |
| Sticky wave already shipped media/plan/etc. | This design treats them as baseline; only honesty gaps reopen (sandbox, policy compile, inherit UI, weekly recap) |
| Goal mode / subagent HUD marked “absorbed by orchestration” in 2026-07-15 design | **Override:** orchestration calmed the stream but did not deliver real goal-progress binding or real subagent events — C1 and C4 are still **include** |
| Fork deferred in sticky wave (“edit-and-rerun covers daily”) | **Override:** fork remains include as advanced overflow; not default daily path |
| Dual memory (Desk store vs CLI experimental) | Prefer Desk-native recap (C9); CLI memory only via explicit advanced later |
| Port greed starves current-app fixes | §7 improvements are first-class program work (Wave I), not “nice polish later” |

---

## 10. References

- Catalog: `to_add.md`
- Prior design: `docs/superpowers/specs/2026-07-15-cli-feature-port-design.md` (status: sticky wave implemented)
- Prior plan: `docs/superpowers/plans/2026-07-16-cli-feature-port-wave.md`
- QA: `docs/analysis/2026-07-16-cli-port-wave-qa.md`
- Product experience audit: `docs/analysis/2026-07-15-product-experience-audit.md`
- Honesty: `codex_improve.md` (SEC-01, GROK-02, MAINT-01)
- Landed polish logs: `apps/desktop/IMPROVEMENTS.md`, `UI_IMPROVEMENTS.md`, `EXPERIENCE_IMPROVEMENTS.md`, `SLASH_IMPROVEMENTS.md`, `docs/plans/ux-review-improvements.md`
- Policy: `packages/shared/src/policy-to-grok-flags.ts` (sandbox not passed)
- Isolation: `packages/engine-grok/src/session.ts`
- Probe: `packages/engine-grok/src/discover.ts`
- ACP: `packages/provider-grok/`
- Worker HUD discipline: `apps/desktop/src/renderer/lib/subagent-hud.ts`
- Desk slash (coworker recipes, not CLI clone): `apps/desktop/src/renderer/lib/composer-input.ts`
- Grok Build docs: `~/.grok/docs/user-guide/` (sandbox, permissions, plan, subagents, memory, background tasks)
- Live CLI: `grok` 0.2.x (`--sandbox`, `--best-of-n`, `--check`, `--permission-mode`, `--worktree`, `--fork-session`, `--restore-code`, `--experimental-memory`)
