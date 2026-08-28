/**
 * jsdom: pause/resume/stop on the workflow run panel (Phase 3.1).
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowRunPanel } from "./workflow-run-panel";
import type { WorkflowRunView } from "@grokdesk/shared";

vi.mock("@/i18n", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    if (key === "workflow.budgetLine") {
      return `${params?.used}/${params?.reserved} used · ${params?.remaining} left`;
    }
    if (key === "workflow.nowIn") return `Now: ${params?.phase}`;
    const map: Record<string, string> = {
      "workflow.title": "Team run",
      "workflow.pause": "Pause",
      "workflow.resume": "Resume",
      "workflow.stop": "Stop",
    };
    return map[key] ?? key;
  },
}));

const view: WorkflowRunView = {
  handle: "deep-research-2",
  objective: "Compare databases",
  currentPhase: "Sources",
  phases: [
    { id: "Plan", title: "Plan", active: false },
    { id: "Sources", title: "Sources", active: true },
  ],
  agents: [{ id: "a1", label: "Scout", status: "running", summary: "Reading" }],
  agentsUsed: 2,
  agentsReserved: 1,
  remaining: 6,
  pauseMessage: null,
  resultSummary: null,
  lastEvent: "Scout started",
  status: "running",
};

describe("WorkflowRunPanel", () => {
  it("highlights the active phase and reports remaining budget", () => {
    render(<WorkflowRunPanel view={view} />);
    expect(
      screen.getByTestId("workflow-run-panel").getAttribute("data-workflow-handle"),
    ).toBe("deep-research-2");
    const active = screen.getByText("Sources");
    expect(active.closest("[data-phase-active]")?.getAttribute("data-phase-active")).toBe(
      "true",
    );
    expect(screen.getByTestId("workflow-budget").textContent).toContain("6 left");
  });

  it("pauses the live run from the panel", async () => {
    const user = userEvent.setup();
    const onControl = vi.fn();
    render(<WorkflowRunPanel view={view} onControl={onControl} />);
    await user.click(screen.getByTestId("workflow-pause"));
    expect(onControl).toHaveBeenCalledWith("pause");
  });
});
