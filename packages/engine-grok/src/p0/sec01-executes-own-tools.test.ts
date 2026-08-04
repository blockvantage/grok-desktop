import { describe, it, expect } from "vitest";
import { GrokBuildEngine, ManagedRuntimeUnavailableEngine } from "../session.js";

describe("SEC-01 executesOwnTools characterization", () => {
  it("production Grok engine owns tool execution (gateway does not mediate)", () => {
    const engine = new GrokBuildEngine({ binary: "/usr/bin/false" });
    expect(engine.executesOwnTools).toBe(true);
  });

  it("unavailable managed runtime still owns tools (no gateway mediation simulation)", () => {
    const engine = new ManagedRuntimeUnavailableEngine();
    expect(engine.executesOwnTools).toBe(true);
  });
});
