import type { TaskEvent } from "@grokdesk/shared";

const MAX_ASSISTANT_TURN_LENGTH = 96_000;
const NOISE_ONLY = /^(?:done|completed|complete|working|finished|ok|success)[.!\s]*$/i;

type ReconciliationTask = {
  id: string;
  conversationId?: string | null;
  model: string;
};

type AssistantTurnInput = {
  conversationId: string;
  taskId: string;
  role: "assistant";
  content: string;
  contextStrategy: "transcript_fallback";
  modelId: string;
  providerId: string;
};

export function selectSafeAssistantFinal(events: readonly TaskEvent[]): string | null {
  const groups: string[] = [];
  const terminal: string[] = [];
  let current = "";

  const flush = () => {
    const value = current.trim();
    if (isSafeAssistantText(value)) groups.push(value);
    current = "";
  };

  for (const event of events) {
    const payload = event.payload;
    const isAssistantText =
      event.kind === "message" &&
      payload.role === "assistant" &&
      (payload.channel == null || payload.channel === "text") &&
      typeof payload.text === "string";
    if (!isAssistantText) {
      flush();
      continue;
    }

    const text = payload.text as string;
    if (!isSafeAssistantText(text)) {
      flush();
      continue;
    }
    if (payload.terminal === true) {
      flush();
      terminal.push(text.trim());
      continue;
    }
    if (current.length + text.length > MAX_ASSISTANT_TURN_LENGTH) {
      flush();
      continue;
    }
    current += text;
  }
  flush();

  return terminal.at(-1) ?? groups.at(-1) ?? null;
}

export function reconcileAssistantTurn<T>(input: {
  task: ReconciliationTask;
  events: readonly TaskEvent[];
  appendTurn: (turn: AssistantTurnInput) => T;
}): T | null {
  const conversationId = input.task.conversationId;
  if (!conversationId) return null;
  const content = selectSafeAssistantFinal(input.events);
  if (!content) return null;
  return input.appendTurn({
    conversationId,
    taskId: input.task.id,
    role: "assistant",
    content,
    contextStrategy: "transcript_fallback",
    modelId: input.task.model,
    providerId: "grok",
  });
}

function isSafeAssistantText(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > MAX_ASSISTANT_TURN_LENGTH) return false;
  if (NOISE_ONLY.test(value)) return false;
  if (/^data:[^;,]+;base64,/i.test(value)) return false;
  if (value.length >= 4_096 && !/\s/.test(value) && /^[A-Za-z0-9+/]+=*$/.test(value)) {
    return false;
  }
  if (value.startsWith("{") && value.endsWith("}")) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      const type = typeof parsed.type === "string" ? parsed.type.toLowerCase() : "";
      if (
        type === "tool_call_update" ||
        type === "tool_call" ||
        type === "tool_result" ||
        type === "thought" ||
        (Array.isArray(parsed.content) && "toolCallId" in parsed)
      ) {
        return false;
      }
    } catch {
      // Ordinary prose that happens to use braces remains visible.
    }
  }
  return true;
}
