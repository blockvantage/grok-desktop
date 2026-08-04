# Chat Composer Attachments, Voice, @Mentions & Deliverables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users attach files/images, @-mention paths, send voice with polished animations (STT + optional audio), and show only Grok-created files as deliverables when a project folder is open.

**Architecture:** Renderer composers hold a local `attachments[]` list (paperclip / drop / paste / @ / voice). On `tasks.create`, gateway resolves the managed primary workspace, stages images + optional voice under `attachments/`, path-refs other files, and injects an attachment block into the engine prompt. Deliverables rail and harvest use **primary root artifacts only** (no project folder inventory).

**Tech Stack:** Electron dialogs + IPC, React renderer, Zod IPC schemas (`@grokdesk/shared`), Gateway TaskRunner harvest, Grok STT (existing dictation), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-11-chat-composer-attachments-voice-deliverables-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/shared/src/types.ts` | `TaskAttachment` type; extend `CreateTaskInput` |
| `packages/shared/src/ipc.ts` | Zod schemas for attachments on create |
| `packages/shared/src/attachments.ts` **(new)** | Pure helpers: image/audio detect, safe names, prompt block, caps |
| `packages/shared/src/attachments.test.ts` **(new)** | Unit tests for helpers |
| `packages/gateway/src/services/attachment-stage.ts` **(new)** | Copy images/audio into primary workspace |
| `packages/gateway/src/services/attachment-stage.test.ts` **(new)** | Staging tests |
| `packages/gateway/src/index.ts` | Stage + enrich on `tasks.create` |
| `packages/gateway/src/services/runner.ts` | Harvest **primary root only** |
| `packages/gateway/src/services/runner.test.ts` | Harvest scope tests |
| `packages/engine-grok/src/session.ts` | Optional: keep goal as source of truth (attachment text already in goal) |
| `apps/desktop/src/main/dialog.ts` | `pickFiles` multi-select |
| `apps/desktop/src/main/index.ts` | IPC for pickFiles + writeTempAttachment |
| `apps/desktop/src/preload/index.ts` | Expose pickFiles / writeTempAttachment |
| `apps/desktop/src/renderer/lib/api.ts` | Typed wrappers |
| `apps/desktop/src/renderer/lib/attachments.ts` **(new)** | Client attachment list ops, limits, paste |
| `apps/desktop/src/renderer/lib/attachments.test.ts` **(new)** | Pure client helpers |
| `apps/desktop/src/renderer/lib/mention-files.ts` **(new)** | `@` query filter + token insert |
| `apps/desktop/src/renderer/lib/mention-files.test.ts` **(new)** | Mention parsing tests |
| `apps/desktop/src/renderer/hooks/use-dictation.ts` | Expose live `level` 0–1 from PCM |
| `apps/desktop/src/renderer/components/dictation-button.tsx` | Waveform / level bars + keep-audio affordance |
| `apps/desktop/src/renderer/components/composer-attachments.tsx` **(new)** | Chips strip |
| `apps/desktop/src/renderer/components/file-mention-menu.tsx` **(new)** | `@` popup |
| `apps/desktop/src/renderer/components/views/home-view.tsx` | Wire attach / drop / paste / @ / voice keep |
| `apps/desktop/src/renderer/components/views/task-workspace-view.tsx` | Same + deliverables artifacts-only; follow-up attachments |
| `apps/desktop/src/renderer/App.tsx` | Pass attachments into `tasks.create` |
| `apps/desktop/src/renderer/ui-structure.test.ts` | Structure guards |
| Locale `en.json` / `es.json` | New strings |

---

### Task 1: Shared attachment types + pure helpers

**Files:**
- Create: `packages/shared/src/attachments.ts`
- Create: `packages/shared/src/attachments.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/ipc.ts`
- Modify: `packages/shared/src/ipc.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write failing tests for helpers**

```ts
// packages/shared/src/attachments.test.ts
import { describe, expect, it } from "vitest";
import {
  attachmentKindForName,
  buildAttachmentsPromptBlock,
  isAllowedAttachmentSize,
  MAX_ATTACHMENTS,
  sanitizeAttachmentFileName,
} from "./attachments.js";

describe("attachments", () => {
  it("classifies image / audio / file", () => {
    expect(attachmentKindForName("a.PNG")).toBe("image");
    expect(attachmentKindForName("v.wav")).toBe("audio");
    expect(attachmentKindForName("r.pdf")).toBe("file");
  });

  it("sanitizes names", () => {
    expect(sanitizeAttachmentFileName("../../x y.png")).toBe("x-y.png");
  });

  it("enforces size + count caps", () => {
    expect(isAllowedAttachmentSize("image", 14 * 1024 * 1024)).toBe(true);
    expect(isAllowedAttachmentSize("image", 16 * 1024 * 1024)).toBe(false);
    expect(MAX_ATTACHMENTS).toBe(10);
  });

  it("builds prompt block with sections", () => {
    const block = buildAttachmentsPromptBlock([
      {
        id: "1",
        name: "hero.png",
        sourcePath: "/tmp/hero.png",
        kind: "image",
        stagedPath: "/ws/attachments/hero.png",
      },
      {
        id: "2",
        name: "r.pdf",
        sourcePath: "/Users/me/r.pdf",
        kind: "file",
      },
    ]);
    expect(block).toContain("Attached images");
    expect(block).toContain("/ws/attachments/hero.png");
    expect(block).toContain("Attached files");
    expect(block).toContain("/Users/me/r.pdf");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/shared && pnpm exec vitest run src/attachments.test.ts
```

Expected: cannot find module `./attachments.js`

- [ ] **Step 3: Implement helpers + types + schema**

```ts
// packages/shared/src/attachments.ts
export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type AttachmentKind = "image" | "file" | "audio";

export function attachmentKindForName(name: string): AttachmentKind {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(n)) return "image";
  if (/\.(wav|mp3|m4a|ogg|webm|aac)$/.test(n)) return "audio";
  return "file";
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  return base.replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}

export function isAllowedAttachmentSize(
  kind: AttachmentKind,
  sizeBytes: number,
): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return false;
  if (kind === "image") return sizeBytes <= MAX_IMAGE_BYTES;
  if (kind === "audio") return sizeBytes <= MAX_AUDIO_BYTES;
  return sizeBytes <= MAX_FILE_BYTES;
}

export type AttachmentPromptInput = {
  id: string;
  name: string;
  sourcePath: string;
  kind: AttachmentKind;
  stagedPath?: string;
};

export function buildAttachmentsPromptBlock(
  items: AttachmentPromptInput[],
): string {
  if (!items.length) return "";
  const images = items.filter((i) => i.kind === "image");
  const files = items.filter((i) => i.kind === "file");
  const audio = items.filter((i) => i.kind === "audio");
  const lines: string[] = [];
  if (images.length) {
    lines.push("Attached images (in primary workspace):");
    for (const i of images) {
      lines.push(`- ${i.stagedPath || i.sourcePath}`);
    }
  }
  if (files.length) {
    lines.push("Attached files (read by path):");
    for (const i of files) lines.push(`- ${i.sourcePath}`);
  }
  if (audio.length) {
    lines.push("Attached audio:");
    for (const i of audio) {
      lines.push(`- ${i.stagedPath || i.sourcePath}`);
    }
  }
  return lines.join("\n");
}

export function mergeGoalWithAttachments(
  goal: string,
  items: AttachmentPromptInput[],
): string {
  const block = buildAttachmentsPromptBlock(items);
  if (!block) return goal;
  return `${goal.trim()}\n\n${block}`;
}
```

Add to `types.ts`:

```ts
export interface TaskAttachment {
  id: string;
  name: string;
  sourcePath: string;
  kind: "image" | "file" | "audio";
  stagedPath?: string;
  mime?: string;
  sizeBytes?: number;
}

// on CreateTaskInput:
attachments?: TaskAttachment[];
```

In `ipc.ts` on `CreateTaskInputSchema`:

```ts
attachments: z
  .array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      sourcePath: z.string().min(1),
      kind: z.enum(["image", "file", "audio"]),
      stagedPath: z.string().optional(),
      mime: z.string().optional(),
      sizeBytes: z.number().nonnegative().optional(),
    }),
  )
  .max(10)
  .default([]),
```

Export from `index.ts`: `export * from "./attachments.js";`

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd packages/shared && pnpm exec vitest run src/attachments.test.ts src/ipc.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/attachments.ts packages/shared/src/attachments.test.ts packages/shared/src/types.ts packages/shared/src/ipc.ts packages/shared/src/ipc.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): task attachment types and prompt helpers"
```

---

### Task 2: Gateway stage attachments + enrich goal on create

**Files:**
- Create: `packages/gateway/src/services/attachment-stage.ts`
- Create: `packages/gateway/src/services/attachment-stage.test.ts`
- Modify: `packages/gateway/src/index.ts` (`tasks.create` case)
- Modify: `packages/gateway/src/dispatch.test.ts` (optional create-with-attachments case)

- [ ] **Step 1: Write failing staging tests**

```ts
// packages/gateway/src/services/attachment-stage.test.ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stageTaskAttachments } from "./attachment-stage.js";

let dir: string;
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("stageTaskAttachments", () => {
  it("copies images into primary/attachments and leaves files as path refs", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-"));
    const primary = path.join(dir, "primary");
    fs.mkdirSync(primary);
    const img = path.join(dir, "photo.png");
    fs.writeFileSync(img, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const pdf = path.join(dir, "doc.pdf");
    fs.writeFileSync(pdf, "%PDF-1.4");

    const out = stageTaskAttachments(primary, [
      {
        id: "1",
        name: "photo.png",
        sourcePath: img,
        kind: "image",
        sizeBytes: 4,
      },
      {
        id: "2",
        name: "doc.pdf",
        sourcePath: pdf,
        kind: "file",
        sizeBytes: 8,
      },
    ]);

    expect(out[0]!.stagedPath).toMatch(/attachments[/\\]photo\.png$/);
    expect(fs.existsSync(out[0]!.stagedPath!)).toBe(true);
    expect(out[1]!.stagedPath).toBeUndefined();
    expect(out[1]!.sourcePath).toBe(path.resolve(pdf));
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd packages/gateway && pnpm exec vitest run src/services/attachment-stage.test.ts
```

- [ ] **Step 3: Implement staging + wire create**

```ts
// packages/gateway/src/services/attachment-stage.ts
import fs from "node:fs";
import path from "node:path";
import {
  isAllowedAttachmentSize,
  sanitizeAttachmentFileName,
  type TaskAttachment,
} from "@grokdesk/shared";

export function stageTaskAttachments(
  primaryRoot: string,
  items: TaskAttachment[],
): TaskAttachment[] {
  const destDir = path.join(primaryRoot, "attachments");
  fs.mkdirSync(destDir, { recursive: true });
  const used = new Set<string>();

  return items.map((item) => {
    const abs = path.resolve(item.sourcePath);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error(`Attachment not found: ${item.name}`);
    }
    const size = fs.statSync(abs).size;
    if (!isAllowedAttachmentSize(item.kind, size)) {
      throw new Error(`Attachment too large: ${item.name}`);
    }
    if (item.kind === "file") {
      return { ...item, sourcePath: abs, sizeBytes: size };
    }
    // image + audio → copy into managed attachments/
    let name = sanitizeAttachmentFileName(item.name);
    let candidate = path.join(destDir, name);
    let n = 1;
    while (used.has(candidate) || fs.existsSync(candidate)) {
      const ext = path.extname(name);
      const stem = path.basename(name, ext);
      name = `${stem}-${n}${ext}`;
      candidate = path.join(destDir, name);
      n += 1;
    }
    fs.copyFileSync(abs, candidate);
    used.add(candidate);
    return {
      ...item,
      sourcePath: abs,
      stagedPath: candidate,
      sizeBytes: size,
      name,
    };
  });
}
```

In `packages/gateway/src/index.ts` `tasks.create`:

```ts
case "tasks.create": {
  const params = { ...req.params };
  params.workspaceRoots = this.resolveTaskWorkspaceRoots(params);
  const primary = params.workspaceRoots[0]!;
  const rawAtt = (params.attachments ?? []) as import("@grokdesk/shared").TaskAttachment[];
  if (rawAtt.length > 0) {
    const staged = stageTaskAttachments(primary, rawAtt);
    params.attachments = staged;
    params.goal = mergeGoalWithAttachments(params.goal, staged);
  }
  // … rolePack, create, etc.
}
```

Import `stageTaskAttachments`, `mergeGoalWithAttachments`.

- [ ] **Step 4: Run tests PASS**

```bash
cd packages/gateway && pnpm exec vitest run src/services/attachment-stage.test.ts src/dispatch.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/gateway/src/services/attachment-stage.ts packages/gateway/src/services/attachment-stage.test.ts packages/gateway/src/index.ts packages/gateway/src/dispatch.test.ts
git commit -m "feat(gateway): stage chat attachments into managed workspace"
```

---

### Task 3: Deliverables harvest — primary root only + UI artifacts-only

**Files:**
- Modify: `packages/gateway/src/services/runner.ts` (`harvestWorkspaceDeliverables`)
- Modify: `packages/gateway/src/services/runner.test.ts`
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/ui-structure.test.ts`

- [ ] **Step 1: Write failing harvest test**

Add to `runner.test.ts`:

```ts
it("harvests only primary root, not secondary project files", async () => {
  const silent: EngineAdapter = {
    executesOwnTools: true,
    async cancel() {},
    async run(opts) {
      const primary = opts.task.policySnapshot.workspaceRoots[0]!;
      fs.writeFileSync(path.join(primary, "made-by-grok.md"), "hi");
      await opts.onEvent({ type: "done", summary: "ok" });
    },
  };
  runner = new TaskRunner(tasks, audit, silent);
  const primary = path.join(dir, "primary-h");
  const project = path.join(dir, "project-h");
  fs.mkdirSync(primary);
  fs.mkdirSync(project);
  fs.writeFileSync(path.join(project, "old-readme.md"), "pre-existing");
  const t = tasks.create({
    goal: "Write",
    workspaceRoots: [primary, project],
    approvalMode: "autopilot",
  });
  await runner.start(t.id);
  const arts = tasks
    .listEvents(t.id)
    .filter((e) => e.kind === "artifact_created")
    .map((e) => path.basename(String(e.payload.path)));
  expect(arts).toContain("made-by-grok.md");
  expect(arts).not.toContain("old-readme.md");
});
```

- [ ] **Step 2: Run — expect FAIL** (current code harvests all roots and may pick up secondary if mtime is new)

Note: secondary file is pre-existing so mtime may be old enough to skip — force mtime if needed:

```ts
const old = path.join(project, "old-readme.md");
fs.writeFileSync(old, "pre-existing");
// Touch mtime to "now" to prove we still ignore secondary
const now = new Date();
fs.utimesSync(old, now, now);
```

- [ ] **Step 3: Fix harvest to primary only**

In `harvestWorkspaceDeliverables`:

```ts
const roots = task.policySnapshot.workspaceRoots;
const primary = roots[0];
if (!primary) return 0;
// Only primary managed workspace for deliverables
const files = listDeliverableFiles(primary, 40, sinceMs);
// … existing knownPaths loop for single root
```

- [ ] **Step 4: UI — artifacts only**

In `task-workspace-view.tsx`:

1. Remove `files` state + `workspace.listFiles` effect (or keep only if used elsewhere — it is only for deliverables merge → delete).
2. Change deliverables memo:

```ts
const deliverables: Deliverable[] = useMemo(() => {
  const byPath = new Map<string, Deliverable>();
  for (const a of arts) {
    const key = a.path ? pathKey(a.path) : `art:${a.id}`;
    byPath.set(key, {
      key,
      title: a.title || fileName(a.path) || "Deliverable",
      path: a.path,
      source: "artifact",
      isImage: isImagePath(a.path),
      isVideo: isVideoPath(a.path),
    });
  }
  return [...byPath.values()];
}, [arts]);
```

3. Empty copy:

```tsx
{isLive
  ? "Files Grok writes will show up here."
  : "No deliverables yet."}
```

4. Update `ui-structure.test.ts` if needed:

```ts
expect(ws).not.toMatch(/workspace\.listFiles/);
// or allow listFiles only if reintroduced for something else
```

- [ ] **Step 5: Run tests**

```bash
cd packages/gateway && pnpm exec vitest run src/services/runner.test.ts
cd apps/desktop && pnpm exec vitest run src/renderer/ui-structure.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add packages/gateway/src/services/runner.ts packages/gateway/src/services/runner.test.ts apps/desktop/src/renderer/components/views/task-workspace-view.tsx apps/desktop/src/renderer/ui-structure.test.ts
git commit -m "fix: deliverables are Grok-created artifacts only"
```

---

### Task 4: Electron pickFiles + temp write for paste/voice

**Files:**
- Modify: `apps/desktop/src/main/dialog.ts`
- Modify: `apps/desktop/src/main/index.ts`
- Modify: `apps/desktop/src/preload/index.ts`
- Modify: `apps/desktop/src/renderer/lib/api.ts`
- Modify: `apps/desktop/src/packaging.smoke.test.ts` (optional string checks)

- [ ] **Step 1: Add `pickFiles` + `writeTempAttachment`**

```ts
// dialog.ts
export async function pickFiles(
  parent?: BrowserWindow | null,
): Promise<string[]> {
  const opts = {
    properties: ["openFile", "multiSelections"] as Array<
      "openFile" | "multiSelections"
    >,
    // no restrictive filters — allow any file; kind inferred by extension
  };
  const result = parent
    ? await dialog.showOpenDialog(parent, opts)
    : await dialog.showOpenDialog(opts);
  if (result.canceled) return [];
  return result.filePaths ?? [];
}
```

Main IPC:

```ts
ipcMain.handle("grokdesk:pickFiles", async () => pickFiles(mainWindow));

ipcMain.handle(
  "grokdesk:writeTempAttachment",
  async (_e, payload: { name: string; base64: string }) => {
    const safe = String(payload?.name || "paste.bin").replace(/[^\w.\-]+/g, "-");
    const dir = path.join(app.getPath("userData"), "pending-attachments");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${Date.now()}-${safe}`);
    fs.writeFileSync(file, Buffer.from(String(payload.base64), "base64"));
    return { ok: true as const, path: file };
  },
);
```

Preload:

```ts
pickFiles: () => ipcRenderer.invoke("grokdesk:pickFiles") as Promise<string[]>,
writeTempAttachment: (payload: { name: string; base64: string }) =>
  ipcRenderer.invoke("grokdesk:writeTempAttachment", payload) as Promise<{
    ok: boolean;
    path?: string;
    error?: string;
  }>,
```

`api.ts`:

```ts
export async function pickFiles(): Promise<string[]> {
  if (!window.grokdesk?.pickFiles) return [];
  return window.grokdesk.pickFiles();
}

export async function writeTempAttachment(
  name: string,
  base64: string,
): Promise<string | null> {
  const r = await window.grokdesk?.writeTempAttachment?.({ name, base64 });
  return r?.ok && r.path ? r.path : null;
}
```

Update `Window.grokdesk` typing in `api.ts` accordingly. Remove handler on teardown next to `pickDirectory`.

- [ ] **Step 2: Smoke test strings (optional)**

```ts
expect(preload).toMatch(/pickFiles/);
expect(preload).toMatch(/writeTempAttachment/);
```

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/dialog.ts apps/desktop/src/main/index.ts apps/desktop/src/preload/index.ts apps/desktop/src/renderer/lib/api.ts apps/desktop/src/packaging.smoke.test.ts
git commit -m "feat(desktop): multi-file picker and temp attachment writes"
```

---

### Task 5: Client attachment helpers + chips UI

**Files:**
- Create: `apps/desktop/src/renderer/lib/attachments.ts`
- Create: `apps/desktop/src/renderer/lib/attachments.test.ts`
- Create: `apps/desktop/src/renderer/components/composer-attachments.tsx`

- [ ] **Step 1: Tests for client list ops**

```ts
// attachments.test.ts
import { describe, expect, it } from "vitest";
import {
  addPathsToAttachments,
  removeAttachment,
  type ClientAttachment,
} from "./attachments";

describe("client attachments", () => {
  it("adds paths with kinds and enforces max", () => {
    const paths = Array.from({ length: 12 }, (_, i) => `/tmp/f${i}.txt`);
    const { items, error } = addPathsToAttachments([], paths);
    expect(items.length).toBe(10);
    expect(error).toMatch(/10/);
  });

  it("dedupes by resolved path", () => {
    const a: ClientAttachment[] = [];
    const r1 = addPathsToAttachments(a, ["/tmp/a.png"]);
    const r2 = addPathsToAttachments(r1.items, ["/tmp/a.png"]);
    expect(r2.items.length).toBe(1);
  });

  it("removes by id", () => {
    const { items } = addPathsToAttachments([], ["/tmp/a.pdf"]);
    expect(removeAttachment(items, items[0]!.id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// lib/attachments.ts
import {
  MAX_ATTACHMENTS,
  attachmentKindForName,
  type TaskAttachment,
} from "@grokdesk/shared";

export type ClientAttachment = TaskAttachment;

export function addPathsToAttachments(
  current: ClientAttachment[],
  paths: string[],
): { items: ClientAttachment[]; error?: string } {
  const next = [...current];
  const seen = new Set(next.map((a) => a.sourcePath));
  let error: string | undefined;
  for (const p of paths) {
    if (next.length >= MAX_ATTACHMENTS) {
      error = `You can attach up to ${MAX_ATTACHMENTS} files.`;
      break;
    }
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const name = p.split(/[/\\]/).pop() || "file";
    next.push({
      id: crypto.randomUUID(),
      name,
      sourcePath: p,
      kind: attachmentKindForName(name),
    });
  }
  return { items: next, error };
}

export function removeAttachment(
  current: ClientAttachment[],
  id: string,
): ClientAttachment[] {
  return current.filter((a) => a.id !== id);
}

export function toTaskAttachments(
  items: ClientAttachment[],
): TaskAttachment[] {
  return items.map(({ id, name, sourcePath, kind, stagedPath, mime, sizeBytes }) => ({
    id,
    name,
    sourcePath,
    kind,
    stagedPath,
    mime,
    sizeBytes,
  }));
}
```

Chips component (`composer-attachments.tsx`): horizontal list of chips with icon (Image / File / Mic), name truncated, × remove. No network; pure UI.

- [ ] **Step 3: Run tests PASS + commit**

```bash
cd apps/desktop && pnpm exec vitest run src/renderer/lib/attachments.test.ts
git add apps/desktop/src/renderer/lib/attachments.ts apps/desktop/src/renderer/lib/attachments.test.ts apps/desktop/src/renderer/components/composer-attachments.tsx
git commit -m "feat(renderer): composer attachment list and chips"
```

---

### Task 6: `@` file mention menu

**Files:**
- Create: `apps/desktop/src/renderer/lib/mention-files.ts`
- Create: `apps/desktop/src/renderer/lib/mention-files.test.ts`
- Create: `apps/desktop/src/renderer/components/file-mention-menu.tsx`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  extractMentionQuery,
  filterMentionCandidates,
  insertMentionToken,
} from "./mention-files";

describe("mentions", () => {
  it("extracts @query at cursor", () => {
    expect(extractMentionQuery("see @bri", 8)).toEqual({
      start: 4,
      query: "bri",
    });
    expect(extractMentionQuery("email a@b.com", 13)).toBeNull();
  });

  it("filters by name", () => {
    const c = filterMentionCandidates(
      [
        { path: "/ws/brief.md", name: "brief.md", group: "attached" },
        { path: "/ws/other.txt", name: "other.txt", group: "project" },
      ],
      "bri",
    );
    expect(c).toHaveLength(1);
    expect(c[0]!.name).toBe("brief.md");
  });

  it("inserts backtick path token", () => {
    const r = insertMentionToken("see @bri", 8, 4, "/proj/brief.md");
    expect(r.text).toBe("see `@/proj/brief.md` ");
    expect(r.cursor).toBe(r.text.length);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// mention-files.ts
export type MentionCandidate = {
  path: string;
  name: string;
  group: "attached" | "project" | "deliverable";
};

export function extractMentionQuery(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(/(^|[\s])@([^\s@]*)$/);
  if (!m) return null;
  const at = before.lastIndexOf("@");
  // avoid email-like: char before @ is word char without space start
  if (at > 0 && /[^\s]/.test(before[at - 1]!) && !/\s/.test(before[at - 1]!)) {
    // if previous char is non-space and not the start group, treat as email
    if (!/\s/.test(before[at - 1]!)) return null;
  }
  return { start: at, query: m[2] ?? "" };
}

export function filterMentionCandidates(
  all: MentionCandidate[],
  query: string,
  limit = 8,
): MentionCandidate[] {
  const q = query.toLowerCase();
  return all
    .filter((c) => !q || c.name.toLowerCase().includes(q) || c.path.toLowerCase().includes(q))
    .slice(0, limit);
}

export function insertMentionToken(
  text: string,
  cursor: number,
  start: number,
  filePath: string,
): { text: string; cursor: number } {
  const token = `\`@${filePath}\` `;
  const next = text.slice(0, start) + token + text.slice(cursor);
  return { text: next, cursor: start + token.length };
}
```

Menu UI: absolute positioned list under composer; keyboard ↑↓ Enter Esc; on pick call insert + `addPathsToAttachments`.

**Candidate sources (wire in views later):**
- Attached chips
- Project root via existing `workspace.listFiles` **only for mention picker**, not deliverables (`rpc("workspace.listFiles", { root, max: 40 })`)
- Deliverables from open task artifacts (follow-up)

- [ ] **Step 3: Tests PASS + commit**

```bash
cd apps/desktop && pnpm exec vitest run src/renderer/lib/mention-files.test.ts
git commit -am "feat(renderer): @ file mention parsing and menu"
```

---

### Task 7: Voice level animation + keep-audio

**Files:**
- Modify: `apps/desktop/src/renderer/hooks/use-dictation.ts`
- Modify: `apps/desktop/src/renderer/components/dictation-button.tsx`
- Modify: `apps/desktop/src/main/dictation-service.ts` (optional: return path to WAV already built for STT — reuse buffer)

- [ ] **Step 1: Expose live level from PCM**

In `use-dictation.ts` `onaudioprocess`, after building `pcm`:

```ts
let sum = 0;
for (let i = 0; i < pcm.length; i++) {
  const v = pcm[i]! / 0x8000;
  sum += v * v;
}
const rms = Math.sqrt(sum / Math.max(1, pcm.length));
setLevel(Math.min(1, rms * 4)); // sensitize
```

Return `{ level, keepAudio, setKeepAudio, ... }` from hook.

- [ ] **Step 2: On stop with keepAudio, write WAV temp**

Reuse main process WAV encoding if exposed; else encode in renderer from accumulated Int16 PCM:

Add `pcmChunksRef: Int16Array[]` during capture. On stop + keepAudio:

```ts
const wavB64 = encodeWavBase64(pcmChunksRef.current, 16000);
const p = await writeTempAttachment(`voice-${Date.now()}.wav`, wavB64);
if (p) opts.onAudioAttached?.(p);
```

Implement small `encodeWavBase64` in `lib/wav.ts` (PCM16 mono header + samples) + unit test for header bytes `RIFF`/`WAVE`.

- [ ] **Step 3: DictationButton UI**

- When `listening`: 4–5 vertical bars scaled by `level` (CSS `scaleY` / height), soft glow ring.
- When `processing`: spinner ring morph.
- Optional compact toggle “Keep” / waveform chip when `keepAudio`.
- Props: `level: number`, `keepAudio?: boolean`, `onToggleKeepAudio?: () => void`.

- [ ] **Step 4: Manual UX check list (document in PR)**

1. Mic → bars react to speaking  
2. Stop → processing → text appears  
3. Keep audio → chip appears after stop  

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/hooks/use-dictation.ts apps/desktop/src/renderer/components/dictation-button.tsx apps/desktop/src/renderer/lib/wav.ts apps/desktop/src/renderer/lib/wav.test.ts
git commit -m "feat(voice): live levels, keep-audio WAV staging"
```

---

### Task 8: Wire Home composer (attach / drop / paste / @ / voice / create)

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/home-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx`
- Modify: locale files under `apps/desktop/src/renderer/i18n/` (en + es keys)

- [ ] **Step 1: Home state**

```ts
const [attachments, setAttachments] = useState<ClientAttachment[]>([]);
const [mentionOpen, setMentionOpen] = useState(false);
// dictation with onAudioAttached → addPathsToAttachments
```

Toolbar: Paperclip button → `pickFiles()` → add paths.  
Compose surface: `onDragOver` preventDefault + `onDrop` files (paths via `f.path` in Electron File).  
`onPaste`: if clipboard image items, read as base64 → `writeTempAttachment` → add.

Render `<ComposerAttachments items={attachments} onRemove={…} />`.  
Render `<FileMentionMenu …>` when `extractMentionQuery` non-null.

- [ ] **Step 2: App.createTask accepts attachments**

```ts
// HomeView props
attachments: ClientAttachment[];
onAttachments: (a: ClientAttachment[]) => void;
// or keep state in App and pass down — prefer state in Home lifted to App so createTask can read it

// App.tsx createTask:
const task = await rpc<Task>("tasks.create", {
  goal: g,
  workspaceRoots,
  model,
  effort,
  approvalMode,
  rolePack: null,
  attachments: toTaskAttachments(attachments),
});
// clear attachments on success
setAttachments([]);
```

Simplest: keep attachment state in `App` next to `goal`, pass to HomeView like goal.

- [ ] **Step 3: i18n keys**

```
composer.attach: Attach files
composer.dropHint: Drop files here
composer.maxAttachments: Up to 10 files
composer.keepAudio: Keep audio
dictation.sending: Sending voice…
```

- [ ] **Step 4: Structure test**

```ts
// ui-structure.test.ts
const home = read("components/views/home-view.tsx");
expect(home).toMatch(/ComposerAttachments|pickFiles|Paperclip/);
expect(home).toMatch(/FileMentionMenu|extractMentionQuery/);
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(home): wire attachments, mentions, and voice keep-audio"
```

---

### Task 9: Wire follow-up composer + send animation

**Files:**
- Modify: `apps/desktop/src/renderer/components/views/task-workspace-view.tsx`
- Modify: `apps/desktop/src/renderer/App.tsx` (`onFollowUp`)

- [ ] **Step 1: Follow-up attachments state** in workspace view (local is fine).

On submit:

```ts
props.onFollowUp?.(followUp, toTaskAttachments(attachments));
```

App:

```ts
onFollowUp={async (goal, attachments) => {
  await rpc("tasks.create", {
    goal,
    parentTaskId: selectedId,
    workspaceRoots: [], // inherit
    attachments: attachments ?? [],
    model,
    effort,
    approvalMode,
  });
}}
```

- [ ] **Step 2: Mention candidates** = attachments ∪ artifacts of task ∪ optional project secondary root files for picker only.

Secondary root: `task.policySnapshot.workspaceRoots[1]`.

- [ ] **Step 3: Send animation**

When submitting with audio attachment: set `voiceSending` true for ~600ms; DictationButton gets `state="processing"` or new visual class `animate-send-burst` (scale ring). CSS in existing globals / Tailwind:

```css
@keyframes send-burst {
  0% { box-shadow: 0 0 0 0 hsl(var(--primary) / 0.5); }
  100% { box-shadow: 0 0 0 12px hsl(var(--primary) / 0); }
}
```

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(workspace): follow-up attachments, mentions, voice send motion"
```

---

### Task 10: Integration verification + polish pass

**Files:** any residual from above; tests; locales

- [ ] **Step 1: Run full unit suite**

```bash
pnpm -r exec vitest run --passWithNoTests 2>/dev/null || true
cd packages/shared && pnpm exec vitest run
cd packages/gateway && pnpm exec vitest run
cd packages/engine-grok && pnpm exec vitest run
cd apps/desktop && pnpm exec vitest run
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck
# or per-package tsc -b
```

- [ ] **Step 3: Manual checklist**

| # | Scenario | Pass |
|---|----------|------|
| 1 | Paperclip image → run → file under managed `attachments/` | |
| 2 | Attach PDF → prompt has path, no copy into project folder | |
| 3 | Drag-drop + paste image work on home | |
| 4 | `@brief` picks file and inserts token | |
| 5 | Mic bars animate; stop fills text | |
| 6 | Keep audio → wav staged + text | |
| 7 | Open large project folder → Deliverables empty until Grok writes | |
| 8 | After run with written file → deliverable appears | |

- [ ] **Step 4: Related polish (while in these files)**

- Disable Run/Send when only attachments and empty goal **or** allow empty goal if attachments present by synthesizing goal `"See attached files."` — **prefer require non-empty goal text** (transcript counts).
- Toast on attach errors (too large / not found).
- Clear keep-audio toggle after successful send.

- [ ] **Step 5: Final commit if dirty**

```bash
git status
git commit -am "test: verify composer attachments voice deliverables"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Paperclip / multi-file | 4, 5, 8 |
| Drag-drop / paste images | 4, 5, 8 |
| Images staged to `attachments/` | 2 |
| Other files path-only | 1, 2 |
| `@` mentions | 6, 8, 9 |
| Voice levels + STT | 7 |
| Optional keep audio | 7, 8, 9 |
| Send animation | 9 |
| Deliverables = created only | 3 |
| Harvest primary only | 3 |
| Caps 10 / size limits | 1, 2, 5 |
| Shared home + follow-up | 8, 9 |
| Tests | 1–7, 10 |

## Placeholder scan

No TBD steps. Exact paths, code samples, and commands included.

## Type consistency

- `TaskAttachment` / `ClientAttachment` share shape from `@grokdesk/shared`
- `kind: "image" | "file" | "audio"` everywhere
- Gateway `stageTaskAttachments(primary, items) → TaskAttachment[]`
- `mergeGoalWithAttachments(goal, staged)` on create
- `toTaskAttachments` before RPC

---

## Execution handoff

Plan complete and saved to:

`docs/superpowers/plans/2026-07-11-chat-composer-attachments-voice-deliverables.md`

Spec:

`docs/superpowers/specs/2026-07-11-chat-composer-attachments-voice-deliverables-design.md`
