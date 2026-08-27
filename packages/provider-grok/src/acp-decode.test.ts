import { describe, expect, it } from "vitest";
import { decodeSessionUpdate, decodeToolKind } from "./acp-decode.js";

describe("ACP forward-compat decode", () => {
  it("maps known session/update variants and sinks unknown ones", () => {
    expect(
      decodeSessionUpdate({ sessionUpdate: "tool_call", kind: "edit" }).kind,
    ).toBe("tool_call");
    expect(
      decodeSessionUpdate({ sessionUpdate: "SubagentSpawned" }).kind,
    ).toBe("subagent_spawned");
    expect(
      decodeSessionUpdate({ sessionUpdate: "pending_interaction" }).kind,
    ).toBe("pending_interaction");
    expect(
      decodeSessionUpdate({ sessionUpdate: "InteractionResolved" }).kind,
    ).toBe("interaction_resolved");
    expect(
      decodeSessionUpdate({ sessionUpdate: "turn_completed" }).kind,
    ).toBe("turn_completed");
    expect(
      decodeSessionUpdate({ sessionUpdate: "session_status" }).kind,
    ).toBe("session_status");
    expect(
      decodeSessionUpdate({ sessionUpdate: "SessionStatus" }).kind,
    ).toBe("session_status");
    expect(
      decodeSessionUpdate({ sessionUpdate: "AutoCompactCompleted" }).kind,
    ).toBe("auto_compact_completed");
    expect(
      decodeSessionUpdate({ sessionUpdate: "auto_compact_failed" }).kind,
    ).toBe("auto_compact_failed");
    expect(
      decodeSessionUpdate({ sessionUpdate: "GoalUpdated" }).kind,
    ).toBe("goal_updated");
    expect(
      decodeSessionUpdate({ sessionUpdate: "workflow_updated" }).kind,
    ).toBe("unknown");
    expect(decodeSessionUpdate(null).kind).toBe("unknown");
  });

  it("never throws on unknown ToolKind; maps to other", () => {
    expect(decodeToolKind("edit")).toBe("edit");
    expect(decodeToolKind("brand_new_kind")).toBe("other");
    expect(decodeToolKind(undefined)).toBe("other");
    expect(() => decodeToolKind({ nested: true })).not.toThrow();
  });
});
