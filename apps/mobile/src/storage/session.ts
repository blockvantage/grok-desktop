/**
 * Session persistence. In React Native uses SecureStore; in Node tests uses memory.
 *
 * Load path validates shape and field lengths so corrupt/tampered SecureStore
 * rows cannot inject unbounded strings into the remote client.
 */
export type StoredSession = {
  machineId: string;
  machinePub: string;
  deviceId: string;
  deviceToken: string;
  channel: string;
  relay: string;
  pairSecret: string;
  deviceSecretB64: string;
  devicePubB64: string;
  deviceLabel: string;
  /** Epoch ms when pair/rekey last succeeded (CX-14). */
  pairedAt?: number;
  /** Epoch ms of last successful rekey. */
  lastRekeyAt?: number;
};

const mem = new Map<string, string>();

const ID_MAX = 128;
const KEY_MAX = 256;
const TOKEN_MAX = 256;
const CHANNEL_MAX = 256;
const RELAY_MAX = 2048;
const LABEL_MAX = 64;

function boundedString(
  v: unknown,
  max: number,
): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.length < 1 || s.length > max) return null;
  return s;
}

function optionalEpochMs(v: unknown): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) return undefined;
  if (v < 0 || v > 4102444800000) return undefined; // ~2100
  return Math.floor(v);
}

/**
 * Parse and validate a stored session blob. Returns null when corrupt.
 * Exported for unit tests.
 */
export function parseStoredSession(raw: string): StoredSession | null {
  if (!raw || raw.length > 16_384) return null;
  let o: unknown;
  try {
    o = JSON.parse(raw);
  } catch {
    return null;
  }
  if (o == null || typeof o !== "object" || Array.isArray(o)) return null;
  const rec = o as Record<string, unknown>;

  const machineId = boundedString(rec.machineId, ID_MAX);
  const machinePub = boundedString(rec.machinePub, KEY_MAX);
  const deviceId = boundedString(rec.deviceId, ID_MAX);
  const deviceToken = boundedString(rec.deviceToken, TOKEN_MAX);
  const channel = boundedString(rec.channel, CHANNEL_MAX);
  const relay = boundedString(rec.relay, RELAY_MAX);
  const pairSecret = boundedString(rec.pairSecret, TOKEN_MAX);
  const deviceSecretB64 = boundedString(rec.deviceSecretB64, KEY_MAX);
  const devicePubB64 = boundedString(rec.devicePubB64, KEY_MAX);
  const deviceLabel = boundedString(rec.deviceLabel, LABEL_MAX);

  if (
    !machineId ||
    !machinePub ||
    !deviceId ||
    !deviceToken ||
    !channel ||
    !relay ||
    !pairSecret ||
    !deviceSecretB64 ||
    !devicePubB64 ||
    !deviceLabel
  ) {
    return null;
  }

  const pairedAt = optionalEpochMs(rec.pairedAt);
  const lastRekeyAt = optionalEpochMs(rec.lastRekeyAt);

  return {
    machineId,
    machinePub,
    deviceId,
    deviceToken,
    channel,
    relay,
    pairSecret,
    deviceSecretB64,
    devicePubB64,
    deviceLabel,
    ...(pairedAt !== undefined ? { pairedAt } : {}),
    ...(lastRekeyAt !== undefined ? { lastRekeyAt } : {}),
  };
}

export async function saveSession(session: StoredSession): Promise<void> {
  // Re-validate on write so callers cannot persist garbage.
  const checked = parseStoredSession(JSON.stringify(session));
  if (!checked) {
    throw new Error("Invalid remote session shape");
  }
  const raw = JSON.stringify(checked);
  try {
    // Dynamic import so vitest/node does not need expo
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.setItemAsync) {
      await SecureStore.setItemAsync("remote.session", raw);
      return;
    }
  } catch {
    /* fall through */
  }
  mem.set("remote.session", raw);
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.getItemAsync) {
      const raw = await SecureStore.getItemAsync("remote.session");
      if (!raw) return null;
      const parsed = parseStoredSession(raw);
      if (!parsed) {
        // Corrupt row — drop so the user can re-pair cleanly.
        await clearSession();
        return null;
      }
      return parsed;
    }
  } catch {
    /* fall through */
  }
  const raw = mem.get("remote.session");
  if (!raw) return null;
  const parsed = parseStoredSession(raw);
  if (!parsed) {
    mem.delete("remote.session");
    return null;
  }
  return parsed;
}

export async function clearSession(): Promise<void> {
  try {
    const SecureStore = await import("expo-secure-store").catch(() => null);
    if (SecureStore?.deleteItemAsync) {
      await SecureStore.deleteItemAsync("remote.session");
      mem.delete("remote.session");
      return;
    }
  } catch {
    /* fall through */
  }
  mem.delete("remote.session");
}
