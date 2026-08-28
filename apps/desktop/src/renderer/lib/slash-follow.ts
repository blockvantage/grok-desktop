/**
 * Pure helpers for applying slash commands in the follow-up composer
 * (Phase 6 extract from TaskWorkspaceView).
 */

export type SlashFollowCmd = {
  id: string;
  kind: string;
  effort?: string;
  goalKey?: string;
  action?: string;
};

export type SlashQueryLike = {
  args: string;
};

/**
 * Whether applying this slash should prompt for a folder (organize without root).
 */
export function shouldPickFolderForSlash(
  cmd: SlashFollowCmd,
  root: string | null | undefined,
): boolean {
  return cmd.id === "organize" && !root?.trim();
}

/**
 * Side-effect action id after a non-fill slash command.
 */
export function slashSideAction(
  cmd: SlashFollowCmd,
):
  | "pickFolder"
  | "openSchedule"
  | "openTools"
  | "openMemory"
  | "openRecipes"
  | "showBriefing"
  | "exportPack"
  | "compact"
  | "rewind"
  | "remember"
  | null {
  if (cmd.action === "pickFolder") return "pickFolder";
  if (cmd.action === "openSchedule") return "openSchedule";
  if (cmd.action === "openTools") return "openTools";
  if (cmd.action === "openMemory") return "openMemory";
  if (cmd.action === "openRecipes") return "openRecipes";
  if (cmd.action === "showBriefing") return "showBriefing";
  if (cmd.action === "exportPack") return "exportPack";
  if (cmd.action === "compact") return "compact";
  if (cmd.action === "rewind") return "rewind";
  if (cmd.action === "remember") return "remember";
  return null;
}
