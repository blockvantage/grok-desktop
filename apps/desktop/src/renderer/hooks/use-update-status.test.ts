import { describe, expect, it } from "vitest";
import {
  getUpdateApi,
  shouldInstallRestartForUpdateNow,
} from "./use-update-status";

describe("useUpdateStatus helpers", () => {
  it("getUpdateApi returns null without window.grokdesk.update", () => {
    expect(getUpdateApi()).toBeNull();
  });

  it("shouldInstallRestartForUpdateNow is true for staged and waiting_for_idle", () => {
    expect(shouldInstallRestartForUpdateNow("staged")).toBe(true);
    expect(shouldInstallRestartForUpdateNow("waiting_for_idle")).toBe(true);
    expect(shouldInstallRestartForUpdateNow("available")).toBe(false);
    expect(shouldInstallRestartForUpdateNow("idle")).toBe(false);
    expect(shouldInstallRestartForUpdateNow(undefined)).toBe(false);
  });
});
