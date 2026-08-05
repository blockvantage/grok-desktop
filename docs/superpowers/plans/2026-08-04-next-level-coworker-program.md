# Next-Level Coworker Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap from “impressive SuperGrok desktop chat” to a trustworthy night-shift coworker: real trust enforcement, unattended schedule outcomes, memory that compounds, file review that restores, connectors/skills depth, light local sharing, and habit loops — **without** mobile remote / telepresence product work.

**Architecture:** Build on the existing local gateway + SQLite + Electron renderer. Prefer pure shared helpers, gateway services, and thin UI wiring over new processes. Trust improvements must project **honest** effective protection (never claim more than the engine enforces). Night-shift, memory, and recap reuse inbox + scheduler + proactivity. File review stores pre-edit snapshots on the gateway so Accept/Revert are real. Computer-use hardening only after Trust Phase A.

**Tech Stack:** TypeScript pnpm monorepo, Vitest, Electron (`apps/desktop`), gateway (`packages/gateway`), shared contracts (`packages/shared`), Grok engine/provider (`packages/engine-grok`, `packages/provider-grok`), existing SQLite schema via `packages/gateway/src/db.ts`.

**Baseline (2026-08-04):** Sticky CLI port, ACP-default when probed, plan-first, context meter, approvals, browser + desktop planes, artifacts, recipes, connector presets, bundled skills, role packs, morning briefing pure helper, free-app updater, durable chat outbox — **already landed**. This program does **not** re-implement those. It closes honesty and habit gaps.

---

## Out of scope (explicit)

| Excluded | Why |
|----------|-----|
| Mobile remote client (iOS/Android) | User deferred — needs pairing/relay/telepresence surface not wanted yet |
| Remote relay product expansion, QR pairing polish, multi-device remote | Same |
| Cloud-hosted agent / multi-tenant SaaS | Violates local-first wedge |
| Plugin marketplace (install from GitHub registry) | Stretch after D; not required for coworker habit |
| Multi-user team workspaces / RBAC | Later |
| Full CLI `xai-hunk-tracker` parity or IDE-grade multi-hunk UI | Phase E does **file-level** snapshot accept/revert only |
| Multi-model IDE positioning | Stay coworker, not Cursor clone |

Remote-related **code already in tree** (settings Remote tab, telepresence services) must not regress; do not expand it in this program.

---

## North-star outcomes

After this program ships:

1. **Trust** — Careful/Balanced/Autopilot maps to documented CLI sandbox + permission flags when the probe supports them; Protection chip and Settings never over-claim; user can browse audit for a task.
2. **Night shift** — Scheduled runs that finish (or fail/wait) produce durable inbox outcomes; Home morning brief surfaces overnight results; quiet hours respected for *notifications*, not for silent work.
3. **Memory compounds** — One-tap takeaways land in reviewable memory; weekly recap inbox item (opt-in); suggestions improve from unfinished + standing rules.
4. **Files** — Review changes Accept/Revert restore or keep real bytes on disk, with audit rows.
5. **Ecosystem** — Create-skill wizard, Claude/Cursor import under trusted folders, connector gallery remains the happy path.
6. **Share** — One-click export pack (markdown + deliverables zip) stays local (no hosted links).
7. **Computer use** — Hardened deny/exclusive/pause paths only after Trust A; no new RPA scope.

---

## Execution order

| Phase | Name | Depends on | Ships alone? | Est. effort |
|-------|------|------------|--------------|-------------|
| **A** | Trust solid | — | Yes | Large |
| **B** | Night-shift loop | A recommended (can start in parallel on pure services) | Yes | Medium |
| **C** | Memory compounds | B helpful (recap uses completed scheduled/interactive tasks) | Yes | Medium |
| **D** | Ecosystem depth | — | Yes | Medium |
| **E** | True file review + export pack | A for audit | Yes | Medium |
| **F** | Computer-use hardening | **A required** | Yes | Small–Medium |
| **G** | Habit & Home polish | B, C | Yes | Small |

**Recommended sequence:** A → B → C → E → D ∥ F → G.

**Parallelizable:** D with B/C after A; F only after A merge; G last polish pass.

**Definition of done (whole program):** A dogfood user can: set Autopilot on a trusted folder with honest protection display → schedule overnight jobs → wake to morning brief + inbox → Accept/Revert real file edits → remember takeaways → receive weekly recap → export a deliverable pack — all without mobile remote.

---

## File structure (create / modify by phase)

```
packages/shared/src/
  types.ts                          # InboxKind + recap; Audit list DTOs if needed
  policy-to-grok-flags.ts           # A: permission rule compile honesty
  effective-protection.ts           # A: already exists; extend tests
  takeaways.ts                      # C: extend for recap aggregation
  weekly-recap.ts                   # C: NEW pure builder
  memory-suggestions.ts             # C: optional pure ranking helpers
  file-snapshot.ts                  # E: NEW pure path/hash helpers
  export-pack.ts                    # E: NEW pack manifest pure helpers
  settings-schema.ts                # B/C: weeklyRecapEnabled, schedule outcome prefs
  ipc.ts                            # new methods: audit.list, memory.acceptTakeaway,
                                    #   workspace.snapshotFile, workspace.revertFile,
                                    #   artifacts.exportPack, skills.create, skills.importPaths
  index.ts                          # re-exports

packages/gateway/src/
  db.ts                             # migrations: file_snapshots, weekly_recap_cursor,
                                    #   audit list indexes if needed
  services/audit.ts                 # A: list/filter API
  services/audit-list.ts            # A: NEW
  services/policy-provider-gate.ts  # A: tighten fail-closed
  services/acp-permission-bridge.ts # A: remembered grants ledger hooks
  services/permission-grants.ts     # A: NEW remembered allow/deny grants
  services/schedule-outcomes.ts     # B: NEW watch task terminal → inbox
  services/scheduler.ts             # B: wire outcomes
  services/proactivity.ts           # B/C: overnight digest + recap tick
  services/weekly-recap.ts          # C: NEW service
  services/memory.ts                # C: accept takeaway path
  services/file-snapshots.ts        # E: NEW
  services/export-pack.ts           # E: NEW
  services/skills-authoring.ts      # D: NEW create/import
  index.ts / domain-dispatch        # wire IPC

apps/desktop/src/renderer/
  components/views/settings/permissions-tab.tsx  # A: grants + audit deep link
  components/audit-drawer.tsx                    # A: NEW
  components/protection-chip.tsx                 # A: polish only if needed
  components/inbox-panel.tsx                     # B/C: recap + schedule_done actions
  components/views/home-view.tsx                 # B/G: overnight strip
  lib/morning-briefing.ts                        # B: overnight completed lines
  components/views/memory-view.tsx               # C: takeaways / recap accept
  components/conversation/*                      # C: remember chip on done turn
  components/review-changes-strip.tsx            # E: real revert IPC
  lib/review-changes.ts                          # E: keep pure; wire gateway
  components/views/artifacts-view.tsx            # E: export pack
  components/views/settings/tools-tab.tsx        # D: create skill / import
  components/create-skill-wizard.tsx             # D: NEW
  lib/task-recipes.ts                            # G: first-class recipes polish
  i18n/locales/en.json                           # all new strings
```

---

## Phase A — Trust solid

**Goal:** Policy labels match enforceable behavior; users can inspect audit; partial mediation is honest.

**Related:** `codex_improve.md` SEC-01/GROK-02, `packages/shared/src/policy-to-grok-flags.ts`, `effective-protection.ts`, `packages/gateway/src/services/audit.ts`, ACP permission broker.

### Task A1: Audit list API (gateway + shared)

**Files:**
- Create: `packages/gateway/src/services/audit-list.ts`
- Create: `packages/gateway/src/services/audit-list.test.ts`
- Modify: `packages/gateway/src/services/audit.ts` (add `list` if missing)
- Modify: `packages/shared/src/ipc.ts` — method `audit.list`
- Modify: gateway dispatch + renderer `lib/api.ts`

- [ ] **Step 1: Write failing tests for list filter**

```ts
// packages/gateway/src/services/audit-list.test.ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { openTestDb } from "../db.test-helpers.js"; // use existing test DB helper pattern in gateway
import { AuditService } from "./audit.js";
import { listAuditEntries } from "./audit-list.js";

describe("listAuditEntries", () => {
  it("returns newest first for a taskId", () => {
    // open db, append two audit rows for same taskId with different createdAt
    // expect listAuditEntries(db, { taskId, limit: 10 })[0].action === later action
  });

  it("filters by decision when provided", () => {
    // append allow + deny; filter decision: "deny" → only deny rows
  });

  it("caps limit at 500", () => {
    expect(listAuditEntries(db, { limit: 9999 }).length).toBeLessThanOrEqual(500);
  });
});
```

Use the same SQLite test harness other gateway services use (`db.ts` temp path pattern from `audit` / `inbox` tests). If `db.test-helpers` does not exist, copy the open/close pattern from `packages/gateway/src/services/inbox.test.ts` or `proactivity.test.ts`.

- [ ] **Step 2: Run test — expect FAIL** (module missing)

```bash
pnpm --filter @grokdesk/gateway test src/services/audit-list.test.ts
```

- [ ] **Step 3: Implement pure list helper + AuditService.list**

```ts
// packages/gateway/src/services/audit-list.ts
import type { AuditEntry } from "@grokdesk/shared";
import type { Db } from "../db.js";

export type AuditListParams = {
  taskId?: string | null;
  decision?: AuditEntry["decision"] | null;
  limit?: number;
};

export function listAuditEntries(db: Db, params: AuditListParams = {}): AuditEntry[] {
  const limit = Math.min(Math.max(1, Math.floor(params.limit ?? 100)), 500);
  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (params.taskId) {
    clauses.push("task_id = ?");
    binds.push(params.taskId);
  }
  if (params.decision) {
    clauses.push("decision = ?");
    binds.push(params.decision);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db
    .prepare(
      `SELECT id, task_id, action, detail_json, decision, created_at
       FROM audit_entries ${where}
       ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...binds, limit) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    taskId: (r.task_id as string | null) ?? null,
    action: r.action as string,
    detail: JSON.parse(String(r.detail_json ?? "{}")) as Record<string, unknown>,
    decision: r.decision as AuditEntry["decision"],
    createdAt: r.created_at as string,
  }));
}
```

Wire `AuditService.list` to call this. Add IPC `audit.list` with zod params `{ taskId?: string, decision?: string, limit?: number }`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/audit-list.ts packages/gateway/src/services/audit-list.test.ts packages/gateway/src/services/audit.ts packages/shared/src/ipc.ts packages/gateway/src/index.ts
git commit -m "feat(trust): audit.list API for task and decision filters"
```

### Task A2: Audit drawer UI (task workspace + Settings)

**Files:**
- Create: `apps/desktop/src/renderer/components/audit-drawer.tsx`
- Create: `apps/desktop/src/renderer/components/audit-drawer.test.tsx`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` (overflow “View audit”)
- Modify: `apps/desktop/src/renderer/components/views/settings/permissions-tab.tsx` (link: recent decisions)
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json`

- [ ] **Step 1: Component test — empty + rows render**

```tsx
// apps/desktop/src/renderer/components/audit-drawer.test.tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuditDrawer } from "./audit-drawer";

describe("AuditDrawer", () => {
  it("shows empty copy when no entries", () => {
    render(
      <AuditDrawer open entries={[]} onOpenChange={() => {}} taskLabel="Demo" />,
    );
    expect(screen.getByText(/no decisions yet/i)).toBeTruthy();
  });

  it("renders action and decision for each entry", () => {
    render(
      <AuditDrawer
        open
        taskLabel="Demo"
        onOpenChange={() => {}}
        entries={[
          {
            id: "1",
            taskId: "t1",
            action: "tool.shell",
            detail: { command: "ls" },
            decision: "approve",
            createdAt: "2026-08-04T12:00:00.000Z",
          },
        ]}
      />,
    );
    expect(screen.getByText(/tool\.shell/i)).toBeTruthy();
    expect(screen.getByText(/approve/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement sheet listing entries (newest first); load via `api.audit.list({ taskId })` when opened**

- [ ] **Step 3: Wire overflow menu on task workspace; Settings Permissions “Recent decisions” opens global list (no taskId)**

- [ ] **Step 4: Run desktop component tests + typecheck**

```bash
pnpm --filter @grokdesk/desktop test src/renderer/components/audit-drawer.test.tsx
pnpm typecheck
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(trust): audit drawer for task and global decisions"
```

### Task A3: Effective protection snapshot on every run attempt

**Files:**
- Modify: `packages/gateway/src/services/run-context.ts` / runner spawn path
- Modify: `packages/shared/src/effective-protection.ts` (+ tests if gaps)
- Modify: store snapshot JSON on run attempt or first task event for UI reload

- [ ] **Step 1: Test that after spawn, protection projected from **actual argv** matches stored snapshot**

Use existing `projectEffectiveProtection` / `projectProtectionFromArgs` helpers. Assert `sandboxProfile` is null when argv lacks `--sandbox`, even if settings say Autopilot.

- [ ] **Step 2: On engine start, persist `effectiveProtection` onto run context or a task event kind `protection_snapshot`**

- [ ] **Step 3: Protection chip prefers event/snapshot over live recompute when reopening a historical task**

- [ ] **Step 4: Tests green; commit**

```bash
git commit -m "feat(trust): persist effective protection snapshot per run"
```

### Task A4: Fail-closed policy when sandbox required but unsupported

**Files:**
- Modify: `packages/gateway/src/services/policy-provider-gate.ts`
- Modify: `packages/gateway/src/services/policy-provider-gate.test.ts`
- Modify: settings optional `requireSandboxForAutopilot` default **false** (honesty first; opt-in hard gate)

- [ ] **Step 1: Failing test — when `requireSandboxForAutopilot: true` and probe `supportsSandbox === false`, task create / run preflight returns structured error, does not spawn**

- [ ] **Step 2: Implement gate in preflight path used by runner (same place network/shell gates run)**

- [ ] **Step 3: UI: Preferences copy under Autopilot — “Require OS sandbox when available” toggle; when sandbox unavailable chip shows `sandbox_unavailable` (already in `ProtectionChipSegment`)**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(trust): optional fail-closed when autopilot lacks sandbox"
```

### Task A5: Remembered permission grants (ACP broker)

**Files:**
- Create: `packages/gateway/src/services/permission-grants.ts`
- Create: `packages/gateway/src/services/permission-grants.test.ts`
- Modify: `packages/gateway/src/db.ts` — table `permission_grants`
- Modify: ACP permission bridge to check grants before parking approval
- Modify: Settings Permissions tab — list/revoke grants

Schema:

```sql
CREATE TABLE IF NOT EXISTS permission_grants (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,          -- 'workspace' | 'global'
  workspace_root TEXT,          -- null for global
  tool_pattern TEXT NOT NULL,   -- e.g. 'Write(**)' or tool id
  decision TEXT NOT NULL,       -- 'allow' | 'deny'
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
```

- [ ] **Step 1: Unit tests — allow grant suppresses re-prompt for matching tool; deny always blocks; revoke removes row**

- [ ] **Step 2: Implement store + match helper (glob simple suffix/prefix; fail closed on ambiguous)**

- [ ] **Step 3: Bridge: on user Approve with “Always allow for this workspace”, insert grant + audit info row**

- [ ] **Step 4: Settings UI list + Revoke; commit**

```bash
git commit -m "feat(trust): remembered workspace permission grants with revoke UI"
```

### Task A6: Trust phase verification gate

- [ ] **Step 1: Run**

```bash
pnpm typecheck
pnpm --filter @grokdesk/shared test
pnpm --filter @grokdesk/gateway test
pnpm --filter @grokdesk/desktop test
```

- [ ] **Step 2: Manual checklist (document in PR):** Careful mode on folder → write prompts; Autopilot → chip shows sandbox profile or sandbox_unavailable; audit drawer shows decisions; revoke grant forces re-prompt

- [ ] **Step 3: Commit docs note if claim matrix needs update** (`docs/evidence/claim-to-test-matrix.md` — only claim what tests prove)

---

## Phase B — Night-shift loop

**Goal:** Overnight work produces trustworthy outcomes on the desk in the morning.

### Task B1: Schedule outcome → inbox (`schedule_done` / unfinished)

**Files:**
- Create: `packages/gateway/src/services/schedule-outcomes.ts`
- Create: `packages/gateway/src/services/schedule-outcomes.test.ts`
- Modify: runner post-exit / task status transitions
- Modify: `packages/gateway/src/services/inbox.ts` if dedupe rules needed

`InboxKind` already includes `"schedule_done"`. Use it.

- [ ] **Step 1: Pure tests**

```ts
// packages/gateway/src/services/schedule-outcomes.test.ts
import { describe, expect, it } from "vitest";
import { buildScheduleOutcomeInbox } from "./schedule-outcomes.js";

describe("buildScheduleOutcomeInbox", () => {
  it("returns schedule_done for done task with scheduleRuleId", () => {
    const item = buildScheduleOutcomeInbox({
      task: {
        id: "t1",
        goal: "Brief the launch",
        status: "done",
        scheduleRuleId: "s1",
        title: "Launch brief",
      },
      scheduleName: "Night shift",
    });
    expect(item?.kind).toBe("schedule_done");
    expect(item?.title).toMatch(/Night shift|Launch brief/i);
    expect(item?.taskId).toBe("t1");
  });

  it("returns unfinished for failed scheduled task", () => {
    const item = buildScheduleOutcomeInbox({
      task: {
        id: "t2",
        goal: "x",
        status: "failed",
        scheduleRuleId: "s1",
        title: null,
      },
      scheduleName: "Night shift",
    });
    expect(item?.kind).toBe("unfinished");
  });

  it("returns null when scheduleRuleId is null (interactive)", () => {
    expect(
      buildScheduleOutcomeInbox({
        task: {
          id: "t3",
          goal: "x",
          status: "done",
          scheduleRuleId: null,
          title: null,
        },
        scheduleName: null,
      }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `buildScheduleOutcomeInbox` + `ScheduleOutcomeService.onTaskTerminal(task)` that inserts deduped inbox (`taskId` = task id, kind = outcome kind)**

- [ ] **Step 3: Call from the single task terminal path (post-engine-exit / status set to done|failed|cancelled)** — not from scheduler tick alone

- [ ] **Step 4: When status is waiting_approval on a scheduled task, proactivity already nags; ensure title includes schedule name if available**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(night-shift): inbox outcomes for scheduled task completion and failure"
```

### Task B2: Overnight strip on Home (extend morning briefing)

**Files:**
- Modify: `apps/desktop/src/renderer/lib/morning-briefing.ts`
- Modify: `apps/desktop/src/renderer/lib/morning-briefing.test.ts` (create if missing)
- Modify: `apps/desktop/src/renderer/lib/coworker-home.ts` / `home-view.tsx`

- [ ] **Step 1: Extend types**

```ts
// add to BriefingLine kind union:
// "overnight_done" | "overnight_waiting"
```

- [ ] **Step 2: Tests**

```ts
it("surfaces schedule_done inbox as overnight line in morning hours", () => {
  const brief = buildMorningBriefing({
    tasks: [],
    schedules: [],
    inbox: [
      {
        id: "i1",
        kind: "schedule_done",
        title: "Night shift finished",
        read: false,
      },
    ],
    now: new Date("2026-08-04T08:00:00"),
  });
  expect(brief.lines.some((l) => l.kind === "overnight_done")).toBe(true);
  expect(brief.actionable).toBe(true);
});
```

- [ ] **Step 3: Implement; Home card CTA deep-links to task or Artifacts**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(night-shift): morning brief overnight completed strip"
```

### Task B3: Quiet hours honesty for notifications only

**Files:**
- Modify: `packages/gateway/src/services/proactivity.ts`
- Modify: `packages/gateway/src/services/notify-scheduler.ts` (if OS toasts fire from here)
- Modify: scheduler — **do not** block task execution during quiet hours (confirm current behavior; scheduled work should still run)

- [ ] **Step 1: Test — during quiet hours, `tick()` still does not add *suggestion* spam, but schedule_done from B1 path still inserts (outcomes are durable truth, not nudges)**

Clarify product rule in code comment:

- Quiet hours suppress **proactive suggestions** and **OS notifications**
- Quiet hours do **not** suppress writing `schedule_done` / approval inbox rows (user must see them in the morning)

- [ ] **Step 2: If today quiet hours block all inbox adds in proactivity, keep that for suggestion/approval *dedupe pings* from proactivity only; B1 inserts bypass proactivity**

- [ ] **Step 3: Commit**

```bash
git commit -m "fix(night-shift): quiet hours suppress nudges not schedule outcomes"
```

### Task B4: Schedule rule → expected deliverable hint (light)

**Files:**
- Modify: schedule create UI + schema if needed (`goal` already exists)
- Modify: `packages/shared` schedule types — optional `successHint?: string` (e.g. “launch-brief.md exists”)

Keep YAGNI: **optional free-text success hint** stored on rule; shown on `schedule_done` body (“Expected: …”). No filesystem assertion engine in v1.

- [ ] **Step 1: Schema/settings migration if column needed; default null**

- [ ] **Step 2: UI field on Scheduled view create/edit**

- [ ] **Step 3: Include hint in B1 inbox body when present**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(night-shift): optional success hint on schedule rules"
```

### Task B5: Phase B verification

```bash
pnpm --filter @grokdesk/gateway test src/services/schedule-outcomes.test.ts
pnpm --filter @grokdesk/desktop test src/renderer/lib/morning-briefing
pnpm typecheck
```

Manual: create cron rule 1 minute out → wait → see task run → inbox schedule_done → morning brief line.

---

## Phase C — Memory that compounds

**Goal:** Day-30 “three words” path — takeaways stick; weekly recap; better suggestions.

### Task C1: One-tap “Remember this” on completed turns

**Files:**
- Modify: `packages/shared/src/takeaways.ts` (+ tests)
- Modify: gateway memory create path
- Modify: `apps/desktop/src/renderer/components/conversation/conversation-turn.tsx` or done-summary chips
- IPC: `memory.acceptTakeaway` or reuse `memory.upsert`

- [ ] **Step 1: Extend takeaways helper**

```ts
// packages/shared/src/takeaways.ts
export function buildTakeawayMemoryItem(opts: {
  taskId: string;
  goal: string;
  events: TakeawayEvent[];
  kind?: "standing" | "project" | "preference";
}): { kind: string; title: string; content: string; provenance: string } {
  const content = buildTakeawaysContent(opts);
  return {
    kind: opts.kind ?? "standing",
    title: `Takeaway: ${opts.goal.slice(0, 80)}`,
    content,
    provenance: `task:${opts.taskId}`,
  };
}
```

- [ ] **Step 2: Tests for content length + provenance**

- [ ] **Step 3: UI chip on done turn → calls memory create → toast “Saved to Memory” → opens Memory view optional**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(memory): one-tap remember takeaway from completed turn"
```

### Task C2: Weekly recap pure builder (was sticky Task 15)

**Files:**
- Create: `packages/shared/src/weekly-recap.ts`
- Create: `packages/shared/src/weekly-recap.test.ts`

- [ ] **Step 1: Implement pure function (no I/O)**

```ts
// packages/shared/src/weekly-recap.ts
export type RecapInputItem = {
  id: string;
  title: string;
  content: string;
  updatedAt: string; // ISO
  kind: string;
};

export type WeeklyRecapLine = {
  text: string;
  suggestedMemory: string | null;
  sourceId: string;
};

export type WeeklyRecap = {
  title: string;
  lines: WeeklyRecapLine[];
  weekStartIso: string;
  weekEndIso: string;
};

export function buildWeeklyRecap(opts: {
  memoryItems: RecapInputItem[];
  completedTaskSummaries: { id: string; goal: string; doneAt: string }[];
  now: Date;
  maxLines?: number;
}): WeeklyRecap | null {
  // trailing 7 days window; null if no items
  // lines from completed tasks + memory touched in window
  // never invent content — only summarize titles/goals
}
```

- [ ] **Step 2: Tests — empty week → null; two tasks → two lines; respects maxLines**

- [ ] **Step 3: Export from `@grokdesk/shared`; commit**

```bash
git commit -m "feat(memory): pure weekly recap builder"
```

### Task C3: Weekly recap gateway service + inbox kind

**Files:**
- Create: `packages/gateway/src/services/weekly-recap.ts`
- Create: `packages/gateway/src/services/weekly-recap.test.ts`
- Modify: `packages/shared/src/types.ts` — add `"recap"` to `InboxKind`
- Modify: settings schema `weeklyRecapEnabled: boolean` default `true` (or false if spam-averse — prefer **true** with quiet hours + one item/week)
- Modify: proactivity or scheduler weekly tick
- db: store last recap week key in settings to prevent spam

- [ ] **Step 1: Service tests with fake memory/tasks lists**

- [ ] **Step 2: Once per ISO week, if enabled and not quiet-hours-for-notify, insert inbox kind `recap` with body = joined lines; `taskId` = `recap:YYYY-Www` for dedupe**

- [ ] **Step 3: Inbox panel: Accept line → memory.create; Dismiss → mark read**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(memory): weekly recap inbox item with per-line remember"
```

### Task C4: Stronger automation suggestions from unfinished work

**Files:**
- Modify: `packages/shared/src/automation-suggestions.ts`
- Modify: tests
- Modify: proactivity wiring (already calls suggestAutomationsFromMemory)

- [ ] **Step 1: Add suggestions for failed/cancelled tasks in last 7 days without an enabled schedule covering same goal fingerprint**

- [ ] **Step 2: Dedupe by suggestionKey; never more than 3 new suggestions per tick**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(memory): suggest schedules from unfinished recent work"
```

### Task C5: Phase C verification

```bash
pnpm --filter @grokdesk/shared test src/weekly-recap.test.ts src/takeaways
pnpm --filter @grokdesk/gateway test src/services/weekly-recap.test.ts src/services/proactivity.test.ts
```

Manual: complete a task → Remember → appears in Memory; force weekly recap tick in test harness.

---

## Phase D — Ecosystem depth

**Goal:** Skills and connectors feel like an app store without building a marketplace.

### Task D1: Create-skill wizard (Desk-native SKILL.md)

**Files:**
- Create: `packages/gateway/src/services/skills-authoring.ts`
- Create: `packages/gateway/src/services/skills-authoring.test.ts`
- Create: `apps/desktop/src/renderer/components/create-skill-wizard.tsx`
- Modify: Tools settings tab
- IPC: `skills.create`

- [ ] **Step 1: Pure writer test — given name + description + body, writes `dir/SKILL.md` with frontmatter**

```ts
export function renderSkillMd(input: {
  name: string;
  description: string;
  body: string;
}): string {
  return `---
name: ${input.name}
description: ${input.description}
---

${input.body.trim()}\n`;
}
```

- [ ] **Step 2: Gateway writes under user skills root (first of settings.skillsPaths or `userData/skills`); appends path to skillsPaths if needed; rebuilds engine skills env on next run**

- [ ] **Step 3: Wizard UI: name, description, instructions, “Save skill”; validation no path traversal**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(skills): create-skill wizard writes SKILL.md to user skills path"
```

### Task D2: Import Claude / Cursor skill roots (trusted folder only)

**Files:**
- Modify: `packages/shared/src/skills-resolve.ts` / folder-trust
- Modify: onboarding or Tools tab “Import from project”
- Tests for path allowlist

- [ ] **Step 1: Only scan `.claude/skills`, `.cursor/skills`, `.agents/skills`, `.grok/skills` under a **trusted** workspace root**

- [ ] **Step 2: Present multi-select list; on confirm, add those directories to `skillsPaths` (not copy, reference) OR copy into user skills — **prefer reference + trust gate** for YAGNI**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(skills): import skill paths from trusted project roots"
```

### Task D3: Connector gallery polish (no new presets required)

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/settings/tools-tab.tsx`
- Modify: `packages/shared/src/connector-presets.ts` only if categories missing

- [ ] **Step 1: Ensure Recommended / category chips / search already work; add empty-state CTA “Enable recommended connectors” calling existing `connectors.enableRecommended`**

- [ ] **Step 2: Doctor status badge per row (reuse `mcp-doctor`)**

- [ ] **Step 3: Commit only if UX gaps found; otherwise note N/A in phase exit**

### Task D4: Role pack → skills/memory apply audit

**Files:**
- Modify: `packages/gateway/src/services/role-pack-apply.ts`
- UI: show “Pack applied: Marketing” chip on task create

- [ ] **Step 1: Confirm packs write standing memory (already); add audit info row `role_pack.apply`**

- [ ] **Step 2: Home role pack picker already exists — ensure last-used pack restores**

- [ ] **Step 3: Commit if code changes**

---

## Phase E — True file review + local export pack

**Goal:** Accept/Revert mean something; share stays local.

### Task E1: Pre-edit file snapshots on write tools

**Files:**
- Create: `packages/gateway/src/services/file-snapshots.ts`
- Create: `packages/gateway/src/services/file-snapshots.test.ts`
- Modify: `db.ts` — `file_snapshots` table
- Hook: host write / tool mediation path **or** runner when tool_result indicates write and path under workspace

```sql
CREATE TABLE IF NOT EXISTS file_snapshots (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  path TEXT NOT NULL,
  content BLOB,
  existed INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

- [ ] **Step 1: Tests — snapshot stores prior content; missing file → existed=0; path outside workspace roots → reject**

- [ ] **Step 2: On first mutating tool for path in task, snapshot once (do not overwrite snapshot)**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(files): snapshot workspace files before first agent write"
```

### Task E2: Revert / Accept IPC

**Files:**
- Modify: gateway workspace dispatch
- Modify: `apps/desktop/src/renderer/lib/review-changes.ts` (keep pure list)
- Modify: `review-changes-strip.tsx` — call IPC
- Audit: log accept/revert decisions

- [ ] **Step 1: `workspace.revertFile({ taskId, path })` restores snapshot bytes or deletes if !existed; fails if no snapshot**

- [ ] **Step 2: `workspace.acceptFile({ taskId, path })` drops snapshot row (keep disk as-is) + audit allow**

- [ ] **Step 3: UI: Revert calls revertFile; Accept calls acceptFile; both remove strip row on success**

- [ ] **Step 4: Tests + commit**

```bash
git commit -m "feat(files): accept and revert use durable pre-edit snapshots"
```

### Task E3: Export pack (local zip + markdown)

**Files:**
- Create: `packages/gateway/src/services/export-pack.ts`
- Create: `packages/shared/src/export-pack.ts` (manifest pure)
- Modify: artifacts view + chat overflow “Export pack”
- Use Node zlib/archiver if already a dep; else write a simple folder copy + `pack-manifest.json` without zip first — **prefer zip if `archiver` or similar exists in lockfile; else folder export to user-chosen directory via dialog**

- [ ] **Step 1: Pure manifest builder test**

```ts
export function buildExportManifest(input: {
  taskId: string;
  goal: string;
  files: { path: string; relativeName: string }[];
  exportedAt: string;
}): { version: 1; taskId: string; goal: string; files: string[]; exportedAt: string } {
  return {
    version: 1,
    taskId: input.taskId,
    goal: input.goal,
    files: input.files.map((f) => f.relativeName),
    exportedAt: input.exportedAt,
  };
}
```

- [ ] **Step 2: Gateway copies allowlisted artifact paths + `README.md` summary (from chat export helper) into dest dir**

- [ ] **Step 3: Renderer: folder picker → export → toast path + Reveal**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(share): local export pack for task deliverables and summary"
```

---

## Phase F — Computer-use hardening (after A)

**Goal:** Desktop control is safer to leave on; not a new feature surface.

### Task F1: Deny-list and exclusive-mode audit

**Files:**
- `packages/shared/src/desktop-deny.ts`
- `apps/desktop/src/main/desktop-use-service.ts`
- gateway desktop task ops

- [ ] **Step 1: Inventory existing deny paths; add tests that blocked apps/URLs never reach OS adapter**

- [ ] **Step 2: Every desktop grant decision writes audit entry (reuse AuditService)**

- [ ] **Step 3: Soft-pause + Pause all still force-disconnect control (regression tests)**

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): audit desktop control grants and tighten deny tests"
```

### Task F2: Settings copy honesty

- [ ] **Step 1: Permissions tab states desktop control requires Accessibility/Screen Recording; Autopilot does not skip OS permission prompts**

- [ ] **Step 2: Commit copy/i18n only if needed**

**Do not** expand telepresence, remote desktop streaming, or mobile pairing in this phase.

---

## Phase G — Habit & Home polish

**Goal:** Power hides; habit surfaces stay calm.

### Task G1: Home IA pass

**Files:**
- `home-view.tsx`, `coworker-home.ts`, `home-landing-policy.ts`

- [ ] **Step 1: Priority order on Home: Needs you → Overnight results → Continue drafts → Recipes → New goal**

- [ ] **Step 2: Hide engine jargon (ACP, argv) behind Advanced; Protection chip stays**

- [ ] **Step 3: Tests for landing policy pure helpers; commit**

```bash
git commit -m "feat(home): prioritize needs-you and overnight over engine chrome"
```

### Task G2: Recipes as first-class playbooks

**Files:**
- `apps/desktop/src/renderer/lib/task-recipes.ts`
- Home chips + “Save as recipe” from successful task

- [ ] **Step 1: Ensure save recipe captures goal template, role pack, effort, planFirst, workspace preference**

- [ ] **Step 2: Cap list; export/import recipes as JSON file (local) for backup — optional small win**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(home): richer task recipes from successful work"
```

### Task G3: Tray / OS notification for schedule_done (respect quiet hours)

**Files:**
- notify path in main + gateway hooks

- [ ] **Step 1: On schedule_done insert, if not quiet hours, fire OS notification “Night shift finished” with deep link to task**

- [ ] **Step 2: Tests for quiet hours skip; commit**

```bash
git commit -m "feat(night-shift): OS notification on schedule completion outside quiet hours"
```

### Task G4: Program exit gate

- [ ] **Step 1: Full CI-equivalent**

```bash
pnpm typecheck
pnpm test
pnpm --filter @grokdesk/desktop release-qa
```

- [ ] **Step 2: Update README only for claims that are true post-program (Accept/Revert real; weekly recap; audit drawer). No mobile remote claims.

- [ ] **Step 3: Update `docs/evidence/claim-to-test-matrix.md` rows for trust + recap + file revert

- [ ] **Step 4: Final commit**

```bash
git commit -m "docs: next-level coworker program exit claims and matrix"
```

---

## Testing strategy (all phases)

| Layer | Command |
|-------|---------|
| Shared pure | `pnpm --filter @grokdesk/shared test` |
| Gateway | `pnpm --filter @grokdesk/gateway test` |
| Desktop unit | `pnpm --filter @grokdesk/desktop test` |
| Typecheck | `pnpm typecheck` |
| Chat e2e (after E/A) | `pnpm --filter @grokdesk/desktop e2e:chat` |
| Approvals e2e | `pnpm --filter @grokdesk/desktop exec playwright test e2e/chat-approvals.spec.ts` |

**TDD rule:** For every new pure helper and gateway service, write the failing test first. UI may use component tests where behavior is non-trivial (audit drawer, review strip).

**Adversarial trust tests (Phase A must add at least one):**

- Strict/Careful + no sandbox support → chip not “fully sandboxed”
- Path outside workspace roots → snapshot/revert reject
- Permission deny grant → tool never auto-approved

---

## Risk register

| Risk | Mitigation |
|------|------------|
| `executesOwnTools` still means incomplete pre-mediation | Never claim full mediation; Protection chip `partial_mediation`; prefer ACP broker path |
| Snapshot disk growth | Cap snapshots per task (e.g. 50 files / 20MB); prune on task delete |
| Weekly recap spam | One per ISO week; quiet hours; empty week → no item |
| Create-skill path traversal | Normalize + ensure under skills root |
| Computer-use OS permission friction | Copy + checklist; do not soft-fail into silent control |
| Scope creep into mobile remote | Hard out-of-scope table; reject PRs that touch `apps/mobile` product paths for this program |

---

## Spec coverage checklist (self-review)

| Next-level theme (excl. mobile) | Phase / tasks |
|---------------------------------|---------------|
| Trust solid (sandbox honesty, audit, grants) | A1–A6 |
| Night-shift loop (outcomes, morning, quiet hours) | B1–B5, G3 |
| Memory compounds (takeaways, recap, suggestions) | C1–C5 |
| Connector / skills depth | D1–D4 |
| Light share / export | E3 |
| True file Accept/Revert | E1–E2 |
| Computer-use carefully | F1–F2 |
| Experience + habit polish | G1–G2, G4 |
| Distribution (auto-update already DONE) | No rebuild; G4 claim matrix only |
| Mobile remote | **OUT OF SCOPE** |

**Placeholder scan:** No TBD implementation steps; deferred items named as cuts (marketplace, team SaaS, hunk-level IDE).

**Type consistency:**

- `InboxKind` gains `"recap"` in C3 (keep `"schedule_done"` as-is)
- Snapshot table `file_snapshots` used by E1/E2 only
- IPC names: `audit.list`, `memory` existing upsert, `workspace.revertFile`, `workspace.acceptFile`, `artifacts.exportPack` or `workspace.exportPack`, `skills.create`, `skills.importPaths`

---

## Suggested PR slices (for stacked delivery)

1. `feat(trust): audit list + drawer`
2. `feat(trust): protection snapshot + optional sandbox gate + grants`
3. `feat(night-shift): schedule outcomes + morning strip + quiet hours honesty`
4. `feat(memory): takeaways + weekly recap + unfinished suggestions`
5. `feat(files): snapshots accept/revert + export pack`
6. `feat(skills): create + import`
7. `feat(desktop): control audit hardening`
8. `feat(home): habit polish + notifications`

---

## Handoff

Plan saved for execution with subagent-driven development (one task at a time, review between tasks) or inline execution with checkpoints after each phase.

**Start here:** Task A1 (audit list API) — smallest vertical that unblocks visible trust UX and does not depend on engine changes.
