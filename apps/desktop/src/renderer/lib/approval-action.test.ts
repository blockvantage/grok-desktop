import { describe, expect, it, vi } from "vitest";
import {
  beginApprovalBusy,
  busyDecisionForApproval,
  endApprovalBusy,
  focusApprovalTarget,
  approvalTargetForTurn,
  restoreApprovalActionFocus,
  runApprovalAction,
} from "./approval-action";

describe("approval actions", () => {
  const turn = {
    taskId: "task-b",
    approval: { approvalId: "approval-b" },
  };

  it("targets the exact approval owned by the canonical turn", () => {
    expect(approvalTargetForTurn(turn)).toEqual({
      taskId: "task-b",
      approvalId: "approval-b",
    });
  });

  it("focuses the stable turn target after successful settlement", async () => {
    const action = vi.fn(async () => {});
    const actionFocus = vi.fn();
    const turnFocus = vi.fn();
    const announce = vi.fn();

    await expect(
      runApprovalAction({
        target: approvalTargetForTurn(turn)!,
        action,
        actionElement: { focus: actionFocus },
        turnElement: { focus: turnFocus },
        announce,
      }),
    ).resolves.toBe(true);
    expect(action).toHaveBeenCalledWith({
      taskId: "task-b",
      approvalId: "approval-b",
    });
    expect(turnFocus).toHaveBeenCalledOnce();
    expect(actionFocus).not.toHaveBeenCalled();
  });

  it("returns focus to the action and announces RPC failure", async () => {
    const actionFocus = vi.fn();
    const turnFocus = vi.fn();
    const announce = vi.fn();

    await expect(
      runApprovalAction({
        target: approvalTargetForTurn(turn)!,
        action: async () => {
          throw new Error("Approval service unavailable");
        },
        actionElement: { focus: actionFocus },
        turnElement: { focus: turnFocus },
        announce,
      }),
    ).resolves.toBe(false);
    expect(actionFocus).not.toHaveBeenCalled();
    expect(turnFocus).not.toHaveBeenCalled();
    expect(announce).toHaveBeenCalledWith("Approval service unavailable");
  });

  it("tracks overlapping approvals independently and clears only the exact key", () => {
    const a = { taskId: "task-a", approvalId: "approval-a" };
    const b = { taskId: "task-b", approvalId: "approval-b" };
    let busy = beginApprovalBusy({}, a, "approve");
    busy = beginApprovalBusy(busy, b, "reject");
    busy = endApprovalBusy(busy, a);

    expect(busyDecisionForApproval(busy, a)).toBeNull();
    expect(busyDecisionForApproval(busy, b)).toBe("reject");
  });

  it("focuses the exact earlier approval rather than the latest turn", () => {
    let active: string | null = null;
    const elements = [
      {
        dataset: { taskId: "task-a", approvalId: "approval-a" },
        focus: () => {
          active = "a";
        },
        scrollIntoView: vi.fn(),
      },
      {
        dataset: { taskId: "task-b", approvalId: "approval-b" },
        focus: () => {
          active = "b";
        },
        scrollIntoView: vi.fn(),
      },
    ];
    const root = { querySelectorAll: () => elements };

    expect(
      focusApprovalTarget(root, {
        taskId: "task-a",
        approvalId: "approval-a",
      }),
    ).toBe(true);
    expect(active).toBe("a");
  });

  it("restores rejection focus only after the button is enabled", () => {
    const documentState: { activeElement: unknown } = { activeElement: null };
    const button = {
      disabled: true,
      focus() {
        documentState.activeElement = this;
      },
    };
    let frame: (() => void) | null = null;

    restoreApprovalActionFocus(button, (callback) => {
      frame = callback;
    });
    expect(documentState.activeElement).toBeNull();
    button.disabled = false;
    (frame as unknown as () => void)();
    expect(documentState.activeElement).toBe(button);
  });
});
