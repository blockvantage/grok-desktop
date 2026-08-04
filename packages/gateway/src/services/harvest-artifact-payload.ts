/**
 * Pure artifact_created payload for workspace harvest (Phase 6 extract).
 */

export type HarvestItemLike = {
  title: string;
  path: string;
  kind: "file" | "report" | "media" | "card";
  sizeBytes?: number;
  mime?: string;
};

export type HarvestArtifactPayload = HarvestItemLike & { id: string };

export function harvestArtifactCreatedPayload(
  item: HarvestItemLike,
  id: string,
): HarvestArtifactPayload {
  const payload: HarvestArtifactPayload = {
    id,
    title: item.title,
    path: item.path,
    kind: item.kind,
  };
  if (item.sizeBytes !== undefined) payload.sizeBytes = item.sizeBytes;
  if (item.mime !== undefined) payload.mime = item.mime;
  return payload;
}
