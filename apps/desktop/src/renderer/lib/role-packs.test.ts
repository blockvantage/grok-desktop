import { describe, expect, it } from "vitest";
import {
  packEffortIfUnset,
  resolveCreateRolePack,
  ROLE_PACK_STORAGE_KEY,
} from "./role-packs";

describe("role-packs helpers", () => {
  it("resolveCreateRolePack prefers explicit selection over last-used", () => {
    expect(resolveCreateRolePack("research", "marketing")).toBe("research");
    // null = explicit General (no pack); do not revive last-used
    expect(resolveCreateRolePack(null, "marketing")).toBeNull();
    // undefined = no UI state yet → last-used
    expect(resolveCreateRolePack(undefined, "marketing")).toBe("marketing");
    expect(resolveCreateRolePack(null, null)).toBeNull();
  });

  it("packEffortIfUnset only fills when user left default", () => {
    expect(packEffortIfUnset("normal", "heavy")).toBe("heavy");
    expect(packEffortIfUnset("fast", "heavy")).toBe("fast");
  });

  it("storage key is stable", () => {
    expect(ROLE_PACK_STORAGE_KEY).toBe("grokdesk.lastRolePackId");
  });
});
