import { describe, it, expect } from "vitest";
import {
  browserOpenUrlFromToolMeta,
  buildHostParkedToolRequest,
  hostParkedApprovalRequiredPayload,
  shouldMarkCancelled,
} from "./host-parked-approval.js";

describe("host-parked-approval", () => {
  it("builds tool request with hostParked meta", () => {
    const tr = buildHostParkedToolRequest({
      approvalId: "a1",
      browserSessionId: "root-1",
      tool: "browser_open",
      reason: "allowlist",
      url: "https://example.com",
      args: { wait: true },
    });
    expect(tr.type).toBe("tool_request");
    expect(tr.id).toBe("a1");
    expect(tr.meta).toMatchObject({
      hostParked: true,
      browserSessionId: "root-1",
      url: "https://example.com",
      wait: true,
    });
  });

  it("builds approval_required payload", () => {
    const input = {
      approvalId: "a1",
      browserSessionId: "root",
      tool: "browser_open",
      reason: "need",
    };
    const tr = buildHostParkedToolRequest(input);
    const p = hostParkedApprovalRequiredPayload(input, tr);
    expect(p.approvalId).toBe("a1");
    expect(p.browserSessionId).toBe("root");
    expect(p.reason).toBe("need");
  });

  it("shouldMarkCancelled skips terminal statuses", () => {
    expect(shouldMarkCancelled("running")).toBe(true);
    expect(shouldMarkCancelled("done")).toBe(false);
    expect(shouldMarkCancelled("failed")).toBe(false);
    expect(shouldMarkCancelled("cancelled")).toBe(false);
  });

  it("reads url or href from meta", () => {
    expect(browserOpenUrlFromToolMeta({ url: "https://a" })).toBe("https://a");
    expect(browserOpenUrlFromToolMeta({ href: "https://b" })).toBe("https://b");
    expect(browserOpenUrlFromToolMeta(undefined)).toBe("");
  });
});
