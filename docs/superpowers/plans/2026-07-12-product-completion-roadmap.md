# Product Completion Roadmap — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between backend-complete features and a shippable coworker product: expose role packs, real first-run trust, an actionable inbox, honest commerce/distribution, and a maintainable renderer shell—without adding net-new engine capabilities.

**Architecture:** Prefer **UI wiring over new gateway services**. Role packs (`rolePacks.list` + `tasks.create.rolePack`), inbox (`inbox.*`), and automation suggestions already live in gateway/shared. Renderer currently never calls them. Ship readiness is version/manifest/license honesty. Split `App.tsx` only after Phase A–C land so refactors don't block user-visible value.

**Tech Stack:** TypeScript monorepo, Electron (main/preload/renderer), React, Zod IPC (`packages/shared`), gateway SQLite, Vitest, i18n locale JSON, existing tray/notifications.

**Source review:** Session review (2026-07-12).  
**Related specs:** `docs/superpowers/specs/2026-07-10-grok-desk-design.md`, `docs/analysis/sota-notes.md`, `docs/plans/2026-07-11-polish-round-2.md`.

**Out of scope for this plan:** Docker/VM sandbox, Slack/Telegram bridges, multi-channel messaging, full 7-locale human translation, Heavy multi-agent redesign, hard auto-update CDN ops (download-link update is in scope; electron-updater optional follow-up).

---

## Execution order and independence

| Phase | Name | Depends on | Ships value alone? |
|-------|------|------------|--------------------|
| **A** | Role packs UI | — | Yes |
| **B** | First-run onboarding wizard | A optional (wizard can set pack) | Yes |
| **C** | Inbox + schedule-from-suggestion | — | Yes |
| **D** | Ship readiness (version, manifest, license honesty) | — | Yes |
| **E** | Renderer shell split (`App.tsx`) | Prefer after A–C | No (dev velocity) |
| **F** | Stickiness (takeaways prompt, NL schedule, light projects) | C helpful for schedule | Yes per task |
| **G** | Hardening (CI e2e, `.grok` safety residual, Windows QA checklist) | D for release claims | Yes |

**Recommended sequence:** A → C → B → D → E → F → G.  
**Parallelizable:** A ∥ C ∥ D; E after A–C merge; F after C; G continuous.

**Definition of done (whole roadmap):** A user can first-launch → pick pack + policy → run a task → receive a suggestion → one-click schedule it → see inbox “needs you” → check for updates with a non-placeholder manifest → license path rejects casual GD1 forge in release builds.

---

## File structure (create / modify)

```
packages/shared/src/
  index.ts                         # GROKDESK_VERSION → align with root package.json
  role-packs.ts                    # already complete; maybe icons/labels for UI
  automation-suggestions.ts        # parse helpers for inbox → schedule (optional)
  types.ts                         # OnboardingState if needed; project list later
  ipc.ts                           # inbox.acceptSuggestion OR reuse schedule.create
  release-manifest.ts              # already; consumer used by gateway
  settings-schema.ts               # onboardingCompleted, lastRolePackId, defaultWorkspaceRoots

packages/gateway/src/
  index.ts                         # optional schedules.createFromInbox; settings keys
  services/settings.ts             # onboarding + lastRolePack persistence
  services/inbox.ts                # structured metadata for suggestions (if needed)
  services/proactivity.ts          # optional: store draftSchedule as JSON in body/meta
  services/scheduler.ts            # unchanged create path

packages/license/src/
  keys.ts / activation.ts / service.ts  # confirm GD2-only release defaults (polish plan)

apps/desktop/src/renderer/
  lib/role-packs.ts                # NEW: labels, icons, local last-pack helper
  lib/onboarding.ts                # NEW: completion criteria pure helpers + tests
  lib/inbox-actions.ts             # NEW: parse suggestion → schedule.create payload
  lib/inbox-actions.test.ts        # NEW
  hooks/use-inbox.ts               # NEW: list/poll/mark/dismiss
  hooks/use-role-packs.ts          # NEW: fetch packs once
  components/role-pack-picker.tsx  # NEW
  components/onboarding-wizard.tsx # NEW
  components/inbox-panel.tsx       # NEW: sheet or sidebar section
  components/shell/app-sidebar.tsx # badge + inbox entry
  components/views/home-view.tsx   # pack chips, needs-you strip, drop raw EN ideas
  components/views/scheduled-view.tsx  # NL recurrence input
  components/views/settings/...    # update banner if present
  App.tsx                          # wire packs, inbox, onboarding gate; later split
  hooks/use-gateway-bootstrap.ts   # NEW in Phase E
  hooks/use-task-session.ts        # NEW in Phase E
  i18n/locales/en.json (+ es min)  # all new strings

docs/releases/latest.json          # real version when cutting a release (Phase D)
docs/superpowers/plans/…           # this file
```

---

## Phase A — Role packs UI

### Task A1: Pure UI helpers + tests for pack selection

**Files:**
- Create: `apps/desktop/src/renderer/lib/role-packs.ts`
- Create: `apps/desktop/src/renderer/lib/role-packs.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// apps/desktop/src/renderer/lib/role-packs.test.ts
import { describe, expect, it } from "vitest";
import {
  packEffortIfUnset,
  resolveCreateRolePack,
  ROLE_PACK_STORAGE_KEY,
} from "./role-packs";

describe("role-packs helpers", () => {
  it("resolveCreateRolePack prefers explicit selection over last-used", () => {
    expect(resolveCreateRolePack("research", "marketing")).toBe("research");
    expect(resolveCreateRolePack(null, "marketing")).toBe("marketing");
    expect(resolveCreateRolePack(null, null)).toBeNull();
  });

  it("packEffortIfUnset only fills when user left default", () => {
    expect(packEffortIfUnset("normal", "heavy")).toBe("heavy");
    expect(packEffortIfUnset("fast", "heavy")).toBe("fast");
  });

  it("storage key is stable", () => {
    expect(ROLE_PACK_STORAGE_KEY).toBe("grokdesk.lastRolePackId");
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
pnpm --filter @grokdesk/desktop exec vitest run src/renderer/lib/role-packs.test.ts
```

- [ ] **Step 3: Implement helpers**

```ts
// apps/desktop/src/renderer/lib/role-packs.ts
import type { EffortLevel, RolePack } from "@grokdesk/shared";

export const ROLE_PACK_STORAGE_KEY = "grokdesk.lastRolePackId";

export function resolveCreateRolePack(
  selected: string | null,
  lastUsed: string | null,
): string | null {
  return selected ?? lastUsed ?? null;
}

/** If the user never left "normal", adopt the pack default effort. */
export function packEffortIfUnset(
  current: EffortLevel,
  packDefault: EffortLevel | undefined,
): EffortLevel {
  if (current !== "normal" || !packDefault) return current;
  return packDefault;
}

export function readLastRolePackId(): string | null {
  try {
    return localStorage.getItem(ROLE_PACK_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function writeLastRolePackId(id: string | null): void {
  try {
    if (!id) localStorage.removeItem(ROLE_PACK_STORAGE_KEY);
    else localStorage.setItem(ROLE_PACK_STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function findPack(
  packs: RolePack[],
  id: string | null,
): RolePack | undefined {
  if (!id) return undefined;
  return packs.find((p) => p.id === id);
}
```

Note: export `RolePack` from `@grokdesk/shared` if not already public (it is via `role-packs.ts` → `index.ts`).

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/lib/role-packs.ts apps/desktop/src/renderer/lib/role-packs.test.ts
git commit -m "feat(desktop): role pack selection helpers"
```

---

### Task A2: `RolePackPicker` component

**Files:**
- Create: `apps/desktop/src/renderer/components/role-pack-picker.tsx`
- Modify: `apps/desktop/src/renderer/i18n/locales/en.json` (and `es.json` minimum)

- [ ] **Step 1: Add i18n keys**

```json
"rolePack": {
  "label": "Role pack",
  "none": "General",
  "noneDesc": "No specialist defaults",
  "marketing": "Marketing Agent",
  "research": "Researcher",
  "ops": "Ops / Files",
  "chiefOfStaff": "Chief of Staff"
}
```

(Use pack `name`/`description` from gateway as primary; i18n is fallback for "General".)

- [ ] **Step 2: Implement picker**

```tsx
// apps/desktop/src/renderer/components/role-pack-picker.tsx
import { cn } from "@/lib/utils";
import type { RolePack } from "@grokdesk/shared";
import { useT } from "@/i18n";

export function RolePackPicker(props: {
  packs: RolePack[];
  value: string | null;
  onChange: (id: string | null) => void;
  className?: string;
}) {
  const t = useT();
  const items: Array<{ id: string | null; name: string; description: string }> = [
    {
      id: null,
      name: t("rolePack.none"),
      description: t("rolePack.noneDesc"),
    },
    ...props.packs.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    })),
  ];

  return (
    <div
      className={cn("flex flex-wrap gap-2", props.className)}
      role="listbox"
      aria-label={t("rolePack.label")}
    >
      {items.map((item) => {
        const selected = props.value === item.id;
        return (
          <button
            key={item.id ?? "none"}
            type="button"
            role="option"
            aria-selected={selected}
            onClick={() => props.onChange(item.id)}
            className={cn(
              "max-w-[11rem] rounded-xl border px-3 py-2 text-left transition-colors",
              selected
                ? "border-primary/50 bg-primary/10"
                : "border-border/60 bg-card/40 hover:border-border",
            )}
          >
            <div className="text-[13px] font-medium leading-tight">{item.name}</div>
            <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {item.description}
            </div>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/renderer/components/role-pack-picker.tsx apps/desktop/src/renderer/i18n/locales/
git commit -m "feat(desktop): RolePackPicker component"
```

---

### Task A3: Wire `rolePack` through Home → `tasks.create`

**Files:**
- Modify: `apps/desktop/src/renderer/App.tsx` (state + `createTask`)
- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx`
- Optional: `apps/desktop/src/renderer/components/views/tasks-view.tsx` (badge already shows `t.rolePack`)

- [ ] **Step 1: Load packs once on bootstrap**

In `App.tsx` boot/`refresh` path (same place as `settings.get` / models):

```ts
const [rolePacks, setRolePacks] = useState<import("@grokdesk/shared").RolePack[]>([]);
const [rolePackId, setRolePackId] = useState<string | null>(() => readLastRolePackId());

// inside bootstrap:
const packs = await rpc<import("@grokdesk/shared").RolePack[]>("rolePacks.list", {});
setRolePacks(packs);
```

- [ ] **Step 2: Pass pack into create (replace hard-coded null)**

```ts
const resolvedPack = resolveCreateRolePack(rolePackId, readLastRolePackId());
const pack = findPack(rolePacks, resolvedPack);
const effortForCreate = packEffortIfUnset(effort, pack?.defaultEffort);

const task = await rpc<Task>("tasks.create", {
  goal: g,
  workspaceRoots,
  model,
  effort: effortForCreate,
  approvalMode,
  rolePack: resolvedPack,
  attachments: atts,
});
writeLastRolePackId(resolvedPack);
```

Update optimistic task the same way (`rolePack: resolvedPack`, `effort: effortForCreate`).

- [ ] **Step 3: HomeView props**

Add:

```ts
rolePacks: RolePack[];
rolePackId: string | null;
onRolePack: (id: string | null) => void;
```

Render `<RolePackPicker />` above model/effort controls (near compose).

- [ ] **Step 4: Manual verify**

```bash
pnpm dev
# Home → select "Researcher" → Run "Summarize this folder"
# Task list should show rolePack; memory should gain "Role pack: Researcher" standing item
```

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/App.tsx apps/desktop/src/renderer/components/views/home-view.tsx
git commit -m "feat(desktop): wire role packs into task create"
```

---

## Phase B — First-run onboarding wizard

### Task B1: Onboarding pure helpers + settings flag

**Files:**
- Create: `apps/desktop/src/renderer/lib/onboarding.ts`
- Create: `apps/desktop/src/renderer/lib/onboarding.test.ts`
- Modify: `packages/shared/src/settings-schema.ts` — add optional `onboardingCompleted?: boolean` (and maybe `defaultWorkspaceRoots` if not present)
- Modify: `packages/gateway/src/services/settings.ts` — default `onboardingCompleted: false`

- [ ] **Step 1: Tests for completion criteria**

```ts
import { describe, expect, it } from "vitest";
import { shouldShowOnboarding } from "./onboarding";

describe("shouldShowOnboarding", () => {
  it("shows when not completed and missing auth or roots", () => {
    expect(
      shouldShowOnboarding({
        onboardingCompleted: false,
        signedIn: false,
        hasWorkspaceRoot: false,
        hasApprovalModeChosen: false,
      }),
    ).toBe(true);
  });

  it("hides when completed flag set", () => {
    expect(
      shouldShowOnboarding({
        onboardingCompleted: true,
        signedIn: false,
        hasWorkspaceRoot: false,
        hasApprovalModeChosen: false,
      }),
    ).toBe(false);
  });
});
```

```ts
// onboarding.ts
export function shouldShowOnboarding(s: {
  onboardingCompleted: boolean;
  signedIn: boolean;
  hasWorkspaceRoot: boolean;
  hasApprovalModeChosen: boolean;
}): boolean {
  if (s.onboardingCompleted) return false;
  // Show until user finishes wizard even if partially signed in
  return true;
}

export type OnboardingStepId =
  | "welcome"
  | "auth"
  | "workspace"
  | "policy"
  | "done";

export const ONBOARDING_STEPS: OnboardingStepId[] = [
  "welcome",
  "auth",
  "workspace",
  "policy",
  "done",
];
```

- [ ] **Step 2: Persist `onboardingCompleted` via `settings.set`**

In `APP_SETTINGS_SETTABLE_KEYS` / schema:

```ts
onboardingCompleted: z.boolean().optional(),
lastRolePackId: z.string().nullable().optional(), // optional dual-write with localStorage
```

Gateway defaults: `onboardingCompleted: false`.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/settings-schema.ts packages/gateway/src/services/settings.ts \
  apps/desktop/src/renderer/lib/onboarding.ts apps/desktop/src/renderer/lib/onboarding.test.ts
git commit -m "feat: onboarding completion flag and helpers"
```

---

### Task B2: Wizard UI + gate in App

**Files:**
- Create: `apps/desktop/src/renderer/components/onboarding-wizard.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: i18n locales

**Wizard steps (mandatory product copy):**

1. **Welcome** — coworker positioning (not terminal).  
2. **Auth** — Sign in with SuperGrok CTA (`auth` IPC already used on Home).  
3. **Workspace** — pick default folder (`pickDirectory` / existing `onPickRoot`).  
4. **Policy** — Strict / Balanced / Autopilot with short risk text; default Balanced. Optional role pack chips (reuse `RolePackPicker`).  
5. **Done** — enable recommended connectors optional checkbox → `connectors.enableRecommended` if exists; set `onboardingCompleted: true`.

- [ ] **Step 1: Implement modal/fullscreen wizard**

Use existing `Dialog` or full-panel overlay (prefer full-panel for first launch — less “dismissable modal” feel). Block main nav until complete **or** allow Skip that still sets `onboardingCompleted: true` only after policy step minimum (auth can be deferred with warning).

Product decision (lock in):

- **Skip auth** allowed with banner “Scheduled/proactive paused until sign-in.”  
- **Workspace + approval mode required** to finish.

- [ ] **Step 2: Gate render**

```tsx
{showOnboarding ? (
  <OnboardingWizard
    auth={auth}
    root={root}
    approvalMode={approvalMode}
    rolePacks={rolePacks}
    rolePackId={rolePackId}
    onPickRoot={...}
    onApprovalMode={setApprovalMode}
    onRolePack={setRolePackId}
    onSignIn={...}
    onComplete={async () => {
      await rpc("settings.set", { onboardingCompleted: true });
      writeLastRolePackId(rolePackId);
      setShowOnboarding(false);
    }}
  />
) : (
  /* existing shell */
)}
```

Replace Home-only checklist (`grokdesk.onboarding.dismissed`) with wizard; migrate: if old localStorage dismissed **and** signed in + root, set `onboardingCompleted: true` once.

- [ ] **Step 3: Manual verify first-run** (clear settings / fresh user data dir)

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): first-run onboarding wizard"
```

---

## Phase C — Inbox + schedule-from-suggestion

### Task C1: Parse suggestion bodies → schedule payload

Proactivity currently stores draft schedule as free text:

```
Draft schedule: Weekly priority review (0 9 * * 1)
Goal: Review standing priorities...
```

**Files:**
- Create: `apps/desktop/src/renderer/lib/inbox-actions.ts`
- Create: `apps/desktop/src/renderer/lib/inbox-actions.test.ts`
- Optional better long-term: gateway stores `meta: { draftSchedule }` on inbox rows (schema change). Prefer **parser first** (no DB migration); upgrade storage in same PR if parser is fragile.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { parseSuggestionDraftSchedule } from "./inbox-actions";

describe("parseSuggestionDraftSchedule", () => {
  it("parses proactivity body format", () => {
    const body = [
      "Based on your standing context...",
      "",
      "Draft schedule: Weekly priority review (0 9 * * 1)",
      "Goal: Review standing priorities and open loops.",
    ].join("\n");
    const d = parseSuggestionDraftSchedule(body);
    expect(d).toEqual({
      name: "Weekly priority review",
      cron: "0 9 * * 1",
      goalTemplate: "Review standing priorities and open loops.",
    });
  });

  it("returns null when not a suggestion draft", () => {
    expect(parseSuggestionDraftSchedule("Task failed")).toBeNull();
  });
});
```

- [ ] **Step 2: Implement parser**

```ts
export function parseSuggestionDraftSchedule(body: string): {
  name: string;
  cron: string;
  goalTemplate: string;
} | null {
  const scheduleLine = body.match(
    /Draft schedule:\s*(.+?)\s*\(([^)]+)\)\s*$/m,
  );
  const goalLine = body.match(/^Goal:\s*(.+)$/m);
  if (!scheduleLine || !goalLine) return null;
  return {
    name: scheduleLine[1].trim(),
    cron: scheduleLine[2].trim(),
    goalTemplate: goalLine[1].trim(),
  };
}
```

- [ ] **Step 3: Prefer structured meta (optional same task)**

If touching gateway is cheap: extend `inbox.add` to accept optional `metaJson`; proactivity writes `JSON.stringify(s.draftSchedule)`. Parser becomes fallback. Only do this if you already edit `inbox.ts` / schema in this phase.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): parse automation suggestion draft schedules"
```

---

### Task C2: Inbox panel UI + App wiring

**Files:**
- Create: `apps/desktop/src/renderer/components/inbox-panel.tsx`
- Create: `apps/desktop/src/renderer/hooks/use-inbox.ts`
- Modify: `apps/desktop/src/renderer/components/shell/app-sidebar.tsx` (badge count)
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx` (“Needs you” strip)
- Modify: `apps/desktop/src/main/tray.ts` (tooltip “N need you” — optional)

- [ ] **Step 1: Hook**

```ts
// use-inbox.ts
export function useInbox(pollMs = 4000) {
  const [items, setItems] = useState<InboxItem[]>([]);
  const refresh = useCallback(async () => {
    const list = await rpc<InboxItem[]>("inbox.list", {});
    setItems(list);
  }, []);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);
  return { items, refresh, unread: items.filter((i) => !i.read).length };
}
```

- [ ] **Step 2: Panel actions**

| Kind | Primary CTA | Secondary |
|------|-------------|-----------|
| `approval` / `unfinished` | Open task | Dismiss |
| `suggestion` | Create schedule | Dismiss |
| `reauth` | Open Settings → Account | Dismiss |
| other | Mark read | Dismiss |

Create schedule:

```ts
const draft = parseSuggestionDraftSchedule(item.body);
if (!draft) { toast destructive; return; }
const roots = root.trim() ? [root.trim()] : [];
if (!roots.length) {
  toast({ description: t("inbox.needWorkspace"), variant: "destructive" });
  return;
}
await rpc("schedule.create", {
  name: draft.name,
  goalTemplate: draft.goalTemplate,
  cron: draft.cron,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  workspaceRoots: roots,
  approvalMode,
  model,
  effort,
  quietHoursRespect: true,
});
await rpc("inbox.dismiss", { id: item.id });
toast({ description: t("inbox.scheduleCreated") });
// navigate to Scheduled
```

- [ ] **Step 3: Sidebar badge** — unread count on Home or new Inbox control (⌘K action “Inbox”).

- [ ] **Step 4: Home “Needs you”** — top 3 unread approval/unfinished with Open.

- [ ] **Step 5: Manual verify**

Seed via proactivity tests or memory standing “weekly priorities” + wait for tick, or call `proactivity` test harness. Faster: unit tests for parser + gateway proactivity already emit suggestions.

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(desktop): inbox panel and schedule-from-suggestion"
```

---

## Phase D — Ship readiness

### Task D1: Align versions

**Files:**
- Modify: `packages/shared/src/index.ts` — `GROKDESK_VERSION`
- Modify: root `package.json` / `apps/desktop/package.json` — single source of truth
- Prefer: read version from `package.json` at build time OR set all to `0.1.2` now and document bump script

- [ ] **Step 1:**

```ts
// packages/shared/src/index.ts
export const GROKDESK_VERSION = "0.1.2";
```

- [ ] **Step 2:** Grep for `0.1.0` and stale versions; fix UI about strings.

- [ ] **Step 3:** Commit `chore: align GROKDESK_VERSION with 0.1.2`

---

### Task D2: Release manifest honesty + Settings update surface

**Files:**
- Modify: `docs/releases/latest.json` when cutting a real build (not fake digests)
- Modify: Settings Account (or About) — call `updates.manifest` (gateway already has `updates.manifest`)
- Create: `apps/desktop/src/renderer/lib/update-check.ts` + test using `parseReleaseManifest`

- [ ] **Step 1:** UI shows:

- Current version vs manifest version  
- If newer: primary button opens download URL (`shell.openExternal`)  
- If channel `dev` / placeholder SHA: show “Development channel — updates not verified”

- [ ] **Step 2:** Do **not** claim auto-update until electron-updater lands (out of scope).

- [ ] **Step 3:** Commit `feat(desktop): update available check via release manifest`

---

### Task D3: License release posture checklist

Follow residual items from `docs/plans/2026-07-11-polish-round-2.md` §1 if not already on `main`:

- [ ] Confirm `allowHmac` defaults false without `GROKDESK_LICENSE_SECRET`
- [ ] Offline verify always re-checks key crypto
- [ ] Document in `docs/license-release-keys.md`: embed real `GROKDESK_LICENSE_PUBLIC_KEY` at release; private key never in client
- [ ] Integration tests green

```bash
pnpm --filter @grokdesk/license test
pnpm --filter @grokdesk/gateway test
```

- [ ] Commit only if code changes remain; else document “verified done on main” in this plan checkbox.

---

## Phase E — Renderer shell split

### Task E1: Extract bootstrap + polling from `App.tsx`

**Files:**
- Create: `apps/desktop/src/renderer/hooks/use-gateway-bootstrap.ts`
- Create: `apps/desktop/src/renderer/hooks/use-task-session.ts`
- Modify: `apps/desktop/src/renderer/App.tsx` (thin orchestrator)

**Boundaries:**

| Hook | Owns |
|------|------|
| `useGatewayBootstrap` | auth, settings, models, rolePacks, gatewayUiStatus, boot skeleton |
| `useTaskSession` | tasks list, selectedId, events afterSeq, create/cancel/approve, optimistic create |
| `useInbox` | from Phase C |
| App | nav, layout, pass props / context |

- [ ] **Step 1:** Move state + effects without behavior change (no UI redesign).

- [ ] **Step 2:** Run desktop unit tests + typecheck:

```bash
pnpm --filter @grokdesk/desktop typecheck
pnpm --filter @grokdesk/desktop test
```

- [ ] **Step 3:** Commit `refactor(desktop): extract gateway bootstrap and task session hooks`

**Do not** split `task-workspace-view.tsx` in this plan unless a task already requires edits there.

---

## Phase F — Stickiness (optional after A–D)

### Task F1: Post-task takeaway prompt

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` or completion path in App
- Reuse: `buildTakeawaysContent` / memory.upsert already used in coworker features

- [ ] When task transitions to `done`, soft toast or inline card: “Remember takeaways?” → existing remember flow.
- [ ] Commit `feat(desktop): prompt remember takeaways on task done`

---

### Task F2: Natural-language schedule field

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/scheduled-view.tsx`
- Use: `naturalLanguageToCron` from `@grokdesk/shared`

- [ ] Input placeholder: “every monday 9am”
- [ ] On blur/submit: if parse succeeds, fill cron; else show “Use cron or try: every day 9am”
- [ ] Expand `naturalLanguageToCron` only for 3–5 more phrases if tests demand (weekdays, biweekly — keep minimal)
- [ ] Commit `feat(desktop): natural language schedule recurrence helper`

---

### Task F3: Light projects (defer if time-boxed)

**Minimum viable:** filter tasks by `projectId` + free-text project name stored as memory kind `project` only—**no full Projects CRUD** unless A–D are done.

Skip full Projects IA in first execution pass.

---

## Phase G — Hardening

### Task G1: CI smoke / package path

**Files:**
- Modify: `.github/workflows/*` if present
- Ensure: `pnpm typecheck` + `pnpm test` + desktop build on PR
- Optional: opt-in e2e job `workflow_dispatch` only (keep Playwright smoke opt-in)

- [ ] Commit workflow only if missing gates.

---

### Task G2: `.grok` workspace safety residual

If not already on `main` (see polish round 2 §2):

- [ ] Write `.grok/.gitignore` (`config.toml`, `skills/`) on MCP write
- [ ] Managed-marker strip for MCP tables only
- [ ] Full skill dir copy fallback

```bash
pnpm --filter @grokdesk/shared test
```

---

### Task G3: Windows QA checklist (manual doc)

**Create:** `docs/qa/windows-parity-checklist.md`

```markdown
# Windows parity checklist

- [ ] Install NSIS/portable build
- [ ] SuperGrok sign-in
- [ ] Task create + artifact reveal in Explorer
- [ ] Tray pause/resume
- [ ] Browser pane open
- [ ] Desktop control grant + one click (if supported)
- [ ] Path roots with spaces
- [ ] Notifications
```

- [ ] Commit doc; run checklist before public Windows claim.

---

## Verification gates

### After each phase

```bash
pnpm --filter @grokdesk/shared build
pnpm --filter @grokdesk/gateway build
pnpm --filter @grokdesk/engine-grok build
pnpm test
pnpm typecheck
pnpm --filter @grokdesk/desktop typecheck
```

### End-to-end product gate (human)

1. Fresh profile → wizard completes with workspace + Balanced.  
2. Select Marketing pack → run campaign brief task → standing memory present.  
3. Add memory about “weekly priorities” → proactivity suggestion appears (or force tick in test).  
4. Inbox → Create schedule → rule appears on Scheduled.  
5. Settings → version matches package; update UI honest about channel.  
6. License: GD1 key without env secret fails activate (release posture).

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Suggestion body format drifts | Prefer structured inbox meta in same PR as parser |
| Onboarding blocks power users | Skip after policy; migrate old checklist flag |
| App.tsx split causes regressions | Phase E behavior-preserving only; full test suite |
| Placeholder manifest shipped to customers | Gate D2: refuse non-placeholder digests for `channel: "stable"` |
| Role pack skills names ≠ installed skill ids | Gateway already merges skill *ids*; packs reference marketing/research/files/planning — ensure bundled packs match (`skills/` dirs) |

---

## Self-review (plan vs original suggestions)

| Review recommendation | Plan phase |
|----------------------|------------|
| Surface role packs | A |
| First-run policy wizard | B |
| Inbox + one-click schedule from suggestion | C |
| Commerce/manifest/version honesty | D |
| Split App.tsx | E |
| Memory takeaways / NL schedule / projects light | F |
| CI, `.grok` safety, Windows QA | G |
| Auto-update full electron-updater | Explicitly out of scope (download link only) |
| Credential vault UI | Out of scope (follow-up) |
| Gateway push vs poll | Out of scope (follow-up after E) |
| Grok capability chips (X/Imagine) | Out of scope (follow-up) |

---

## Commit strategy

- One logical commit per task (A1, A2, …).  
- No force-push; no commit of `release/*.dmg` binaries.  
- Prefer feature branch: `feat/product-completion-a-role-packs` then stack or sequential merges per phase.

---

## Estimated effort

| Phase | Effort (engineer familiar with repo) |
|-------|--------------------------------------|
| A | 0.5–1 day |
| B | 1 day |
| C | 1–1.5 days |
| D | 0.5–1 day |
| E | 1 day |
| F | 0.5–1 day |
| G | 0.5 day + manual QA |

**Total:** ~5–7 engineering days for A–E + G essentials; F optional polish.
