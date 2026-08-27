/**
 * Follow-up composer preview: mid-conversation settings apply to the next turn.
 */

export type NextReplyPreviewInput = {
  model: string;
  effort: string;
  approvalMode?: string;
  planFirst?: boolean;
  rolePackName?: string | null;
};

export type NextReplyPreview = {
  model: string;
  effort: string;
  parts: string[];
};

export function projectNextReplyPreview(
  input: NextReplyPreviewInput,
): NextReplyPreview {
  const model = input.model.trim() || "Grok";
  const effort = input.effort.trim() || "normal";
  const parts = [model, effort];
  if (input.planFirst) parts.push("plan first");
  if (input.approvalMode && input.approvalMode !== "balanced") {
    parts.push(input.approvalMode);
  }
  if (input.rolePackName?.trim()) parts.push(input.rolePackName.trim());
  return { model, effort, parts };
}

/** Interpolation bag for `workspace.nextReplyWillUse`. */
export function nextReplyWillUseParams(preview: NextReplyPreview): {
  summary: string;
} {
  return { summary: preview.parts.join(" · ") };
}
