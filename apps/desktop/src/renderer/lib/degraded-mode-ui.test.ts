import { describe, it, expect } from "vitest";
import {
  projectDegradedModeView,
  transportFromProviderVersion,
} from "./degraded-mode-ui";

describe("degraded mode UI", () => {
  it("shows limited mode once for headless", () => {
    const v = projectDegradedModeView({
      transport: transportFromProviderVersion("headless-degraded"),
    });
    expect(v.showLimitedLabel).toBe(true);
    expect(v.labelKey).toBe("degraded.limitedMode");
  });

  it("hides label for acp-mediated", () => {
    const v = projectDegradedModeView({
      transport: transportFromProviderVersion("acp-mediated"),
    });
    expect(v.showLimitedLabel).toBe(false);
  });
});
