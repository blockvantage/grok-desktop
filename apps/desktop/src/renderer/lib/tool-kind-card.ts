/**
 * ToolKind presentation: calm one-liners. Non-coders never see a raw JSON envelope.
 */

export const TOOL_KIND_CARDS = [
  "edit",
  "write",
  "execute",
  "media",
  "ask_user",
  "other",
] as const;

export type ToolKindCardKind = (typeof TOOL_KIND_CARDS)[number];

export type ToolKindCard = {
  kind: ToolKindCardKind;
  title: string;
  summary: string;
  path?: string;
  command?: string;
  output?: string;
  diff?: string;
  prompt?: string;
};

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function asKind(raw: string): ToolKindCardKind {
  const token = raw.trim().toLowerCase();
  if (token === "edit" || token === "write") return token;
  if (token === "execute" || token === "shell" || token === "bash") return "execute";
  if (
    token === "image_gen" ||
    token === "video_gen" ||
    token === "image_to_video" ||
    token === "reference_to_video" ||
    token === "media" ||
    token.includes("imagine")
  ) {
    return "media";
  }
  if (token === "ask_user" || token === "ask_user_question") return "ask_user";
  if (token === "write_file") return "write";
  if (token === "read_file" || token === "read") return "other";
  return "other";
}

function countChangedLines(diff: string): number {
  return diff.split("\n").filter((line) => /^[+-]/.test(line) && !/^[+-]{3}/.test(line))
    .length;
}

/**
 * Project a tool_request / tool_result payload into a kind card.
 * Unknown kinds sink to `other` with a one-line summary — never JSON.
 */
export function projectToolKindCard(
  payload: Record<string, unknown> | null | undefined,
): ToolKindCard {
  const obj = rec(payload) ?? {};
  const meta = rec(obj.meta) ?? rec(obj.tool) ?? {};
  const toolToken = str(obj.kind) || str(obj.tool) || str(obj.name) || str(meta.kind);
  const kind = asKind(toolToken);
  const path =
    str(obj.path) ||
    str(obj.file_path) ||
    str(meta.path) ||
    str(meta.file_path);
  const command = str(obj.command) || str(meta.command) || str(obj.title);
  const output = str(obj.output) || str(obj.rawOutput);
  const diff =
    str(obj.diff) ||
    str(obj.rawOutput) ||
    str(meta.diff);
  const prompt = str(obj.prompt) || str(obj.question) || str(obj.title);
  const title = str(obj.title) || command || (path ? basename(path) : toolToken || "Tool");

  if (kind === "edit" || kind === "write") {
    const name = path ? basename(path) : title;
    const changed = diff ? countChangedLines(diff) : 0;
    const summary = changed
      ? `Updated ${name} — ${changed} line${changed === 1 ? "" : "s"} changed`
      : kind === "write"
        ? `Wrote ${name}`
        : `Updated ${name}`;
    return { kind, title: name, summary, path: path || undefined, diff: diff || undefined };
  }
  if (kind === "execute") {
    const cmd = command || title;
    return {
      kind: "execute",
      title: cmd,
      summary: cmd ? `Ran ${cmd}` : "Ran a command",
      command: cmd || undefined,
      output: output || undefined,
    };
  }
  if (kind === "media") {
    return {
      kind: "media",
      title: path ? basename(path) : title,
      summary: path ? `Created ${basename(path)}` : "Created media",
      path: path || undefined,
    };
  }
  if (kind === "ask_user") {
    return {
      kind: "ask_user",
      title: prompt || "Question",
      summary: prompt || "Grok needs an answer",
      prompt: prompt || undefined,
    };
  }
  return {
    kind: "other",
    title,
    summary: title || "Tool",
    path: path || undefined,
    command: command || undefined,
    output: output || undefined,
  };
}

export function toolKindDetail(card: ToolKindCard): string | null {
  if (card.kind === "edit" || card.kind === "write") return card.diff ?? null;
  if (card.kind === "execute") return card.output ?? card.command ?? null;
  if (card.kind === "ask_user") return card.prompt ?? null;
  if (card.kind === "media") return card.path ?? null;
  return card.output ?? card.command ?? card.path ?? null;
}
