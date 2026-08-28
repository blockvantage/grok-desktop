import { describe, expect, it } from "vitest";
import {
  DESK_PERMISSION_CLIENT,
  deskPermissionFileName,
  encodeGrantScopeRoot,
  grantFileRelativePath,
  grantPatternFromToolRequest,
  grantPatternMatches,
  matchRememberedGrant,
  parseCompactRule,
  parsePermissionToml,
  serializePermissionToml,
  type RememberedGrant,
} from "./permission-grants.js";

function grant(
  partial: Partial<RememberedGrant> & Pick<RememberedGrant, "toolPattern" | "decision">,
): RememberedGrant {
  return {
    id: partial.id ?? "g1",
    scopeRoot: partial.scopeRoot ?? "/ws",
    createdAt: partial.createdAt ?? "2026-08-27T00:00:00.000Z",
    toolPattern: partial.toolPattern,
    decision: partial.decision,
  };
}

describe("permission grants", () => {
  it("names Desk's own client file, not the TUI permission.toml", () => {
    expect(deskPermissionFileName()).toBe("permission_grok-desk.toml");
    expect(DESK_PERMISSION_CLIENT).toBe("grok-desk");
    expect(grantFileRelativePath("/Users/ada/proj")).toBe(
      `sessions/${encodeGrantScopeRoot("/Users/ada/proj")}/permission_grok-desk.toml`,
    );
  });

  it("allow grant suppresses re-prompt for a matching command", () => {
    const grants = [grant({ toolPattern: "Bash(git *)", decision: "allow" })];
    expect(
      matchRememberedGrant(grants, { tool: "shell", command: "git status" })
        ?.decision,
    ).toBe("allow");
    expect(
      matchRememberedGrant(grants, { tool: "shell", command: "rm -rf /" }),
    ).toBeNull();
  });

  it("deny always wins over allow", () => {
    const grants = [
      grant({ id: "a", toolPattern: "Bash(git *)", decision: "allow" }),
      grant({ id: "d", toolPattern: "Bash(git push *)", decision: "deny" }),
    ];
    expect(
      matchRememberedGrant(grants, {
        tool: "shell",
        command: "git push origin main",
      })?.decision,
    ).toBe("deny");
  });

  it("fails closed on unparsable or empty patterns", () => {
    expect(parseCompactRule("")).toBeNull();
    expect(parseCompactRule("!!!")).toBeNull();
    expect(grantPatternMatches("Bash()", { tool: "shell", command: "ls" })).toBe(
      false,
    );
    expect(
      matchRememberedGrant(
        [grant({ toolPattern: "not a rule", decision: "allow" })],
        { tool: "shell", command: "ls" },
      ),
    ).toBeNull();
  });

  it("whole-tool Edit matches write/edit without a path glob", () => {
    expect(grantPatternMatches("Edit", { tool: "write", title: "edit file" })).toBe(
      true,
    );
    expect(grantPatternMatches("Read", { tool: "write" })).toBe(false);
  });

  it("round-trips toml allow/deny arrays", () => {
    const grants = [
      grant({ toolPattern: "Bash(git *)", decision: "allow" }),
      grant({ toolPattern: "Bash(rm -rf *)", decision: "deny" }),
    ];
    const toml = serializePermissionToml(grants);
    expect(toml).toContain("permission_grok-desk");
    const parsed = parsePermissionToml(toml, "/ws");
    expect(parsed.map((g) => g.decision)).toEqual(["deny", "allow"]);
    expect(parsed.map((g) => g.toolPattern).sort()).toEqual(
      ["Bash(git *)", "Bash(rm -rf *)"].sort(),
    );
  });

  it("builds a compact pattern from a parked tool request", () => {
    expect(
      grantPatternFromToolRequest({ tool: "shell", command: "npm test --watch" }),
    ).toBe("Bash(npm test *)");
    expect(grantPatternFromToolRequest({ tool: "write" })).toBe("Edit");
    expect(
      grantPatternMatches("Bash(npm test *)", {
        tool: "shell",
        command: "npm test",
      }),
    ).toBe(true);
  });
});
