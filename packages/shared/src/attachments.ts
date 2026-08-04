/**
 * Pure helpers for chat task attachments (kind, size caps, prompt blocks).
 * No filesystem I/O — safe for renderer and gateway.
 */

export const MAX_ATTACHMENTS = 10;
export const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export type AttachmentKind = "image" | "file" | "audio";

export function attachmentKindForName(name: string): AttachmentKind {
  const n = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/.test(n)) return "image";
  if (/\.(wav|mp3|m4a|ogg|webm|aac)$/.test(n)) return "audio";
  return "file";
}

export function sanitizeAttachmentFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file";
  const cleaned = base.replace(/[^\w.\-]+/g, "-").replace(/^-+|-+$/g, "");
  // Reject pure dot segments (`.`, `..`, `...`) — path.join(dest, "..") would escape.
  if (!cleaned || /^\.+$/.test(cleaned)) return "file";
  return cleaned;
}

export function isAllowedAttachmentSize(
  kind: AttachmentKind,
  sizeBytes: number,
): boolean {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return false;
  if (kind === "image") return sizeBytes <= MAX_IMAGE_BYTES;
  if (kind === "audio") return sizeBytes <= MAX_AUDIO_BYTES;
  return sizeBytes <= MAX_FILE_BYTES;
}

export type AttachmentPromptInput = {
  id: string;
  name: string;
  sourcePath: string;
  kind: AttachmentKind;
  stagedPath?: string;
};

export function buildAttachmentsPromptBlock(
  items: AttachmentPromptInput[],
): string {
  if (!items.length) return "";
  const images = items.filter((i) => i.kind === "image");
  const files = items.filter((i) => i.kind === "file");
  const audio = items.filter((i) => i.kind === "audio");
  const lines: string[] = [];
  if (images.length) {
    lines.push("Attached images (in primary workspace):");
    for (const i of images) {
      lines.push(`- ${i.stagedPath || i.sourcePath}`);
    }
  }
  if (files.length) {
    lines.push("Attached files (read by path):");
    for (const i of files) lines.push(`- ${i.sourcePath}`);
  }
  if (audio.length) {
    lines.push("Attached audio:");
    for (const i of audio) {
      lines.push(`- ${i.stagedPath || i.sourcePath}`);
    }
  }
  return lines.join("\n");
}

export function mergeGoalWithAttachments(
  goal: string,
  items: AttachmentPromptInput[],
): string {
  const block = buildAttachmentsPromptBlock(items);
  if (!block) return goal;
  return `${goal.trim()}\n\n${block}`;
}
