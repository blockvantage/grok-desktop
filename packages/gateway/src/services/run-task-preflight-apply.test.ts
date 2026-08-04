import { describe, it, expect } from "vitest";
import {
  planFromEngineOwnToolsGate,
  planFromProviderPreflight,
} from "./run-task-preflight-apply.js";

describe("planFromProviderPreflight", () => {
  it("reject / degraded / allow", () => {
    expect(planFromProviderPreflight({ action: "reject", reason: "no" })).toEqual({
      kind: "reject",
      errorMessage: "no",
      terminalStatus: "failed",
      attemptReason: "policy_fail_closed",
      receiptSource: "provider_preflight_reject",
    });
    expect(
      planFromProviderPreflight({ action: "degraded", reason: "partial" }),
    ).toMatchObject({ kind: "degraded", stepTitle: "partial" });
    expect(planFromProviderPreflight({ action: "allow" })).toEqual({
      kind: "continue",
    });
  });
});

describe("planFromEngineOwnToolsGate", () => {
  it("maps reject and degraded", () => {
    expect(
      planFromEngineOwnToolsGate({
        action: "reject",
        message: "shell denied",
      }),
    ).toMatchObject({ kind: "reject", errorMessage: "shell denied" });
    expect(
      planFromEngineOwnToolsGate({
        action: "degraded",
        stepTitle: "no sandbox",
      }),
    ).toMatchObject({ kind: "degraded", stepTitle: "no sandbox" });
  });
});
