/**
 * Host-mediated write_file execution helpers (Phase 6 extract).
 * Used when engine.executesOwnTools is false (TestEngine / gateway-mediated).
 */

export type WriteFileToolEvent = {
  id: string;
  tool: string;
  path?: string;
  meta?: Record<string, unknown>;
};

/** Cap host-mediated write content so TestEngine paths cannot dump multi-GB. */
export const HOST_WRITE_FILE_MAX_CHARS = 2_000_000;

/**
 * Extract content string and byte length from a write_file tool request.
 * Returns null when tool is wrong, path missing, or content exceeds cap.
 */
export function writeFilePayload(event: WriteFileToolEvent): {
  content: string;
  bytes: number;
} | null {
  if (event.tool !== "write_file" || !event.path) return null;
  const content = String(event.meta?.content ?? "");
  if (content.length > HOST_WRITE_FILE_MAX_CHARS) return null;
  return { content, bytes: content.length };
}

export function writeFileSuccessOutput(path: string): string {
  return `wrote ${path}`;
}

export function writeFileReceiptDetail(
  path: string,
  bytes: number,
): Record<string, unknown> {
  return {
    tool: "write_file",
    path,
    bytes,
  };
}
