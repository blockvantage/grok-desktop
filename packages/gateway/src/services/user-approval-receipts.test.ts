import { describe, it, expect } from "vitest";
import {
  userApprovedToolReceipt,
  userRejectedToolReceipt,
} from "./user-approval-receipts.js";

const event = { id: "t1", tool: "write_file", path: "/ws/a.txt" };

describe("user-approval-receipts", () => {
  it("builds reject receipt", () => {
    const r = userRejectedToolReceipt(event);
    expect(r.decision).toBe("deny");
    expect(r.effect).toBe("user_rejected");
    expect(r.action).toBe("tool:write_file");
    expect(r.correlationId).toBe("t1");
  });

  it("builds approve receipt", () => {
    const r = userApprovedToolReceipt(event);
    expect(r.decision).toBe("allow");
    expect(r.effect).toBe("user_approved");
    expect(r.detail.reason).toBe("user_approved");
  });
});
