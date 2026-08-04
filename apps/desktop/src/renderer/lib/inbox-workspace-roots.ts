/**
 * Workspace roots passed into InboxPanel for schedule/create context (Phase 6).
 */

export function inboxWorkspaceRoots(root: string): string[] {
  const trimmed = root.trim();
  return trimmed ? [trimmed] : [];
}
