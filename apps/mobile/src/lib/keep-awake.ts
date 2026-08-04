/**
 * Soft keep-awake while telepresence is live (P4).
 * Uses expo-keep-awake when installed; no-ops in Node/tests.
 */

let activeTag: string | null = null;

export async function setDeskKeepAwake(
  enabled: boolean,
  tag = "grok-desk-tele",
): Promise<{ active: boolean; mode: "native" | "noop" }> {
  if (!enabled) {
    if (activeTag) {
      try {
        const KeepAwake = await import("expo-keep-awake").catch(() => null);
        await KeepAwake?.deactivateKeepAwake?.(activeTag);
      } catch {
        /* ignore */
      }
      activeTag = null;
    }
    return { active: false, mode: "noop" };
  }
  try {
    const KeepAwake = await import("expo-keep-awake").catch(() => null);
    if (KeepAwake?.activateKeepAwakeAsync) {
      await KeepAwake.activateKeepAwakeAsync(tag);
      activeTag = tag;
      return { active: true, mode: "native" };
    }
    if (KeepAwake?.activateKeepAwake) {
      KeepAwake.activateKeepAwake(tag);
      activeTag = tag;
      return { active: true, mode: "native" };
    }
  } catch {
    /* fall through */
  }
  activeTag = tag;
  // Intent recorded even without native module (settings keepAwakeWhileDesk).
  return { active: true, mode: "noop" };
}

export function isKeepAwakeTagged(): boolean {
  return activeTag != null;
}
