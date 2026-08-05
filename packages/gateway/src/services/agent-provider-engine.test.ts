import { describe, it, expect, vi } from "vitest";
import {
  FakeAgentProvider,
  type AgentProvider,
  type AgentSession,
  type ProviderCapabilities,
  type ProviderSessionBinding,
  type SessionInput,
  type TurnInput,
  type TurnResult,
  type RuntimeEventSink,
} from "@grokdesk/agent-runtime";
import {
  AgentProviderEngine,
  runtimeEventToNormalized,
  createAgentProviderEngine,
} from "./agent-provider-engine.js";
import type { NormalizedEngineEvent } from "../engine-types.js";
import type { Task } from "@grokdesk/shared";
import { openDatabase } from "../db.js";
import { TaskService } from "./tasks.js";
import { AuditService } from "./audit.js";
import { TaskRunner } from "./runner.js";
import { RunAttemptService } from "./run-attempts.js";
import { OperationReceiptService } from "./operation-receipts.js";
import { createDefaultProviderRegistry } from "../provider-composition.js";
import { createProviderPreflight } from "./provider-preflight.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function task(goal: string, roots: string[], id = "task-1"): Task {
  return {
    id,
    goal,
    title: null,
    mode: "interactive",
    status: "queued",
    model: "fake-fast",
    effort: "fast",
    policySnapshot: {
      approvalMode: "balanced",
      workspaceRoots: roots,
      allowShell: true,
      allowNetworkTools: true,
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
  };
}

/** Minimal provider with controllable capabilities / turn result. */
function stubProvider(opts: {
  caps: ProviderCapabilities;
  runTurn?: (
    input: TurnInput,
    sink: RuntimeEventSink,
  ) => Promise<TurnResult>;
}): AgentProvider {
  let createCount = 0;
  return {
    id: "stub",
    async probe() {
      return {
        ok: true,
        providerId: "stub",
        version: "0",
        authenticated: true,
      };
    },
    async listModels() {
      return [
        {
          id: "fake-fast",
          displayName: "Stub",
          providerId: "stub",
          modalities: ["text"],
        },
      ];
    },
    async getCapabilities() {
      return opts.caps;
    },
    async createSession(input: SessionInput): Promise<AgentSession> {
      createCount += 1;
      const binding: ProviderSessionBinding = {
        providerId: "stub",
        providerSessionId: `stub-${createCount}`,
        modelId: input.ref.modelId,
        createdAt: new Date().toISOString(),
      };
      return {
        binding,
        async runTurn(turn, sink) {
          if (opts.runTurn) return opts.runTurn(turn, sink);
          await sink({
            type: "message",
            role: "assistant",
            text: turn.goal,
            channel: "text",
          });
          await sink({ type: "done", summary: "ok" });
          return { status: "done", summary: "ok" };
        },
        async cancel() {},
      };
    },
    async resumeSession(binding) {
      return {
        binding,
        async runTurn() {
          return { status: "done", summary: "resumed" };
        },
        async cancel() {},
      };
    },
  };
}

describe("runtimeEventToNormalized", () => {
  it("maps core runtime events", () => {
    expect(
      runtimeEventToNormalized({
        type: "message",
        role: "assistant",
        text: "hi",
        channel: "text",
      }),
    ).toMatchObject({ type: "message", text: "hi" });
    expect(
      runtimeEventToNormalized({
        type: "tool_call",
        id: "1",
        tool: "shell",
        command: "ls",
      }),
    ).toMatchObject({ type: "tool_request", tool: "shell" });
    expect(
      runtimeEventToNormalized({ type: "done", summary: "ok" }),
    ).toEqual({ type: "done", summary: "ok" });
    expect(
      runtimeEventToNormalized({
        type: "usage",
        usage: { inputTokens: 10, outputTokens: 5 },
      }),
    ).toEqual({
      type: "usage",
      inputTokens: 10,
      outputTokens: 5,
    });
  });

  it("maps permission_request with permissionRequest meta", () => {
    const n = runtimeEventToNormalized({
      type: "permission_request",
      id: "p1",
      tool: "write_file",
      path: "/w/x.txt",
    });
    expect(n).toMatchObject({
      type: "tool_request",
      id: "p1",
      tool: "write_file",
      path: "/w/x.txt",
      meta: { permissionRequest: true },
    });
  });

  it("maps browser_* tools when known", () => {
    expect(
      runtimeEventToNormalized({
        type: "tool_call",
        id: "b1",
        tool: "browser_open",
      }),
    ).toMatchObject({ type: "tool_request", tool: "browser_open" });
  });
});

describe("AgentProviderEngine", () => {
  it("runs FakeAgentProvider through EngineAdapter surface", async () => {
    const provider = new FakeAgentProvider();
    const engine = createAgentProviderEngine(provider, {
      executesOwnTools: false,
    });
    expect(engine.executesOwnTools).toBe(false);

    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("hello provider", ["/tmp"]),
      systemPreamble: "ctx",
      onEvent: async (ev) => {
        events.push(ev);
        return "continue";
      },
    });

    expect(events.some((e) => e.type === "message")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "tool_request" &&
          (e.meta as { permissionRequest?: boolean } | undefined)
            ?.permissionRequest === true,
      ),
    ).toBe(true);
  });

  it("maps media generation tools to the media tool id", () => {
    for (const t of [
      "image_gen",
      "image_edit",
      "image_to_video",
      "reference_to_video",
    ]) {
      const ev = runtimeEventToNormalized({
        type: "tool_call",
        id: "1",
        tool: t,
      } as never);
      expect(ev).toMatchObject({ type: "tool_request", tool: "media" });
    }
  });

  it("maps plan runtime events to plan_update", () => {
    const ev = runtimeEventToNormalized({
      type: "plan",
      content: "# Plan",
      status: "awaiting_approval",
    } as never);
    expect(ev).toEqual({
      type: "plan_update",
      content: "# Plan",
      status: "awaiting_approval",
    });
  });

  it("resumes a prior provider session instead of creating a fresh one", async () => {
    const calls: string[] = [];
    const fakeSession = (): AgentSession => ({
      binding: {
        providerId: "grok",
        providerSessionId: "sess-9",
        modelId: "fake-fast",
        createdAt: new Date().toISOString(),
      },
      async runTurn(_input, sink) {
        await sink({ type: "done", summary: "ok" });
        return { status: "done", summary: "ok" };
      },
      async cancel() {},
    });
    const provider = {
      id: "grok",
      getCapabilities: async () => ({
        toolMediation: "provider-permission-rpc",
        policyEnforceable: true,
      }),
      createSession: async () => {
        calls.push("create");
        return fakeSession();
      },
      resumeSession: async (binding: { providerSessionId: string }) => {
        calls.push(`resume:${binding.providerSessionId}`);
        return fakeSession();
      },
    } as never;
    const engine = createAgentProviderEngine(provider, {
      executesOwnTools: true,
    });
    await engine.run({
      task: task("resume me", ["/tmp"]),
      systemPreamble: "",
      priorProviderSessionId: "sess-9",
      onEvent: async () => "continue",
    });
    expect(calls).toEqual(["resume:sess-9"]);
  });

  it("falls back to the injected headless engine when ACP session creation fails", async () => {
    const events: string[] = [];
    const fallback = {
      executesOwnTools: true,
      run: async (o: {
        onEvent: (e: NormalizedEngineEvent) => Promise<"continue" | "cancel">;
      }) => {
        await o.onEvent({ type: "done", summary: "headless-ran" });
      },
      cancel: async () => {},
    };
    const provider = {
      id: "grok",
      getCapabilities: async () => ({
        toolMediation: "provider-permission-rpc",
        policyEnforceable: true,
      }),
      createSession: async () => {
        throw new Error("acp spawn failed");
      },
    } as never;
    const engine = createAgentProviderEngine(provider, {
      fallbackEngine: fallback,
      executesOwnTools: true,
    });
    await engine.run({
      task: task("fallback", ["/tmp"]),
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e.type === "run_progress" ? e.message : e.type);
        return "continue";
      },
    });
    expect(events.some((m) => m.includes("falling back"))).toBe(true);
    expect(events).toContain("done");
  });

  it("reports self-executing ownership after a mediated provider falls back", async () => {
    const provider = {
      id: "grok",
      getCapabilities: async () => ({
        toolMediation: "provider-permission-rpc",
        policyEnforceable: true,
      }),
      createSession: async () => {
        throw new Error("acp spawn failed");
      },
    } as never;
    const fallback = {
      executesOwnTools: true,
      async run(options: {
        onEvent: (event: NormalizedEngineEvent) => Promise<"continue" | "abort">;
      }) {
        await options.onEvent({ type: "done", summary: "fallback done" });
      },
      async cancel() {},
    } as never;
    const engine = createAgentProviderEngine(provider, { fallbackEngine: fallback });

    await engine.run({
      task: task("fallback ownership", ["/tmp"]),
      systemPreamble: "",
      onEvent: async () => "continue",
    });

    expect(engine.executesOwnTools).toBe(true);
  });

  it("opens an engine-wide circuit after provider session initialization fails", async () => {
    const fallbackRuns: string[] = [];
    const createSession = vi.fn(async () => {
      throw new Error("ACP initialization timed out");
    });
    const provider = {
      id: "grok",
      getCapabilities: async () => ({
        toolMediation: "provider-permission-rpc",
        policyEnforceable: true,
      }),
      createSession,
    } as never;
    const fallback = {
      executesOwnTools: true,
      async run(options: { task: Task }) {
        fallbackRuns.push(options.task.id);
      },
      async cancel() {},
    } as never;
    const engine = createAgentProviderEngine(provider, {
      fallbackEngine: fallback,
      executesOwnTools: true,
    });
    const onEvent = async () => "continue" as const;

    await engine.run({
      task: task("first", ["/tmp"], "task-a"),
      systemPreamble: "",
      onEvent,
    });
    await engine.run({
      task: task("second", ["/tmp"], "task-b"),
      systemPreamble: "",
      onEvent,
    });

    expect(createSession).toHaveBeenCalledTimes(1);
    expect(fallbackRuns).toEqual(["task-a", "task-b"]);
  });

  it("resolves executesOwnTools=false from gateway-mediated Fake caps", async () => {
    const engine = createAgentProviderEngine(new FakeAgentProvider());
    // Before run: default true until caps resolve
    expect(engine.executesOwnTools).toBe(true);
    await engine.run({
      task: task("caps", ["/tmp"]),
      systemPreamble: "",
      onEvent: async () => "continue",
    });
    // FakeAgentProvider: toolMediation gateway + policyEnforceable ⇒ runner mediates
    expect(engine.executesOwnTools).toBe(false);
  });

  it("resolves executesOwnTools=true when toolMediation is uncontrolled", async () => {
    const provider = stubProvider({
      caps: {
        sessions: "resume",
        toolMediation: "uncontrolled",
        sandboxProfiles: [],
        supportsMcp: false,
        supportsUsage: false,
        supportsArtifacts: false,
        modalities: ["text"],
        policyEnforceable: false,
      },
    });
    const engine = createAgentProviderEngine(provider);
    await engine.run({
      task: task("uncontrolled", ["/tmp"]),
      systemPreamble: "",
      onEvent: async () => "continue",
    });
    expect(engine.executesOwnTools).toBe(true);
  });

  it("reuses AgentSession across follow-up runs for the same task id", async () => {
    let createCount = 0;
    const provider: AgentProvider = {
      id: "reuse",
      async probe() {
        return {
          ok: true,
          providerId: "reuse",
          version: "0",
          authenticated: true,
        };
      },
      async listModels() {
        return [
          {
            id: "fake-fast",
            displayName: "R",
            providerId: "reuse",
            modalities: ["text"],
          },
        ];
      },
      async getCapabilities() {
        return {
          sessions: "resume",
          toolMediation: "gateway",
          sandboxProfiles: [],
          supportsMcp: false,
          supportsUsage: false,
          supportsArtifacts: false,
          modalities: ["text"],
          policyEnforceable: true,
        };
      },
      async createSession(input) {
        createCount += 1;
        const binding: ProviderSessionBinding = {
          providerId: "reuse",
          providerSessionId: `s-${createCount}`,
          modelId: input.ref.modelId,
          createdAt: new Date().toISOString(),
        };
        return {
          binding,
          async runTurn(turn, sink) {
            await sink({
              type: "message",
              role: "assistant",
              text: `${binding.providerSessionId}:${turn.goal}`,
              channel: "text",
            });
            await sink({ type: "done", summary: "ok" });
            return { status: "done", summary: "ok" };
          },
          async cancel() {},
        };
      },
      async resumeSession() {
        throw new Error("resume not used");
      },
    };
    const engine = createAgentProviderEngine(provider, {
      executesOwnTools: false,
    });
    const t = task("first", ["/tmp"], "same-task");
    const texts: string[] = [];
    const collect = async (ev: NormalizedEngineEvent) => {
      if (ev.type === "message") texts.push(ev.text);
      return "continue" as const;
    };
    await engine.run({ task: t, systemPreamble: "", onEvent: collect });
    await engine.run({
      task: { ...t, goal: "second" },
      systemPreamble: "",
      onEvent: collect,
    });
    expect(createCount).toBe(1);
    expect(texts[0]).toContain("s-1:first");
    expect(texts[1]).toContain("s-1:second");
  });

  it("emits error when provider turn fails without done event", async () => {
    const provider = stubProvider({
      caps: {
        sessions: "stateless",
        toolMediation: "gateway",
        sandboxProfiles: [],
        supportsMcp: false,
        supportsUsage: false,
        supportsArtifacts: false,
        modalities: ["text"],
        policyEnforceable: true,
      },
      runTurn: async () => ({
        status: "failed",
        summary: "provider boom",
      }),
    });
    const engine = createAgentProviderEngine(provider, {
      executesOwnTools: false,
    });
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("fail", ["/tmp"]),
      systemPreamble: "",
      onEvent: async (ev) => {
        events.push(ev);
        return "continue";
      },
    });
    expect(
      events.some(
        (e) => e.type === "error" && e.message.includes("provider boom"),
      ),
    ).toBe(true);
  });

  it("synthesizes done when success result has no done event", async () => {
    const provider = stubProvider({
      caps: {
        sessions: "stateless",
        toolMediation: "gateway",
        sandboxProfiles: [],
        supportsMcp: false,
        supportsUsage: false,
        supportsArtifacts: false,
        modalities: ["text"],
        policyEnforceable: true,
      },
      runTurn: async (_input, sink) => {
        await sink({
          type: "message",
          role: "assistant",
          text: "partial",
          channel: "text",
        });
        return { status: "done", summary: "implicit done" };
      },
    });
    const engine = createAgentProviderEngine(provider, {
      executesOwnTools: false,
    });
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("implicit", ["/tmp"]),
      systemPreamble: "",
      onEvent: async (ev) => {
        events.push(ev);
        return "continue";
      },
    });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });

  it("cancel prevents further work", async () => {
    const provider = new FakeAgentProvider();
    const engine = new AgentProviderEngine({
      provider,
      executesOwnTools: false,
    });
    const t = task("cancel me", ["/tmp"]);
    const p = engine.run({
      task: t,
      systemPreamble: "",
      onEvent: async () => "continue",
    });
    await engine.cancel(t.id);
    await p;
  });

  it("TaskRunner completes a task via AgentProviderEngine + registry preflight", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gd-ape-"));
    const db = openDatabase(path.join(dir, "t.sqlite"));
    const tasks = new TaskService(db);
    const runs = new RunAttemptService(db);
    const receipts = new OperationReceiptService(db);
    const reg = createDefaultProviderRegistry({ includeFake: true });
    const engine = createAgentProviderEngine(reg.require("fake"), {
      executesOwnTools: false,
    });
    const runner = new TaskRunner(tasks, new AuditService(db), engine, {
      runAttempts: runs,
      operationReceipts: receipts,
      providerPreflight: createProviderPreflight(reg, {
        defaultProviderId: "fake",
      }),
    });
    const created = tasks.create({
      goal: "bridge goal",
      workspaceRoots: [dir],
      model: "fake-fast",
      allowShell: true,
      allowNetworkTools: true,
      approvalMode: "balanced",
    });
    runs.create(created.id);
    await runner.start(created.id);
    expect(tasks.get(created.id)?.status).toBe("done");
    const events = tasks.listEvents(created.id);
    expect(
      events.some(
        (e) =>
          e.kind === "message" &&
          String(e.payload.text ?? "").includes("bridge goal"),
      ),
    ).toBe(true);
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("AgentProvider dual-path product contract", () => {
  it("documents opt-in env only — default composition does not require env", () => {
    // Gateway.start uses createAgentProviderEngine only when
    // process.env.GROKDESK_PROVIDER_ENGINE === "1". Unset ⇒ engine-grok.
    expect(process.env.GROKDESK_PROVIDER_ENGINE).not.toBe("1");
  });
});


describe("AgentProviderEngine T3 protection honesty", () => {
  const acpCaps: ProviderCapabilities = {
    sessions: "resume",
    toolMediation: "provider-permission-rpc",
    // Static target caps always list sandbox profiles — must NOT drive T3.
    sandboxProfiles: ["workspace", "read-only", "none"],
    supportsMcp: true,
    supportsUsage: true,
    supportsArtifacts: true,
    modalities: ["text"],
    policyEnforceable: true,
  };

  it("session_meta.protection omits sandbox when supportsSandbox is false (probe)", async () => {
    const engine = createAgentProviderEngine(
      stubProvider({ caps: acpCaps }),
      { supportsSandbox: false, executesOwnTools: true },
    );
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("hello", ["/ws"]),
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e);
        return "continue";
      },
    });
    const meta = events.find((e) => e.type === "session_meta");
    expect(meta).toBeDefined();
    if (meta?.type !== "session_meta" || !meta.protection) {
      throw new Error("expected session_meta.protection");
    }
    expect(meta.protection.supportsSandbox).toBe(false);
    expect(meta.protection.spawnArgs).not.toContain("--sandbox");
    // Same as pure ACP helper for equal SessionInput+probe
    const { acpSpawnArgsForSession } = await import("./acp-transport-factory.js");
    const expected = acpSpawnArgsForSession(
      {
        ref: { providerId: "stub", modelId: "fake-fast" },
        cwd: "/ws",
        workspaceRoots: ["/ws"],
        policy: {
          version: "1",
          approvalMode: "balanced",
          workspaceRoots: ["/ws"],
          capabilities: [
            { id: "shell", decision: "ask" },
            { id: "network", decision: "allow" },
          ],
        },
        inheritUserConfig: false,
      },
      { supportsSandbox: false },
    );
    expect(meta.protection.spawnArgs).toEqual(expected);
  });

  it("session_meta.protection includes sandbox when supportsSandbox is true", async () => {
    const engine = createAgentProviderEngine(
      stubProvider({ caps: acpCaps }),
      { supportsSandbox: true, executesOwnTools: true },
    );
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("hello", ["/ws"]),
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e);
        return "continue";
      },
    });
    const meta = events.find((e) => e.type === "session_meta");
    expect(meta?.type).toBe("session_meta");
    if (meta?.type !== "session_meta" || !meta.protection) {
      throw new Error("expected protection");
    }
    expect(meta.protection.supportsSandbox).toBe(true);
    expect(meta.protection.spawnArgs).toContain("--sandbox");
    // Static caps would always claim sandbox — prove we used the probe flag
    // by also checking omit path is distinct when false (covered above).
  });

  it("defaults supportsSandbox to false (fail closed) when option omitted", async () => {
    const engine = createAgentProviderEngine(stubProvider({ caps: acpCaps }));
    const events: NormalizedEngineEvent[] = [];
    await engine.run({
      task: task("hello", ["/ws"]),
      systemPreamble: "",
      onEvent: async (e) => {
        events.push(e);
        return "continue";
      },
    });
    const meta = events.find((e) => e.type === "session_meta");
    if (meta?.type !== "session_meta" || !meta.protection) {
      throw new Error("expected protection");
    }
    expect(meta.protection.supportsSandbox).toBe(false);
    expect(meta.protection.spawnArgs).not.toContain("--sandbox");
  });
});
