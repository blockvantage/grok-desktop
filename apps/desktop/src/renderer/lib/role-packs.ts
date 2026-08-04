import type { EffortLevel, RolePack } from "@grokdesk/shared";

export const ROLE_PACK_STORAGE_KEY = "grokdesk.lastRolePackId";

/**
 * Resolve pack id for create.
 * - `selected === undefined` → fall back to lastUsed (boot / no UI state yet)
 * - `selected === null` → explicit General (no pack)
 * - `selected` string → that pack
 */
export function resolveCreateRolePack(
  selected: string | null | undefined,
  lastUsed: string | null,
): string | null {
  if (selected !== undefined) return selected;
  return lastUsed ?? null;
}

/** If the user never left "normal", adopt the pack default effort. */
export function packEffortIfUnset(
  current: EffortLevel,
  packDefault: EffortLevel | undefined,
): EffortLevel {
  if (current !== "normal" || !packDefault) return current;
  return packDefault;
}

export function readLastRolePackId(): string | null {
  try {
    const v = localStorage.getItem(ROLE_PACK_STORAGE_KEY);
    if (!v) return null;
    const id = v.trim().slice(0, 128);
    return id || null;
  } catch {
    return null;
  }
}

export function writeLastRolePackId(id: string | null): void {
  try {
    if (!id) localStorage.removeItem(ROLE_PACK_STORAGE_KEY);
    else localStorage.setItem(ROLE_PACK_STORAGE_KEY, id.trim().slice(0, 128));
  } catch {
    /* ignore */
  }
}

export function findPack(
  packs: RolePack[],
  id: string | null,
): RolePack | undefined {
  if (!id) return undefined;
  return packs.find((p) => p.id === id);
}
