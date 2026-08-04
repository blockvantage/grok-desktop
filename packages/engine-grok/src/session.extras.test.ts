import { describe, it, expect } from "vitest";
import {
  GrokBuildEngine,
  withDeskBrowserTaskId,
  headlessSpawnArgv,
} from "./session.js";

describe("GrokBuildEngine extras", () => {
  it("stores mcpServers and skillsPaths for engine args/env", () => {
    const engine = new GrokBuildEngine({
      binary: "/usr/bin/false",
      mcpServers: [
        {
          id: "fs",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          enabled: true,
        },
      ],
      skillsPaths: ["/tmp/skills"],
    });
    const extras = engine.getEngineExtras();
    expect(extras.mcpServers).toHaveLength(1);
    expect(extras.mcpServers[0]!.id).toBe("fs");
    expect(extras.skillsPaths).toEqual(["/tmp/skills"]);
    expect(engine.executesOwnTools).toBe(true);
  });

  it("injects GROKDESK_BROWSER_TASK_ID into desk-browser MCP only", () => {
    const taskId = "task-uuid-1234";
    const out = withDeskBrowserTaskId(
      [
        {
          id: "desk-browser",
          command: "node",
          args: ["mcp.mjs"],
          env: { GROKDESK_BROWSER_URL: "http://127.0.0.1:9" },
          enabled: true,
        },
        {
          id: "filesystem",
          command: "npx",
          args: [],
          enabled: true,
        },
      ],
      taskId,
    );
    expect(out[0]!.env?.GROKDESK_BROWSER_TASK_ID).toBe(taskId);
    expect(out[0]!.env?.GROKDESK_BROWSER_URL).toBe("http://127.0.0.1:9");
    expect(out[1]!.env?.GROKDESK_BROWSER_TASK_ID).toBeUndefined();
  });

  it("injects GROKDESK_DESKTOP_TASK_ID into desk-desktop MCP", () => {
    const taskId = "task-desktop-99";
    const out = withDeskBrowserTaskId(
      [
        {
          id: "desk-desktop",
          command: "node",
          args: ["desktop-mcp.mjs"],
          env: { GROKDESK_DESKTOP_URL: "http://127.0.0.1:8" },
          enabled: true,
        },
      ],
      taskId,
    );
    expect(out[0]!.env?.GROKDESK_DESKTOP_TASK_ID).toBe(taskId);
  });

  it("includes --resume when priorProviderSessionId is set", () => {
    const withResume = headlessSpawnArgv(
      ["-p", "hi", "--output-format", "streaming-json"],
      "abc123",
    );
    expect(withResume).toContain("--resume");
    expect(withResume[withResume.indexOf("--resume") + 1]).toBe("abc123");
    const without = headlessSpawnArgv(
      ["-p", "hi", "--output-format", "streaming-json"],
    );
    expect(without).not.toContain("--resume");
  });
});

