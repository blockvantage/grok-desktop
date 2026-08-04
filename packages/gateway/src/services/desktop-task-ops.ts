/**
 * Desktop control grant IPC orchestration (Phase 6 extract from Gateway dispatch).
 * Host bridge calls are injected; pure grant storage lives on TaskRunner.
 */

export type DesktopGrant = {
  granted: boolean;
  displayId: string | null;
};

export interface DesktopTaskOpsDeps {
  getGrant(taskId: string): DesktopGrant;
  setGrant(
    taskId: string,
    granted: boolean,
    displayId?: string | null,
  ): void;
  threadRootId(taskId: string): string;
  getMachineSettings(): unknown;
  desktopGetStatus(
    rootTaskId: string,
  ): Promise<{ softPaused?: boolean } | null | undefined>;
  desktopConfigure(input: {
    taskId: string;
    granted: boolean;
    displayId: string | null;
    machine: unknown;
    clearSoftPause?: boolean;
  }): Promise<unknown>;
}

export async function getDesktopTaskGrant(
  taskId: string,
  deps: DesktopTaskOpsDeps,
): Promise<DesktopGrant & { softPaused: boolean }> {
  const g = deps.getGrant(taskId);
  let softPaused = false;
  try {
    const root = deps.threadRootId(taskId);
    const st = await deps.desktopGetStatus(root);
    softPaused = Boolean(st?.softPaused);
  } catch {
    /* host optional */
  }
  return { ...g, softPaused };
}

export async function setDesktopTaskGrant(
  input: {
    taskId: string;
    granted: boolean;
    displayId?: string | null;
  },
  deps: DesktopTaskOpsDeps,
): Promise<{ ok: true } & DesktopGrant> {
  deps.setGrant(input.taskId, input.granted, input.displayId);
  const machine = deps.getMachineSettings();
  const root = deps.threadRootId(input.taskId);
  try {
    await deps.desktopConfigure({
      taskId: root,
      granted: input.granted,
      displayId: input.displayId ?? null,
      machine,
    });
  } catch {
    // host may be null in tests
  }
  return { ok: true, ...deps.getGrant(input.taskId) };
}

export async function resumeDesktopTask(
  taskId: string,
  deps: DesktopTaskOpsDeps,
): Promise<{ ok: true } & DesktopGrant & { softPaused: false }> {
  const g = deps.getGrant(taskId);
  const machine = deps.getMachineSettings();
  const root = deps.threadRootId(taskId);
  try {
    await deps.desktopConfigure({
      taskId: root,
      granted: g.granted,
      displayId: g.displayId,
      machine,
      clearSoftPause: true,
    });
  } catch {
    /* ignore */
  }
  return { ok: true, ...g, softPaused: false };
}
