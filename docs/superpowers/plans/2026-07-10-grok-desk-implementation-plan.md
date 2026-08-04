# Grok Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Grok Desk — a SuperGrok-powered Cowork-class desktop agent for macOS and Windows with parallel tasks, scheduling, local memory, host policy, and desktop proactivity.

**Architecture:** Electron shell (React UI + tray) talks over typed IPC to an in-process/local TypeScript gateway. The gateway owns SQLite state, policy, scheduler, memory, and proactivity. Task execution goes through a Grok Build engine adapter (SuperGrok session). Shared pure logic lives in `packages/shared`.

**Tech Stack:** TypeScript, pnpm workspaces, Electron 33+, React 18, Vite, better-sqlite3, vitest, zod, electron-builder, keytar (OS secrets), cron-parser, Grok Build CLI as engine.

**Spec:** `docs/superpowers/specs/2026-07-10-grok-desk-design.md`

**Platforms:** Every stage ships for **macOS and Windows** with shared code and platform adapters only where required.

---

## File structure (create as tasks progress)

```
grok-desktop/
├── package.json                          # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .gitignore
├── README.md
├── apps/
│   └── desktop/
│       ├── package.json
│       ├── electron.vite.config.ts
│       ├── electron-builder.yml
│       ├── src/
│       │   ├── main/
│       │   │   ├── index.ts              # app entry, window, lifecycle
│       │   │   ├── tray.ts               # menu bar / system tray
│       │   │   ├── notifications.ts
│       │   │   ├── protocol.ts           # grokdesk://
│       │   │   ├── ipc-bridge.ts         # main ↔ gateway ↔ renderer
│       │   │   └── secrets.ts            # keytar wrappers
│       │   ├── preload/
│       │   │   └── index.ts              # contextBridge API
│       │   └── renderer/
│       │       ├── index.html
│       │       ├── main.tsx
│       │       ├── App.tsx
│       │       ├── styles/global.css
│       │       ├── lib/api.ts            # typed client to preload
│       │       ├── lib/store.ts
│       │       └── views/
│       │           ├── HomeView.tsx
│       │           ├── TasksView.tsx
│       │           ├── TaskWorkspace.tsx
│       │           ├── ScheduleView.tsx
│       │           ├── MemoryView.tsx
│       │           ├── SkillsView.tsx
│       │           ├── SettingsView.tsx
│       │           ├── InboxPanel.tsx
│       │           ├── OnboardingWizard.tsx
│       │           └── components/
│       │               ├── TaskList.tsx
│       │               ├── EventStream.tsx
│       │               ├── ArtifactList.tsx
│       │               ├── ApprovalModal.tsx
│       │               ├── ModelEffortBar.tsx
│       │               └── StatusBadge.tsx
│       └── resources/
│           ├── icon.icns
│           ├── icon.ico
│           └── trayTemplate.png
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts
│   │       ├── types.ts                  # Task, Event, Memory, Schedule…
│   │       ├── ipc.ts                    # IPC method map + zod schemas
│   │       ├── policy.ts                 # pure policy evaluation
│   │       ├── paths.ts                  # cross-platform path helpers
│   │       ├── recurrence.ts             # NL/cron helpers
│   │       └── role-packs.ts             # pack definitions
│   ├── gateway/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vitest.config.ts
│   │   └── src/
│   │       ├── index.ts                  # Gateway class, public API
│   │       ├── db.ts                     # SQLite schema + migrations
│   │       ├── config.ts                 # data dirs per OS
│   │       ├── services/
│   │       │   ├── tasks.ts
│   │       │   ├── policy-service.ts
│   │       │   ├── audit.ts
│   │       │   ├── scheduler.ts
│   │       │   ├── memory.ts
│   │       │   ├── proactivity.ts
│   │       │   ├── artifacts.ts
│   │       │   ├── auth.ts
│   │       │   └── inbox.ts
│   │       └── embeddings/
│   │           └── local.ts              # simple local embedder interface
│   └── engine-grok/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── index.ts
│           ├── discover.ts               # find grok CLI on PATH / common installs
│           ├── session.ts                # spawn + stream
│           ├── auth-bridge.ts            # session status / login trigger
│           ├── events.ts                 # normalize engine events
│           └── types.ts
└── docs/
    └── superpowers/
        ├── specs/2026-07-10-grok-desk-design.md
        └── plans/2026-07-10-grok-desk-implementation-plan.md
```

---

## Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/index.ts`
- Create: `packages/gateway/package.json`
- Create: `packages/gateway/tsconfig.json`
- Create: `packages/gateway/src/index.ts`
- Create: `packages/engine-grok/package.json`
- Create: `packages/engine-grok/tsconfig.json`
- Create: `packages/engine-grok/src/index.ts`
- Create: `apps/desktop/package.json`

- [ ] **Step 1: Create root workspace files**

`package.json`:
```json
{
  "name": "grok-desktop",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.6.0",
  "scripts": {
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "dev": "pnpm --filter @grokdesk/desktop dev",
    "typecheck": "pnpm -r run typecheck"
  },
  "engines": {
    "node": ">=20"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
```

`.gitignore`:
```
node_modules
dist
out
.DS_Store
*.log
coverage
.env
.env.*
apps/desktop/release
```

`README.md`:
```markdown
# Grok Desk

SuperGrok-powered desktop coworker (Cowork-class) for macOS and Windows.

See `docs/superpowers/specs/2026-07-10-grok-desk-design.md`.

## Develop

```bash
pnpm install
pnpm test
pnpm dev
```
```

- [ ] **Step 2: Create package stubs**

`packages/shared/package.json`:
```json
{
  "name": "@grokdesk/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"]
}
```

`packages/shared/src/index.ts`:
```ts
export const GROKDESK_VERSION = "0.1.0";
```

`packages/gateway/package.json`:
```json
{
  "name": "@grokdesk/gateway",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@grokdesk/shared": "workspace:*",
    "@grokdesk/engine-grok": "workspace:*",
    "better-sqlite3": "^11.5.0",
    "cron-parser": "^4.9.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`packages/gateway/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [
    { "path": "../shared" },
    { "path": "../engine-grok" }
  ]
}
```

`packages/gateway/src/index.ts`:
```ts
export class Gateway {
  async start(): Promise<void> {
    // implemented in later tasks
  }

  async stop(): Promise<void> {
    // implemented in later tasks
  }
}
```

`packages/engine-grok/package.json`:
```json
{
  "name": "@grokdesk/engine-grok",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@grokdesk/shared": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`packages/engine-grok/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": true
  },
  "include": ["src"],
  "references": [{ "path": "../shared" }]
}
```

`packages/engine-grok/src/index.ts`:
```ts
export type EngineStatus = "unknown" | "missing" | "ready" | "needs_auth";

export async function getEngineStatus(): Promise<EngineStatus> {
  return "unknown";
}
```

`apps/desktop/package.json`:
```json
{
  "name": "@grokdesk/desktop",
  "version": "0.1.0",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "test": "vitest run",
    "pack": "electron-builder --dir",
    "dist": "electron-builder"
  },
  "dependencies": {
    "@grokdesk/gateway": "workspace:*",
    "@grokdesk/shared": "workspace:*",
    "keytar": "^7.9.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "electron": "^33.2.0",
    "electron-builder": "^25.1.8",
    "electron-vite": "^2.3.0",
    "typescript": "^5.6.3",
    "vite": "^5.4.10",
    "vitest": "^2.1.4"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run:
```bash
cd /Users/maceo/blockvantage/grok-desktop && pnpm install
```

Expected: lockfile created; workspace packages linked without errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json .gitignore README.md pnpm-lock.yaml packages apps
git commit -m "chore: scaffold pnpm monorepo for Grok Desk"
```

---

## Task 2: Shared domain types

**Files:**
- Create: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/vitest.config.ts`
- Create: `packages/shared/src/types.test.ts`

- [ ] **Step 1: Write failing test for type guards / constants**

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

`packages/shared/src/types.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  TASK_STATUSES,
  APPROVAL_MODES,
  EFFORT_LEVELS,
  isTaskStatus,
} from "./types.js";

describe("domain types", () => {
  it("includes waiting_approval status", () => {
    expect(TASK_STATUSES).toContain("waiting_approval");
  });

  it("validates task status", () => {
    expect(isTaskStatus("running")).toBe(true);
    expect(isTaskStatus("nope")).toBe(false);
  });

  it("defines three approval modes", () => {
    expect(APPROVAL_MODES).toEqual(["strict", "balanced", "autopilot"]);
  });

  it("defines effort levels", () => {
    expect(EFFORT_LEVELS).toEqual(["fast", "normal", "heavy"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @grokdesk/shared test`  
Expected: FAIL — cannot find module `./types.js` or exports.

- [ ] **Step 3: Implement types**

`packages/shared/src/types.ts`:
```ts
export const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_approval",
  "waiting_user",
  "blocked",
  "done",
  "failed",
  "cancelled",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

export const TASK_MODES = ["interactive", "scheduled", "proactive"] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export const APPROVAL_MODES = ["strict", "balanced", "autopilot"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];

export const EFFORT_LEVELS = ["fast", "normal", "heavy"] as const;
export type EffortLevel = (typeof EFFORT_LEVELS)[number];

export type TrayStatus =
  | "idle"
  | "working"
  | "needs_you"
  | "paused"
  | "reauth"
  | "error";

export interface PolicySnapshot {
  approvalMode: ApprovalMode;
  workspaceRoots: string[];
  allowNetworkTools: boolean;
  allowShell: boolean;
}

export interface Task {
  id: string;
  goal: string;
  mode: TaskMode;
  status: TaskStatus;
  model: string;
  effort: EffortLevel;
  policySnapshot: PolicySnapshot;
  projectId: string | null;
  parentTaskId: string | null;
  scheduleRuleId: string | null;
  rolePack: string | null;
  skills: string[];
  mcpServerIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export type TaskEventKind =
  | "message"
  | "step"
  | "tool_request"
  | "tool_result"
  | "approval_required"
  | "approval_resolved"
  | "artifact_created"
  | "status_change"
  | "error";

export interface TaskEvent {
  id: string;
  taskId: string;
  seq: number;
  kind: TaskEventKind;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface Artifact {
  id: string;
  taskId: string;
  title: string;
  kind: "file" | "report" | "media" | "card";
  path: string | null;
  mimeType: string | null;
  createdAt: string;
}

export interface ScheduleRule {
  id: string;
  name: string;
  goalTemplate: string;
  cron: string;
  timezone: string;
  enabled: boolean;
  quietHoursRespect: boolean;
  approvalMode: ApprovalMode;
  model: string;
  effort: EffortLevel;
  workspaceRoots: string[];
  rolePack: string | null;
  createdAt: string;
  updatedAt: string;
}

export type MemoryKind =
  | "profile"
  | "project"
  | "brand"
  | "preference"
  | "episodic"
  | "now"
  | "standing";

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  projectId: string | null;
  provenance: string | null;
  createdAt: string;
  updatedAt: string;
}

export type InboxKind =
  | "approval"
  | "clarification"
  | "unfinished"
  | "schedule_done"
  | "suggestion"
  | "reauth"
  | "engine";

export interface InboxItem {
  id: string;
  kind: InboxKind;
  title: string;
  body: string;
  taskId: string | null;
  read: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  taskId: string | null;
  action: string;
  detail: Record<string, unknown>;
  decision: "allow" | "deny" | "approve" | "reject" | "info";
  createdAt: string;
}

export interface AuthState {
  signedIn: boolean;
  accountLabel: string | null;
  needsReauth: boolean;
  engineStatus: "unknown" | "missing" | "ready" | "needs_auth";
}

export interface CreateTaskInput {
  goal: string;
  mode?: TaskMode;
  model?: string;
  effort?: EffortLevel;
  workspaceRoots: string[];
  approvalMode?: ApprovalMode;
  rolePack?: string | null;
  skills?: string[];
  mcpServerIds?: string[];
  projectId?: string | null;
  scheduleRuleId?: string | null;
  parentTaskId?: string | null;
}
```

`packages/shared/src/index.ts`:
```ts
export const GROKDESK_VERSION = "0.1.0";
export * from "./types.js";
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @grokdesk/shared test`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): add domain types for tasks, policy, memory"
```

---

## Task 3: Cross-platform path helpers

**Files:**
- Create: `packages/shared/src/paths.ts`
- Create: `packages/shared/src/paths.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/shared/src/paths.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  normalizeRoot,
  isPathInsideRoot,
  assertAbsolutePath,
} from "./paths.js";
import path from "node:path";

describe("paths", () => {
  it("rejects relative paths", () => {
    expect(() => assertAbsolutePath("foo/bar")).toThrow(/absolute/i);
  });

  it("detects path inside root (posix-style logical)", () => {
    const root = path.resolve("/Users/me/work");
    const child = path.resolve("/Users/me/work/campaign/a.md");
    expect(isPathInsideRoot(child, root)).toBe(true);
  });

  it("rejects path escape with ..", () => {
    const root = path.resolve("/Users/me/work");
    const escape = path.resolve("/Users/me/work/../secret");
    expect(isPathInsideRoot(escape, root)).toBe(false);
  });

  it("normalizes trailing separators", () => {
    const a = normalizeRoot(path.resolve("/tmp/ws") + path.sep);
    const b = normalizeRoot(path.resolve("/tmp/ws"));
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @grokdesk/shared test`  
Expected: FAIL missing `./paths.js`

- [ ] **Step 3: Implement paths**

`packages/shared/src/paths.ts`:
```ts
import path from "node:path";

export function assertAbsolutePath(p: string): string {
  if (!path.isAbsolute(p)) {
    throw new Error(`Path must be absolute: ${p}`);
  }
  return p;
}

export function normalizeRoot(root: string): string {
  const abs = assertAbsolutePath(root);
  return path.normalize(abs).replace(/[/\\]+$/, "") || path.normalize(abs);
}

export function isPathInsideRoot(target: string, root: string): boolean {
  const resolvedTarget = path.resolve(assertAbsolutePath(target));
  const resolvedRoot = normalizeRoot(root);
  if (resolvedTarget === resolvedRoot) return true;
  const rel = path.relative(resolvedRoot, resolvedTarget);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function isPathInsideAnyRoot(target: string, roots: string[]): boolean {
  return roots.some((r) => isPathInsideRoot(target, r));
}
```

Update `packages/shared/src/index.ts`:
```ts
export const GROKDESK_VERSION = "0.1.0";
export * from "./types.js";
export * from "./paths.js";
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @grokdesk/shared test`

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): cross-platform path allowlist helpers"
```

---

## Task 4: Policy engine (pure)

**Files:**
- Create: `packages/shared/src/policy.ts`
- Create: `packages/shared/src/policy.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/shared/src/policy.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluateToolRequest } from "./policy.js";
import type { PolicySnapshot } from "./types.js";
import path from "node:path";

const root = path.resolve("/workspace/proj");

const balanced: PolicySnapshot = {
  approvalMode: "balanced",
  workspaceRoots: [root],
  allowNetworkTools: true,
  allowShell: true,
};

describe("evaluateToolRequest", () => {
  it("allows read inside root without approval in balanced", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "read_file",
      path: path.join(root, "a.md"),
    });
    expect(r.decision).toBe("allow");
  });

  it("denies path outside roots", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "read_file",
      path: path.resolve("/etc/passwd"),
    });
    expect(r.decision).toBe("deny");
    expect(r.reason).toMatch(/workspace/i);
  });

  it("requires approval for shell in balanced", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "shell",
      command: "ls",
    });
    expect(r.decision).toBe("needs_approval");
  });

  it("requires approval for every write in strict", () => {
    const strict: PolicySnapshot = { ...balanced, approvalMode: "strict" };
    const r = evaluateToolRequest(strict, {
      tool: "write_file",
      path: path.join(root, "out.md"),
    });
    expect(r.decision).toBe("needs_approval");
  });

  it("allows shell in autopilot when shell enabled", () => {
    const auto: PolicySnapshot = { ...balanced, approvalMode: "autopilot" };
    const r = evaluateToolRequest(auto, {
      tool: "shell",
      command: "echo hi",
    });
    expect(r.decision).toBe("allow");
  });

  it("denies shell when allowShell is false", () => {
    const noShell: PolicySnapshot = { ...balanced, allowShell: false };
    const r = evaluateToolRequest(noShell, {
      tool: "shell",
      command: "echo hi",
    });
    expect(r.decision).toBe("deny");
  });

  it("flags delete as needs_approval in balanced", () => {
    const r = evaluateToolRequest(balanced, {
      tool: "delete_file",
      path: path.join(root, "x.txt"),
    });
    expect(r.decision).toBe("needs_approval");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

- [ ] **Step 3: Implement policy**

`packages/shared/src/policy.ts`:
```ts
import { isPathInsideAnyRoot } from "./paths.js";
import type { PolicySnapshot } from "./types.js";

export type ToolName =
  | "read_file"
  | "write_file"
  | "delete_file"
  | "shell"
  | "network"
  | "other";

export interface ToolRequest {
  tool: ToolName;
  path?: string;
  command?: string;
  meta?: Record<string, unknown>;
}

export type PolicyDecision = "allow" | "deny" | "needs_approval";

export interface PolicyResult {
  decision: PolicyDecision;
  reason: string;
}

export function evaluateToolRequest(
  policy: PolicySnapshot,
  req: ToolRequest,
): PolicyResult {
  if (req.path) {
    if (!isPathInsideAnyRoot(req.path, policy.workspaceRoots)) {
      return {
        decision: "deny",
        reason: "Path is outside configured workspace roots",
      };
    }
  }

  if (req.tool === "shell") {
    if (!policy.allowShell) {
      return { decision: "deny", reason: "Shell is disabled by policy" };
    }
    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot allows shell" };
    }
    return {
      decision: "needs_approval",
      reason: "Shell requires approval in this mode",
    };
  }

  if (req.tool === "network" && !policy.allowNetworkTools) {
    return { decision: "deny", reason: "Network tools disabled" };
  }

  if (req.tool === "delete_file") {
    if (policy.approvalMode === "autopilot") {
      return { decision: "allow", reason: "Autopilot allows delete" };
    }
    return {
      decision: "needs_approval",
      reason: "Deletes require approval",
    };
  }

  if (req.tool === "write_file") {
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for writes",
      };
    }
    return { decision: "allow", reason: "Write inside workspace allowed" };
  }

  if (req.tool === "read_file") {
    if (policy.approvalMode === "strict") {
      return {
        decision: "needs_approval",
        reason: "Strict mode requires approval for reads",
      };
    }
    return { decision: "allow", reason: "Read inside workspace allowed" };
  }

  if (policy.approvalMode === "strict") {
    return {
      decision: "needs_approval",
      reason: "Strict mode requires approval",
    };
  }

  return { decision: "allow", reason: "Default allow" };
}
```

Export from `index.ts`:
```ts
export * from "./policy.js";
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): policy engine for host tool allow/deny/approve"
```

---

## Task 5: IPC contract (zod)

**Files:**
- Create: `packages/shared/src/ipc.ts`
- Create: `packages/shared/src/ipc.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing test**

`packages/shared/src/ipc.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { CreateTaskInputSchema, parseIpcRequest } from "./ipc.js";

describe("ipc schemas", () => {
  it("accepts valid create task input", () => {
    const parsed = CreateTaskInputSchema.parse({
      goal: "Organize downloads",
      workspaceRoots: ["/tmp/ws"],
    });
    expect(parsed.effort).toBe("normal");
    expect(parsed.approvalMode).toBe("balanced");
  });

  it("rejects empty goal", () => {
    expect(() =>
      CreateTaskInputSchema.parse({ goal: "", workspaceRoots: ["/tmp"] }),
    ).toThrow();
  });

  it("parses known method", () => {
    const req = parseIpcRequest({
      method: "tasks.create",
      id: "1",
      params: {
        goal: "Hi",
        workspaceRoots: ["/tmp/ws"],
      },
    });
    expect(req.method).toBe("tasks.create");
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement ipc.ts**

```ts
import { z } from "zod";

export const CreateTaskInputSchema = z.object({
  goal: z.string().min(1),
  mode: z.enum(["interactive", "scheduled", "proactive"]).default("interactive"),
  model: z.string().default("grok-4.5"),
  effort: z.enum(["fast", "normal", "heavy"]).default("normal"),
  workspaceRoots: z.array(z.string().min(1)).min(1),
  approvalMode: z.enum(["strict", "balanced", "autopilot"]).default("balanced"),
  rolePack: z.string().nullable().optional().default(null),
  skills: z.array(z.string()).default([]),
  mcpServerIds: z.array(z.string()).default([]),
  projectId: z.string().nullable().optional().default(null),
  scheduleRuleId: z.string().nullable().optional().default(null),
  parentTaskId: z.string().nullable().optional().default(null),
});

export const IpcRequestSchema = z.discriminatedUnion("method", [
  z.object({
    id: z.string(),
    method: z.literal("tasks.create"),
    params: CreateTaskInputSchema,
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.get"),
    params: z.object({ taskId: z.string() }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.cancel"),
    params: z.object({ taskId: z.string() }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.approve"),
    params: z.object({
      taskId: z.string(),
      approvalId: z.string(),
      decision: z.enum(["approve", "reject"]),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.pauseAll"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tasks.resumeAll"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("events.list"),
    params: z.object({
      taskId: z.string(),
      afterSeq: z.number().int().nonnegative().default(0),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("auth.status"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("auth.signIn"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("auth.signOut"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("schedule.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("schedule.create"),
    params: z.object({
      name: z.string().min(1),
      goalTemplate: z.string().min(1),
      cron: z.string().min(1),
      timezone: z.string().min(1),
      approvalMode: z
        .enum(["strict", "balanced", "autopilot"])
        .default("balanced"),
      model: z.string().default("grok-4.5"),
      effort: z.enum(["fast", "normal", "heavy"]).default("normal"),
      workspaceRoots: z.array(z.string()).min(1),
      rolePack: z.string().nullable().optional().default(null),
      quietHoursRespect: z.boolean().default(true),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("schedule.setEnabled"),
    params: z.object({ id: z.string(), enabled: z.boolean() }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("memory.list"),
    params: z.object({
      kind: z
        .enum([
          "profile",
          "project",
          "brand",
          "preference",
          "episodic",
          "now",
          "standing",
        ])
        .optional(),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("memory.upsert"),
    params: z.object({
      id: z.string().optional(),
      kind: z.enum([
        "profile",
        "project",
        "brand",
        "preference",
        "episodic",
        "now",
        "standing",
      ]),
      title: z.string().min(1),
      content: z.string(),
      projectId: z.string().nullable().optional().default(null),
    }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("memory.delete"),
    params: z.object({ id: z.string() }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("inbox.list"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("inbox.markRead"),
    params: z.object({ id: z.string() }),
  }),
  z.object({
    id: z.string(),
    method: z.literal("settings.get"),
    params: z.object({}).default({}),
  }),
  z.object({
    id: z.string(),
    method: z.literal("settings.set"),
    params: z.record(z.unknown()),
  }),
  z.object({
    id: z.string(),
    method: z.literal("tray.status"),
    params: z.object({}).default({}),
  }),
]);

export type IpcRequest = z.infer<typeof IpcRequestSchema>;

export function parseIpcRequest(input: unknown): IpcRequest {
  return IpcRequestSchema.parse(input);
}
```

Export from index.

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): zod IPC request contracts"
```

---

## Task 6: Gateway data dirs + SQLite schema

**Files:**
- Create: `packages/gateway/src/config.ts`
- Create: `packages/gateway/src/db.ts`
- Create: `packages/gateway/src/config.test.ts`
- Create: `packages/gateway/src/db.test.ts`
- Create: `packages/gateway/vitest.config.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: Write failing tests**

`packages/gateway/vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

`packages/gateway/src/config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolveDataPaths } from "./config.js";
import path from "node:path";

describe("resolveDataPaths", () => {
  it("uses Application Support on darwin", () => {
    const p = resolveDataPaths({
      platform: "darwin",
      home: "/Users/me",
      appData: "",
      localAppData: "",
    });
    expect(p.dataDir).toBe(
      path.join("/Users/me", "Library", "Application Support", "GrokDesk"),
    );
    expect(p.logsDir).toContain("Logs");
  });

  it("uses APPDATA on win32", () => {
    const p = resolveDataPaths({
      platform: "win32",
      home: "C:\\Users\\me",
      appData: "C:\\Users\\me\\AppData\\Roaming",
      localAppData: "C:\\Users\\me\\AppData\\Local",
    });
    expect(p.dataDir.replace(/\\/g, "/")).toMatch(/GrokDesk$/);
    expect(p.logsDir.replace(/\\/g, "/")).toMatch(/logs$/i);
  });
});
```

`packages/gateway/src/db.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "./db.js";

describe("db schema", () => {
  let dir: string;
  let db: Db;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-db-"));
    db = openDatabase(path.join(dir, "test.sqlite"));
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates tasks table", () => {
    const row = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'",
      )
      .get() as { name: string } | undefined;
    expect(row?.name).toBe("tasks");
  });

  it("inserts and reads a task row", () => {
    db.prepare(
      `INSERT INTO tasks (id, goal, mode, status, model, effort, policy_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "t1",
      "goal",
      "interactive",
      "queued",
      "grok-4.5",
      "normal",
      "{}",
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const row = db.prepare("SELECT goal FROM tasks WHERE id=?").get("t1") as {
      goal: string;
    };
    expect(row.goal).toBe("goal");
  });
});
```

- [ ] **Step 2: Run gateway tests — FAIL**

- [ ] **Step 3: Implement config + db**

`packages/gateway/src/config.ts`:
```ts
import path from "node:path";

export interface EnvLike {
  platform: NodeJS.Platform | "darwin" | "win32" | "linux";
  home: string;
  appData: string;
  localAppData: string;
}

export interface DataPaths {
  dataDir: string;
  logsDir: string;
  dbPath: string;
}

export function resolveDataPaths(env: EnvLike): DataPaths {
  if (env.platform === "darwin") {
    const dataDir = path.join(
      env.home,
      "Library",
      "Application Support",
      "GrokDesk",
    );
    const logsDir = path.join(env.home, "Library", "Logs", "GrokDesk");
    return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
  }

  if (env.platform === "win32") {
    const dataDir = path.join(env.appData || env.home, "GrokDesk");
    const logsDir = path.join(env.localAppData || dataDir, "GrokDesk", "logs");
    return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
  }

  const dataDir = path.join(env.home, ".local", "share", "GrokDesk");
  const logsDir = path.join(env.home, ".local", "state", "GrokDesk", "logs");
  return { dataDir, logsDir, dbPath: path.join(dataDir, "grokdesk.sqlite") };
}

export function resolveDataPathsFromProcess(
  proc: NodeJS.Process = process,
): DataPaths {
  return resolveDataPaths({
    platform: proc.platform,
    home: proc.env.HOME || proc.env.USERPROFILE || "",
    appData: proc.env.APPDATA || "",
    localAppData: proc.env.LOCALAPPDATA || "",
  });
}
```

`packages/gateway/src/db.ts`:
```ts
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Db = Database.Database;

const MIGRATION_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  goal TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  project_id TEXT,
  parent_task_id TEXT,
  schedule_rule_id TEXT,
  role_pack TEXT,
  skills_json TEXT NOT NULL DEFAULT '[]',
  mcp_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(task_id, seq)
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  path TEXT,
  mime_type TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schedule_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  goal_template TEXT NOT NULL,
  cron TEXT NOT NULL,
  timezone TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  quiet_hours_respect INTEGER NOT NULL DEFAULT 1,
  approval_mode TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL,
  workspace_roots_json TEXT NOT NULL,
  role_pack TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  project_id TEXT,
  provenance TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS inbox_items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  task_id TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  decision TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function openDatabase(dbPath: string): Db {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATION_V1);
  db.prepare(
    "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')",
  ).run();
  return db;
}
```

- [ ] **Step 4: Run tests — PASS**  
  Note: `better-sqlite3` must compile for current Node; if install fails on a machine, rebuild with `pnpm rebuild better-sqlite3`.

- [ ] **Step 5: Commit**

```bash
git add packages/gateway
git commit -m "feat(gateway): OS data paths and SQLite schema"
```

---

## Task 7: Task service + event log

**Files:**
- Create: `packages/gateway/src/services/tasks.ts`
- Create: `packages/gateway/src/services/tasks.test.ts`
- Create: `packages/gateway/src/services/audit.ts`
- Modify: `packages/gateway/src/index.ts`

- [ ] **Step 1: Write failing tests for create/list/status**

`packages/gateway/src/services/tasks.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";

describe("TaskService", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-tasks-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates a queued task with policy snapshot", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({
      goal: "Clean folder",
      workspaceRoots: [root],
    });
    expect(t.status).toBe("queued");
    expect(t.policySnapshot.workspaceRoots[0]).toBe(path.resolve(root));
    expect(tasks.list()).toHaveLength(1);
  });

  it("appends events with monotonic seq", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({ goal: "x", workspaceRoots: [root] });
    const e1 = tasks.appendEvent(t.id, "status_change", { status: "running" });
    const e2 = tasks.appendEvent(t.id, "message", { role: "assistant", text: "hi" });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
    expect(tasks.listEvents(t.id, 0)).toHaveLength(2);
  });

  it("setStatus updates task and emits event", () => {
    const root = path.join(dir, "ws");
    fs.mkdirSync(root);
    const t = tasks.create({ goal: "x", workspaceRoots: [root] });
    tasks.setStatus(t.id, "running");
    expect(tasks.get(t.id)?.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement TaskService + AuditService**

`packages/gateway/src/services/audit.ts`:
```ts
import { randomUUID } from "node:crypto";
import type { Db } from "../db.js";
import type { AuditEntry } from "@grokdesk/shared";

export class AuditService {
  constructor(private db: Db) {}

  append(
    entry: Omit<AuditEntry, "id" | "createdAt"> & { createdAt?: string },
  ): AuditEntry {
    const full: AuditEntry = {
      id: randomUUID(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      taskId: entry.taskId,
      action: entry.action,
      detail: entry.detail,
      decision: entry.decision,
    };
    this.db
      .prepare(
        `INSERT INTO audit_entries (id, task_id, action, detail_json, decision, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.taskId,
        full.action,
        JSON.stringify(full.detail),
        full.decision,
        full.createdAt,
      );
    return full;
  }
}
```

`packages/gateway/src/services/tasks.ts`:
```ts
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Db } from "../db.js";
import type {
  CreateTaskInput,
  PolicySnapshot,
  Task,
  TaskEvent,
  TaskEventKind,
  TaskStatus,
} from "@grokdesk/shared";
import { normalizeRoot } from "@grokdesk/shared";

function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as string,
    goal: row.goal as string,
    mode: row.mode as Task["mode"],
    status: row.status as TaskStatus,
    model: row.model as string,
    effort: row.effort as Task["effort"],
    policySnapshot: JSON.parse(row.policy_json as string) as PolicySnapshot,
    projectId: (row.project_id as string | null) ?? null,
    parentTaskId: (row.parent_task_id as string | null) ?? null,
    scheduleRuleId: (row.schedule_rule_id as string | null) ?? null,
    rolePack: (row.role_pack as string | null) ?? null,
    skills: JSON.parse((row.skills_json as string) || "[]") as string[],
    mcpServerIds: JSON.parse((row.mcp_json as string) || "[]") as string[],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

export class TaskService {
  private paused = false;

  constructor(private db: Db) {}

  isPaused(): boolean {
    return this.paused;
  }

  pauseAll(): void {
    this.paused = true;
  }

  resumeAll(): void {
    this.paused = false;
  }

  create(input: CreateTaskInput): Task {
    const now = new Date().toISOString();
    const roots = input.workspaceRoots.map((r) => normalizeRoot(path.resolve(r)));
    const policy: PolicySnapshot = {
      approvalMode: input.approvalMode ?? "balanced",
      workspaceRoots: roots,
      allowNetworkTools: true,
      allowShell: true,
    };
    const task: Task = {
      id: randomUUID(),
      goal: input.goal,
      mode: input.mode ?? "interactive",
      status: "queued",
      model: input.model ?? "grok-4.5",
      effort: input.effort ?? "normal",
      policySnapshot: policy,
      projectId: input.projectId ?? null,
      parentTaskId: input.parentTaskId ?? null,
      scheduleRuleId: input.scheduleRuleId ?? null,
      rolePack: input.rolePack ?? null,
      skills: input.skills ?? [],
      mcpServerIds: input.mcpServerIds ?? [],
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    this.db
      .prepare(
        `INSERT INTO tasks (
          id, goal, mode, status, model, effort, policy_json,
          project_id, parent_task_id, schedule_rule_id, role_pack,
          skills_json, mcp_json, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.goal,
        task.mode,
        task.status,
        task.model,
        task.effort,
        JSON.stringify(task.policySnapshot),
        task.projectId,
        task.parentTaskId,
        task.scheduleRuleId,
        task.rolePack,
        JSON.stringify(task.skills),
        JSON.stringify(task.mcpServerIds),
        task.createdAt,
        task.updatedAt,
        task.completedAt,
      );

    this.appendEvent(task.id, "status_change", { status: "queued" });
    return task;
  }

  list(): Task[] {
    const rows = this.db
      .prepare("SELECT * FROM tasks ORDER BY created_at DESC")
      .all() as Record<string, unknown>[];
    return rows.map(rowToTask);
  }

  get(taskId: string): Task | null {
    const row = this.db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(taskId) as Record<string, unknown> | undefined;
    return row ? rowToTask(row) : null;
  }

  setStatus(taskId: string, status: TaskStatus): Task {
    const now = new Date().toISOString();
    const completedAt =
      status === "done" || status === "failed" || status === "cancelled"
        ? now
        : null;
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
      )
      .run(status, now, completedAt, taskId);
    this.appendEvent(taskId, "status_change", { status });
    const task = this.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    return task;
  }

  appendEvent(
    taskId: string,
    kind: TaskEventKind,
    payload: Record<string, unknown>,
  ): TaskEvent {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM task_events WHERE task_id = ?",
      )
      .get(taskId) as { maxSeq: number };
    const seq = (row?.maxSeq ?? 0) + 1;
    const event: TaskEvent = {
      id: randomUUID(),
      taskId,
      seq,
      kind,
      payload,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO task_events (id, task_id, seq, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        event.id,
        event.taskId,
        event.seq,
        event.kind,
        JSON.stringify(event.payload),
        event.createdAt,
      );
    return event;
  }

  listEvents(taskId: string, afterSeq = 0): TaskEvent[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC`,
      )
      .all(taskId, afterSeq) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r.id as string,
      taskId: r.task_id as string,
      seq: r.seq as number,
      kind: r.kind as TaskEventKind,
      payload: JSON.parse(r.payload_json as string) as Record<string, unknown>,
      createdAt: r.created_at as string,
    }));
  }
}
```

- [ ] **Step 4: Tests PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/gateway
git commit -m "feat(gateway): task service with event log and pause flag"
```

---

## Task 8: Fake engine + task runner with policy gates

**Files:**
- Create: `packages/engine-grok/src/types.ts`
- Create: `packages/engine-grok/src/fake-engine.ts`
- Create: `packages/gateway/src/services/runner.ts`
- Create: `packages/gateway/src/services/runner.test.ts`
- Modify: `packages/engine-grok/src/index.ts`

This establishes the execution loop **before** real Grok Build integration so UI and policy work offline.

- [ ] **Step 1: Define engine interface + fake engine**

`packages/engine-grok/src/types.ts`:
```ts
import type { EffortLevel, Task } from "@grokdesk/shared";

export type NormalizedEngineEvent =
  | { type: "message"; text: string; role: "assistant" | "user" }
  | { type: "step"; title: string; status: "start" | "end" }
  | {
      type: "tool_request";
      id: string;
      tool: "read_file" | "write_file" | "delete_file" | "shell" | "network" | "other";
      path?: string;
      command?: string;
      meta?: Record<string, unknown>;
    }
  | { type: "tool_result"; id: string; ok: boolean; output: string }
  | { type: "artifact"; title: string; path: string; kind: "file" | "report" | "media" | "card" }
  | { type: "done"; summary: string }
  | { type: "error"; message: string };

export interface EngineRunOptions {
  task: Task;
  systemPreamble: string;
  onEvent: (event: NormalizedEngineEvent) => Promise<"continue" | "abort">;
}

export interface EngineAdapter {
  run(options: EngineRunOptions): Promise<void>;
  cancel(taskId: string): Promise<void>;
}
```

`packages/engine-grok/src/fake-engine.ts`:
```ts
import type { EngineAdapter, EngineRunOptions } from "./types.js";
import path from "node:path";

/** Deterministic engine for tests and offline UI development. */
export class FakeEngine implements EngineAdapter {
  private cancelled = new Set<string>();

  async cancel(taskId: string): Promise<void> {
    this.cancelled.add(taskId);
  }

  async run(options: EngineRunOptions): Promise<void> {
    const { task, onEvent } = options;
    if (this.cancelled.has(task.id)) return;

    let signal = await onEvent({
      type: "step",
      title: "Plan work",
      status: "start",
    });
    if (signal === "abort") return;
    await onEvent({ type: "step", title: "Plan work", status: "end" });

    await onEvent({
      type: "message",
      role: "assistant",
      text: `Working on: ${task.goal}`,
    });

    const outPath = path.join(
      task.policySnapshot.workspaceRoots[0]!,
      "grokdesk-output.md",
    );

    const toolId = "tool-1";
    signal = await onEvent({
      type: "tool_request",
      id: toolId,
      tool: "write_file",
      path: outPath,
      meta: { content: `# Result\n\n${task.goal}\n` },
    });
    if (signal === "abort") return;

    await onEvent({
      type: "tool_result",
      id: toolId,
      ok: true,
      output: `wrote ${outPath}`,
    });

    await onEvent({
      type: "artifact",
      title: "Result",
      path: outPath,
      kind: "report",
    });

    await onEvent({ type: "done", summary: "Completed fake run" });
  }
}
```

- [ ] **Step 2: Implement runner that applies policy**

`packages/gateway/src/services/runner.ts`:
```ts
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { EngineAdapter, NormalizedEngineEvent } from "@grokdesk/engine-grok";
import { evaluateToolRequest } from "@grokdesk/shared";
import type { TaskService } from "./tasks.js";
import type { AuditService } from "./audit.js";

export interface PendingApproval {
  id: string;
  taskId: string;
  toolRequest: Extract<NormalizedEngineEvent, { type: "tool_request" }>;
  resolve: (decision: "approve" | "reject") => void;
}

export class TaskRunner {
  private running = new Map<string, Promise<void>>();
  private pending = new Map<string, PendingApproval>();
  private maxConcurrent: number;

  constructor(
    private tasks: TaskService,
    private audit: AuditService,
    private engine: EngineAdapter,
    opts?: { maxConcurrent?: number },
  ) {
    this.maxConcurrent = opts?.maxConcurrent ?? 3;
  }

  getPendingApprovals(taskId?: string): PendingApproval[] {
    const all = [...this.pending.values()];
    return taskId ? all.filter((p) => p.taskId === taskId) : all;
  }

  async approve(approvalId: string, decision: "approve" | "reject"): Promise<void> {
    const p = this.pending.get(approvalId);
    if (!p) throw new Error(`Unknown approval: ${approvalId}`);
    this.pending.delete(approvalId);
    this.audit.append({
      taskId: p.taskId,
      action: "approval",
      detail: { approvalId, decision, tool: p.toolRequest },
      decision,
    });
    this.tasks.appendEvent(p.taskId, "approval_resolved", {
      approvalId,
      decision,
    });
    p.resolve(decision);
  }

  async start(taskId: string): Promise<void> {
    if (this.tasks.isPaused()) {
      return;
    }
    if (this.running.has(taskId)) return;
    if (this.running.size >= this.maxConcurrent) {
      return;
    }

    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const promise = this.runTask(taskId).finally(() => {
      this.running.delete(taskId);
      void this.pumpQueue();
    });
    this.running.set(taskId, promise);
    await promise;
  }

  async pumpQueue(): Promise<void> {
    if (this.tasks.isPaused()) return;
    const queued = this.tasks.list().filter((t) => t.status === "queued");
    for (const t of queued) {
      if (this.running.size >= this.maxConcurrent) break;
      if (!this.running.has(t.id)) {
        void this.start(t.id);
      }
    }
  }

  private async runTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;
    this.tasks.setStatus(taskId, "running");

    try {
      await this.engine.run({
        task,
        systemPreamble: "",
        onEvent: async (event) => this.handleEvent(taskId, event),
      });
      const current = this.tasks.get(taskId);
      if (current && current.status === "running") {
        this.tasks.setStatus(taskId, "done");
      }
    } catch (err) {
      this.tasks.appendEvent(taskId, "error", {
        message: err instanceof Error ? err.message : String(err),
      });
      this.tasks.setStatus(taskId, "failed");
    }
  }

  private async handleEvent(
    taskId: string,
    event: NormalizedEngineEvent,
  ): Promise<"continue" | "abort"> {
    if (this.tasks.isPaused()) return "abort";
    const task = this.tasks.get(taskId);
    if (!task) return "abort";

    switch (event.type) {
      case "message":
        this.tasks.appendEvent(taskId, "message", event);
        return "continue";
      case "step":
        this.tasks.appendEvent(taskId, "step", event);
        return "continue";
      case "tool_request": {
        this.tasks.appendEvent(taskId, "tool_request", event);
        const decision = evaluateToolRequest(task.policySnapshot, {
          tool: event.tool,
          path: event.path,
          command: event.command,
          meta: event.meta,
        });
        this.audit.append({
          taskId,
          action: "policy_check",
          detail: { event, decision },
          decision:
            decision.decision === "allow"
              ? "allow"
              : decision.decision === "deny"
                ? "deny"
                : "info",
        });

        if (decision.decision === "deny") {
          this.tasks.appendEvent(taskId, "tool_result", {
            id: event.id,
            ok: false,
            output: decision.reason,
          });
          return "continue";
        }

        if (decision.decision === "needs_approval") {
          this.tasks.setStatus(taskId, "waiting_approval");
          const approvalId = randomUUID();
          this.tasks.appendEvent(taskId, "approval_required", {
            approvalId,
            tool: event,
            reason: decision.reason,
          });
          const userDecision = await new Promise<"approve" | "reject">(
            (resolve) => {
              this.pending.set(approvalId, {
                id: approvalId,
                taskId,
                toolRequest: event,
                resolve,
              });
            },
          );
          if (userDecision === "reject") {
            this.tasks.appendEvent(taskId, "tool_result", {
              id: event.id,
              ok: false,
              output: "User rejected",
            });
            this.tasks.setStatus(taskId, "running");
            return "continue";
          }
          this.tasks.setStatus(taskId, "running");
        }

        if (event.tool === "write_file" && event.path) {
          const content = String(event.meta?.content ?? "");
          await fs.mkdir(path.dirname(event.path), { recursive: true });
          await fs.writeFile(event.path, content, "utf8");
        }
        return "continue";
      }
      case "tool_result":
        this.tasks.appendEvent(taskId, "tool_result", event);
        return "continue";
      case "artifact": {
        const id = randomUUID();
        // artifacts table write happens via ArtifactService in later polish;
        // still emit event for UI
        this.tasks.appendEvent(taskId, "artifact_created", { ...event, id });
        return "continue";
      }
      case "done":
        this.tasks.appendEvent(taskId, "message", {
          role: "assistant",
          text: event.summary,
        });
        return "continue";
      case "error":
        this.tasks.appendEvent(taskId, "error", { message: event.message });
        return "abort";
      default:
        return "continue";
    }
  }
}
```

- [ ] **Step 3: Write runner test**

`packages/gateway/src/services/runner.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase, type Db } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { TaskRunner } from "./runner.js";
import { FakeEngine } from "@grokdesk/engine-grok";

describe("TaskRunner", () => {
  let dir: string;
  let db: Db;
  let tasks: TaskService;
  let runner: TaskRunner;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-run-"));
    db = openDatabase(path.join(dir, "t.sqlite"));
    tasks = new TaskService(db);
    runner = new TaskRunner(tasks, new AuditService(db), new FakeEngine());
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("runs fake engine to completion and writes artifact file", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const t = tasks.create({
      goal: "Write a note",
      workspaceRoots: [ws],
      approvalMode: "autopilot",
    });
    await runner.start(t.id);
    expect(tasks.get(t.id)?.status).toBe("done");
    const out = path.join(ws, "grokdesk-output.md");
    expect(fs.existsSync(out)).toBe(true);
  });
});
```

Export FakeEngine from `packages/engine-grok/src/index.ts`:
```ts
export type { EngineAdapter, EngineRunOptions, NormalizedEngineEvent } from "./types.js";
export { FakeEngine } from "./fake-engine.js";
export type EngineStatus = "unknown" | "missing" | "ready" | "needs_auth";
export async function getEngineStatus(): Promise<EngineStatus> {
  return "unknown";
}
```

Ensure gateway depends on engine-grok exports FakeEngine (already dependency).

- [ ] **Step 4: `pnpm --filter @grokdesk/engine-grok build && pnpm --filter @grokdesk/gateway test` — PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/engine-grok packages/gateway
git commit -m "feat: fake engine and policy-aware task runner"
```

---

## Task 9: Wire Gateway facade + IPC dispatch

**Files:**
- Modify: `packages/gateway/src/index.ts`
- Create: `packages/gateway/src/dispatch.ts`
- Create: `packages/gateway/src/dispatch.test.ts`

- [ ] **Step 1: Implement Gateway with dispatch**

`packages/gateway/src/dispatch.ts`:
```ts
import { parseIpcRequest, type IpcRequest } from "@grokdesk/shared";
import type { Gateway } from "./index.js";

export async function dispatchGateway(
  gateway: Gateway,
  raw: unknown,
): Promise<unknown> {
  const req = parseIpcRequest(raw);
  return gateway.handle(req);
}
```

`packages/gateway/src/index.ts`:
```ts
import fs from "node:fs";
import type { IpcRequest } from "@grokdesk/shared";
import { FakeEngine } from "@grokdesk/engine-grok";
import { openDatabase, type Db } from "./db.js";
import { resolveDataPathsFromProcess, type DataPaths } from "./config.js";
import { TaskService } from "./services/tasks.js";
import { AuditService } from "./services/audit.js";
import { TaskRunner } from "./services/runner.js";

export class Gateway {
  readonly paths: DataPaths;
  private db!: Db;
  tasks!: TaskService;
  audit!: AuditService;
  runner!: TaskRunner;
  private started = false;

  constructor(paths: DataPaths = resolveDataPathsFromProcess()) {
    this.paths = paths;
  }

  async start(): Promise<void> {
    if (this.started) return;
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    fs.mkdirSync(this.paths.logsDir, { recursive: true });
    this.db = openDatabase(this.paths.dbPath);
    this.tasks = new TaskService(this.db);
    this.audit = new AuditService(this.db);
    this.runner = new TaskRunner(this.tasks, this.audit, new FakeEngine());
    this.started = true;
  }

  async stop(): Promise<void> {
    this.db?.close();
    this.started = false;
  }

  async handle(req: IpcRequest): Promise<unknown> {
    if (!this.started) throw new Error("Gateway not started");

    switch (req.method) {
      case "tasks.create": {
        const task = this.tasks.create(req.params);
        void this.runner.pumpQueue();
        return task;
      }
      case "tasks.list":
        return this.tasks.list();
      case "tasks.get":
        return this.tasks.get(req.params.taskId);
      case "tasks.cancel":
        return this.tasks.setStatus(req.params.taskId, "cancelled");
      case "tasks.approve":
        await this.runner.approve(req.params.approvalId, req.params.decision);
        return { ok: true };
      case "tasks.pauseAll":
        this.tasks.pauseAll();
        return { ok: true };
      case "tasks.resumeAll":
        this.tasks.resumeAll();
        void this.runner.pumpQueue();
        return { ok: true };
      case "events.list":
        return this.tasks.listEvents(req.params.taskId, req.params.afterSeq);
      case "auth.status":
        return {
          signedIn: false,
          accountLabel: null,
          needsReauth: false,
          engineStatus: "unknown",
        };
      case "tray.status":
        return this.computeTrayStatus();
      default:
        // Methods implemented in later tasks return empty safe defaults for now
        if (req.method.startsWith("schedule.")) return [];
        if (req.method.startsWith("memory.")) return [];
        if (req.method.startsWith("inbox.")) return [];
        if (req.method === "settings.get") return {};
        if (req.method === "settings.set") return { ok: true };
        if (req.method === "auth.signIn" || req.method === "auth.signOut") {
          return { ok: true };
        }
        throw new Error(`Unhandled method: ${req.method}`);
    }
  }

  private computeTrayStatus(): {
    status: "idle" | "working" | "needs_you" | "paused" | "reauth" | "error";
    runningCount: number;
  } {
    if (this.tasks.isPaused()) {
      return { status: "paused", runningCount: 0 };
    }
    const list = this.tasks.list();
    const running = list.filter((t) => t.status === "running").length;
    const needs = list.some(
      (t) => t.status === "waiting_approval" || t.status === "waiting_user",
    );
    if (needs) return { status: "needs_you", runningCount: running };
    if (running > 0) return { status: "working", runningCount: running };
    return { status: "idle", runningCount: 0 };
  }
}

export { dispatchGateway } from "./dispatch.js";
```

- [ ] **Step 2: Integration test create via dispatch**

`packages/gateway/src/dispatch.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Gateway } from "./index.js";
import { dispatchGateway } from "./dispatch.js";

describe("dispatchGateway", () => {
  let dir: string;
  let gateway: Gateway;

  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-gw-"));
    gateway = new Gateway({
      dataDir: dir,
      logsDir: path.join(dir, "logs"),
      dbPath: path.join(dir, "db.sqlite"),
    });
    await gateway.start();
  });

  afterEach(async () => {
    await gateway.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("creates task through IPC shape", async () => {
    const ws = path.join(dir, "ws");
    fs.mkdirSync(ws);
    const task = (await dispatchGateway(gateway, {
      id: "1",
      method: "tasks.create",
      params: { goal: "Hello", workspaceRoots: [ws], approvalMode: "autopilot" },
    })) as { id: string; goal: string };
    expect(task.goal).toBe("Hello");
    await new Promise((r) => setTimeout(r, 50));
    const list = (await dispatchGateway(gateway, {
      id: "2",
      method: "tasks.list",
      params: {},
    })) as unknown[];
    expect(list.length).toBe(1);
  });
});
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add packages/gateway
git commit -m "feat(gateway): facade and IPC dispatch for tasks"
```

---

## Task 10: Electron app shell (main + preload + React)

**Files:**
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/tsconfig.node.json`
- Create: `apps/desktop/tsconfig.web.json`
- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/ipc-bridge.ts`
- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/main.tsx`
- Create: `apps/desktop/src/renderer/App.tsx`
- Create: `apps/desktop/src/renderer/styles/global.css`
- Create: `apps/desktop/src/renderer/lib/api.ts`
- Create: `apps/desktop/electron-builder.yml`

- [ ] **Step 1: Add electron-vite config and entrypoints**

`apps/desktop/electron.vite.config.ts`:
```ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/renderer/index.html"),
        },
      },
    },
    plugins: [react()],
  },
});
```

`apps/desktop/src/main/ipc-bridge.ts`:
```ts
import { ipcMain } from "electron";
import type { Gateway } from "@grokdesk/gateway";
import { dispatchGateway } from "@grokdesk/gateway";

export function registerIpc(gateway: Gateway): void {
  ipcMain.handle("grokdesk:request", async (_evt, raw: unknown) => {
    try {
      const result = await dispatchGateway(gateway, raw);
      return { ok: true, result };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}
```

`apps/desktop/src/main/index.ts`:
```ts
import { app, BrowserWindow, shell } from "electron";
import path from "node:path";
import { Gateway } from "@grokdesk/gateway";
import { registerIpc } from "./ipc-bridge.js";

let mainWindow: BrowserWindow | null = null;
let gateway: Gateway | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: "Grok Desk",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  gateway = new Gateway();
  await gateway.start();
  registerIpc(gateway);
  await createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  void gateway?.stop();
});
```

`apps/desktop/src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("grokdesk", {
  request: (payload: unknown) => ipcRenderer.invoke("grokdesk:request", payload),
});
```

`apps/desktop/src/renderer/index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Grok Desk</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`apps/desktop/src/renderer/main.tsx`:
```tsx
import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles/global.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

`apps/desktop/src/renderer/styles/global.css`:
```css
:root {
  color-scheme: dark;
  --bg: #0f1115;
  --panel: #171a21;
  --border: #2a2f3a;
  --text: #e8eaed;
  --muted: #9aa3b2;
  --accent: #7c9cff;
  --danger: #ff6b6b;
  --ok: #3dd68c;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
}

* { box-sizing: border-box; }
html, body, #root { height: 100%; margin: 0; }
body { background: var(--bg); color: var(--text); }
button, input, textarea, select {
  font: inherit;
  color: inherit;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px 12px;
}
button { cursor: pointer; }
button.primary { background: var(--accent); color: #0b1020; border-color: transparent; font-weight: 600; }
```

`apps/desktop/src/renderer/lib/api.ts`:
```ts
type RpcOk<T> = { ok: true; result: T };
type RpcErr = { ok: false; error: string };

declare global {
  interface Window {
    grokdesk: {
      request: (payload: unknown) => Promise<RpcOk<unknown> | RpcErr>;
    };
  }
}

let reqCounter = 0;

export async function rpc<T>(
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const id = String(++reqCounter);
  const res = await window.grokdesk.request({ id, method, params });
  if (!res.ok) throw new Error(res.error);
  return res.result as T;
}
```

`apps/desktop/src/renderer/App.tsx` (minimal shell — expanded in Task 11):
```tsx
import { useEffect, useState } from "react";
import { rpc } from "./lib/api";
import type { Task } from "@grokdesk/shared";

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [goal, setGoal] = useState("Write a short project brief");
  const [root, setRoot] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const list = await rpc<Task[]>("tasks.list", {});
    setTasks(list);
  }

  useEffect(() => {
    void refresh().catch((e) => setError(String(e)));
    const t = setInterval(() => void refresh().catch(() => {}), 1000);
    return () => clearInterval(t);
  }, []);

  async function createTask() {
    setError(null);
    if (!root.trim()) {
      setError("Set an absolute workspace folder path");
      return;
    }
    await rpc("tasks.create", {
      goal,
      workspaceRoots: [root.trim()],
      approvalMode: "autopilot",
    });
    await refresh();
  }

  return (
    <div style={{ display: "grid", gridTemplateRows: "auto 1fr", height: "100%" }}>
      <header style={{ padding: 16, borderBottom: "1px solid var(--border)" }}>
        <strong>Grok Desk</strong>
        <span style={{ color: "var(--muted)", marginLeft: 12 }}>Cowork</span>
      </header>
      <main style={{ display: "grid", gridTemplateColumns: "320px 1fr", height: "100%" }}>
        <section style={{ borderRight: "1px solid var(--border)", padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>New task</h2>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            rows={4}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <input
            placeholder="Absolute workspace path"
            value={root}
            onChange={(e) => setRoot(e.target.value)}
            style={{ width: "100%", marginBottom: 8 }}
          />
          <button className="primary" onClick={() => void createTask()}>
            Start
          </button>
          {error && <p style={{ color: "var(--danger)" }}>{error}</p>}
          <h3>Tasks</h3>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {tasks.map((t) => (
              <li key={t.id} style={{ marginBottom: 8 }}>
                <div>{t.goal}</div>
                <small style={{ color: "var(--muted)" }}>{t.status}</small>
              </li>
            ))}
          </ul>
        </section>
        <section style={{ padding: 16 }}>
          <p style={{ color: "var(--muted)" }}>
            Select a task (full workspace UI lands next). Engine currently uses FakeEngine until SuperGrok bridge is wired.
          </p>
        </section>
      </main>
    </div>
  );
}
```

`apps/desktop/electron-builder.yml`:
```yaml
appId: ai.x.grokdesk
productName: Grok Desk
directories:
  output: release
files:
  - out/**/*
  - package.json
mac:
  category: public.app-category.productivity
  target:
    - dmg
    - zip
win:
  target:
    - nsis
    - portable
```

Add tsconfig files as needed for electron-vite (node + web). Use electron-vite defaults from their docs if paths differ slightly — keep `src/main`, `src/preload`, `src/renderer`.

- [ ] **Step 2: Build packages and run typecheck/dev smoke**

```bash
pnpm --filter @grokdesk/shared build
pnpm --filter @grokdesk/engine-grok build
pnpm --filter @grokdesk/gateway build
pnpm --filter @grokdesk/desktop dev
```

Expected: app window opens on the current OS; creating a task with an absolute path updates the list (FakeEngine).

- [ ] **Step 3: Commit**

```bash
git add apps/desktop packages
git commit -m "feat(desktop): Electron shell with gateway IPC and task list"
```

---

## Task 11: Full Cowork three-pane UI

**Files:**
- Create views/components listed in file structure under `apps/desktop/src/renderer/views/`
- Modify: `App.tsx` for nav: Home | Tasks | Schedule | Memory | Skills | Settings

- [ ] **Step 1: Implement navigation shell** with sidebar routes (local state is fine; no router required).
- [ ] **Step 2: Implement `TaskWorkspace`**
  - Left: `TaskList` filtered by status
  - Center: `EventStream` polling `events.list` every 500ms while task active
  - Right: policy roots, artifacts from events, connectors placeholders
  - Bottom: `ModelEffortBar` (model string + effort select) applied on create
  - `ApprovalModal` when latest event is `approval_required` — calls `tasks.approve`
- [ ] **Step 3: Manual test on current OS**
  - Create task with `balanced` mode that needs write approval if policy requires it; for FakeEngine write under autopilot verify file appears
  - Switch between tasks (parallel: create two autopilot tasks)
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(desktop): Cowork three-pane task workspace UI"
```

Concrete component contracts:

```tsx
// TaskList.tsx
export function TaskList(props: {
  tasks: Task[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): JSX.Element;

// EventStream.tsx
export function EventStream(props: { events: TaskEvent[] }): JSX.Element;

// ApprovalModal.tsx
export function ApprovalModal(props: {
  open: boolean;
  reason: string;
  onApprove: () => void;
  onReject: () => void;
}): JSX.Element;
```

---

## Task 12: Tray / menu bar + Pause all + notifications

**Files:**
- Create: `apps/desktop/src/main/tray.ts`
- Create: `apps/desktop/src/main/notifications.ts`
- Modify: `apps/desktop/src/main/index.ts`

- [ ] **Step 1: Implement tray**

```ts
// tray.ts sketch
import { Tray, Menu, nativeImage, app } from "electron";

export function createTray(handlers: {
  onOpen: () => void;
  onPauseAll: () => void;
  onResumeAll: () => void;
  onQuickCapture: () => void;
}): Tray {
  const image = nativeImage.createEmpty(); // replace with resources/trayTemplate.png
  const tray = new Tray(image);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Open Grok Desk", click: handlers.onOpen },
    { label: "Quick capture", click: handlers.onQuickCapture },
    { type: "separator" },
    { label: "Pause all", click: handlers.onPauseAll },
    { label: "Resume all", click: handlers.onResumeAll },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setToolTip("Grok Desk");
  tray.setContextMenu(contextMenu);
  return tray;
}
```

- [ ] **Step 2: Poll tray status every 2s via gateway `tray.status`; update tooltip.**
- [ ] **Step 3: On transition to `needs_you`, fire `Notification`.**
- [ ] **Step 4: Verify on macOS menu bar and Windows tray (manual or second machine CI).**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat(desktop): system tray, pause-all, needs-you notifications"
```

---

## Task 13: Secrets + SuperGrok auth bridge

**Files:**
- Create: `apps/desktop/src/main/secrets.ts`
- Create: `packages/engine-grok/src/discover.ts`
- Create: `packages/engine-grok/src/auth-bridge.ts`
- Create: `packages/engine-grok/src/discover.test.ts`
- Create: `packages/gateway/src/services/auth.ts`
- Modify: gateway `auth.*` handlers; Settings + Onboarding UI

- [ ] **Step 1: keytar wrapper**

```ts
import keytar from "keytar";
const SERVICE = "GrokDesk";

export async function setSecret(account: string, value: string): Promise<void> {
  await keytar.setPassword(SERVICE, account, value);
}
export async function getSecret(account: string): Promise<string | null> {
  return keytar.getPassword(SERVICE, account);
}
export async function deleteSecret(account: string): Promise<void> {
  await keytar.deletePassword(SERVICE, account);
}
```

- [ ] **Step 2: Discover Grok Build CLI**

`packages/engine-grok/src/discover.ts`:
```ts
import { access } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function exists(p: string): Promise<boolean> {
  try {
    await access(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findGrokBinary(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (env.GROK_BUILD_PATH && (await exists(env.GROK_BUILD_PATH))) {
    return env.GROK_BUILD_PATH;
  }
  // PATH lookup
  try {
    const cmd = platform === "win32" ? "where" : "which";
    const bin = platform === "win32" ? "grok.exe" : "grok";
    const { stdout } = await execFileAsync(cmd, [bin]);
    const first = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {
    // continue
  }
  const home = env.HOME || env.USERPROFILE || "";
  const candidates =
    platform === "win32"
      ? [
          path.join(home, "AppData", "Local", "grok", "grok.exe"),
          path.join(home, ".local", "bin", "grok.exe"),
        ]
      : [
          path.join(home, ".local", "bin", "grok"),
          "/usr/local/bin/grok",
          path.join(home, "bin", "grok"),
        ];
  for (const c of candidates) {
    if (await exists(c)) return c;
  }
  return null;
}
```

Test with mocked env/fs where possible; unit-test candidate assembly with temp PATH.

- [ ] **Step 3: Auth bridge**
  - `auth.status`: run `grok auth status` (or documented equivalent); parse signed-in
  - `auth.signIn`: spawn interactive login (`grok auth login`) in a way that opens browser; poll until ready
  - Document exact CLI flags in code comments once verified against installed Grok Build (`grok --help`)

- [ ] **Step 4: Onboarding wizard UI** — sign in → policy defaults → default roots → optional role pack
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: SuperGrok auth bridge and OS secret storage"
```

---

## Task 14: Real Grok Build engine adapter

**Files:**
- Create: `packages/engine-grok/src/session.ts`
- Create: `packages/engine-grok/src/events.ts`
- Modify: gateway to choose `GrokBuildEngine` when binary+auth ready, else FakeEngine with banner

- [ ] **Step 1: Implement session spawner**
  - Prefer ACP/stdio JSON event stream if available
  - Else headless mode with documented flags for model + effort
  - Map `NormalizedEngineEvent` from engine output lines
- [ ] **Step 2: Pass system preamble** (memory slice + standing instructions + policy roots)
- [ ] **Step 3: Integration test with FakeEngine remains green; add optional live test gated by `GROKDESK_LIVE=1`
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(engine-grok): Grok Build session adapter"
```

---

## Task 15: Parallelism controls + resource caps

**Files:**
- Modify: `TaskRunner` maxConcurrent from settings
- Modify: Settings UI
- Create: gateway test for queueing when cap reached

- [ ] **Step 1: Settings key `maxConcurrentTasks` default 3**
- [ ] **Step 2: Test: create 5 autopilot tasks with maxConcurrent=2; assert only 2 `running` at once**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat(gateway): configurable parallel task cap"
```

---

## Task 16: Artifacts persistence + reveal in Finder/Explorer

**Files:**
- Create: `packages/gateway/src/services/artifacts.ts`
- Create: `apps/desktop/src/main/reveal.ts`
- IPC: `artifacts.list`, `artifacts.reveal`

```ts
// reveal.ts
import { shell } from "electron";
export async function revealInFileManager(filePath: string): Promise<void> {
  shell.showItemInFolder(filePath);
}
```

- [ ] **Step 1: Persist artifacts on `artifact_created`**
- [ ] **Step 2: UI list + Reveal button**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: artifact store and reveal in file manager"
```

---

## Task 17: Scheduler

**Files:**
- Create: `packages/shared/src/recurrence.ts` + tests
- Create: `packages/gateway/src/services/scheduler.ts` + tests
- Create: `ScheduleView.tsx`

- [ ] **Step 1: recurrence helpers**

```ts
import cronParser from "cron-parser";

export function nextRunAt(cron: string, timezone: string, from = new Date()): Date {
  const expr = cronParser.parseExpression(cron, {
    currentDate: from,
    tz: timezone,
  });
  return expr.next().toDate();
}

/** Minimal NL map for v1; expand later */
export function naturalLanguageToCron(input: string): string | null {
  const s = input.trim().toLowerCase();
  if (s === "every monday 9am" || s === "every monday at 9am") {
    return "0 9 * * 1";
  }
  if (s === "every day 9am" || s === "daily at 9am") {
    return "0 9 * * *";
  }
  return null;
}
```

Tests for nextRunAt with fixed `from` and timezone `UTC`.

- [ ] **Step 2: SchedulerService tick every 30s**
  - Load enabled rules
  - If next fire <= now and quiet hours allow → `tasks.create` with `mode: scheduled` + `scheduleRuleId`
  - Record last run in settings or `schedule_runs` table (add migration if needed)
- [ ] **Step 3: Quiet hours from settings `{ start: "22:00", end: "08:00", timezone }`**
- [ ] **Step 4: Schedule UI create/list/enable**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: scheduled tasks with cron and quiet hours"
```

---

## Task 18: Memory system

**Files:**
- Create: `packages/gateway/src/services/memory.ts`
- Create: `packages/gateway/src/embeddings/local.ts`
- Create: `MemoryView.tsx`
- Modify: runner to inject memory into `systemPreamble`

- [ ] **Step 1: CRUD memory_items via IPC (already in schema)**
- [ ] **Step 2: Local embeddings**
  - Start with bag-of-words cosine over token counts (deterministic, no native deps) for retrieval ranking
  - Interface:

```ts
export interface Embedder {
  embed(text: string): number[];
  similarity(a: number[], b: number[]): number;
}
```

- [ ] **Step 3: `memory.retrieve(goal, budgetTokens)` returns top items**
- [ ] **Step 4: Inject into engine preamble**
- [ ] **Step 5: Memory UI + tests**
- [ ] **Step 6: Commit**

```bash
git commit -m "feat: local memory store with retrieval injection"
```

---

## Task 19: Proactivity loop + inbox

**Files:**
- Create: `packages/gateway/src/services/proactivity.ts`
- Create: `packages/gateway/src/services/inbox.ts`
- Create: `InboxPanel.tsx`
- Modify: tray quick capture → creates `now` memory or draft task

- [ ] **Step 1: InboxService CRUD + markRead**
- [ ] **Step 2: Proactivity tick (default 60m)**
  - Scan unfinished / waiting_* / failed schedules
  - Create inbox items (dedupe by kind+taskId within 24h)
  - Emit event to main for notification
- [ ] **Step 3: Home view shows inbox + suggestions**
- [ ] **Step 4: Tests with fake clock / injectible `now`**
- [ ] **Step 5: Commit**

```bash
git commit -m "feat: proactivity loop and desktop inbox"
```

---

## Task 20: Role packs

**Files:**
- Create: `packages/shared/src/role-packs.ts` + tests
- Wire into task create + onboarding

```ts
export interface RolePack {
  id: string;
  name: string;
  description: string;
  skills: string[];
  standingInstructions: string;
  defaultEffort: "fast" | "normal" | "heavy";
}

export const ROLE_PACKS: RolePack[] = [
  {
    id: "marketing",
    name: "Marketing Agent",
    description: "Campaigns, copy, competitor scans, asset briefs",
    skills: ["marketing", "copywriting", "competitor-research"],
    standingInstructions:
      "Prefer clear claims, cite sources when researching, write shippable drafts.",
    defaultEffort: "normal",
  },
  {
    id: "research",
    name: "Researcher",
    description: "Deep research with structured notes",
    skills: ["research"],
    standingInstructions: "Separate facts from inference; list sources.",
    defaultEffort: "heavy",
  },
  {
    id: "ops",
    name: "Ops / Files",
    description: "Folder organization and operational cleanup",
    skills: ["files"],
    standingInstructions: "Prefer reversible file ops; never delete without approval.",
    defaultEffort: "fast",
  },
  {
    id: "chief-of-staff",
    name: "Chief of Staff",
    description: "Priorities, follow-ups, weekly narrative",
    skills: ["planning"],
    standingInstructions: "Protect focus; surface only high-leverage nudges.",
    defaultEffort: "normal",
  },
];
```

- [ ] **Step 1: Tests for pack lookup**
- [ ] **Step 2: Applying pack merges skills + standing memory on create**
- [ ] **Step 3: UI picker on New Task + Skills view**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: role packs for marketing, research, ops, chief of staff"
```

---

## Task 21: Skills & MCP management UI + gateway config

**Files:**
- Settings/Skills views
- Gateway stores MCP server configs in `settings` table as JSON
- Pass enabled MCP ids into engine adapter env/flags when supported

- [ ] **Step 1: Schema for MCP config in settings (`mcpServers: [{id, command, args, env}]`)**
- [ ] **Step 2: UI to add/edit/enable**
- [ ] **Step 3: Skills directory scan for SKILL.md under user skills path (both OS)**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: skills and MCP connector management"
```

---

## Task 22: Grok depth UX (model/effort, X/web, Imagine, sub-agents)

**Files:**
- `ModelEffortBar` already partial — complete with models from engine
- Event rendering for search citations and media artifacts
- UI toggle “Use Heavy / multi-agent” → effort `heavy` + engine flag

- [ ] **Step 1: Model list from `grok models` or static allowlist with refresh**
- [ ] **Step 2: Artifact kind `media` preview (image path / open external)**
- [ ] **Step 3: Sub-agent children shown under parent task in TaskList**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat(ui): model/effort, media artifacts, multi-agent display"
```

---

## Task 23: Protocol handler + export/import backup

**Files:**
- `apps/desktop/src/main/protocol.ts`
- Gateway export zip of data dir excluding secrets
- Settings “Export data” / “Import data”

```ts
// protocol: grokdesk://task/<id> focuses task
app.setAsDefaultProtocolClient("grokdesk");
```

- [ ] **Step 1: Register protocol on macOS + Windows (electron-builder protocols field)**
- [ ] **Step 2: Export/import implementation with tests on temp dirs**
- [ ] **Step 3: Commit**

```bash
git commit -m "feat: deep links and data export/import"
```

---

## Task 24: Hardening, CI, dual-OS packaging

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: prompt-injection policy tests in `packages/shared/src/policy.injection.test.ts`
- Signing notes in README (certs are secrets — document only)

- [ ] **Step 1: CI workflow**

```yaml
name: ci
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - run: pnpm install
      - run: pnpm -r run build
      - run: pnpm -r run test
```

Note: Electron E2E on Linux may need xvfb; gateway/shared tests must pass on all three. Desktop pack optional job on macOS + Windows only.

- [ ] **Step 2: Injection fixtures** — untrusted tool paths / shell metacharacters still deny outside roots
- [ ] **Step 3: `electron-builder` produce mac + win artifacts in CI release workflow (manual dispatch)
- [ ] **Step 4: README install + SuperGrok + Grok Build prerequisites for both OS**
- [ ] **Step 5: Commit**

```bash
git commit -m "ci: multi-OS test matrix and packaging config"
```

---

## Task 25: Optional hard sandbox engine adapter (S13)

**Files:**
- Create: `packages/engine-sandbox/` (Docker backend)
- Settings: “Run high-risk tasks in Docker” when Docker available

- [ ] **Step 1: Adapter implements same `EngineAdapter` interface**
- [ ] **Step 2: Mount only workspace roots into container**
- [ ] **Step 3: Feature-flag off by default**
- [ ] **Step 4: Commit**

```bash
git commit -m "feat: optional Docker sandbox engine adapter"
```

---

## Suggested execution order (checklist map)

| Order | Tasks | Spec stages |
|------:|-------|-------------|
| 1 | Tasks 1–6 | S0 foundations |
| 2 | Tasks 7–9 | S2 core path (offline) |
| 3 | Tasks 10–12 | S0 shell + S3/S4 UX start |
| 4 | Tasks 13–14 | S1 auth + real engine |
| 5 | Tasks 15–16 | S5–S6 parallel + artifacts |
| 6 | Task 17 | S7 scheduler |
| 7 | Tasks 18–19 | S8–S9 memory + proactivity |
| 8 | Tasks 20–22 | S10–S11 packs + Grok depth |
| 9 | Tasks 23–24 | S12 hardening |
| 10 | Task 25 | S13 optional sandbox |

---

## Self-review (plan vs spec)

| Spec requirement | Plan coverage |
|------------------|---------------|
| SuperGrok OAuth | Task 13–14 |
| Host shell + policy | Tasks 4, 8, 11 |
| Knowledge-work Cowork UI | Tasks 10–11 |
| Parallel tasks | Tasks 8, 15 |
| Scheduled work | Task 17 |
| Memory + proactivity | Tasks 18–19 |
| Desktop-only reach | Task 12, 19 |
| Model + effort | Tasks 11, 22 |
| Role packs / marketing | Task 20 |
| Full Grok surface | Tasks 14, 21, 22 |
| macOS + Windows parity | Tasks 3, 6, 12, 24; dual packaging |
| Audit + kill switch | Tasks 7–8, 12 |
| Artifacts | Tasks 8, 16 |
| Optional VM/Docker | Task 25 |

**Placeholder scan:** No TBD implementation steps; live CLI flags verified at Task 13 against installed Grok Build help (explicit discovery step).  
**Type consistency:** `Task`, `PolicySnapshot`, `IpcRequest`, `EngineAdapter`, `NormalizedEngineEvent` used uniformly across tasks.

---

## Plan amendments (from 2026-07-10 review)

Full review: `docs/superpowers/plans/2026-07-10-grok-desk-plan-review.md`

### A1. Engine / policy (P0)

- **FakeEngine:** gateway may execute tools under `evaluateToolRequest`.
- **GrokBuildEngine:** Grok Build executes tools. Map Desk policy → CLI flags:
  - workspace: `--cwd` set to primary root (multi-root: document primary + rules text)
  - autopilot: `--always-approve` or `--permission-mode bypassPermissions` (never default)
  - balanced/strict: map to `--permission-mode` after dogfood (`default` / `acceptEdits` / `plan`)
  - sandbox: prefer `--sandbox` when available over home-grown Docker first
- Auth CLI: `grok login` / `grok logout` (not `grok auth`).
- Headless: `grok agent` with `--output-format streaming-json` (verify; store fixtures under `packages/engine-grok/testdata/`).
- Model/effort: `--model`, `--reasoning-effort` / `--effort`.

### A2. New pure module (Wave 1)

Create `packages/shared/src/policy-to-grok-flags.ts` + tests converting `PolicySnapshot` + effort/model → argv array.

### A3. Parallel waves

| Wave | Tracks (parallel) | Gate |
|------|-------------------|------|
| W0 | T1 scaffold | pnpm install |
| W1 | T2–T5 + policy-to-grok-flags | shared tests |
| W2 | A: T6–T7 gateway · B: engine types+FakeEngine | both build |
| W3 | T8 runner + T9 facade | gateway tests |
| W4 | T10 Electron shell (+ electron native rebuild / prefer gateway child process) | app launches |
| W5 | A: T11 UI · B: T12 tray · C: folder picker + event push | smoke |
| W6 | T13 login bridge → T14 GrokBuildEngine | live optional |
| W7 | T15 ∥ T16 ∥ T17 ∥ T18 ∥ T20 (path-owned) | integration |
| W8 | T19 · T21 · T22 | dogfood |
| W9 | T23 · T24 | RC |
| W10 | T25 optional | backlog |

**Max 3 implementer subagents per wave.** Path ownership: `shared` | `engine-grok` | `gateway` | `desktop-main` | `desktop-ui` | `ci`.

### A4. Operational

- Native modules: `electron-builder install-app-deps` or gateway **child process** on system Node.
- Migrations: versioned from Task 6 (not only V1 dump).
- Folder picker IPC required for no-code UX by Task 11.
- Event push main→renderer preferred; poll as fallback.

---

## Execution status

- Mode: **Subagent-driven + wave-parallel**
- Branch: `feat/grok-desk`
- Review approved for execution with amendments above
