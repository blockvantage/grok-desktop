/**
 * Detect app-managed scratch workspaces (created under GrokDesk/workspaces).
 * These are not user-chosen working directories and should not be shown as such.
 */

/** True for app-managed scratch workspaces (deleted with the chat). */
export function isManagedWorkspacePath(root?: string | null): boolean {
  if (!root) return true;
  const norm = root.trim().replace(/[/\\]+$/, "");
  if (!norm) return true;
  return (
    /grok-(chat|scheduled)-[^/\\]*$/i.test(norm) ||
    /GrokDesk[/\\]workspaces[/\\]/i.test(norm) ||
    // OS-temp legacy (pre-durable workspaces)
    /[\\/](T|Temp)[\\/]grokdesk-chat-/i.test(norm)
  );
}

/**
 * First user-chosen project folder on a task, if any.
 * Primary is often the managed write root; user folders are attached as
 * secondary roots (or primary when no managed dir was used).
 */
export function userFacingWorkspaceRoot(roots: readonly string[] | null | undefined): string {
  const list = (roots ?? []).map((r) => r.trim()).filter(Boolean);
  for (const r of list) {
    if (!isManagedWorkspacePath(r)) return r;
  }
  return "";
}

/** Filter a list of paths down to user-chosen (non-managed) folders. */
export function filterUserWorkspaceRoots(
  roots: readonly string[] | null | undefined,
): string[] {
  return (roots ?? [])
    .map((r) => r.trim())
    .filter((r) => r && !isManagedWorkspacePath(r));
}
