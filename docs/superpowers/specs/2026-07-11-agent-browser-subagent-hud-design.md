# Grok Desk — Agent Browser + Subagent HUD

**Date:** 2026-07-11  
**Status:** Approved  
**Product:** Grok Desk  
**Related:** [Grok Desk product design](./2026-07-10-grok-desk-design.md)

## 1. Summary

Add two complementary surfaces so multi-step agent work is visible and iterable:

1. **In-app agent browser** — an isolated Electron browser pane the agent drives (observe + steer in v1), with the user able to watch a live ~50% split via a minimal globe control.
2. **Subagent HUD** — a lightweight count/list of running child agents so parallel work is glanceable without mission-control clutter.

**One-liner:** Grok drives a sandboxed in-app browser; the user watches through a globe; subagents show up as a quiet count.

## 2. Goals and non-goals

### Goals

| Goal | Detail |
|------|--------|
| Agent cockpit | Agent navigates and interacts so it can check work and iterate without leaving Desk |
| Day-one visibility | User can see what the agent is browsing in roughly half the task workspace |
| Minimal chrome | Globe icon + live pane; no heavy browser toolbar clutter |
| Isolation | Dedicated agent profile/session — no user cookies, passwords, or extensions |
| Hybrid open | Auto-open pane on first browser action; pin / keep-closed control |
| Path to user drive | Architecture allows later user interaction in the same pane (product path C) |
| Subagent glanceability | Compact count → short expand list → focus stream; not an org chart |
| Policy reuse | Browser tools respect Strict / Balanced / Autopilot and full audit |

### Non-goals (v1)

- Shared real Chrome / user logged-in profile
- User typing into the page (deferred to later phase)
- Full cockpit tools (tabs, wait-for, upload, multi-frame) on day one
- Per-subagent separate browser panes
- Multi-window browser farm or user-facing DevTools
- Replacing optional headless Playwright/Chrome MCP for power users (in-app browser is the product path)

## 3. Product decisions (locked)

| Decision | Choice |
|----------|--------|
| Primary mode | **A — Agent cockpit** (agent drives) |
| Later mode | **C — User can drive / assist** in the same isolated pane |
| Layout open policy | **D — Hybrid:** auto-open on first `browser.*`; pin / collapse / keep-closed |
| Subagent UI | **A — Lightweight HUD** |
| Trust model | **A — Isolated agent browser** only |
| Action surface | **D — Observe + steer now; full cockpit later** |
| Implementation shell | **Electron `WebContentsView` / `BrowserView` cockpit** (not screenshot-only mirror, not system Chrome attach) |

## 4. UX

### 4.1 Globe control

- A **globe** icon in task chrome represents the agent browser.
- **Idle:** no badge/dot when no browser session for the task.
- **Active:** quiet badge/dot while the agent has a live page / in-flight browser tools.
- **Click:** toggle the live pane open/closed.
- No large “Agent browser” labels or multi-button toolbars in v1.

### 4.2 Live pane

When open, the task workspace splits roughly **50% stream | 50% live page**.

- Pane is **almost chrome-less**: live content is the product.
- Optional one-line status (URL or last action) only if needed; prefer hover or subtle footer over permanent chrome.
- **Pin** (quiet): keep open while idle.
- **Collapse / ×:** hide pane; agent may continue off-screen.
- **Keep closed (per task):** after user dismisses, do not auto-reopen for that task; globe still shows active state.

### 4.3 Auto-open rules

| Event | Behavior |
|-------|----------|
| First `browser.*` tool on a task | Open ~50% pane unless keep-closed for that task |
| Further browser tools while open | Update live view; no extra UI thrash |
| Browser tools while collapsed (not keep-closed) | Soft re-open on activity (throttle if needed) |
| No browser tools yet | Full-width stream (current layout) |

### 4.4 Subagent HUD

- Compact count near globe or status area (e.g. `2`), **hidden when zero / no children**.
- Click expands a short list: `{name, status, current step}`.
- Click a row focuses that agent’s activity in the stream (or child task thread).
- v1 does **not** include per-agent kill or org-chart layout.

### 4.5 Errors and empty states

| State | UX |
|-------|-----|
| No browser yet | No pane; globe idle |
| Loading | Globe active indicator; normal page load in pane if open |
| Nav / network error | Simple error in pane if open; short tool failure in stream |
| Policy block | Existing approval card in stream; no modal spam |
| Tool failure (selector, etc.) | `tool_result` failure + one-line reason; agent may retry |
| Task done / cancel | Close pane; wipe partition; globe idle |
| Keep closed | Agent browses off-screen; active dot on globe only |
| HUD empty | Hide count |
| Single parent only | No extra HUD chrome |

## 5. Browser tools and policy

### 5.1 Isolation

- Electron `session` partition dedicated to the agent browser (e.g. per-task `task-<id>` or equivalent).
- No access to the user’s default session, cookies, passwords, or extensions.
- Default: **wipe partition when task completes or is cancelled**.

### 5.2 Tools (v1 — observe + steer)

| Tool | Behavior |
|------|----------|
| `browser.open` | Load URL in the agent view |
| `browser.click` | Click by selector or coordinates |
| `browser.type` | Focus target and type text (optional submit) |
| `browser.scroll` | Scroll page or element |
| `browser.screenshot` | Capture viewport; available to stream/artifacts |
| `browser.read` | Visible text / simple accessibility-oriented snapshot |

Later (full cockpit, same pane): tabs, wait-for, select, file upload, hover, multi-frame.

### 5.3 Policy mapping

| Mode | Browser behavior |
|------|------------------|
| **Strict** | Confirm each navigation to a new origin; confirm type/click that submits |
| **Balanced (default)** | Confirm first open per origin; form submits and downloads need approval; same-origin click/type/scroll free |
| **Autopilot** | No interactive confirms; full audit still required |

Always:

- Block `file://` and local/private network targets unless user explicitly elevates.
- Append audit entries for every browser tool (action, URL/target summary, result).
- Global pause / task cancel stops new browser tools and tears down or freezes the view.

### 5.4 Visibility link

- Browser tool calls may auto-open the globe pane (subject to keep-closed).
- Screenshots and read results still appear in the task stream so history works with the pane closed.

## 6. Architecture

```
┌─ Electron main ──────────────────────────────────────────┐
│  BrowserService                                          │
│  · WebContentsView / BrowserView per task                │
│  · isolated session partition                            │
│  · exec: open, click, type, scroll, screenshot, read     │
│  · emits browser.status → renderer                       │
└────────────▲───────────────────────────────┬─────────────┘
             │ tool exec                     │ bounds / globe
┌────────────┴────────────┐     ┌────────────▼─────────────┐
│ Gateway                 │     │ Renderer (task workspace)│
│ · policy gate           │     │ · globe toggle / split   │
│ · audit log             │     │ · view bounds only       │
│ · map engine tool_use   │     │ · subagent HUD           │
│   → BrowserService      │     └──────────────────────────┘
└────────────▲────────────┘
             │ events
┌────────────┴────────────┐
│ Engine (Grok Build)     │
│ · invokes browser.*     │
└─────────────────────────┘
```

### 6.1 Ownership

| Component | Responsibility |
|-----------|----------------|
| **Main `BrowserService`** | Real browser instance, isolation, tool execution, status events |
| **Gateway** | Policy evaluation, audit, task lifecycle, tool routing |
| **Renderer** | Globe, split layout, HUD; **no** privileged browser control |
| **Engine** | Decides when to browse; consumes tool results only |

### 6.2 Tool wiring

Desk-hosted tools: gateway advertises `browser.*` to the engine (direct tool bridge and/or a small local MCP the engine loads). Execution path is always **Main BrowserService**, never renderer-privileged automation.

Optional headless Playwright / Chrome MCP connectors may remain for advanced users; the **in-app globe browser is the primary product browser** when available.

### 6.3 Lifecycle

1. Task starts → no browser instance.
2. First `browser.*` → create view + partition; renderer auto-splits unless keep-closed.
3. Task cancel/done → destroy view; wipe partition by default.
4. Pause all → reject or queue new browser tools; freeze loads.

### 6.4 Subagent HUD data

- Reuse existing task model and `parentTaskId`.
- HUD aggregates **parent + running/queued/waiting children** for the open chat.
- `current step` = latest tool or step event on that task.
- No new multi-agent orchestrator in this spec — presentation + reliable child events only.

### 6.5 Layout integration note

Renderer owns split percentages and reports **content bounds** to main so `BrowserService` can position the native view. On collapse, hide or detach the view without necessarily destroying the session until task end (so off-screen agent browsing can continue).

## 7. Phased rollout

| Phase | Scope | Exit criteria |
|-------|--------|----------------|
| **P0** | BrowserService + isolation; `open` / `screenshot` / `read`; globe + 50% pane auto-open/collapse | Agent opens a URL; user sees live page via globe |
| **P1** | `click` / `type` / `scroll`; Balanced policy; audit | Closed-loop site checks with approvals |
| **P2** | Subagent HUD (count → list → focus stream) | Parallel work is glanceable |
| **P3** | Full cockpit tools (tabs, wait, select, …) | Same shell, more power |
| **P4** | User interaction in pane (path to C) | Optional handoff; still isolated profile |

**v1 product slice = P0–P2.** P3–P4 follow without redesigning the shell.

## 8. Testing

| Layer | Coverage |
|-------|----------|
| Unit | Policy matrix (origin, submit, autopilot); tool arg validation; HUD aggregation from parent/child tasks |
| Main integration | Partition isolation; open URL; screenshot bytes; no leak to default session |
| Gateway | Tool request → policy → exec → `tool_result` + audit |
| Renderer | Globe toggle; auto-open once; keep-closed sticky per task; split bounds |
| E2E smoke | Fake engine emits `browser.open` → pane appears → screenshot/result in stream |
| Hard denials | `file://` and private-network targets blocked without elevate |

## 9. Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Engine may not call custom tools reliably | Local MCP or engine tool bridge; skill/preamble guidance to use `browser.*` |
| Electron view API differences (`WebContentsView` vs `BrowserView`) | Thin adapter behind BrowserService |
| Auto-open thrash | Throttle re-open; prefer globe active state over layout flip |
| Memory (heavy pages) | One view per active task; destroy on done |
| Policy gaps on form submits | Balanced mode treats submit/download as approval-gated |

## 10. Success criteria

- User can glance at a **globe** and open a live half-pane without learning a browser chrome.
- Agent can open a public page, read/screenshot it, and (P1) click/type enough to complete a simple multi-step web check under Balanced policy.
- Parallel child tasks surface as a **quiet count**, expandable to status + step, without cluttering the stream.
- No use of the user’s real browser profile in v1.
- Architecture leaves a clear path to user-driven interaction (P4) in the same isolated pane.

## 11. Open implementation details (non-blocking)

Resolved at plan/implementation time, not product unknowns:

- Exact Electron API (`WebContentsView` preferred if available on target Electron).
- Partition key scheme (`taskId` vs workspace id).
- Exact IPC method names for bounds + status.
- Whether `browser.*` is injected as MCP server vs native engine tool list.

---

**Approval:** Product design approved in brainstorming session 2026-07-11 (Approach 1 + sections 1–5).
