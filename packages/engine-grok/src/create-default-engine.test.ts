import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import {
  createDefaultEngine,
  GrokBuildEngine,
  ManagedRuntimeUnavailableEngine,
  MANAGED_RUNTIME_UNAVAILABLE,
} from "./session.js";
import type { NormalizedEngineEvent } from "./types.js";
import type { Task } from "@grokdesk/shared";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "grokdesk-cde-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

function makeTask(): Task {
  const now = new Date().toISOString();
  return {
    id: "t1",
    goal: "should not simulate",
    mode: "interactive",
    status: "running",
    model: "grok",
    effort: "normal",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: ["/tmp/ws"],
      allowNetworkTools: true,
      allowShell: true,
    },
    projectId: null,
    parentTaskId: null,
    revisionOfTaskId: null,
    scheduleRuleId: null,
    rolePack: null,
    skills: [],
    mcpServerIds: [],
    createdAt: now,
    updatedAt: now,
    completedAt: null,
  };
}

describe("createDefaultEngine production boundary", () => {
  it("requires explicit absolute managed binary and ignores PATH/GROK_BUILD_PATH", async () => {
    const home = await makeTempDir();
    const localBin = path.join(home, ".local", "bin");
    await fs.mkdir(localBin, { recursive: true });
    const global = path.join(localBin, "grok");
    await fs.writeFile(global, "#!/bin/sh\necho global\n", { mode: 0o755 });
    const buildPath = path.join(home, "build-grok");
    await fs.writeFile(buildPath, "#!/bin/sh\necho build\n", { mode: 0o755 });

    const engine = await createDefaultEngine({
      env: {
        PATH: localBin,
        HOME: home,
        GROK_BUILD_PATH: buildPath,
        GROKDESK_PACKAGED: "1",
      },
    });

    expect(engine).toBeInstanceOf(ManagedRuntimeUnavailableEngine);
    expect(engine).not.toBeInstanceOf(GrokBuildEngine);
  });

  it("returns managed_runtime_unavailable without simulated content", async () => {
    const engine = await createDefaultEngine({
      managedBinaryPath: null,
      env: { PATH: "", HOME: await makeTempDir(), GROKDESK_PACKAGED: "1" },
    });
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: makeTask(),
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e);
        return "continue";
      },
    });
    expect(events).toEqual([
      { type: "error", message: MANAGED_RUNTIME_UNAVAILABLE },
    ]);
    expect(events.some((e) => e.type === "done")).toBe(false);
    expect(events.some((e) => e.type === "artifact")).toBe(false);
    expect(events.some((e) => e.type === "tool_request")).toBe(false);
    expect(events.some((e) => e.type === "message")).toBe(false);
  });

  it("builds GrokBuildEngine from absolute managed path", async () => {
    const dir = await makeTempDir();
    const bin = path.join(dir, "managed-grok");
    await fs.writeFile(bin, "#!/bin/sh\necho ok\n", { mode: 0o755 });

    const engine = await createDefaultEngine({
      managedBinaryPath: bin,
      env: { PATH: "", HOME: dir, GROKDESK_PACKAGED: "1" },
    });
    expect(engine).toBeInstanceOf(GrokBuildEngine);
    expect(engine.executesOwnTools).toBe(true);
  });

  it("does not accept forceFake or invent a simulated engine", async () => {
    const engine = await createDefaultEngine({
      // @ts-expect-error forceFake removed from production API
      forceFake: true,
      env: { PATH: "", HOME: await makeTempDir(), GROKDESK_PACKAGED: "1" },
    });
    expect(engine).toBeInstanceOf(ManagedRuntimeUnavailableEngine);
  });
});
