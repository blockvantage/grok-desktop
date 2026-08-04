import { describe, it, expect, beforeEach } from "vitest";
import {
  beginMutation,
  clearPendingMutation,
  newClientMutationId,
  readPendingMutation,
  writePendingMutation,
} from "./client-mutation";

function mem() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
  };
}

describe("client-mutation", () => {
  let storage: ReturnType<typeof mem>;

  beforeEach(() => {
    storage = mem();
  });

  it("generates stable non-empty ids", () => {
    const a = newClientMutationId();
    const b = newClientMutationId();
    expect(a.length).toBeGreaterThan(8);
    expect(a).not.toBe(b);
  });

  it("reuses pending id for same method and payload across retries", () => {
    const payload = { goal: "hello", workspaceRoots: ["/tmp"] };
    const first = beginMutation({
      method: "tasks.create",
      payload,
      storage,
    });
    const retry = beginMutation({
      method: "tasks.create",
      payload,
      storage,
    });
    expect(retry.clientMutationId).toBe(first.clientMutationId);
  });

  it("allocates a new id when payload differs", () => {
    const first = beginMutation({
      method: "tasks.create",
      payload: { goal: "a" },
      storage,
    });
    const second = beginMutation({
      method: "tasks.create",
      payload: { goal: "b" },
      storage,
    });
    expect(second.clientMutationId).not.toBe(first.clientMutationId);
  });

  it("clears after acceptance so remount does not resend stale payload", () => {
    writePendingMutation(
      {
        clientMutationId: "x",
        method: "tasks.create",
        payload: { goal: "g" },
        createdAt: new Date().toISOString(),
      },
      storage,
    );
    expect(readPendingMutation(storage)?.clientMutationId).toBe("x");
    clearPendingMutation(storage);
    expect(readPendingMutation(storage)).toBeNull();
  });
});
