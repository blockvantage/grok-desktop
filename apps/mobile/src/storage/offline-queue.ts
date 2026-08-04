/**
 * Durable offline mutation queue. SecureStore on device; memory in Node/tests.
 */
import {
  parseOfflineQueue,
  serializeOfflineQueue,
  type OfflineQueueItem,
} from "@grokdesk/shared/remote";

const KEY = "remote.offlineQueue";
const mem = new Map<string, string>();

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

export async function loadOfflineQueue(): Promise<OfflineQueueItem[]> {
  return parseOfflineQueue(await getRaw());
}

export async function saveOfflineQueue(items: OfflineQueueItem[]): Promise<void> {
  if (items.length === 0) {
    await clearOfflineQueue();
    return;
  }
  await setRaw(serializeOfflineQueue(items));
}

export async function clearOfflineQueue(): Promise<void> {
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
