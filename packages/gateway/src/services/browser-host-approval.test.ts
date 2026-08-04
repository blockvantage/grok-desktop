import { describe, it, expect, vi } from "vitest";
import { registerBrowserHostApproval } from "./browser-host-approval.js";

describe("registerBrowserHostApproval", () => {
  it("registers with runner and appends audit info", () => {
    const register = vi.fn();
    const append = vi.fn();
    const p = {
      approvalId: "a1",
      taskId: "t1",
      tool: "browser_open",
      reason: "allowlist",
      url: "https://example.com",
    };
    const r = registerBrowserHostApproval(p, {
      registerHostBrowserApproval: register,
      appendAudit: append,
    });
    expect(r).toEqual({ ok: true });
    expect(register).toHaveBeenCalledWith(p);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "t1",
        action: "policy_check",
        decision: "info",
        detail: expect.objectContaining({
          hostParked: true,
          url: "https://example.com",
        }),
      }),
    );
  });
});
