import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Task } from "@grokdesk/shared";
import { GrokBuildEngine } from "./session.js";

const temps: string[] = [];

afterEach(() => {
  delete process.env.GROKDESK_TEST_MCP_REPORT;
  for (const dir of temps.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeTask(workspace: string): Task {
  const now = new Date().toISOString();
  return {
    id: "task-browser-1",
    goal: "Open the site in the in-app browser",
    mode: "interactive",
    status: "running",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: [workspace],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: ["desk-browser"],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe("GrokBuildEngine isolated MCP configuration", () => {
  it("places Desk MCP servers in the trusted isolated GROK_HOME, not the untrusted project", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "gd-isolated-mcp-"));
    temps.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace);
    fs.mkdirSync(path.join(workspace, ".grok"));
    fs.writeFileSync(
      path.join(workspace, ".grok", "config.toml"),
      `[mcp_servers.desk-browser]
# managed-by: grok-desk
command = "old-node"
args = ["old-browser-server.mjs"]
enabled = true
`,
      "utf8",
    );
    const report = path.join(root, "mcp-report.txt");
    // .mjs fixture — works on Windows (no shebang) via cliCommand → node.
    const binary = path.join(root, "fake-grok.mjs");
    fs.writeFileSync(
      binary,
      `import fs from "node:fs";
import path from "node:path";
const a = process.argv.slice(2);
const report = process.env.GROKDESK_TEST_MCP_REPORT;
if (a[0] === "--version") { console.log("grok 0.2.101"); process.exit(0); }
if (a[0] === "--help") { console.log("Usage: grok --no-auto-update"); process.exit(0); }
if (a[0] === "agent" && (a[1] === "--help" || a.includes("--help"))) {
  console.log("agent stdio"); process.exit(0);
}
const grokHome = process.env.GROK_HOME || "";
const cfg = path.join(grokHome, "config.toml");
if (fs.existsSync(cfg)) {
  fs.copyFileSync(cfg, report);
} else {
  fs.writeFileSync(report, "GLOBAL_CONFIG_MISSING\\n");
}
fs.appendFileSync(report, "\\nARGS=" + a.join(" ") + "\\n");
const projectCfg = path.join(process.cwd(), ".grok", "config.toml");
if (fs.existsSync(projectCfg)) {
  const text = fs.readFileSync(projectCfg, "utf8");
  if (text.includes("[mcp_servers.desk-browser]")) {
    fs.appendFileSync(report, "PROJECT_DESK_BROWSER_PRESENT\\n");
  }
}
process.exit(0);
`,
      { mode: 0o755 },
    );
    process.env.GROKDESK_TEST_MCP_REPORT = report;

    const engine = new GrokBuildEngine({
      binary,
      mcpServers: [
        {
          id: "desk-browser",
          command: "/absolute/node",
          args: ["/absolute/browser-mcp-server.mjs"],
          env: {
            GROKDESK_BROWSER_URL: "http://127.0.0.1:58123",
            GROKDESK_BROWSER_TOKEN: "test-token",
          },
          enabled: true,
        },
      ],
    });

    await engine.run({
      task: makeTask(workspace),
      systemPreamble: "",
      browserSessionId: "conversation-browser-1",
      onEvent: async () => "continue",
    });

    const captured = fs.readFileSync(report, "utf8");
    expect(captured).toContain("[mcp_servers.desk-browser]");
    expect(captured).toContain(
      'GROKDESK_BROWSER_TASK_ID = "conversation-browser-1"',
    );
    expect(captured).not.toContain("GLOBAL_CONFIG_MISSING");
    expect(captured).not.toContain("PROJECT_DESK_BROWSER_PRESENT");
    expect(captured).not.toContain("--trust");
    expect(captured).not.toContain("Do not search_tool for browser tools");
    expect(captured).toContain(
      "If browser_open is unavailable or fails, report that failure truthfully",
    );
  });
});
