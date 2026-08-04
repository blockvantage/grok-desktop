/**
 * Deliverable pack — plan an export handoff of chat answer + files.
 * Pure planner; UI/gateway still perform file writes.
 */

export type PackArtifact = {
  id: string;
  title?: string | null;
  path?: string | null;
};

export type PackMessage = {
  role: "user" | "assistant" | "system" | string;
  text: string;
  timestamp?: string;
};

export type DeliverablePackFile = {
  /** Relative path inside the pack folder. */
  relPath: string;
  /** Absolute source path when copying from disk. */
  sourcePath: string | null;
  /** Inline markdown content when generating (e.g. index.md, answer.md). */
  content: string | null;
  kind: "index" | "answer" | "artifact" | "meta";
};

export type DeliverablePackPlan = {
  packName: string;
  files: DeliverablePackFile[];
  /** Short summary for toast/UI. */
  summary: string;
  artifactCount: number;
  hasAnswer: boolean;
};

function safeSlug(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return s || "conversation";
}

function fileNameFromPath(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || "file";
}

/**
 * Extract the last substantial assistant message for answer.md.
 */
export function lastAssistantText(messages: PackMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role === "assistant" && m.text.trim().length > 0) {
      return m.text.trim();
    }
  }
  return null;
}

/**
 * Build a pack plan: INDEX.md + answer.md + artifact copies.
 */
export function planDeliverablePack(input: {
  chatTitle: string;
  taskId: string;
  messages: PackMessage[];
  artifacts: PackArtifact[];
  now?: Date;
}): DeliverablePackPlan {
  const now = input.now ?? new Date();
  const day = now.toISOString().slice(0, 10);
  const packName = `grokdesk-${safeSlug(input.chatTitle)}-${day}`;
  const answer = lastAssistantText(input.messages);
  const files: DeliverablePackFile[] = [];

  const artifactRows = input.artifacts
    .filter((a) => a.path?.trim())
    .map((a, i) => {
      const name = fileNameFromPath(a.path!);
      const rel = `files/${String(i + 1).padStart(2, "0")}-${name}`;
      return { a, rel, name };
    });

  const indexLines = [
    `# ${input.chatTitle || "Conversation pack"}`,
    "",
    `- Task: \`${input.taskId}\``,
    `- Exported: ${now.toISOString()}`,
    `- Artifacts: ${artifactRows.length}`,
    "",
    "## Contents",
    "",
    answer ? "- [Final answer](./answer.md)" : "- _(no assistant answer yet)_",
    ...artifactRows.map((r) => `- [${r.name}](./${r.rel})`),
    "",
  ];

  files.push({
    relPath: "INDEX.md",
    sourcePath: null,
    content: indexLines.join("\n"),
    kind: "index",
  });

  if (answer) {
    files.push({
      relPath: "answer.md",
      sourcePath: null,
      content: answer + "\n",
      kind: "answer",
    });
  }

  for (const r of artifactRows) {
    files.push({
      relPath: r.rel,
      sourcePath: r.a.path!,
      content: null,
      kind: "artifact",
    });
  }

  files.push({
    relPath: "meta.json",
    sourcePath: null,
    content:
      JSON.stringify(
        {
          taskId: input.taskId,
          title: input.chatTitle,
          exportedAt: now.toISOString(),
          artifactCount: artifactRows.length,
          hasAnswer: Boolean(answer),
        },
        null,
        2,
      ) + "\n",
    kind: "meta",
  });

  const parts: string[] = [];
  if (answer) parts.push("answer");
  if (artifactRows.length === 1) parts.push("1 file");
  else if (artifactRows.length > 1) parts.push(`${artifactRows.length} files`);

  return {
    packName,
    files,
    summary:
      parts.length > 0
        ? `Pack ready: ${parts.join(" + ")}`
        : "Pack ready: index only",
    artifactCount: artifactRows.length,
    hasAnswer: Boolean(answer),
  };
}
