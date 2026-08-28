import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PermissionGrantStore } from "./permission-grants.js";

describe("PermissionGrantStore", () => {
  let dir: string;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  function store() {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-grants-"));
    return new PermissionGrantStore(dir);
  }

  it("allow grant suppresses re-prompt; revoke removes the row", () => {
    const s = store();
    s.upsert({
      scopeRoot: "/ws",
      toolPattern: "Bash(git *)",
      decision: "allow",
    });
    expect(s.match("/ws", { tool: "shell", command: "git status" })?.decision).toBe(
      "allow",
    );
    expect(s.revoke("/ws", "Bash(git *)")).toBe(true);
    expect(s.match("/ws", { tool: "shell", command: "git status" })).toBeNull();
  });

  it("deny always blocks even when an allow also matches", () => {
    const s = store();
    s.upsert({
      scopeRoot: "/ws",
      toolPattern: "Bash(git *)",
      decision: "allow",
    });
    s.upsert({
      scopeRoot: "/ws",
      toolPattern: "Bash(git push *)",
      decision: "deny",
    });
    expect(
      s.match("/ws", { tool: "shell", command: "git push origin main" })
        ?.decision,
    ).toBe("deny");
  });

  it("writes Desk's client file and copies into isolated GROK_HOME", () => {
    const s = store();
    s.upsert({
      scopeRoot: "/Users/ada/proj",
      toolPattern: "Edit",
      decision: "allow",
    });
    const listed = s.list("/Users/ada/proj");
    expect(listed).toHaveLength(1);
    expect(listed[0]!.toolPattern).toBe("Edit");
    const grokHome = path.join(dir, "isolated-home");
    const copied = s.copyIntoGrokHome(grokHome, "/Users/ada/proj");
    expect(copied && fs.existsSync(copied)).toBe(true);
    expect(copied).toMatch(/permission_grok-desk\.toml$/);
  });
});
