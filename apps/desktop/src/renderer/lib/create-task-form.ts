/**
 * Pure form assembly for App createTask (Phase 6 extract).
 */

export type CreateTaskFormPack = {
  id: string;
  defaultEffort?: string;
};

export type CreateTaskFormInput<TPack extends CreateTaskFormPack = CreateTaskFormPack> = {
  goal: string;
  root: string;
  model: string;
  effort: string;
  approvalMode: string;
  rolePackId: string | null;
  lastRolePackId: string | null;
  homeAttachments: unknown[];
  overrideGoal?: string;
  attachments?: unknown[];
  planFirst?: boolean;
  rolePacks: TPack[];
  resolveCreateRolePack: (
    rolePackId: string | null,
    last: string | null,
  ) => string | null;
  findPack: (
    packs: TPack[],
    id: string | null,
  ) => TPack | null | undefined;
  packEffortIfUnset: (effort: string, packDefault?: string) => string;
};

/**
 * Build the create-task form fields from App composer state.
 *
 * effortExplicit mirrors packEffortIfUnset: leaving the control at "normal"
 * is treated as unset so role-pack defaultEffort can apply (client + gateway).
 */
export function buildCreateTaskForm<TPack extends CreateTaskFormPack>(
  input: CreateTaskFormInput<TPack>,
): {
  goal: string;
  root: string;
  model: string;
  effort: string;
  /** True only when the user moved effort off the default "normal". */
  effortExplicit: boolean;
  approvalMode: string;
  rolePack: string | null;
  planFirst?: boolean;
  attachments: unknown[];
} {
  const g = (input.overrideGoal ?? input.goal).trim();
  const atts = input.attachments ?? input.homeAttachments;
  const resolvedPack = input.resolveCreateRolePack(
    input.rolePackId,
    input.lastRolePackId,
  );
  const pack = input.findPack(input.rolePacks, resolvedPack);
  // Capture user intent before packEffortIfUnset may rewrite "normal" → pack default.
  const effortExplicit = input.effort !== "normal";
  const effortForCreate = input.packEffortIfUnset(
    input.effort,
    pack?.defaultEffort,
  );
  return {
    goal: g,
    root: input.root,
    model: input.model,
    effort: effortForCreate,
    effortExplicit,
    approvalMode: input.approvalMode,
    rolePack: resolvedPack,
    ...(input.planFirst ? { planFirst: true } : {}),
    attachments: atts,
  };
}
