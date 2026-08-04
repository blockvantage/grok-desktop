/**
 * PORT-01: only composition-root modules import @grokdesk/engine-grok.
 * Domain services import types via engine-types or inject EngineAdapter.
 * Production never imports simulated engines or forceFake settings.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDefaultEngine,
  ManagedRuntimeUnavailableEngine,
  MANAGED_RUNTIME_UNAVAILABLE,
} from "../engine-composition.js";
import type { NormalizedEngineEvent } from "@grokdesk/engine-grok";
import type { Task } from "@grokdesk/shared";

const srcRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const ALLOWED = new Set([
  "engine-composition.ts",
  "engine-types.ts",
]);

function walkTs(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "p0" || ent.name === "node_modules") continue;
      walkTs(p, out);
      continue;
    }
    if (!ent.name.endsWith(".ts")) continue;
    if (ent.name.endsWith(".test.ts")) continue;
    out.push(p);
  }
  return out;
}

describe("engine-grok import boundary", () => {
  it("non-composition production sources do not import @grokdesk/engine-grok", () => {
    const files = walkTs(srcRoot);
    const violators: string[] = [];
    for (const file of files) {
      const base = path.basename(file);
      if (ALLOWED.has(base)) continue;
      const text = fs.readFileSync(file, "utf8");
      if (
        /from\s+["']@grokdesk\/engine-grok["']/.test(text) ||
        /from\s+["']@grokdesk\/engine-grok\//.test(text)
      ) {
        violators.push(path.relative(srcRoot, file));
      }
    }
    expect(violators).toEqual([]);
  });

  it("production sources never import simulated engine symbols", () => {
    // Construct retired names so this test file does not itself contain them.
    const retiredSim = ["Fake", "Engine"].join("");
    const retiredFlag = ["force", "Fake", "Engine"].join("");
    const files = walkTs(srcRoot);
    const violators: string[] = [];
    for (const file of files) {
      if (file.endsWith(".test.ts")) continue;
      const text = fs.readFileSync(file, "utf8");
      if (text.includes(retiredSim) || text.includes(retiredFlag)) {
        violators.push(path.relative(srcRoot, file));
      }
    }
    expect(violators).toEqual([]);
  });
});


describe("managed runtime production composition", () => {
  it("returns managed_runtime_unavailable without simulated content", async () => {
    const engine = await createDefaultEngine({
      managedBinaryPath: null,
      env: {
        PATH: "",
        HOME: "/tmp",
        GROKDESK_PACKAGED: "1",
        GROK_BUILD_PATH: "/usr/local/bin/grok",
      },
    });
    expect(engine).toBeInstanceOf(ManagedRuntimeUnavailableEngine);
    const events: NormalizedEngineEvent[] = [];
    const task = {
      id: "t",
      goal: "x",
      mode: "interactive",
      status: "running",
      model: "grok",
      effort: "normal",
      policySnapshot: {
        approvalMode: "balanced",
        workspaceRoots: ["/tmp"],
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    } as Task;
    await engine.run({
      task,
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e);
        return "continue";
      },
    });
    expect(events).toEqual([
      { type: "error", message: MANAGED_RUNTIME_UNAVAILABLE },
    ]);
  });
});
