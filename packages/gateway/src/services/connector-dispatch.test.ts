import { describe, it, expect, vi } from "vitest";
import {
  dispatchConnectorMethod,
  isConnectorMethod,
} from "./connector-dispatch.js";

describe("isConnectorMethod", () => {
  it("matches connectors.* only", () => {
    expect(isConnectorMethod("connectors.doctor")).toBe(true);
    expect(isConnectorMethod("settings.get")).toBe(false);
  });
});

describe("dispatchConnectorMethod", () => {
  it("enable parses env and requires presetId", async () => {
    const enable = vi.fn(async (input) => ({ ok: true, ...input }));
    const deps = {
      listPresets: vi.fn(() => []),
      enable,
      disable: vi.fn(),
      enableRecommended: vi.fn(),
      doctor: vi.fn(),
    };
    await expect(
      dispatchConnectorMethod("connectors.enable", {}, deps),
    ).rejects.toThrow(/presetId/);
    await expect(
      dispatchConnectorMethod(
        "connectors.enable",
        { presetId: "github", env: { TOKEN: "x", n: 1 } },
        deps,
      ),
    ).resolves.toEqual({
      ok: true,
      presetId: "github",
      env: { TOKEN: "x" },
    });
  });

  it("doctor passes optional serverId", async () => {
    const doctor = vi.fn(() => ({ ok: true }));
    const deps = {
      listPresets: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      enableRecommended: vi.fn(),
      doctor,
    };
    await dispatchConnectorMethod(
      "connectors.doctor",
      { serverId: "gh" },
      deps,
    );
    expect(doctor).toHaveBeenCalledWith("gh");
  });
});
