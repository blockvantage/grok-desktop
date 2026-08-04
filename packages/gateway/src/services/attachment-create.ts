/**
 * Stage attachments for tasks.create and clean up orphan managed workspaces
 * when staging fails before a task row exists (Phase 6 extract).
 */
import fs from "node:fs";
import path from "node:path";
import type { TaskAttachment } from "@grokdesk/shared";
import { planTaskAttachments } from "./attachment-stage.js";
import { isManagedWorkspaceRoot } from "./workspace-managed.js";

export interface StageAttachmentsForCreateInput {
  primaryRoot: string | undefined;
  attachments: TaskAttachment[] | undefined;
  parentTaskId: string | null | undefined;
  dataDir: string;
  /** Injected for tests. Defaults to the pure planner. */
  stage?: typeof planTaskAttachments;
}

export type StageAttachmentsForCreateResult =
  | { ok: true; attachments: TaskAttachment[] | undefined }
  | { ok: false; error: unknown; cleanedOrphan: boolean };

/**
 * Remove only an empty, app-managed root that was allocated speculatively for
 * a create which never adopted it. Never removes follow-up or user roots.
 */
export function cleanupUnacceptedManagedWorkspace(input: {
  primaryRoot: string | undefined;
  parentTaskId: string | null | undefined;
  dataDir: string;
  acceptedPrimaryRoot?: string | undefined;
}): boolean {
  const primary = input.primaryRoot;
  if (!primary || input.parentTaskId) return false;
  if (!isManagedWorkspaceRoot(primary, input.dataDir)) return false;
  const base = path.resolve(input.dataDir, "workspaces");
  if (
    path.dirname(path.resolve(primary)) !== base ||
    !/^grok-[A-Za-z0-9_-]{1,32}-[A-Za-z0-9]{6}$/.test(
      path.basename(primary),
    ) ||
    !fs.existsSync(base) ||
    fs.lstatSync(base).isSymbolicLink() ||
    fs.realpathSync(base) !==
      path.join(fs.realpathSync(path.resolve(input.dataDir)), "workspaces")
  ) {
    return false;
  }
  if (
    input.acceptedPrimaryRoot &&
    path.resolve(input.acceptedPrimaryRoot) === path.resolve(primary)
  ) {
    return false;
  }
  try {
    if (
      fs.lstatSync(primary).isSymbolicLink() ||
      !fs.statSync(primary).isDirectory()
    ) {
      return false;
    }
    if (fs.readdirSync(primary).length > 0) return false;
    fs.rmdirSync(primary);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate and plan attachment destinations without workspace writes.
 * On failure for a brand-new chat (no parent), remove the orphan managed dir
 * if it lives under dataDir/workspaces.
 */
export function stageAttachmentsForCreate(
  input: StageAttachmentsForCreateInput,
): StageAttachmentsForCreateResult {
  const stage = input.stage ?? planTaskAttachments;
  const primary = input.primaryRoot;
  const raw = input.attachments ?? [];

  if (!primary || raw.length === 0) {
    return { ok: true, attachments: undefined };
  }

  try {
    const staged = stage(primary, raw);
    return { ok: true, attachments: staged };
  } catch (error) {
    let cleanedOrphan = false;
    if (!input.parentTaskId && primary) {
      cleanedOrphan = cleanupUnacceptedManagedWorkspace({
        primaryRoot: primary,
        parentTaskId: input.parentTaskId,
        dataDir: input.dataDir,
      });
    }
    return { ok: false, error, cleanedOrphan };
  }
}
