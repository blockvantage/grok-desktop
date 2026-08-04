import { describe, expect, it } from "vitest";
import {
  planHomeDraftHydration,
  shouldBlockNewRootSubmit,
} from "./home-draft-hydrate";
import { emptyWorkSession, type WorkSessionSnapshot } from "./work-session";
import type { PendingMutationRecord } from "./client-mutation";

const now = new Date("2026-08-03T12:00:00.000Z");

function session(
  partial: Partial<WorkSessionSnapshot>,
): WorkSessionSnapshot {
  return {
    ...emptyWorkSession(),
    updatedAt: now.toISOString(),
    ...partial,
  };
}

describe("planHomeDraftHydration", () => {
  it("restores a home draft and workspace root before interactive use", () => {
    const h = planHomeDraftHydration({
      session: session({
        draft: "organize my downloads folder carefully",
        surface: "home",
        workspaceRoot: "/Users/me/Downloads",
        attachmentPaths: ["/tmp/a.png"],
      }),
      now,
    });
    expect(h.goal).toBe("organize my downloads folder carefully");
    expect(h.root).toBe("/Users/me/Downloads");
    expect(h.attachmentPaths).toEqual(["/tmp/a.png"]);
    expect(h.showDraftRestored).toBe(true);
    expect(h.resumeConversationId).toBeNull();
  });

  it("does not resurrect a deliberately cleared empty draft", () => {
    const h = planHomeDraftHydration({
      session: session({
        draft: "",
        draftCleared: true,
        surface: "home",
        workspaceRoot: "/old",
        attachmentPaths: ["/tmp/gone.png"],
      }),
      now,
    });
    expect(h.goal).toBe("");
    expect(h.showDraftRestored).toBe(false);
    expect(h.attachmentPaths).toEqual([]);
  });

  it("returns empty goal for corrupted/empty session", () => {
    const h = planHomeDraftHydration({
      session: emptyWorkSession(),
      now,
    });
    expect(h.goal).toBe("");
    expect(h.showDraftRestored).toBe(false);
    expect(h.pendingMutation).toBeNull();
  });

  it("keeps pending root mutation exact id and payload for reconcile", () => {
    const pending: PendingMutationRecord = {
      clientMutationId: "root-mut-1",
      method: "tasks.create",
      payload: { goal: "survive crash", clientMutationId: "root-mut-1" },
      createdAt: now.toISOString(),
    };
    const h = planHomeDraftHydration({
      session: session({ draft: "partial typed" }),
      pendingMutation: pending,
      now,
    });
    expect(h.pendingMutation?.clientMutationId).toBe("root-mut-1");
    expect(h.pendingMutation?.payload).toEqual(pending.payload);
    expect(shouldBlockNewRootSubmit(h.pendingMutation)).toBe(true);
  });

  it("opens conversation resume without forcing home draft when workspace-focused", () => {
    const h = planHomeDraftHydration({
      session: session({
        surface: "workspace",
        conversationId: "chat-9",
        draft: "follow-up draft text here",
      }),
      now,
    });
    expect(h.resumeConversationId).toBe("chat-9");
    expect(h.goal).toBe("follow-up draft text here");
  });
});

describe("shouldBlockNewRootSubmit", () => {
  it("blocks only tasks.create pending records with a stable id", () => {
    expect(shouldBlockNewRootSubmit(null)).toBe(false);
    expect(
      shouldBlockNewRootSubmit({
        clientMutationId: "x",
        method: "outbox.enqueue",
        payload: {},
        createdAt: now.toISOString(),
      }),
    ).toBe(false);
    expect(
      shouldBlockNewRootSubmit({
        clientMutationId: "x",
        method: "tasks.create",
        payload: { goal: "g" },
        createdAt: now.toISOString(),
      }),
    ).toBe(true);
  });
});
