/**
 * Desktop binding for T5 folder trust (shared pure helpers).
 */
import {
  isFolderTrusted,
  normalizeTrustPath,
  projectToolsAllowed,
  shouldPromptFolderTrust,
  trustFolder,
  untrustFolder,
} from "@grokdesk/shared";

export {
  isFolderTrusted,
  normalizeTrustPath,
  projectToolsAllowed,
  shouldPromptFolderTrust,
  trustFolder,
  untrustFolder,
};

/** Session-dismissed paths (not persisted). */
const dismissed = new Set<string>();
const DISMISSED_MAX = 64;

export function dismissFolderTrustPrompt(folderPath: string): void {
  const n = normalizeTrustPath(folderPath);
  if (!n) return;
  if (dismissed.has(n)) return;
  if (dismissed.size >= DISMISSED_MAX) {
    const first = dismissed.values().next().value as string | undefined;
    if (first !== undefined) dismissed.delete(first);
  }
  dismissed.add(n);
}

export function clearFolderTrustDismissals(): void {
  dismissed.clear();
}

export function shouldShowFolderTrustPrompt(input: {
  workspacePath: string | null | undefined;
  trustedFolders: readonly string[];
}): boolean {
  return shouldPromptFolderTrust({
    workspacePath: input.workspacePath,
    trustedFolders: input.trustedFolders,
    dismissedPaths: [...dismissed],
  });
}
