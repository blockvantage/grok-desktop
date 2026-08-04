import { describe, it, expect } from "vitest";
import { buildCreateTaskForm } from "./create-task-form";

describe("buildCreateTaskForm", () => {
  it("trims goal and applies pack effort", () => {
    const form = buildCreateTaskForm({
      goal: "  ship  ",
      root: "/ws",
      model: "m",
      effort: "normal",
      approvalMode: "balanced",
      rolePackId: "coder",
      lastRolePackId: null,
      homeAttachments: [],
      rolePacks: [{ id: "coder", defaultEffort: "heavy" }],
      resolveCreateRolePack: (id) => id,
      findPack: (packs, id) => packs.find((p) => p.id === id) ?? null,
      packEffortIfUnset: (effort, packDefault) => packDefault ?? effort,
    });
    expect(form.goal).toBe("ship");
    expect(form.effort).toBe("heavy");
    // User left default "normal" — not explicit even after pack fill.
    expect(form.effortExplicit).toBe(false);
    expect(form.rolePack).toBe("coder");
  });

  it("marks effortExplicit when user moved off normal", () => {
    const form = buildCreateTaskForm({
      goal: "ship",
      root: "/ws",
      model: "m",
      effort: "fast",
      approvalMode: "balanced",
      rolePackId: "coder",
      lastRolePackId: null,
      homeAttachments: [],
      rolePacks: [{ id: "coder", defaultEffort: "heavy" }],
      resolveCreateRolePack: (id) => id,
      findPack: (packs, id) => packs.find((p) => p.id === id) ?? null,
      packEffortIfUnset: (effort) => effort,
    });
    expect(form.effort).toBe("fast");
    expect(form.effortExplicit).toBe(true);
  });

  it("prefers override goal and attachments", () => {
    const form = buildCreateTaskForm({
      goal: "home",
      overrideGoal: "override",
      root: "/ws",
      model: "m",
      effort: "fast",
      approvalMode: "strict",
      rolePackId: null,
      lastRolePackId: null,
      homeAttachments: [{ id: "h" }],
      attachments: [{ id: "a" }],
      rolePacks: [],
      resolveCreateRolePack: () => null,
      findPack: () => null,
      packEffortIfUnset: (e) => e,
    });
    expect(form.goal).toBe("override");
    expect(form.attachments).toEqual([{ id: "a" }]);
    expect(form.effortExplicit).toBe(true);
  });
});
