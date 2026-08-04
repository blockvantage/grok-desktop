import { describe, it, expect } from "vitest";
import { projectDegradedMode } from "./degraded-mode.js";

describe("projectDegradedMode", () => {
  it("hides limited label on full ACP path", () => {
    const p = projectDegradedMode({
      transport: "acp",
      acpAvailable: true,
      preferAcp: true,
    });
    expect(p.showLimitedLabel).toBe(false);
  });

  it("shows one limited-mode label for headless", () => {
    const p = projectDegradedMode({
      transport: "headless",
    });
    expect(p.showLimitedLabel).toBe(true);
    expect(p.labelKey).toBe("degraded.limitedMode");
    expect(p.detailKey).toBe("degraded.headlessDetail");
  });

  it("humanizes resume failure once", () => {
    const p = projectDegradedMode({
      transport: "acp",
      resumeFailed: true,
      resumeFailureReason: "session expired",
    });
    expect(p.showLimitedLabel).toBe(true);
    expect(p.labelKey).toBe("degraded.resumeFallback");
    expect(p.reason).toBe("session expired");
  });

  it("provider degraded shows limited mode", () => {
    const p = projectDegradedMode({
      transport: "acp",
      providerDegraded: true,
      providerDegradedReason: "partial mediation",
    });
    expect(p.showLimitedLabel).toBe(true);
    expect(p.labelKey).toBe("degraded.limitedMode");
  });
});
