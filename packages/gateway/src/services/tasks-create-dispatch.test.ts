import { describe, it, expect, vi } from "vitest";
import {
  buildTaskCreateFlowDeps,
  dispatchTasksCreate,
} from "./tasks-create-dispatch.js";
import type { RequestContext } from "./request-context.js";
import type { CreateTaskInput } from "@grokdesk/shared";

const researcherPack = {
  id: "researcher",
  name: "Researcher",
  skills: ["web"],
  defaultEffort: "heavy" as const,
  standingInstructions: "Be thorough.",
};

function baseTask(overrides: { effort?: string } = {}) {
  return {
    id: "t1",
    goal: "hi",
    status: "queued",
    model: "m",
    effort: overrides.effort ?? "normal",
    parentTaskId: null,
    title: null,
    createdAt: "now",
    updatedAt: "now",
    policySnapshot: {
      workspaceRoots: ["/ws"],
      approvalMode: "balanced",
      allowShell: false,
      allowNetworkTools: false,
    },
  };
}

function makeDeps(opts: {
  lookupRolePack?: () => typeof researcherPack | null;
  onSubmit?: (input: CreateTaskInput) => void;
}) {
  return buildTaskCreateFlowDeps({
    dataDir: "/d",
    resolveWorkspaceRoots: () => ["/ws"],
    lookupRolePack: opts.lookupRolePack ?? (() => null),
    upsertStandingMemory: vi.fn(),
    submit: (input) => {
      opts.onSubmit?.(input);
      return {
        task: baseTask({ effort: input.effort }) as never,
        runAttempt: { id: "ra1", taskId: "t1", status: "queued" } as never,
        principalId: "desktop",
        correlation: {
          requestId: "r1",
          taskId: "t1",
          runAttemptId: "ra1",
        },
      };
    },
    appendSubmitReceipt: vi.fn(),
    conversation: {
      ensureForTask: vi.fn(() => "c1"),
      appendTurn: vi.fn(),
    },
    runWithMemory: vi.fn(),
    autoTitle: vi.fn(),
  });
}

const desktopCtx = {
  transport: "desktop",
  principalDeviceId: null,
  machineId: "m1",
  requestId: "r1",
} as RequestContext;

describe("buildTaskCreateFlowDeps", () => {
  it("returns the same bag", () => {
    const bag = {
      dataDir: "/d",
      resolveWorkspaceRoots: vi.fn(() => ["/ws"]),
      lookupRolePack: vi.fn(),
      upsertStandingMemory: vi.fn(),
      submit: vi.fn(),
      appendSubmitReceipt: vi.fn(),
      conversation: {
        ensureForTask: vi.fn(),
        appendTurn: vi.fn(),
      },
      runWithMemory: vi.fn(),
      autoTitle: vi.fn(),
    };
    expect(buildTaskCreateFlowDeps(bag)).toBe(bag);
  });
});

describe("dispatchTasksCreate", () => {
  it("returns task from executeTaskCreate path", () => {
    const deps = makeDeps({});
    const result = dispatchTasksCreate(
      { goal: "hi", model: "m", workspaceRoots: ["/ws"] },
      desktopCtx,
      deps,
    );
    expect((result as { id: string }).id).toBe("t1");
  });

  it("applies role-pack defaultEffort=heavy when effort was not explicit", () => {
    let submitted: CreateTaskInput | undefined;
    const deps = makeDeps({
      lookupRolePack: () => researcherPack,
      onSubmit: (input) => {
        submitted = input;
      },
    });
    // Mirrors post-parseIpcRequest shape: schema filled effort:"normal", no effortExplicit.
    dispatchTasksCreate(
      {
        goal: "research",
        model: "m",
        workspaceRoots: ["/ws"],
        effort: "normal",
        rolePack: "researcher",
      },
      desktopCtx,
      deps,
    );
    expect(submitted?.effort).toBe("heavy");
  });

  it("keeps explicit effort when effortExplicit is true", () => {
    let submitted: CreateTaskInput | undefined;
    const deps = makeDeps({
      lookupRolePack: () => researcherPack,
      onSubmit: (input) => {
        submitted = input;
      },
    });
    dispatchTasksCreate(
      {
        goal: "research",
        model: "m",
        workspaceRoots: ["/ws"],
        effort: "fast",
        effortExplicit: true,
        rolePack: "researcher",
      },
      desktopCtx,
      deps,
    );
    expect(submitted?.effort).toBe("fast");
  });

  it("resolves to normal when no pack and effort was not explicit", () => {
    let submitted: CreateTaskInput | undefined;
    const deps = makeDeps({
      lookupRolePack: () => null,
      onSubmit: (input) => {
        submitted = input;
      },
    });
    dispatchTasksCreate(
      {
        goal: "plain",
        model: "m",
        workspaceRoots: ["/ws"],
        effort: "normal",
      },
      desktopCtx,
      deps,
    );
    expect(submitted?.effort).toBe("normal");
  });
});
