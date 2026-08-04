/**
 * Pure helpers for missing / unavailable local artifact presentation.
 * Keeps media loaders from treating raw ENOENT / 500 body text as content.
 */

/** Classify a load failure as a missing file vs other error. */
export function isArtifactMissingError(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const s = detail.toLowerCase();
  return (
    s.includes("file not found") ||
    s.includes("enoent") ||
    s.includes("no such file") ||
    s.includes("path no longer exists") ||
    s.includes("unknown asset token") ||
    /:\s*404\b/.test(s) ||
    /\b404\b/.test(s) ||
    s.includes("failed: 404") ||
    s.includes("fetch failed: 404") ||
    s.includes("fetch failed: 500") // protocol serve failure often means gone
  );
}

export type ArtifactAvailability =
  | "available"
  | "missing"
  | "error"
  | "unknown";

/**
 * Availability from a successful prepare/read vs thrown error message.
 */
export function artifactAvailabilityFromLoad(input: {
  ok: boolean;
  errorMessage?: string | null;
}): ArtifactAvailability {
  if (input.ok) return "available";
  if (isArtifactMissingError(input.errorMessage)) return "missing";
  if (input.errorMessage) return "error";
  return "unknown";
}

/**
 * Caption / summary copy for a completed deliverable.
 * Never claims the file is still saved when it is missing.
 */
export function deliverableAvailabilityCaption(input: {
  availability: ArtifactAvailability;
  availableLabel: string;
  missingLabel: string;
  errorLabel: string;
}): string {
  switch (input.availability) {
    case "missing":
      return input.missingLabel;
    case "error":
      return input.errorLabel;
    case "available":
    case "unknown":
    default:
      return input.availableLabel;
  }
}

/**
 * Parent directory of an absolute path for reveal-parent actions.
 * Returns null when parent is empty or same as path.
 */
export function artifactParentPath(filePath: string | null | undefined): string | null {
  if (!filePath?.trim()) return null;
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return null;
  const parent = normalized.slice(0, idx);
  return parent || null;
}

/**
 * Whether task completion summary should claim a saved file on disk.
 */
export function shouldClaimSavedFile(availability: ArtifactAvailability): boolean {
  return availability === "available" || availability === "unknown";
}

/**
 * Soften historical "Saved N file(s) under …" status lines when the asset is
 * known missing so completed-task headers do not overclaim files still on disk.
 */
export function softenSavedFileStatus(
  status: string | null | undefined,
  filesMissing: boolean,
): string | null {
  if (!status) return status ?? null;
  if (!filesMissing) return status;
  if (/^Saved\s+\d+\s+image\/video\s+file/i.test(status.trim())) {
    return status
      .replace(/^Saved/i, "Produced")
      .replace(/\s+under\s+.+$/i, " (file no longer on disk)");
  }
  if (/^Saved\s+\d+\s+file/i.test(status.trim())) {
    return status
      .replace(/^Saved/i, "Produced")
      .replace(/\s+under\s+.+$/i, " (file no longer on disk)");
  }
  return status;
}
