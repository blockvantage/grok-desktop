/**
 * Pin important conversations to the top of the chat list.
 * Durable local preference; no new nav tab.
 */

const STORAGE_KEY = "grokdesk.pinned-chats.v1";
const MAX_PINS = 24;

export type PinStore = {
  /** Ordered pin ids (most recently pinned first). */
  ids: string[];
};

export function emptyPinStore(): PinStore {
  return { ids: [] };
}

export function loadPinStore(
  storage: Pick<Storage, "getItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): PinStore {
  if (!storage) return emptyPinStore();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return emptyPinStore();
    if (raw.length > 50_000) return emptyPinStore();
    const parsed = JSON.parse(raw) as Partial<PinStore>;
    if (!Array.isArray(parsed.ids)) return emptyPinStore();
    return {
      ids: parsed.ids
        .filter(
          (id): id is string =>
            typeof id === "string" && id.length > 0 && id.length <= 128,
        )
        .slice(0, MAX_PINS),
    };
  } catch {
    return emptyPinStore();
  }
}

export function savePinStore(
  store: PinStore,
  storage: Pick<Storage, "setItem"> | null =
    typeof localStorage !== "undefined" ? localStorage : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    /* */
  }
}

export function isPinned(store: PinStore, chatId: string): boolean {
  return store.ids.includes(chatId);
}

export function pinChat(store: PinStore, chatId: string): PinStore {
  if (!chatId) return store;
  const ids = [chatId, ...store.ids.filter((id) => id !== chatId)].slice(
    0,
    MAX_PINS,
  );
  return { ids };
}

export function unpinChat(store: PinStore, chatId: string): PinStore {
  return { ids: store.ids.filter((id) => id !== chatId) };
}

export function togglePin(store: PinStore, chatId: string): PinStore {
  return isPinned(store, chatId) ? unpinChat(store, chatId) : pinChat(store, chatId);
}

export type PinnableChat = {
  id: string;
  updatedAt: string;
};

/**
 * Sort chats: pinned (in pin order) first, then unpinned by updatedAt desc.
 */
export function sortChatsWithPins<T extends PinnableChat>(
  chats: T[],
  store: PinStore,
): T[] {
  const byId = new Map(chats.map((c) => [c.id, c]));
  const pinned: T[] = [];
  for (const id of store.ids) {
    const c = byId.get(id);
    if (c) pinned.push(c);
  }
  const pinnedSet = new Set(pinned.map((c) => c.id));
  const rest = chats
    .filter((c) => !pinnedSet.has(c.id))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return [...pinned, ...rest];
}

/** Prune pins for chats that no longer exist. */
export function prunePins(store: PinStore, existingIds: Set<string>): PinStore {
  return { ids: store.ids.filter((id) => existingIds.has(id)) };
}

export { STORAGE_KEY as PIN_STORAGE_KEY };
