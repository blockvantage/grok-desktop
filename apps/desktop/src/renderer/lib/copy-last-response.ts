/**
 * Copy last assistant response as clean markdown (Codex-style Ctrl/Cmd+O parity).
 */

export type StreamMessageLike = {
  role?: string | null;
  kind?: string | null;
  type?: string | null;
  text?: string | null;
  content?: string | null;
  body?: string | null;
};

function extractText(m: StreamMessageLike): string {
  const raw = m.text ?? m.content ?? m.body ?? "";
  return typeof raw === "string" ? raw.trim() : "";
}

function isAssistant(m: StreamMessageLike): boolean {
  const role = (m.role ?? m.kind ?? m.type ?? "").toLowerCase();
  if (
    role === "assistant" ||
    role === "model" ||
    role === "agent" ||
    role === "ai"
  ) {
    return true;
  }
  // Generic message blocks count when they have body text.
  return role === "message" && extractText(m).length > 0;
}

/**
 * Prefer explicit assistant role; fall back to last non-user block with text.
 */
export function extractLastAssistantMarkdown(
  messages: StreamMessageLike[],
): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    const role = (m.role ?? m.kind ?? m.type ?? "").toLowerCase();
    if (role === "user" || role === "human") continue;
    if (isAssistant(m) || role === "" || role === "message") {
      const text = extractText(m);
      if (text.length > 0) return normalizeMarkdown(text);
    }
  }
  return null;
}

/** Strip trailing excessive whitespace; keep fenced code intact. */
export function normalizeMarkdown(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export type CopyLastIntent =
  | { ok: true; markdown: string }
  | { ok: false; reason: "empty" };

export function prepareCopyLastResponse(
  messages: StreamMessageLike[],
): CopyLastIntent {
  const md = extractLastAssistantMarkdown(messages);
  if (!md) return { ok: false, reason: "empty" };
  return { ok: true, markdown: md };
}
