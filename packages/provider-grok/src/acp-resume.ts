/**
 * Feature-detected ACP resume path. Prefer session/resume, then session/load,
 * then a fresh session (caller supplies prior context).
 */
export type AcpResumePath = "resume" | "load" | "fresh_with_context";

export type AcpResumeCapabilities = {
  sessionCapabilities?: {
    resume?: boolean;
    load?: boolean;
    close?: boolean;
  };
  capabilities?: {
    loadSession?: boolean;
  };
};

export function chooseAcpResumePath(
  init: AcpResumeCapabilities | null | undefined,
): AcpResumePath {
  if (init?.sessionCapabilities?.resume === true) return "resume";
  if (
    init?.sessionCapabilities?.load === true ||
    init?.capabilities?.loadSession === true
  ) {
    return "load";
  }
  return "fresh_with_context";
}

export function acpResumeProgressMessage(path: AcpResumePath): string {
  switch (path) {
    case "resume":
      return "Resumed the previous session.";
    case "load":
      return "Loaded the previous session.";
    default:
      return "Started a new session with earlier conversation context.";
  }
}

export function runningPromptIdFromLoadResult(result: unknown): string | null {
  if (!result || typeof result !== "object") return null;
  const rec = result as Record<string, unknown>;
  const meta = rec._meta;
  if (meta && typeof meta === "object") {
    const id = (meta as Record<string, unknown>)["x.ai/runningPromptId"];
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  if (typeof rec.runningPromptId === "string" && rec.runningPromptId.trim()) {
    return rec.runningPromptId.trim();
  }
  return null;
}
