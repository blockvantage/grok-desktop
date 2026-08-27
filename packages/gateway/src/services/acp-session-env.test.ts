import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  cleanupProvisionedGrokHome,
  provisionAcpGrokHome,
} from "./acp-session-env.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeSkillPack(root: string): string {
  const skillsRoot = path.join(root, "skills");
  const pack = path.join(skillsRoot, "desk-image");
  fs.mkdirSync(pack, { recursive: true });
  fs.writeFileSync(
    path.join(pack, "SKILL.md"),
    "---\nname: desk-image\n---\nMake images.\n",
  );
  return skillsRoot;
}

describe("provisionAcpGrokHome", () => {
  it("isolates GROK_HOME, skips user hooks, installs skills, and writes Desk MCP", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-acp-env-"));
    temps.push(root);
    const userHome = path.join(root, "user");
    const hooksDir = path.join(userHome, ".grok", "hooks");
    fs.mkdirSync(hooksDir, { recursive: true });
    fs.writeFileSync(path.join(hooksDir, "evil.sh"), "echo pwned\n");
    fs.writeFileSync(
      path.join(userHome, ".grok", "auth.json"),
      JSON.stringify({ token: "secret" }),
    );
    const cwd = path.join(root, "ws");
    fs.mkdirSync(cwd);
    const skillsRoot = makeSkillPack(root);

    const result = provisionAcpGrokHome({
      inheritUserConfig: false,
      cwd,
      userHome,
      processEnv: { HOME: userHome, PATH: "/usr/bin" },
      binary: path.join(root, "managed", "grok"),
      mcpServers: [
        {
          id: "desk-browser",
          command: "node",
          args: ["browser.mjs"],
          env: { GROKDESK_BROWSER_TOKEN: "t" },
          enabled: true,
        },
      ],
      skillsPaths: [skillsRoot],
      browserSessionId: "task-1",
    });
    temps.push(result.grokHome ?? "");

    expect(result.isolateGrokHome).toBe(true);
    expect(result.grokHome).toBeTruthy();
    expect(result.env.GROK_HOME).toBe(result.grokHome);
    expect(result.env.GROK_HOME).not.toBe(path.join(userHome, ".grok"));
    expect(fs.existsSync(path.join(result.grokHome!, "hooks", "evil.sh"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(result.grokHome!, "auth.json"))).toBe(true);
    expect(
      fs.existsSync(
        path.join(result.grokHome!, "skills", "desk-image", "SKILL.md"),
      ) ||
        fs
          .lstatSync(path.join(result.grokHome!, "skills", "desk-image"))
          .isSymbolicLink(),
    ).toBe(true);
    expect(result.skillsInstalled.length).toBeGreaterThan(0);
    const cfg = fs.readFileSync(
      path.join(result.grokHome!, "config.toml"),
      "utf8",
    );
    expect(cfg).toMatch(/desk-browser/);
    expect(cfg).toMatch(/GROKDESK_BROWSER_TASK_ID/);
    expect(result.mcpServersForSession).toEqual([
      expect.objectContaining({
        name: "desk-browser",
        command: "node",
      }),
    ]);
    // Managed binary dir is on PATH; global ~/.grok/bin is not injected.
    expect(result.env.PATH).toContain(path.join(root, "managed"));
    expect(result.env.PATH).not.toMatch(/\.grok[/\\]bin/);

    cleanupProvisionedGrokHome(result);
  });

  it("does not set GROK_HOME when inheriting user config", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-acp-inherit-"));
    temps.push(root);
    const userHome = path.join(root, "user");
    fs.mkdirSync(path.join(userHome, ".grok"), { recursive: true });
    const result = provisionAcpGrokHome({
      inheritUserConfig: true,
      cwd: root,
      userHome,
      processEnv: { HOME: userHome, PATH: "/usr/bin" },
    });
    expect(result.isolateGrokHome).toBe(false);
    expect(result.grokHome).toBeNull();
    expect(result.env.GROK_HOME).toBeUndefined();
    expect(result.createdHome).toBe(false);
  });
});
