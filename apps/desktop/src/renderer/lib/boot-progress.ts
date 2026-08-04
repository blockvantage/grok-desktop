export const BOOT_STAGES = [
  "starting",
  "loading_workspace",
  "restoring_session",
  "ready",
] as const;

export type BootStage = (typeof BOOT_STAGES)[number];

const PROGRESS: Record<BootStage, number> = {
  starting: 14,
  loading_workspace: 46,
  restoring_session: 82,
  ready: 100,
};

/** Determinate progress backed by completed startup milestones. */
export function bootProgress(stage: BootStage): number {
  return PROGRESS[stage];
}
