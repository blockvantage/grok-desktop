import { describe, it, expect } from "vitest";
import { buildShellNotices } from "./shell-notices";

describe("buildShellNotices", () => {
  it("emits dead gateway notice", () => {
    const n = buildShellNotices({ gatewayUiStatus: "dead" });
    expect(n.map((x) => x.kind)).toEqual(["gateway_dead"]);
  });

  it("emits reconnecting for starting/restarting", () => {
    expect(
      buildShellNotices({ gatewayUiStatus: "starting" })[0]?.kind,
    ).toBe("gateway_reconnecting");
    expect(
      buildShellNotices({ gatewayUiStatus: "restarting" })[0]?.kind,
    ).toBe("gateway_reconnecting");
  });

  it("combines reconnecting with reauth", () => {
    const n = buildShellNotices({
      gatewayUiStatus: "restarting",
      needsReauth: true,
    });
    expect(n.map((x) => x.kind)).toEqual([
      "gateway_reconnecting",
      "reauth",
    ]);
  });

  it("ready with no reauth is empty", () => {
    expect(buildShellNotices({ gatewayUiStatus: "ready" })).toEqual([]);
  });

  it("readiness blocked collapses entitlement/runtime/reauth stack", () => {
    const n = buildShellNotices({
      gatewayUiStatus: "ready",
      readinessBlocked: true,
      entitlementBlocked: true,
      runtimeBlocked: true,
      needsReauth: true,
    });
    expect(n.map((x) => x.kind)).toEqual(["readiness"]);
  });

  it("ranks entitlement and runtime when readiness sheet is not used", () => {
    const n = buildShellNotices({
      gatewayUiStatus: "ready",
      entitlementBlocked: true,
      runtimeBlocked: true,
    });
    expect(n.map((x) => x.kind)).toEqual(["entitlement", "runtime"]);
  });
});
