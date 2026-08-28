import { describe, expect, it } from "vitest";
import {
  decodeWorkflowPayload,
  foldWorkflowRun,
  workflowControlPrompt,
} from "./workflow-update.js";

const payload = {
  title: "workflow_update",
  handle: "deep-research-2",
  objective: "Compare Postgres 17 and MySQL 9",
  current_phase: "Sources",
  phases: ["Plan", "Sources", "Write-up"],
  agents: [
    { id: "a1", label: "Scout", status: "running", summary: "Reading docs" },
    { id: "a2", label: "Skeptic", status: "idle" },
  ],
  agents_used: 2,
  agents_reserved: 1,
  agent_budget: 8,
  last_event: "Scout started Sources",
};

describe("foldWorkflowRun", () => {
  it("projects phases, agents, and remaining budget from WorkflowUpdated", () => {
    const view = foldWorkflowRun([
      { kind: "step", payload },
    ]);
    expect(view?.handle).toBe("deep-research-2");
    expect(view?.objective).toBe("Compare Postgres 17 and MySQL 9");
    expect(view?.currentPhase).toBe("Sources");
    expect(view?.phases.map((p) => p.title)).toEqual([
      "Plan",
      "Sources",
      "Write-up",
    ]);
    expect(view?.phases.find((p) => p.active)?.title).toBe("Sources");
    expect(view?.agents[0]).toMatchObject({
      label: "Scout",
      status: "running",
      summary: "Reading docs",
    });
    expect(view?.agentsUsed).toBe(2);
    expect(view?.agentsReserved).toBe(1);
    expect(view?.remaining).toBe(6);
    expect(view?.status).toBe("running");
  });

  it("marks paused when pause_message is set", () => {
    const view = decodeWorkflowPayload({
      ...payload,
      pause_message: "Waiting for you to continue",
    });
    expect(view?.status).toBe("paused");
    expect(view?.pauseMessage).toBe("Waiting for you to continue");
  });

  it("ignores unrelated steps", () => {
    expect(
      foldWorkflowRun([
        { kind: "step", payload: { title: "session_status" } },
      ]),
    ).toBeNull();
  });
});

describe("workflowControlPrompt", () => {
  it("builds /workflow pause|resume|stop with the run handle", () => {
    expect(workflowControlPrompt("pause", "deep-research-2")).toBe(
      "/workflow pause deep-research-2",
    );
    expect(workflowControlPrompt("stop", "workflow")).toBe("/workflow stop");
  });
});
