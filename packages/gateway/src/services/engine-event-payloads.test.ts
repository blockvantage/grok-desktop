import { describe, it, expect } from "vitest";
import {
  RUN_PROGRESS_TITLE_MAX,
  messageEventPayload,
  runProgressStepPayload,
  stepEventPayload,
  toolRequestEventPayload,
  toolResultEventPayload,
  toolResultDeniedPayload,
  toolResultUserRejectedPayload,
  artifactCreatedEventPayload,
  errorEventPayload,
  doneSummaryMessagePayload,
  workerEventPayload,
} from "./engine-event-payloads.js";

describe("engine-event-payloads", () => {
  it("messageEventPayload defaults channel to text", () => {
    expect(
      messageEventPayload({
        type: "message",
        role: "assistant",
        text: "hi",
      }),
    ).toEqual({ role: "assistant", text: "hi", channel: "text" });
    expect(
      messageEventPayload({
        type: "message",
        role: "assistant",
        text: "t",
        channel: "thought",
      }).channel,
    ).toBe("thought");
  });

  it("runProgressStepPayload truncates title and uses status start", () => {
    const long = "x".repeat(RUN_PROGRESS_TITLE_MAX + 50);
    const p = runProgressStepPayload({ type: "run_progress", message: long });
    expect(p.title).toHaveLength(RUN_PROGRESS_TITLE_MAX);
    expect(p.status).toBe("start");
  });

  it("stepEventPayload copies title and status", () => {
    expect(
      stepEventPayload({ type: "step", title: "Planning", status: "end" }),
    ).toEqual({ title: "Planning", status: "end" });
  });

  it("tool request/result and deny/reject payloads", () => {
    const req = {
      type: "tool_request" as const,
      id: "t1",
      tool: "shell" as const,
      command: "ls",
      path: "/tmp",
      meta: { a: 1 },
    };
    expect(toolRequestEventPayload(req)).toEqual({
      id: "t1",
      tool: "shell",
      path: "/tmp",
      command: "ls",
      meta: { a: 1 },
    });
    expect(toolResultDeniedPayload(req, "blocked")).toEqual({
      id: "t1",
      ok: false,
      output: "blocked",
    });
    expect(toolResultUserRejectedPayload(req)).toEqual({
      id: "t1",
      ok: false,
      output: "User rejected",
    });
    expect(
      toolResultEventPayload({
        type: "tool_result",
        id: "t1",
        ok: true,
        output: "ok",
      }),
    ).toEqual({ id: "t1", ok: true, output: "ok" });
  });

  it("artifact and error payloads", () => {
    expect(
      artifactCreatedEventPayload(
        {
          type: "artifact",
          title: "Report",
          path: "/ws/r.md",
          kind: "report",
        },
        "art-1",
      ),
    ).toEqual({
      id: "art-1",
      title: "Report",
      path: "/ws/r.md",
      kind: "report",
    });
    expect(
      errorEventPayload({ type: "error", message: "boom" }),
    ).toEqual({ message: "boom" });
  });

  it("doneSummaryMessagePayload gates on usefulness", () => {
    expect(
      doneSummaryMessagePayload("  final answer  ", () => true),
    ).toEqual({
      role: "assistant",
      text: "final answer",
      channel: "text",
    });
    expect(doneSummaryMessagePayload("noise", () => false)).toBeNull();
  });

  it("workerEventPayload preserves supplied worker identity and semantic fields", () => {
    expect(
      workerEventPayload({
        type: "worker_started",
        workerId: "w1",
        label: "Research",
        objective: "Find evidence",
        parentWorkerId: "lead-1",
      }),
    ).toEqual({
      workerId: "w1",
      label: "Research",
      objective: "Find evidence",
      parentWorkerId: "lead-1",
    });

    expect(
      workerEventPayload({
        type: "worker_message",
        workerId: "w1",
        text: "Found three sources",
      }),
    ).toEqual({
      workerId: "w1",
      text: "Found three sources",
    });
  });

  it("workerEventPayload omits undefined optional fields", () => {
    expect(
      workerEventPayload({ type: "worker_completed", workerId: "w1" }),
    ).toEqual({ workerId: "w1" });
  });
});
