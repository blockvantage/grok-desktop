import { describe, it, expect } from "vitest";
import {
  remoteRequestContext,
  desktopRequestContext,
  resolveRemoteDeviceId,
} from "../services/request-context.js";

describe("REMOTE-01 principal binding", () => {
  it("rejects body deviceId that conflicts with principal", () => {
    const ctx = remoteRequestContext({
      principalDeviceId: "device-a",
      machineId: "mach-1",
      requestId: "r1",
    });
    expect(() => resolveRemoteDeviceId(ctx, "device-b")).toThrow(
      /mismatch|principal/i,
    );
  });

  it("accepts matching or omitted body deviceId", () => {
    const ctx = remoteRequestContext({
      principalDeviceId: "device-a",
      machineId: "mach-1",
      requestId: "r1",
    });
    expect(resolveRemoteDeviceId(ctx, "device-a")).toBe("device-a");
    expect(resolveRemoteDeviceId(ctx, undefined)).toBe("device-a");
    expect(resolveRemoteDeviceId(ctx, "")).toBe("device-a");
  });

  it("desktop context cannot resolve remote device identity", () => {
    const ctx = desktopRequestContext("r2");
    expect(() => resolveRemoteDeviceId(ctx, "device-a")).toThrow(/remote/i);
  });
});
