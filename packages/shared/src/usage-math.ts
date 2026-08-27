/**
 * Usage folding (Phase 1.3). Include cache_creation_input_tokens so session
 * cost/token totals never under-report billed cache writes.
 */

export type FoldedUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  partial: boolean;
};

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function rec(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Fold a snake_case or camelCase usage object. Missing fields count as 0 in
 * the sum only when at least one token field is present; otherwise partial.
 */
export function foldUsageTokens(raw: unknown): FoldedUsage | null {
  const obj = rec(raw);
  if (!obj) return null;
  const input = num(obj.input_tokens ?? obj.inputTokens);
  const output = num(obj.output_tokens ?? obj.outputTokens);
  const cacheCreation = num(
    obj.cache_creation_input_tokens ?? obj.cacheCreationInputTokens,
  );
  const cacheRead = num(
    obj.cache_read_input_tokens ?? obj.cacheReadInputTokens,
  );
  if (
    input == null &&
    output == null &&
    cacheCreation == null &&
    cacheRead == null
  ) {
    return null;
  }
  const inputTokens = input ?? 0;
  const outputTokens = output ?? 0;
  const cacheCreationInputTokens = cacheCreation ?? 0;
  const cacheReadInputTokens = cacheRead ?? 0;
  return {
    inputTokens,
    outputTokens,
    cacheCreationInputTokens,
    cacheReadInputTokens,
    totalTokens:
      inputTokens +
      outputTokens +
      cacheCreationInputTokens +
      cacheReadInputTokens,
    partial:
      input == null ||
      output == null ||
      cacheCreation == null,
  };
}

export const TURN_STOP_REASONS = [
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
] as const;

export type TurnStopReason = (typeof TURN_STOP_REASONS)[number] | "unknown";

export type TurnCompletedRecord = {
  promptId: string | null;
  stopReason: TurnStopReason;
  elapsedMs: number | null;
  usage: FoldedUsage | null;
};

export function decodeTurnCompleted(raw: unknown): TurnCompletedRecord {
  const obj = rec(raw) ?? {};
  const nested = rec(obj.turn_completed) ?? rec(obj.TurnCompleted);
  const src = nested ?? obj;
  const stopRaw = String(src.stop_reason ?? src.stopReason ?? "");
  const stopReason = (TURN_STOP_REASONS as readonly string[]).includes(stopRaw)
    ? (stopRaw as TurnStopReason)
    : stopRaw
      ? "unknown"
      : "unknown";
  const promptId =
    typeof src.prompt_id === "string"
      ? src.prompt_id
      : typeof src.promptId === "string"
        ? src.promptId
        : null;
  const elapsed = num(src.elapsed_ms ?? src.elapsedMs);
  return {
    promptId,
    stopReason,
    elapsedMs: elapsed,
    usage: foldUsageTokens(src.usage),
  };
}

export function reasoningEffortForDesk(
  effort: "fast" | "normal" | "heavy" | "max" | undefined,
  caps?: { supportsMax?: boolean; supportsXhigh?: boolean },
): string | undefined {
  if (!effort) return undefined;
  switch (effort) {
    case "fast":
      return "low";
    case "normal":
      return "medium";
    case "heavy":
      return "high";
    case "max":
      if (caps?.supportsMax) return "max";
      if (caps?.supportsXhigh) return "xhigh";
      return "high";
    default:
      return undefined;
  }
}
