import {
  MAX_ATTACHMENTS,
  attachmentKindForName,
  type TaskAttachment,
} from "@grokdesk/shared";

export type ClientAttachment = TaskAttachment;

export function addPathsToAttachments(
  current: ClientAttachment[],
  paths: string[],
): { items: ClientAttachment[]; error?: string } {
  const next = [...current];
  const seen = new Set(next.map((a) => a.sourcePath));
  let error: string | undefined;
  for (const p of paths) {
    if (next.length >= MAX_ATTACHMENTS) {
      // Stable code — UI maps via t("composer.maxAttachments")
      error = "max_attachments";
      break;
    }
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const name = p.split(/[/\\]/).pop() || "file";
    next.push({
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name,
      sourcePath: p,
      kind: attachmentKindForName(name),
    });
  }
  return { items: next, error };
}

export function removeAttachment(
  current: ClientAttachment[],
  id: string,
): ClientAttachment[] {
  return current.filter((a) => a.id !== id);
}

export function toTaskAttachments(
  items: ClientAttachment[],
): TaskAttachment[] {
  return items.map(
    ({ id, name, sourcePath, kind, stagedPath, mime, sizeBytes }) => ({
      id,
      name,
      sourcePath,
      kind,
      stagedPath,
      mime,
      sizeBytes,
    }),
  );
}

/** Read an image File/Blob to a base64 string (no data: prefix). */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

export function imageExtFromMime(mime: string): string {
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}
