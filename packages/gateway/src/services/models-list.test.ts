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
});
