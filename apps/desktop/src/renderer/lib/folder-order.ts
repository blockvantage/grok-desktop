/**
 * Persist sidebar folder order keys in localStorage with hard bounds.
 */

export const FOLDER_ORDER_STORAGE_KEY = "grokdesk.folderOrder.v1";
export const MAX_FOLDER_ORDER_ENTRIES = 64;
export const MAX_FOLDER_ORDER_KEY_CHARS = 512;
export const MAX_FOLDER_ORDER_RAW_CHARS = 32_768;

/** Pure parse for tests and sidebar load. */
export function parseFolderOrderRaw(raw: string | null): string[] {
  if (!raw || raw.length > MAX_FOLDER_ORDER_RAW_CHARS) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const x of parsed) {
      if (typeof x !== "string") continue;
      const t = x.trim().slice(0, MAX_FOLDER_ORDER_KEY_CHARS);
      if (!t) continue;
      out.push(t);
      if (out.length >= MAX_FOLDER_ORDER_ENTRIES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function capFolderOrder(order: string[]): string[] {
  return order
    .filter((x) => typeof x === "string" && x.trim())
    .map((x) => x.trim().slice(0, MAX_FOLDER_ORDER_KEY_CHARS))
    .slice(0, MAX_FOLDER_ORDER_ENTRIES);
}
