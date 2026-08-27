import { describe, expect, it } from "vitest";
import {
  decodeTurnCompleted,
  foldUsageTokens,
  reasoningEffortForDesk,
} from "./usage-math.js";

describe("foldUsageTokens", () => {
  it("includes cache_creation_input_tokens in the total", () => {
    const folded = foldUsageTokens({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: 40,
      cache_read_input_tokens: 100,
    });
    expect(folded).toMatchObject({
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationInputTokens: 40,
      cacheReadInputTokens: 100,
      totalTokens: 155,
      partial: false,
    });
  });

  it("does not treat a missing usage object as free", () => {
    expect(foldUsageTokens(null)).toBeNull();
    expect(foldUsageTokens({})).toBeNull();
  });
});

describe("decodeTurnCompleted", () => {
  it("reads snake_case stop_reason and does not throw on unknown", () => {
    expect(
      decodeTurnCompleted({
        sessionUpdate: "turn_completed",
        prompt_id: "p1",
        stop_reason: "end_turn",
        elapsed_ms: 12,
        usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3 },
      }),
    ).toMatchObject({
      promptId: "p1",
      stopReason: "end_turn",
      elapsedMs: 12,
      usage: { totalTokens: 6 },
    });
    expect(decodeTurnCompleted({ stop_reason: "brand_new" }).stopReason).toBe(
      "unknown",
    );
    expect(() => decodeTurnCompleted(null)).not.toThrow();
  });
});

describe("reasoningEffortForDesk", () => {
  it("maps heavy to high and max to max when advertised", () => {
    expect(reasoningEffortForDesk("heavy")).toBe("high");
    expect(reasoningEffortForDesk("max")).toBe("high");
    expect(reasoningEffortForDesk("max", { supportsMax: true })).toBe("max");
    expect(reasoningEffortForDesk("max", { supportsXhigh: true })).toBe(
      "xhigh",
    );
  });
});
