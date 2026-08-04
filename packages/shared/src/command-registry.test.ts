import { describe, it, expect } from "vitest";
import {
  CommandRegistry,
  registerCoreCommands,
} from "./command-registry.js";

describe("CommandRegistry (Phase 5 foundations)", () => {
  it("registers core templates and labels them as templates", () => {
    const reg = new CommandRegistry();
    registerCoreCommands(reg);
    const brief = reg.get("core.brief");
    expect(brief?.kind).toBe("template");
    expect(brief?.template).toContain("{{input}}");
  });

  it("capability-gates image/video when provider lacks modality", () => {
    const reg = new CommandRegistry();
    registerCoreCommands(reg);
    const without = reg.list({ capabilities: { image: false, video: false } });
    expect(without.some((c) => c.id === "core.image")).toBe(false);
    expect(without.some((c) => c.id === "core.video")).toBe(false);

    const withImg = reg.list({ capabilities: { image: true, video: false } });
    expect(withImg.some((c) => c.id === "core.image")).toBe(true);
    expect(withImg.some((c) => c.id === "core.video")).toBe(false);

    const unavailable = reg.listUnavailable({
      capabilities: { image: false },
    });
    expect(
      unavailable.some((u) => u.command.id === "core.image" && u.reason),
    ).toBe(true);
  });

  it("rejects duplicate registration", () => {
    const reg = new CommandRegistry();
    registerCoreCommands(reg);
    expect(() => registerCoreCommands(reg)).toThrow(/already registered/);
  });
});
