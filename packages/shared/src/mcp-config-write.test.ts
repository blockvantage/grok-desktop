import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  renderMcpServersToml,
  writeProjectMcpConfig,
  stripMcpServerSections,
  expandMcpPlaceholders,
  installSkillsIntoProject,
  installSkillsIntoGrokHome,
  copySkillDir,
  redactSecretsForPrompt,
  sanitizeMcpServerId,
  tomlQuote,
  MCP_MANAGED_MARKER,
} from "./mcp-config-write.js";

describe("mcp-config-write", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "grokdesk-mcp-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("renders valid toml for enabled servers with managed-by marker", () => {
    const toml = renderMcpServersToml([
      {
        id: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/home"],
        enabled: true,
      },
      {
        id: "off",
        command: "npx",
        args: [],
        enabled: false,
      },
    ]);
    expect(toml).toContain("[mcp_servers.filesystem]");
    expect(toml).toContain(MCP_MANAGED_MARKER);
    expect(toml).toContain('command = "npx"');
    expect(toml).toContain("@modelcontextprotocol/server-filesystem");
    expect(toml).not.toContain("[mcp_servers.off]");
  });

  it("writes project config under .grok/config.toml and creates .gitignore once", () => {
    const p = writeProjectMcpConfig(tmp, [
      {
        id: "fetch",
        command: "uvx",
        args: ["mcp-server-fetch"],
        env: { FOO: "bar" },
        enabled: true,
      },
    ]);
    expect(p).toBe(path.join(tmp, ".grok", "config.toml"));
    const body = fs.readFileSync(p!, "utf8");
    expect(body).toContain("[mcp_servers.fetch]");
    expect(body).toContain(MCP_MANAGED_MARKER);
    expect(body).toContain("uvx");
    expect(body).toContain("FOO");

    const gi = path.join(tmp, ".grok", ".gitignore");
    expect(fs.existsSync(gi)).toBe(true);
    expect(fs.readFileSync(gi, "utf8")).toBe("config.toml\nskills/\n");

    // Pre-existing custom .gitignore is never overwritten
    fs.writeFileSync(gi, "custom-ignore\n", "utf8");
    writeProjectMcpConfig(tmp, [
      {
        id: "fetch",
        command: "uvx",
        args: ["mcp-server-fetch"],
        enabled: true,
      },
    ]);
    expect(fs.readFileSync(gi, "utf8")).toBe("custom-ignore\n");
  });

  it("expands HOME and env at spawn, leaves missing placeholders", () => {
    const expanded = expandMcpPlaceholders(
      [
        {
          id: "fs",
          command: "npx",
          args: ["${HOME}/docs", "${MISSING_TOKEN}"],
          env: { K: "${API_KEY}" },
          enabled: true,
        },
      ],
      { HOME: "/Users/me", API_KEY: "secret" },
    );
    expect(expanded[0]!.args[0]).toBe("/Users/me/docs");
    expect(expanded[0]!.args[1]).toBe("${MISSING_TOKEN}");
    expect(expanded[0]!.env?.K).toBe("secret");
  });

  it("preserves user-authored mcp_servers tables without marker", () => {
    const existing = `
[ui]
yolo = true

[mcp_servers.custom]
command = "my-tool"
args = []
enabled = true

[mcp]
something = 1

[plugins]
enabled = ["x"]
`;
    const stripped = stripMcpServerSections(
      existing,
      new Set(["filesystem"]),
    );
    expect(stripped).toContain("[ui]");
    expect(stripped).toContain("[plugins]");
    expect(stripped).toContain("[mcp_servers.custom]");
    expect(stripped).toContain("my-tool");
    // [mcp.*] user sections must not be eaten
    expect(stripped).toContain("[mcp]");
    expect(stripped).toContain("something = 1");
  });

  it("removes Desk-marked tables and managed ids on rewrite", () => {
    const existing = `
[ui]
yolo = true

[mcp_servers.old]
${MCP_MANAGED_MARKER}
command = "echo"
args = []
enabled = true

[mcp_servers.custom]
command = "keep-me"
args = []

[plugins]
enabled = ["x"]
`;
    // managedIds includes "old" (disabled since last write); custom has no marker
    const stripped = stripMcpServerSections(existing, new Set(["old"]));
    expect(stripped).toContain("[ui]");
    expect(stripped).toContain("[plugins]");
    expect(stripped).toContain("[mcp_servers.custom]");
    expect(stripped).toContain("keep-me");
    expect(stripped).not.toContain("mcp_servers.old");
    expect(stripped).not.toContain("echo");
  });

  it("writeProjectMcpConfig keeps user tables and drops disabled managed", () => {
    const configPath = path.join(tmp, ".grok", "config.toml");
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(
      configPath,
      `
[mcp_servers.custom]
command = "user"
args = []

[mcp_servers.filesystem]
${MCP_MANAGED_MARKER}
command = "npx"
args = []
enabled = true
`,
      "utf8",
    );

    writeProjectMcpConfig(tmp, [
      {
        id: "filesystem",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        enabled: false,
      },
      {
        id: "memory",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
        enabled: true,
      },
    ]);

    const body = fs.readFileSync(configPath, "utf8");
    expect(body).toContain("[mcp_servers.custom]");
    expect(body).toContain("user");
    expect(body).toContain("[mcp_servers.memory]");
    expect(body).not.toContain("[mcp_servers.filesystem]");
  });

  it("installs skill packs into .grok/skills", () => {
    const skillsRoot = path.join(tmp, "skills");
    const pack = path.join(skillsRoot, "desk-defaults");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(path.join(pack, "SKILL.md"), "---\nname: desk\n---\nHi\n");
    const installed = installSkillsIntoProject(tmp, [skillsRoot]);
    expect(installed.length).toBe(1);
    expect(
      fs.existsSync(path.join(tmp, ".grok", "skills", "desk-defaults", "SKILL.md")) ||
        fs.lstatSync(path.join(tmp, ".grok", "skills", "desk-defaults")).isSymbolicLink(),
    ).toBe(true);
  });

  it("installs skill packs into GROK_HOME/skills", () => {
    const skillsRoot = path.join(tmp, "skills");
    const pack = path.join(skillsRoot, "desk-defaults");
    fs.mkdirSync(pack, { recursive: true });
    fs.writeFileSync(path.join(pack, "SKILL.md"), "---\nname: desk\n---\nHi\n");
    const grokHome = path.join(tmp, "grok-home");
    const installed = installSkillsIntoGrokHome(grokHome, [skillsRoot]);
    expect(installed.length).toBe(1);
    expect(
      fs.existsSync(path.join(grokHome, "skills", "desk-defaults", "SKILL.md")) ||
        fs.lstatSync(path.join(grokHome, "skills", "desk-defaults")).isSymbolicLink(),
    ).toBe(true);
  });

  it("copySkillDir copies nested resource files, not just SKILL.md", () => {
    const src = path.join(tmp, "src-pack");
    const dest = path.join(tmp, "dest-pack");
    fs.mkdirSync(path.join(src, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(src, "SKILL.md"), "---\nname: pack\n---\n");
    fs.writeFileSync(path.join(src, "scripts", "run.sh"), "#!/bin/sh\necho hi\n");
    fs.writeFileSync(path.join(src, "notes.txt"), "nested resource\n");

    copySkillDir(src, dest);

    expect(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8")).toContain("pack");
    expect(fs.existsSync(path.join(dest, "scripts", "run.sh"))).toBe(true);
    expect(fs.readFileSync(path.join(dest, "notes.txt"), "utf8")).toContain(
      "nested resource",
    );
  });

  it("redacts connection strings and tokens", () => {
    expect(
      redactSecretsForPrompt("url=postgres://user:pass@host/db token=ghp_abcdefghijk"),
    ).not.toContain("pass");
    expect(redactSecretsForPrompt("ghp_abcdefghijklmnop")).toContain("[redacted]");
  });

  it("sanitizes server ids and quotes toml", () => {
    expect(sanitizeMcpServerId("my server!")).toBe("my-server");
    expect(tomlQuote('a"b')).toContain('\\"');
  });
});
