import { describe, expect, it, vi } from "vitest";
import { PowerStateGate } from "./power-state.js";

describe("PowerStateGate", () => {
  it("suspend pauses dispatch; resume refreshes auth before releasing", async () => {
    const order: string[] = [];
    const gate = new PowerStateGate({
      pauseDispatch: () => order.push("pause"),
      resumeDispatch: () => order.push("resume"),
      refreshAuth: async () => {
        order.push("refresh");
      },
    });
    await gate.setState("suspended");
    expect(gate.state).toBe("suspended");
    await gate.setState("active");
    expect(order).toEqual(["pause", "refresh", "resume"]);
  });

  it("is idempotent for repeated same-state signals", async () => {
    const pause = vi.fn();
    const gate = new PowerStateGate({
      pauseDispatch: pause,
      resumeDispatch: () => {},
      refreshAuth: async () => {},
    });
    await gate.setState("suspended");
    await gate.setState("suspended");
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("still resumes dispatch when auth refresh fails", async () => {
    const order: string[] = [];
    const gate = new PowerStateGate({
      pauseDispatch: () => order.push("pause"),
      resumeDispatch: () => order.push("resume"),
      refreshAuth: async () => {
        throw new Error("offline");
      },
    });
    await gate.setState("suspended");
    await gate.setState("active");
    expect(order).toEqual(["pause", "resume"]);
  });
});
