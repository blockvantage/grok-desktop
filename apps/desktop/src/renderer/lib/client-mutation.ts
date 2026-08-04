/**
 * Stable clientMutationId helpers for chat mutations.
 * Never generate a new id inside a retry callback — reuse the pending record.
 */

const PENDING_KEY = "grokdesk.pending-mutation.v1";

export type PendingMutationRecord = {
  clientMutationId: string;
  method: string;
  /** Exact request payload to resend on ambiguous failure. */
  payload: Record<string, unknown>;
  createdAt: string;
};

export function newClientMutationId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `mut-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export function readPendingMutation(
  storage: Pick<Storage, "getItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): PendingMutationRecord | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(PENDING_KEY);
    if (!raw || raw.length > 500_000) return null;
    const parsed = JSON.parse(raw) as Partial<PendingMutationRecord>;
    if (
      typeof parsed.clientMutationId !== "string" ||
      !parsed.clientMutationId ||
      typeof parsed.method !== "string" ||
      !parsed.payload ||
      typeof parsed.payload !== "object"
    ) {
      return null;
    }
    return {
      clientMutationId: parsed.clientMutationId,
      method: parsed.method,
      payload: parsed.payload as Record<string, unknown>,
      createdAt:
        typeof parsed.createdAt === "string"
          ? parsed.createdAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writePendingMutation(
  record: PendingMutationRecord,
  storage: Pick<Storage, "setItem"> | null = typeof localStorage !== "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.setItem(PENDING_KEY, JSON.stringify(record));
  } catch {
    /* quota */
  }
}

export function clearPendingMutation(
  storage: Pick<Storage, "removeItem"> | null = typeof localStorage !==
  "undefined"
    ? localStorage
    : null,
): void {
  if (!storage) return;
  try {
    storage.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Begin a mutation: reuse an existing pending record for the same method when
 * payloads match; otherwise create a new stable id and persist the request.
 */
export function beginMutation(input: {
  method: string;
  payload: Record<string, unknown>;
  /** Optional pre-allocated id (e.g. outbox item id). */
  clientMutationId?: string;
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
}): PendingMutationRecord {
  const storage =
    input.storage ??
    (typeof localStorage !== "undefined" ? localStorage : null);
  const existing = readPendingMutation(storage);
  if (
    existing &&
    existing.method === input.method &&
    stableEqual(existing.payload, input.payload)
  ) {
    return existing;
  }
  const record: PendingMutationRecord = {
    clientMutationId: input.clientMutationId?.trim() || newClientMutationId(),
    method: input.method,
    payload: input.payload,
    createdAt: new Date().toISOString(),
  };
  writePendingMutation(record, storage);
  return record;
}

function stableEqual(a: unknown, b: unknown): boolean {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}
