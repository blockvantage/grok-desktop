/**
 * Folder trust (T5): project connectors/skills gate semantics.
 *
 * Soft first-use prompt; Settings holds an explicit trusted-folders list.
 * Paths are normalized for stable comparison (no full trusted_folders.toml UI).
 */

/** Normalize a workspace path for trust comparisons. */
export function normalizeTrustPath(raw: string): string {
  let p = raw.trim();
  if (!p) return "";
  // Drop trailing slashes (except root /)
  if (p.length > 1) {
    p = p.replace(/[/\\]+$/, "");
  }
  // Collapse duplicate separators (best-effort, platform-agnostic)
  p = p.replace(/\\/g, "/");
  // Lowercase drive letter on Windows-style paths
  if (/^[A-Za-z]:\//.test(p)) {
    p = p[0]!.toLowerCase() + p.slice(1);
  }
  return p;
}

export function isFolderTrusted(
  trustedFolders: readonly string[],
  folderPath: string,
): boolean {
  const target = normalizeTrustPath(folderPath);
  if (!target) return false;
  const set = new Set(
    trustedFolders.map(normalizeTrustPath).filter(Boolean),
  );
  if (set.has(target)) return true;
  // Parent trust covers nested project folders
  for (const trusted of set) {
    if (target.startsWith(trusted + "/")) return true;
  }
  return false;
}

export function trustFolder(
  trustedFolders: readonly string[],
  folderPath: string,
): string[] {
  const n = normalizeTrustPath(folderPath);
  if (!n) return [...trustedFolders];
  if (isFolderTrusted(trustedFolders, n)) {
    return trustedFolders.map(normalizeTrustPath).filter(Boolean);
  }
  return [...trustedFolders.map(normalizeTrustPath).filter(Boolean), n];
}

export function untrustFolder(
  trustedFolders: readonly string[],
  folderPath: string,
): string[] {
  const n = normalizeTrustPath(folderPath);
  return trustedFolders
    .map(normalizeTrustPath)
    .filter((p) => p && p !== n);
}

/**
 * Whether to show the soft "Trust this folder for project tools?" prompt.
 * True when a non-empty workspace is selected and not yet trusted.
 */
export function shouldPromptFolderTrust(input: {
  workspacePath: string | null | undefined;
  trustedFolders: readonly string[];
  /** User dismissed for this path without trusting (session-only). */
  dismissedPaths?: readonly string[];
}): boolean {
  const path = normalizeTrustPath(input.workspacePath ?? "");
  if (!path) return false;
  if (isFolderTrusted(input.trustedFolders, path)) return false;
  const dismissed = new Set(
    (input.dismissedPaths ?? []).map(normalizeTrustPath).filter(Boolean),
  );
  if (dismissed.has(path)) return false;
  return true;
}

/** Soft gate for project-local tools (skills/MCP in repo). */
export function projectToolsAllowed(input: {
  workspacePath: string | null | undefined;
  trustedFolders: readonly string[];
}): boolean {
  const path = normalizeTrustPath(input.workspacePath ?? "");
  if (!path) return false;
  return isFolderTrusted(input.trustedFolders, path);
}

/**
 * Run-start gate used by engine spawn (T5 enforce).
 * Returns whether project-scoped MCP write + skills install may run.
 * Desk-owned ephemeral MCP in isolated GROK_HOME is always allowed separately.
 */
export function allowProjectToolSetup(input: {
  workspacePath: string | null | undefined;
  trustedFolders?: readonly string[] | null;
  /**
   * When trustedFolders is omitted/null, fail closed (no project tools) unless
   * explicitly opted into legacy unrestricted via allowWhenUnset.
   */
  allowWhenUnset?: boolean;
}): boolean {
  if (input.trustedFolders == null) {
    return input.allowWhenUnset === true;
  }
  return projectToolsAllowed({
    workspacePath: input.workspacePath,
    trustedFolders: input.trustedFolders,
  });
}
