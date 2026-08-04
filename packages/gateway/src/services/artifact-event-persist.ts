/**
 * Pure mapping from artifact_created task events → ArtifactService.create input
 * (Phase 6 extract from Gateway.start onEventAppended).
 */

export type ArtifactCreatedEventLike = {
  kind: string;
  taskId: string;
  payload: Record<string, unknown>;
};

export type ArtifactCreateInput = {
  taskId: string;
  title: string;
  kind: "file" | "report" | "media" | "card";
  path: string | null;
};

const ARTIFACT_KINDS = new Set(["file", "report", "media", "card"]);

/** Bound persisted artifact title/path from untrusted engine events. */
export const MAX_ARTIFACT_TITLE_CHARS = 512;
export const MAX_ARTIFACT_PATH_CHARS = 4_096;

/**
 * When the event is artifact_created, return create input; otherwise null.
 */
export function artifactCreateFromEvent(
  ev: ArtifactCreatedEventLike,
): ArtifactCreateInput | null {
  if (ev.kind !== "artifact_created") return null;
  const kindRaw = ev.payload.kind;
  const kind =
    typeof kindRaw === "string" && ARTIFACT_KINDS.has(kindRaw)
      ? (kindRaw as ArtifactCreateInput["kind"])
      : "file";
  let path: string | null =
    typeof ev.payload.path === "string" ? ev.payload.path : null;
  if (path != null) {
    path = path.trim();
    if (!path || path.length > MAX_ARTIFACT_PATH_CHARS) path = null;
  }
  let title =
    typeof ev.payload.title === "string" && ev.payload.title.trim()
      ? ev.payload.title.trim()
      : "Artifact";
  if (title.length > MAX_ARTIFACT_TITLE_CHARS) {
    title = title.slice(0, MAX_ARTIFACT_TITLE_CHARS);
  }
  return {
    taskId: ev.taskId,
    title,
    kind,
    path,
  };
}
