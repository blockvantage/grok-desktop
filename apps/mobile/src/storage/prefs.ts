/**
 * Local mobile remote preferences (P3 Settings depth).
 * SecureStore on device; memory in Node/tests.
 */

export type MobileRemotePrefs = {
  /** Default telepresence quality when connecting Desk. */
  defaultQuality: "auto" | "smooth" | "crisp";
  /** Preferred display id (null = host primary / default). */
  preferredDisplayId: string | null;
  /** Keep stream active as PiP when leaving Desk tab. */
  pipEnabled: boolean;
  /** Soft keep-awake while telepresence is live (client-side intent flag). */
  keepAwakeWhileDesk: boolean;
  /** Surface home banner when new inbox items appear. */
  notifyInbox: boolean;
  /** Surface home banner for approval-needed stream events. */
  notifyApprovals: boolean;
  /** Require biometric unlock before showing paired UI (P4). */
  biometricLock: boolean;
  /** Last known inbox item ids for notification diff. */
  seenInboxIds: string[];
};

export const DEFAULT_PREFS: MobileRemotePrefs = {
  defaultQuality: "auto",
  preferredDisplayId: null,
  pipEnabled: true,
  keepAwakeWhileDesk: true,
  notifyInbox: true,
  notifyApprovals: true,
  biometricLock: false,
  seenInboxIds: [],
};

const KEY = "remote.prefs";
const mem = new Map<string, string>();

const DISPLAY_ID_MAX = 64;
const SEEN_INBOX_MAX = 200;
const SEEN_ID_MAX = 128;

function normalize(raw: unknown): MobileRemotePrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_PREFS };
  const o = raw as Partial<MobileRemotePrefs>;
  const q = o.defaultQuality;
  const display =
    typeof o.preferredDisplayId === "string" &&
    o.preferredDisplayId.length > 0 &&
    o.preferredDisplayId.length <= DISPLAY_ID_MAX
      ? o.preferredDisplayId
      : null;
  const seenInboxIds = Array.isArray(o.seenInboxIds)
    ? o.seenInboxIds
        .filter(
          (x): x is string =>
            typeof x === "string" && x.length > 0 && x.length <= SEEN_ID_MAX,
        )
        .slice(0, SEEN_INBOX_MAX)
    : [];
  return {
    defaultQuality:
      q === "auto" || q === "smooth" || q === "crisp" ? q : "auto",
    preferredDisplayId: display,
    pipEnabled: o.pipEnabled !== false,
    keepAwakeWhileDesk: o.keepAwakeWhileDesk !== false,
    notifyInbox: o.notifyInbox !== false,
    notifyApprovals: o.notifyApprovals !== false,
    biometricLock: o.biometricLock === true,
    seenInboxIds,
  };
}

async function setRaw(raw: string): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.setItemAsync) {
      await SecureStore.setItemAsync(KEY, raw);
      return;
    }
  } catch {
    /* fall through */
  }
  mem.set(KEY, raw);
}

async function getRaw(): Promise<string | null> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.getItemAsync) {
      return (await SecureStore.getItemAsync(KEY)) ?? null;
    }
  } catch {
    /* fall through */
  }
  return mem.get(KEY) ?? null;
}

export async function loadPrefs(): Promise<MobileRemotePrefs> {
  const raw = await getRaw();
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: MobileRemotePrefs): Promise<void> {
  await setRaw(JSON.stringify(normalize(prefs)));
}

export async function clearPrefs(): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.deleteItemAsync) {
      await SecureStore.deleteItemAsync(KEY);
      mem.delete(KEY);
      return;
    }
  } catch {
    /* fall through */
  }
  mem.delete(KEY);
}

/** Diff new inbox ids against seen set; returns newly appeared ids. */
export function diffNewInboxIds(
  seen: string[],
  current: string[],
): { newIds: string[]; nextSeen: string[] } {
  const seenSet = new Set(seen);
  const newIds = current.filter((id) => !seenSet.has(id));
  return { newIds, nextSeen: [...current] };
}
