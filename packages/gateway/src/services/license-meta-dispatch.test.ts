import { describe, it, expect, vi } from "vitest";
import {
  dispatchLicenseMetaMethod,
  isLicenseMetaMethod,
} from "./license-meta-dispatch.js";

describe("isLicenseMetaMethod", () => {
  it("matches only non-licensing metadata methods", () => {
    expect(isLicenseMetaMethod("license.status")).toBe(false);
    expect(isLicenseMetaMethod("license.activate")).toBe(false);
    expect(isLicenseMetaMethod("license.verify")).toBe(false);
    expect(isLicenseMetaMethod("updates.manifest")).toBe(false);
    expect(isLicenseMetaMethod("models.list")).toBe(true);
    expect(isLicenseMetaMethod("tray.status")).toBe(true);
    expect(isLicenseMetaMethod("tasks.list")).toBe(false);
  });
});

describe("dispatchLicenseMetaMethod", () => {
  it("rejects retired licensing and disk-manifest methods", async () => {
    const deps = {
      computeTrayStatus: vi.fn(),
      getGrokAuthStatus: vi.fn(),
    };
    for (const method of [
      "license.status",
      "license.activate",
      "license.verify",
      "updates.manifest",
    ]) {
      await expect(
        dispatchLicenseMetaMethod(method, {}, deps),
      ).rejects.toThrow(`Unhandled license/meta method: ${method}`);
    }
  });

  it("rolePacks.list returns packs", async () => {
    const deps = {
      computeTrayStatus: vi.fn(),
      getGrokAuthStatus: vi.fn(),
    };
    const packs = await dispatchLicenseMetaMethod(
      "rolePacks.list",
      {},
      deps,
    );
    expect(Array.isArray(packs)).toBe(true);
    expect((packs as unknown[]).length).toBeGreaterThan(0);
  });
});
