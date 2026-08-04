# Chat composer: attachments, voice, @mentions, deliverables

**Date:** 2026-07-11  
**Status:** Approved for implementation  
**Scope:** Home + task follow-up composers; deliverables rail; gateway harvest

## Problem

1. Users can pick a **folder** but cannot attach individual **images/files** to a chat task.
2. Voice is STT-only with a minimal pulse; no “sending audio” delight and no optional raw audio attachment.
3. Opening a project folder makes the **Deliverables** rail show existing folder files instead of files Grok actually created.

## Goals

| Area | Behavior |
|------|----------|
| Attach files | Paperclip, drag-drop, paste images; chips; limits |
| Images | Copy into managed primary workspace `attachments/` |
| Other files | Keep absolute path (no copy); list in prompt as references |
| `@` mentions | Type `@` to pick files (attached, project folder, chat deliverables) and insert path tokens into the goal |
| Voice | Live level animation; STT → text by default; optional “keep audio” stages WAV into attachments |
| Deliverables | Only files Grok created this run (artifacts + harvest on primary managed root) |

## Non-goals (v1)

- Full multimodal vision API payloads separate from workspace files
- `@people` / `@memory` mentions
- Free-disk recursive search outside selected project + attachments
- Separate “Project files” browser in the rail
- Thread-wide deliverable union across all turns (per-run only)

## Architecture

```
Composer (renderer)
  attachments[] + goal text + @mentions + voice
       │
       ▼
Main: pickFiles / copy / write staged assets (optional helpers)
       │
       ▼
tasks.create / follow-up  { goal, workspaceRoots, attachments? }
       │
       ▼
Gateway: resolve managed primary root → stage images/voice into attachments/
         → enrich goal/preamble with paths
       │
       ▼
Engine: primaryCwd write rules (existing)
       │
       ▼
Harvest: primary root only, mtime ≥ task start → artifact_created
UI rail: artifacts only (no listFiles merge)
```

## Data model

```ts
type TaskAttachment = {
  id: string;           // client uuid
  name: string;
  sourcePath: string;   // original absolute path (or staged path for paste/voice)
  kind: "image" | "file" | "audio";
  stagedPath?: string;  // set after copy into managed workspace
  mime?: string;
  sizeBytes?: number;
};
```

`CreateTaskInput` gains optional `attachments: TaskAttachment[]` (paths only over IPC; staging may complete in gateway after primary root is known).

## Attachment rules

- Max **10** attachments per send.
- Images: extensions png/jpg/jpeg/gif/webp/svg/bmp/avif; max **15MB** each; **copy** into `<primary>/attachments/<safe-name>`.
- Audio (optional voice keep): wav preferred; stage under `attachments/voice-<ts>.wav`.
- Other files: path reference only; must exist at send time.
- Prompt enrichment (gateway or engine preamble):

```
Attached images (in primary workspace):
- /…/attachments/hero.png
Attached files (read by path):
- /Users/…/report.pdf
Attached audio (optional):
- /…/attachments/voice-….wav
User goal:
…
```

## `@` mentions

- Trigger: `@` at start of token (whitespace-delimited).
- Candidates: current chips → recent files under selected project root (depth-limited) → deliverables of open task (follow-up).
- Insert form: `` `@/absolute/or/relative/path` `` (backtick-wrapped path) for unambiguous parsing; also ensure path is in `attachments` if not already.
- Keyboard: ↑↓ Enter Escape.

## Voice UX

1. Mic → listening + **live PCM level bars**.
2. Stop → processing ring → STT text into field.
3. Toggle **Keep audio** while listening (or on stop before processing completes).
4. If keep audio: stage WAV + chip; STT still fills text when available.
5. SuperGrok required for STT (existing rails); attach-audio-only without STT is allowed if signed out only if we skip STT — prefer keep current SuperGrok gate for mic start.

## Deliverables

- **UI:** Remove merging of `workspace.listFiles` into Deliverables. Rail = `artifact_created` / artifacts for this task only.
- **Harvest:** Scan **primary** workspace root only (`workspaceRoots[0]`). Keep `sinceMs = createdAt - 30s`. Do not harvest secondary project roots into deliverables.
- Empty: “Files Grok writes will show up here.” / “No deliverables yet.”

## Related polish

- Shared composer primitives between home and follow-up.
- Clear errors: too large, missing file, mic denied.
- Tests for harvest scope, attachment staging, `@` insert, deliverables UI source.

## Success criteria

1. Attach image → file appears under managed `attachments/` and is listed in prompt context.
2. Attach PDF → path only, no copy into project.
3. `@file` inserts path and includes it in context.
4. Voice: visible level animation; optional audio chip; transcript in field.
5. Open large project folder → Deliverables empty until Grok creates files; those files appear after run.
