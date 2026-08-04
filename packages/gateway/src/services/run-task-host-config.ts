/**
 * Pure host session IDs for TaskRunner.runTask (Phase 6 extract).
 * Browser and desktop computer-use share the chat-root session key.
 */

/**
 * One isolated browser/desktop session per chat root so follow-ups share pane.
 */
export function hostSessionIdsFromThreadRoot(threadRootId: string): {
  browserSessionId: string;
  desktopSessionId: string;
} {
  return {
    browserSessionId: threadRootId,
    desktopSessionId: threadRootId,
  };
}

/**
 * Desktop configure payload from machine settings + prior grant.
 */
export function desktopConfigureInput<M>(input: {
  desktopSessionId: string;
  granted: boolean;
  displayId: string | null;
  machine: M;
}): {
  taskId: string;
  granted: boolean;
  displayId: string | null;
  machine: M;
} {
  return {
    taskId: input.desktopSessionId,
    granted: input.granted,
    displayId: input.displayId,
    machine: input.machine,
  };
}
