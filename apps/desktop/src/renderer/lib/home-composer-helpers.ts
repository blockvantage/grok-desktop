/**
 * Pure helpers for HomeView composer (Phase 6 residual extracts).
 */

import { isManagedWorkspacePath, userFacingWorkspaceRoot } from "./managed-workspace";

export type WorkspaceListFileRow = {
  name: string;
  path: string;
  isDir: boolean;
};

export type HomeMentionCandidate = {
  path: string;
  name: string;
  group: "project" | "attached";
};

/**
 * Map workspace.listFiles rows into project mention candidates (files only).
 */
export function projectMentionCandidatesFromList(
  list: ReadonlyArray<WorkspaceListFileRow>,
): HomeMentionCandidate[] {
  return list
    .filter((f) => !f.isDir)
    .map((f) => ({
      path: f.path,
      name: f.name,
      group: "project" as const,
    }));
}

/**
 * Paths from a drag-drop FileList / File[] (Electron file.path when present).
 */
export function pathsFromDropFiles(
  files: ReadonlyArray<{ path?: string }>,
): string[] {
  return files
    .map((f) => f.path)
    .filter((p): p is string => Boolean(p && p.trim()));
}

/**
 * Prefer explicit *user* workspace root; else first user-facing task root.
 * Never returns app-managed generated folders (those are not a working dir).
 */
export function resolveHomeActiveRoot(
  root: string | null | undefined,
  tasks: ReadonlyArray<{
    policySnapshot?: { workspaceRoots?: string[] };
  }>,
): string {
  const explicit = (root ?? "").trim();
  if (explicit && !isManagedWorkspacePath(explicit)) return explicit;
  for (const t of tasks) {
    const r = userFacingWorkspaceRoot(t.policySnapshot?.workspaceRoots);
    if (r) return r;
  }
  return "";
}

/** Smart-start icon key (UI maps key → Lucide component). */
export type SmartStartIconKey =
  | "pen"
  | "folder"
  | "sparkles"
  | "image"
  | "search"
  | "calendar"
  | "play";

export function resolveSmartStartIconKey(
  icon: string | undefined,
): SmartStartIconKey {
  switch (icon) {
    case "pen":
    case "folder":
    case "sparkles":
    case "image":
    case "search":
    case "calendar":
    case "play":
      return icon;
    default:
      return "sparkles";
  }
}
