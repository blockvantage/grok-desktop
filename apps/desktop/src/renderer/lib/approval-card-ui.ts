/**
 * Desktop binding for I4 approval what/where/why (shared projector).
 */
import {
  projectApprovalCard,
  type ApprovalCardProjection,
} from "@grokdesk/shared";

export type ApprovalCardView = ApprovalCardProjection & {
  /** Whether where line should render. */
  showWhere: boolean;
  /** Whether once/always chips should render. */
  showScope: boolean;
};

export function projectApprovalCardView(
  payload: Record<string, unknown> | null | undefined,
): ApprovalCardView {
  const card = projectApprovalCard(payload);
  return {
    ...card,
    showWhere: card.where.length > 0,
    showScope: card.scope != null,
  };
}
