export type ApprovalActionTarget = {
  taskId: string;
  approvalId: string;
};

export type ApprovalDecision = "approve" | "reject";
export type ApprovalBusyState = Readonly<Record<string, ApprovalDecision>>;

export function approvalActionKey(target: ApprovalActionTarget): string {
  return `${encodeURIComponent(target.taskId)}:${encodeURIComponent(target.approvalId)}`;
}

export function beginApprovalBusy(
  state: ApprovalBusyState,
  target: ApprovalActionTarget,
  decision: ApprovalDecision,
): ApprovalBusyState {
  return { ...state, [approvalActionKey(target)]: decision };
}

export function endApprovalBusy(
  state: ApprovalBusyState,
  target: ApprovalActionTarget,
): ApprovalBusyState {
  const key = approvalActionKey(target);
  if (!(key in state)) return state;
  const next = { ...state };
  delete next[key];
  return next;
}

export function busyDecisionForApproval(
  state: ApprovalBusyState,
  target: ApprovalActionTarget | null,
): ApprovalDecision | null {
  return target ? state[approvalActionKey(target)] ?? null : null;
}

type FocusTarget = { focus: () => void } | null | undefined;
type ApprovalFocusElement = {
  dataset: { taskId?: string; approvalId?: string };
  focus: () => void;
  scrollIntoView?: (options?: unknown) => void;
};

export function focusApprovalTarget(
  root: {
    querySelectorAll: (selector: string) => Iterable<ApprovalFocusElement>;
  } | null | undefined,
  target: ApprovalActionTarget,
): boolean {
  if (!root) return false;
  const elements = root.querySelectorAll("[data-approval-focus-target]");
  for (const element of elements) {
    if (
      element.dataset.taskId === target.taskId &&
      element.dataset.approvalId === target.approvalId
    ) {
      element.scrollIntoView?.({ block: "center", behavior: "smooth" });
      element.focus();
      return true;
    }
  }
  return false;
}

export function restoreApprovalActionFocus(
  element: ({ disabled: boolean; focus: () => void } | null | undefined),
  schedule: (callback: () => void) => void,
): void {
  if (!element) return;
  let attempts = 0;
  const attempt = () => {
    attempts += 1;
    if (element.disabled && attempts < 5) {
      schedule(attempt);
      return;
    }
    if (!element.disabled) element.focus();
  };
  schedule(attempt);
}

export function approvalTargetForTurn(input: {
  taskId: string;
  approval: { approvalId?: unknown } | null;
}): ApprovalActionTarget | null {
  const approvalId = input.approval?.approvalId;
  return typeof approvalId === "string" && approvalId.trim()
    ? { taskId: input.taskId, approvalId: approvalId.trim() }
    : null;
}

export async function runApprovalAction(input: {
  target: ApprovalActionTarget;
  action: (target: ApprovalActionTarget) => void | Promise<void>;
  actionElement?: FocusTarget;
  turnElement?: FocusTarget;
  announce: (message: string) => void;
}): Promise<boolean> {
  try {
    await input.action(input.target);
    input.turnElement?.focus();
    return true;
  } catch (error) {
    input.announce(
      error instanceof Error ? error.message : "Approval action failed",
    );
    return false;
  }
}
