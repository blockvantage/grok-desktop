import type { NormalizedEngineEvent } from "./types.js";

/**
 * Parse one line of Grok `--output-format streaming-json` (or plain text) into
 * normalized engine events. Tolerant of unknown shapes.
 *
 * Real Grok Build streaming-json (verified live):
 *   {"type":"thought","data":"The"}
 *   {"type":"text","data":"hi"}
 *   {"type":"end","stopReason":"EndTurn",...}
 */
export function parseStreamingJsonLine(
  line: string,
): NormalizedEngineEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    return normalizeJsonEvent(obj);
  } catch {
    // plain text line
    return [{ type: "message", role: "assistant", text: trimmed, channel: "text" }];
  }
}

function normalizeJsonEvent(obj: Record<string, unknown>): NormalizedEngineEvent[] {
  const type = String(obj.type ?? obj.event ?? obj.kind ?? "").toLowerCase();

  const workerEvents = normalizeExplicitWorkerEvent(type, obj);
  if (workerEvents) return workerEvents;

  // --- Grok Build streaming-json primary types ---
  if (type === "thought") {
    const data = extractDataChunk(obj);
    if (!data) return [];
    return [{ type: "message", role: "assistant", text: data, channel: "thought" }];
  }

  if (type === "text") {
    const data = extractDataChunk(obj);
    if (!data) return [];
    return [{ type: "message", role: "assistant", text: data, channel: "text" }];
  }

  // Terminal / session metadata. Never surface as user-visible messages.
  if (type === "end") {
    const out: NormalizedEngineEvent[] = [];
    const sid = typeof obj.sessionId === "string" ? obj.sessionId : null;
    if (sid) out.push({ type: "session_meta", providerSessionId: sid });
    const usage = obj.usage as
      | { input_tokens?: number; output_tokens?: number; inputTokens?: number; outputTokens?: number }
      | undefined;
    if (usage && typeof usage === "object") {
      const inputTokens = Number(usage.input_tokens ?? usage.inputTokens ?? 0);
      const outputTokens = Number(usage.output_tokens ?? usage.outputTokens ?? 0);
      let contextWindow: number | undefined;
      const modelUsage = obj.modelUsage as Record<string, { context_window?: number }> | undefined;
      if (modelUsage && typeof modelUsage === "object") {
        for (const v of Object.values(modelUsage)) {
          if (v && typeof v.context_window === "number") {
            contextWindow = v.context_window;
            break;
          }
        }
      }
      out.push({
        type: "usage",
        inputTokens,
        outputTokens,
        ...(contextWindow != null ? { contextWindow } : {}),
      });
    }
    return out;
  }
  if (
    type === "max_turns_reached" ||
    type === "session" ||
    type === "heartbeat"
  ) {
    return [];
  }

  // Compact / session housekeeping — ignore
  if (type.startsWith("auto_compact") || type === "status" || type === "ping") {
    return [];
  }

  if (
    type === "assistant" ||
    type === "message" ||
    type === "content" ||
    type === "content_block_delta" ||
    typeof obj.text === "string" ||
    typeof obj.content === "string"
  ) {
    const text = String(
      obj.text ?? obj.content ?? obj.message ?? obj.delta ?? obj.data ?? "",
    );
    if (!text) return [];
    // Never re-emit nested JSON dumps as user-visible prose
    if (looksLikeStreamEnvelope(text)) {
      try {
        return normalizeJsonEvent(JSON.parse(text) as Record<string, unknown>);
      } catch {
        // fall through
      }
    }
    const role =
      obj.role === "user" || obj.role === "assistant"
        ? (obj.role as "user" | "assistant")
        : "assistant";
    const channel =
      type === "thought" || obj.channel === "thought" ? "thought" : "text";
    return [{ type: "message", role, text, channel }];
  }

  if (
    type === "tool_use" ||
    type === "tool_call" ||
    type === "tool_request" ||
    type === "tool" ||
    type === "mcp_tool" ||
    type === "mcp_call" ||
    type === "function_call" ||
    type === "use_tool"
  ) {
    const name = String(
      obj.name ?? obj.tool ?? obj.toolName ?? obj.tool_name ?? "other",
    );
    const tool = mapToolName(name);
    const input =
      (obj.input as Record<string, unknown> | undefined) ??
      (obj.arguments as Record<string, unknown> | undefined) ??
      (obj.args as Record<string, unknown> | undefined) ??
      obj;
    return [
      {
        type: "tool_request",
        id: String(
          obj.id ?? obj.tool_use_id ?? obj.call_id ?? `tool-${Date.now()}`,
        ),
        tool,
        path: typeof obj.path === "string" ? obj.path : undefined,
        command:
          typeof obj.command === "string"
            ? obj.command
            : typeof input === "object" &&
                input &&
                "command" in input
              ? String((input as { command?: string }).command ?? "")
              : undefined,
        meta: typeof input === "object" && input ? input : obj,
      },
    ];
  }

  if (
    type === "tool_result" ||
    type === "tool_response" ||
    type === "function_result" ||
    type === "mcp_result"
  ) {
    return [
      {
        type: "tool_result",
        id: String(obj.id ?? obj.tool_use_id ?? obj.call_id ?? "tool"),
        ok: obj.is_error === true || obj.ok === false ? false : true,
        output: String(obj.output ?? obj.content ?? obj.result ?? ""),
      },
    ];
  }

  if (type === "result" || type === "done" || type === "complete") {
    return [
      {
        type: "done",
        summary: String(obj.result ?? obj.summary ?? obj.text ?? "Completed"),
      },
    ];
  }

  if (type === "error") {
    return [
      {
        type: "error",
        message: String(obj.message ?? obj.error ?? obj.data ?? "Engine error"),
      },
    ];
  }

  if (type === "step" || type === "progress") {
    return [
      {
        type: "step",
        title: String(obj.title ?? obj.name ?? "step"),
        status: obj.status === "end" || obj.status === "completed" ? "end" : "start",
      },
    ];
  }

  // Tool-shaped objects without a recognized type still surface as activity.
  if (
    typeof obj.name === "string" &&
    (obj.input != null || obj.arguments != null || obj.args != null)
  ) {
    return normalizeJsonEvent({ ...obj, type: "tool_use" });
  }

  // Unknown object — do NOT dump raw JSON into the user-facing stream.
  return [];
}

const WORKER_TYPE_MAP = {
  worker_started: "worker_started",
  subagent_started: "worker_started",
  worker_activity: "worker_activity",
  subagent_activity: "worker_activity",
  worker_message: "worker_message",
  subagent_message: "worker_message",
  worker_completed: "worker_completed",
  subagent_completed: "worker_completed",
  worker_failed: "worker_failed",
  subagent_failed: "worker_failed",
} as const;

function normalizeExplicitWorkerEvent(
  sourceType: string,
  obj: Record<string, unknown>,
): NormalizedEngineEvent[] | null {
  const type = WORKER_TYPE_MAP[sourceType as keyof typeof WORKER_TYPE_MAP];
  if (!type) return null;

  const workerId = firstString(obj, [
    "workerId",
    "worker_id",
    "subagentId",
    "subagent_id",
  ])?.trim();
  if (!workerId) return [];

  const parentWorkerId = firstString(obj, [
    "parentWorkerId",
    "parent_worker_id",
    "parentSubagentId",
    "parent_subagent_id",
  ])?.trim();
  const parent = parentWorkerId ? { parentWorkerId } : {};

  switch (type) {
    case "worker_started": {
      const label = typeof obj.label === "string" ? { label: obj.label } : {};
      const objective =
        typeof obj.objective === "string" ? { objective: obj.objective } : {};
      return [{ type, workerId, ...label, ...objective, ...parent }];
    }
    case "worker_message": {
      const text = typeof obj.text === "string" ? { text: obj.text } : {};
      return [{ type, workerId, ...text, ...parent }];
    }
    case "worker_activity":
    case "worker_completed":
    case "worker_failed": {
      const summary =
        typeof obj.summary === "string" ? { summary: obj.summary } : {};
      return [{ type, workerId, ...summary, ...parent }];
    }
  }
}

function firstString(
  obj: Record<string, unknown>,
  fields: readonly string[],
): string | undefined {
  for (const field of fields) {
    if (typeof obj[field] === "string") return obj[field];
  }
  return undefined;
}

function extractDataChunk(obj: Record<string, unknown>): string {
  if (typeof obj.data === "string") return obj.data;
  if (typeof obj.text === "string") return obj.text;
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.delta === "string") return obj.delta;
  return "";
}

/** True when a string looks like a nested streaming-json envelope we stored by mistake. */
function looksLikeStreamEnvelope(text: string): boolean {
  const t = text.trim();
  return (
    (t.startsWith('{"type":"thought"') ||
      t.startsWith('{"type":"text"') ||
      t.startsWith('{"type": "thought"') ||
      t.startsWith('{"type": "text"')) &&
    t.includes("data")
  );
}

type MappedTool =
  | "read_file"
  | "write_file"
  | "delete_file"
  | "shell"
  | "network"
  | "browser_open"
  | "browser_click"
  | "browser_type"
  | "browser_scroll"
  | "browser_screenshot"
  | "browser_read"
  | "other";

function mapToolName(name: string): MappedTool {
  const n = name.toLowerCase().replace(/\./g, "_");
  if (
    n === "browser_open" ||
    n.endsWith("_browser_open") ||
    n === "browseropen"
  ) {
    return "browser_open";
  }
  if (n === "browser_click" || n.includes("browser_click")) {
    return "browser_click";
  }
  if (n === "browser_type" || n.includes("browser_type")) {
    return "browser_type";
  }
  if (n === "browser_scroll" || n.includes("browser_scroll")) {
    return "browser_scroll";
  }
  if (n === "browser_screenshot" || n.includes("browser_screenshot")) {
    return "browser_screenshot";
  }
  if (n === "browser_read" || n.includes("browser_read")) {
    return "browser_read";
  }
  if (n.includes("write") || n.includes("edit") || n.includes("create_file")) {
    return "write_file";
  }
  if (n.includes("read") || n.includes("view") || n.includes("cat")) {
    return "read_file";
  }
  if (n.includes("delete") || n.includes("rm")) return "delete_file";
  if (n.includes("bash") || n.includes("shell") || n.includes("terminal")) {
    return "shell";
  }
  if (n.includes("web") || n.includes("search") || n.includes("fetch")) {
    return "network";
  }
  return "other";
}

/**
 * Parse multi-line streaming-json fixture/output into events.
 */
export function parseStreamingJsonOutput(text: string): NormalizedEngineEvent[] {
  const events: NormalizedEngineEvent[] = [];
  for (const line of text.split(/\r?\n/)) {
    events.push(...parseStreamingJsonLine(line));
  }
  return events;
}
