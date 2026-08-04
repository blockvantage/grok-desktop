/**
 * Build @-mention candidate lists for the workspace composer (Phase 6 extract).
 */

export type MentionCandidateLike = {
  path: string;
  name: string;
  group: "attached" | "deliverable" | "project" | string;
};

export type AttachmentLike = {
  sourcePath: string;
  name: string;
};

export type DeliverableLike = {
  path?: string | null;
  title: string;
};

/**
 * Attachments currently in the follow-up composer.
 */
export function attachedMentionCandidates(
  attachments: AttachmentLike[],
): MentionCandidateLike[] {
  return attachments.map((a) => ({
    path: a.sourcePath,
    name: a.name,
    group: "attached",
  }));
}

/**
 * Deliverables with a path (skip pathless artifacts).
 */
export function deliverableMentionCandidates(
  deliverables: DeliverableLike[],
): MentionCandidateLike[] {
  return deliverables
    .filter((d) => d.path)
    .map((d) => ({
      path: d.path!,
      name: d.title,
      group: "deliverable",
    }));
}

/**
 * Merge workspace.listFiles results into unique project mention candidates.
 */
export function mergeProjectFileMentions(
  lists: Array<Array<{ name: string; path: string; isDir: boolean }>>,
): MentionCandidateLike[] {
  const merged: MentionCandidateLike[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const f of list) {
      if (f.isDir || seen.has(f.path)) continue;
      seen.add(f.path);
      merged.push({
        path: f.path,
        name: f.name,
        group: "project",
      });
    }
  }
  return merged;
}

/**
 * Non-empty trimmed project roots for mention scoping.
 */
export function mentionRootsFromProjects(projectRoots: string[]): string[] {
  return projectRoots.filter((r) => r?.trim());
}
