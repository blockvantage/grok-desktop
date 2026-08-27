import { describe, it, expect } from "vitest";
import { buildModelsListResponse } from "./models-list.js";

describe("buildModelsListResponse", () => {
  it("uses auth models when present", () => {
    expect(
      buildModelsListResponse({
        models: ["a", "b"],
        defaultModel: "b",
      }),
    ).toEqual({ models: ["a", "b"], defaultModel: "b" });
  });

  it("falls back when empty", () => {
    expect(buildModelsListResponse({ models: [] })).toEqual({
      models: ["grok-4.5"],
      defaultModel: "grok-4.5",
    });
  });

  it("prefers a live catalog over the grok-4.5-only fallback", () => {
    expect(
      buildModelsListResponse({ models: [] }, "grok-4.5", [
        "grok-4",
        "fake-fast",
      ]),
    ).toEqual({
      models: ["grok-4", "fake-fast"],
      defaultModel: "grok-4",
    });
  });
});
