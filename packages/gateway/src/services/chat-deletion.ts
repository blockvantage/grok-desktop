/**
 * Delete a chat thread: cancel runs, destroy browser sessions, delete DB rows,
 * and remove only app-managed workspace folders (Phase 6 extract).
 */
import fs from "node:fs";
import type { Task } from "@grokdesk/shared";
import type { TaskService } from "./tasks.js";
import type { HostBridge } from "../host-bridge.js";
import { collectManagedRootsToDelete } from "./workspace-managed.js";

export interface ChatDeletionDeps {
  tasks: TaskService;
  runner: {
    cancel: (taskId: string) => Promise<void>;
    /** Optional: drop in-memory desktop control grants for the thread root. */
    clearDesktopGrant?: (taskId: string) => void;
  };
  hostBridge: HostBridge;
  dataDir: string;
  /** Optional fs.rmSync override for tests. */
  rmSync?: typeof fs.rmSync;
}

/**
 * Delete whole chat thread (root + follow-ups). Never deletes user project roots.
 */
export async function deleteChatThread(
  taskId: string,
  deps: ChatDeletionDeps,
): Promise<{ ok: true; deletedIds: string[] }> {
  const members = deps.tasks.collectThread(taskId);
  for (const m of members) {
    if (
      m.status === "running" ||
      m.status === "queued" ||
      m.status === "waiting_approval"
    ) {
      try {
        await deps.runner.cancel(m.id);
      } catch {
        // proceed with deletion regardless
      }
    }
    try {
      await deps.hostBridge.browserDestroy(m.id);
    } catch {
      // host may be unavailable in tests
    }
  }

  // Drop desktop control grants before DB delete so threadRootId still resolves.
  try {
    deps.runner.clearDesktopGrant?.(taskId);
  } catch {
    // optional hook
  }

  const deleted = deps.tasks.deleteThread(taskId);
  const roots = collectManagedRootsToDelete(
    deleted.map((m: Task) => m.policySnapshot.workspaceRoots[0]),
    deps.dataDir,
  );
  const rm = deps.rmSync ?? fs.rmSync.bind(fs);
  for (const abs of roots) {
    try {
      rm(abs, { recursive: true, force: true });
    } catch {
      // locked or already gone
    }
  }
  return { ok: true, deletedIds: deleted.map((m) => m.id) };
}
